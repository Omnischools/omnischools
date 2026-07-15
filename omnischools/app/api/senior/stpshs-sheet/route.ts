import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { getCurrentUser } from "@/lib/auth";
import { hasAnyRole, SENIOR_LEDGER_ROLES, SENIOR_MANAGEMENT_ROLES } from "@/lib/access";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { seniorSubjectTeacher } from "@/db/schema";
import { buildStpshsSheetData } from "@/lib/data/stpshs-sheet-data";
import { renderStpshsSheetPdf } from "@/lib/pdf/render-stpshs-sheet";
import type { StpshsSheetData } from "@/lib/pdf/stpshs-score-sheet-document";
import {
  overHundredCells,
  rosterQualifies,
  STPSHS_CATEGORY_LABEL,
  type OverHundredCell,
} from "@/lib/score-ledger/stpshs-sheet";

// @react-pdf/renderer is Node-only (fontkit); never run this on the edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  classId: z.string().uuid(),
  subjectId: z.string().uuid(),
  periodId: z.string().uuid(),
});

/**
 * GET /api/senior/stpshs-sheet?classId&subjectId&periodId[&ack=1] — the authenticated STPSHS
 * printable score-sheet download (INCR-3 · Item 8). Keyed by class×subject×period IDs only (no
 * PII in the URL). Enforced SERVER-SIDE (not UI-only):
 *  - H2/H3: teaching/leadership roles; a TEACHER/FORM_MASTER only for a class×subject they own.
 *  - Q3: reject unless every ACTIVE student is COMPLETE/STPSHS_READY.
 *  - Q5: reject if any qualifying category stored >100 and the ack-and-cap param is absent; the
 *    rejection names the offending student+category cells. With ack, cap-to-100 applies (the
 *    stored ledger value is unchanged) and the acknowledged cell keys ride the audit row (G7).
 *  - I1/I2: a successful generation writes one auditLog row (STPSHS_SHEET_GENERATED) with NO
 *    score values and no PII beyond class/subject/period (+ acknowledged cell keys, never marks).
 */
export async function GET(req: Request) {
  const { school } = await requireSchool();

  // H2 — teaching/leadership only; STUDENT/PARENT/BURSAR denied with an explicit 403.
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
  const ack = url.searchParams.get("ack") === "1";
  const isManagement = hasAnyRole(user.roles, SENIOR_MANAGEMENT_ROLES);

  type Outcome =
    | { kind: "deny"; status: number; message: string }
    | { kind: "ok"; data: StpshsSheetData; acknowledged: OverHundredCell[] };

  const outcome: Outcome = await withSchool(school.id, async (tx) => {
    // H3 — a TEACHER/FORM_MASTER may generate only for a class×subject they teach; management
    // (ADMIN/HEADMASTER/VHM) generate any within their school.
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

    const build = await buildStpshsSheetData(tx, school.id, ctx);
    if (!build) {
      return {
        kind: "deny",
        status: 404,
        message: "No ledger found for this class, subject and semester.",
      };
    }

    // Q3 — completeness gate for the whole active roster.
    if (!rosterQualifies(build.gateRows.map((r) => r.status))) {
      return {
        kind: "deny",
        status: 409,
        message:
          "Every active student must have all five categories filled (COMPLETE) before the STPSHS sheet can be generated.",
      };
    }

    // Q5 — over-100 gate. Without the ack-and-cap param, reject and name the offending cells.
    const over = overHundredCells(build.gateRows);
    if (over.length > 0 && !ack) {
      const named = over.map((c) => `${c.name} · ${STPSHS_CATEGORY_LABEL[c.category]}`).join("; ");
      return {
        kind: "deny",
        status: 409,
        message: `Resolve the score(s) over 100 before generating — ${named}. Correct each to 100 or below, or acknowledge to cap them at 100 for the STPSHS export.`,
      };
    }

    return { kind: "ok", data: build.data, acknowledged: ack ? over : [] };
  });

  if (outcome.kind === "deny") {
    return new Response(outcome.message, { status: outcome.status });
  }

  const pdf = await renderStpshsSheetPdf(outcome.data);

  // I1/I2/G7 — audit only a successful generation (a rejected one writes nothing, I3). The
  // payload carries who / class×subject×period / when + the acknowledged cell keys when capped;
  // it NEVER carries score values or student names.
  const actor = await resolveActor(school.id);
  await withSchool(school.id, (tx) =>
    recordAudit(tx, {
      schoolId: school.id,
      actorUserId: actor.id ?? undefined,
      actorRole: actor.role,
      actionType: "STPSHS_SHEET_GENERATED",
      entityType: "senior_score_ledger",
      entityId: ctx.subjectId,
      after: {
        classId: ctx.classId,
        subjectId: ctx.subjectId,
        periodId: ctx.periodId,
        students: outcome.data.rows.length,
        acknowledgedCells: outcome.acknowledged.length
          ? outcome.acknowledged.map((c) => `${c.studentId}:${c.category}`)
          : undefined,
      },
      reason: "STPSHS printable score sheet generated",
    }),
  );

  const filename = `STPSHS-${outcome.data.subject}-${outcome.data.yearLabel}-${outcome.data.semLabel}.pdf`.replace(
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
