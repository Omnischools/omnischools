import { requireSchool } from "@/lib/auth/server";
import { getCurrentUser } from "@/lib/auth";
import { hasAnyRole, WASSCE_SETUP_ROLES } from "@/lib/access";
import { withSchool } from "@/lib/db/rls";
import { loadReadinessStatementForPdf } from "@/lib/wassce/readiness-data";
import { renderReadinessStatementPdf } from "@/lib/pdf/render-readiness-statement";

// @react-pdf/renderer is Node-only (fontkit); never run this on the edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/senior/readiness-statement/[id] — the authenticated WASSCE readiness-statement PDF (SHS
 * module 4.3 / INCR-17). Re-renders the ACADEMIC block ON DEMAND from the frozen `readiness_statements`
 * snapshot (Ruling 4; no files table, no new PDF dep — mirrors the #136 receipt route). Enforced
 * server-side: requireSchool + WASSCE_SETUP_ROLES (STUDENT/PARENT/TEACHER denied 403); withSchool scopes
 * every read so a statement can never leak across tenants (AC19). Since INCR-17b/AC20 it ALSO renders the
 * university block — read from the same frozen `target_universities_json` snapshot, never live.
 */
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const { school } = await requireSchool();

  const user = await getCurrentUser();
  if (!user || !hasAnyRole(user.roles, WASSCE_SETUP_ROLES)) {
    return new Response("Forbidden", { status: 403 });
  }

  const params = await props.params;
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
