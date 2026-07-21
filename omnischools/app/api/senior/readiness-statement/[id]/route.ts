import { and, eq } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { getCurrentUser } from "@/lib/auth";
import { hasAnyRole, WASSCE_SETUP_ROLES } from "@/lib/access";
import { withSchool, withParentScope } from "@/lib/db/rls";
import { readinessStatements } from "@/db/schema";
import { loadReadinessStatementForPdf } from "@/lib/wassce/readiness-data";
import { renderReadinessStatementPdf } from "@/lib/pdf/render-readiness-statement";

// @react-pdf/renderer is Node-only (fontkit); never run this on the edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/senior/readiness-statement/[id] — the authenticated WASSCE readiness-statement PDF (SHS
 * module 4.3 / INCR-17). Re-renders the ACADEMIC block ON DEMAND from the frozen `readiness_statements`
 * snapshot (Ruling 4; no files table, no new PDF dep — mirrors the #136 receipt route). Enforced
 * server-side: requireSchool + WASSCE_SETUP_ROLES for staff; withSchool scopes every read so a statement
 * can never leak across tenants (AC19). Since INCR-17b/AC20 it ALSO renders the university block — read
 * from the same frozen `target_universities_json` snapshot, never live. INCR-19b adds a PARENT reader who
 * owns the statement (ownership proven under withParentScope before any render); STUDENT/TEACHER denied.
 */
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const { school } = await requireSchool();

  const user = await getCurrentUser();
  if (!user) return new Response("Forbidden", { status: 403 });

  const params = await props.params;

  // INCR-19b — a PARENT may open THEIR OWN child's CURRENT statement PDF (Lucy control #7). Authorised
  // through the 19a boundary: the id must be visible under withParentScope (readiness_statements is
  // parent-scoped to the current, non-superseded rows of the parent's own children). Staff keep the
  // WASSCE_SETUP_ROLES gate; every other role is denied.
  const isStaffReader = hasAnyRole(user.roles, WASSCE_SETUP_ROLES);
  if (!isStaffReader) {
    if (!user.roles.includes("PARENT")) return new Response("Forbidden", { status: 403 });
    const owned = await withParentScope(school.id, user.id, (tx) =>
      tx
        .select({ id: readinessStatements.id })
        .from(readinessStatements)
        .where(and(eq(readinessStatements.schoolId, school.id), eq(readinessStatements.id, params.id)))
        .limit(1),
    );
    if (owned.length === 0) return new Response("Forbidden", { status: 403 });
  }
  const data = await withSchool(school.id, (tx) =>
    loadReadinessStatementForPdf(tx, school.id, params.id),
  );
  if (!data) return new Response("Readiness statement not found", { status: 404 });

  const pdf = await renderReadinessStatementPdf(data);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Readiness-${data.candidate.indexNumber}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
