import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { getCurrentUser } from "@/lib/auth";
import { hasAnyRole, SENIOR_LEDGER_ROLES, SENIOR_MANAGEMENT_ROLES } from "@/lib/access";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { seniorSubjectTeacher } from "@/db/schema";
import { buildLedgerBookData } from "@/lib/data/ledger-book-data";
import { renderLedgerBookPdf } from "@/lib/pdf/render-ledger-book";
import type { LedgerBookData } from "@/lib/pdf/ledger-book-document";

// @react-pdf/renderer is Node-only (fontkit); never run this on the edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  classId: z.string().uuid(),
  subjectId: z.string().uuid(),
  periodId: z.string().uuid(),
});

/**
 * GET /api/senior/ledger-book?classId&subjectId&periodId — the authenticated Omnischools blank
 * paper ledger book download (INCR-5 · Item 6). Cloned from app/api/senior/stpshs-sheet, MINUS
 * the completeness (Q3) and over-100 (Q5) gates — the book is BLANK, so there are no scores to
 * gate on. Keyed by class×subject×period IDs only (no PII in the URL). Enforced SERVER-SIDE:
 *  - F2/F3: teaching/leadership roles; a TEACHER/FORM_MASTER only for a class×subject they own.
 *  - G1/G2: a successful generation writes one auditLog row (LEDGER_BOOK_GENERATED) carrying
 *    who / class×subject×period / when + the active-roster count — NO names, NO scores. A denied
 *    request writes nothing (G3).
 */
export async function GET(req: Request) {
  const { school } = await requireSchool();

  // F2 — teaching/leadership only; STUDENT/PARENT/BURSAR denied with an explicit 403.
  const user = await getCurrentUser();
  if (!user || !hasAnyRole(user.roles, SENIOR_LEDGER_ROLES)) {
    return new Response("Forbidden", { status: 403 });
  }

  const url = new URL(req.url);
  const parsed = Query.safeParse({
    classId: url.searchParams.get("classId"),
    subjectId: url.searchParams.get("subjectId"),
    periodId: url.searchParams.get("periodId"),
  });
  if (!parsed.success) return new Response("Invalid request", { status: 400 });
  const ctx = parsed.data;
  const isManagement = hasAnyRole(user.roles, SENIOR_MANAGEMENT_ROLES);

  type Outcome =
    | { kind: "deny"; status: number; message: string }
    | { kind: "ok"; data: LedgerBookData };

  const outcome: Outcome = await withSchool(school.id, async (tx) => {
    // F3 — a TEACHER/FORM_MASTER may print only for a class×subject they teach; management
    // (ADMIN/HEADMASTER/VHM) print any within their school.
    if (!isManagement) {
      const [assigned] = await tx
        .select({ id: seniorSubjectTeacher.id })
        .from(seniorSubjectTeacher)
        .where(
          and(
            eq(seniorSubjectTeacher.schoolId, school.id),
            eq(seniorSubjectTeacher.classId, ctx.classId),
            eq(seniorSubjectTeacher.subjectId, ctx.subjectId),
            eq(seniorSubjectTeacher.teacherUserId, user.id),
          ),
        );
      if (!assigned) {
        return {
          kind: "deny",
          status: 403,
          message: "You are not assigned to teach this subject to this class.",
        };
      }
    }

    const data = await buildLedgerBookData(tx, school.id, ctx);
    if (!data) {
      return {
        kind: "deny",
        status: 404,
        message: "No class, subject and semester found for this ledger book.",
      };
    }
    return { kind: "ok", data };
  });

  if (outcome.kind === "deny") {
    return new Response(outcome.message, { status: outcome.status });
  }

  const pdf = await renderLedgerBookPdf(outcome.data);

  // G1/G2 — audit only a successful generation (a denied one writes nothing, G3). The payload
  // carries who / class×subject×period / when + the active-roster count; it NEVER carries student
  // names or scores (the book has none), and the spare rows are not counted (I2).
  const actor = await resolveActor(school.id);
  await withSchool(school.id, (tx) =>
    recordAudit(tx, {
      schoolId: school.id,
      actorUserId: actor.id ?? undefined,
      actorRole: actor.role,
      actionType: "LEDGER_BOOK_GENERATED",
      entityType: "senior_score_ledger",
      entityId: ctx.subjectId,
      after: {
        classId: ctx.classId,
        subjectId: ctx.subjectId,
        periodId: ctx.periodId,
        students: outcome.data.rows.length,
      },
      reason: "Omnischools blank paper ledger book generated",
    }),
  );

  const filename = `Ledger-Book-${outcome.data.subject}-${outcome.data.yearLabel}-${outcome.data.semLabel}.pdf`.replace(
    /[^A-Za-z0-9._-]+/g,
    "-",
  );
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
