import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import {
  students,
  classes,
  subjects,
  users,
  seniorScoreLedger,
  seniorLedgerPath,
  seniorSubjectTeacher,
} from "@/db/schema";

export type CapturePath = "AUTO_COMPILE" | "SCAN_EXTRACT" | "DIRECT_ENTRY";
/** STPSHS readiness tier (spec §6.1 / surface §1.7). Never-started folds into at_risk. */
export type VhmStatus = "ready" | "behind" | "at_risk";

/**
 * One (class × subject) row of the Vice Headmaster Academic progress view.
 * COMPLETION ONLY — the number of students who have each category *entered*, never the
 * score values themselves (spec §6.2). The Vice Headmaster sees whether work is done,
 * not what the marks are.
 */
export type VhmProgressRow = {
  classId: string;
  className: string;
  subjectId: string;
  subjectName: string;
  path: CapturePath;
  teacherName: string | null;
  rosterSize: number;
  filled: {
    asgn: number;
    midSem: number;
    endSem: number;
    project: number;
    portfolio: number;
  };
  categoriesDone: number; // of 5 — categories where EVERY student has an entry (the "n/5")
  lastActivityAt: Date | null;
  daysInactive: number | null;
  status: VhmStatus;
  flags: string[];
};

/** ref_anomaly_rule LEDGER-INACTIVE-14 threshold (spec §6.3). */
const INACTIVE_DAYS = 14;

const DAY_MS = 86_400_000;

/**
 * The STPSHS "n/5" and tier from the per-category filled counts (surface §1.7 / §1.11).
 * `categoriesDone` = categories EVERY active student has entered (partials don't count).
 * Tier: 5/5 = ready · 0/5 = at_risk (incl. never-started) · in between = behind. Pure &
 * side-effect-free so it is unit-tested directly.
 *
 * LIMITATION (roster vs enrolment): `rosterSize` is the whole active class. Once elective
 * subjects exist (only some of a class take a subject), a category could read "partial"
 * forever because not every class member is enrolled in it. All current subjects are
 * class-wide; revisit with a per-subject enrolment model (see the follow-up task).
 */
export function computeVhmTier(
  filled: { asgn: number; midSem: number; endSem: number; project: number; portfolio: number },
  rosterSize: number,
): { categoriesDone: number; status: VhmStatus } {
  const categoriesDone =
    rosterSize > 0
      ? [filled.asgn, filled.midSem, filled.endSem, filled.project, filled.portfolio].filter(
          (c) => c === rosterSize,
        ).length
      : 0;
  const status: VhmStatus =
    categoriesDone === 5 ? "ready" : categoriesDone === 0 ? "at_risk" : "behind";
  return { categoriesDone, status };
}

/**
 * Aggregate ledger completion for the Vice Headmaster progress view (spec §6). One row per
 * teaching assignment (senior_subject_teacher) for the period, LEFT JOINed to progress — so a
 * teacher who has started nothing still appears (§6.1). Per-category counts are computed with
 * SQL `count(*) filter (…)` so raw scores never leave the DB (§6.2). The STPSHS "n/5" tier is
 * the number of categories EVERY student has entered; never-started folds into at_risk.
 */
export async function loadVhmProgress(
  tx: Tx,
  schoolId: string,
  periodId: string,
  now: Date,
): Promise<VhmProgressRow[]> {
  // Enumeration source: the teaching assignments (spec §6.1). A teacher who has started
  // nothing still gets a row — enumerate from what's EXPECTED, LEFT JOIN progress, never
  // from what's started, or the most at-risk (never-started) teachers become invisible.
  const assignments = await tx
    .select({
      classId: seniorSubjectTeacher.classId,
      subjectId: seniorSubjectTeacher.subjectId,
      teacherUserId: seniorSubjectTeacher.teacherUserId,
    })
    .from(seniorSubjectTeacher)
    .where(eq(seniorSubjectTeacher.schoolId, schoolId));
  if (assignments.length === 0) return [];

  // Per (class, subject) completion counts — join students to resolve the class; count in
  // SQL so no score value is ever selected into app memory (§6.2 discipline).
  const agg = await tx
    .select({
      classId: students.classId,
      subjectId: seniorScoreLedger.subjectId,
      asgn: sql<number>`count(*) filter (where ${seniorScoreLedger.asgnScore} is not null)`.mapWith(
        Number,
      ),
      midSem:
        sql<number>`count(*) filter (where ${seniorScoreLedger.midSemScore} is not null)`.mapWith(
          Number,
        ),
      endSem:
        sql<number>`count(*) filter (where ${seniorScoreLedger.endSemScore} is not null)`.mapWith(
          Number,
        ),
      project:
        sql<number>`count(*) filter (where ${seniorScoreLedger.projectScore} is not null)`.mapWith(
          Number,
        ),
      portfolio:
        sql<number>`count(*) filter (where ${seniorScoreLedger.portfolioScore} is not null)`.mapWith(
          Number,
        ),
      lastActivityAt: sql<Date | null>`max(${seniorScoreLedger.updatedAt})`,
    })
    .from(seniorScoreLedger)
    .innerJoin(
      students,
      and(
        eq(students.schoolId, seniorScoreLedger.schoolId),
        eq(students.id, seniorScoreLedger.studentId),
      ),
    )
    .where(
      and(
        eq(seniorScoreLedger.schoolId, schoolId),
        eq(seniorScoreLedger.periodId, periodId),
        eq(students.status, "ACTIVE"),
        isNotNull(students.classId),
      ),
    )
    .groupBy(students.classId, seniorScoreLedger.subjectId);

  // Chosen capture paths for the period (a context may have a path but no entries yet).
  const paths = await tx
    .select({
      classId: seniorLedgerPath.classId,
      subjectId: seniorLedgerPath.subjectId,
      path: seniorLedgerPath.path,
      updatedByUserId: seniorLedgerPath.updatedByUserId,
      updatedAt: seniorLedgerPath.updatedAt,
    })
    .from(seniorLedgerPath)
    .where(
      and(
        eq(seniorLedgerPath.schoolId, schoolId),
        eq(seniorLedgerPath.periodId, periodId),
      ),
    );

  // Active roster size per class.
  const rosters = await tx
    .select({
      classId: students.classId,
      size: sql<number>`count(*)`.mapWith(Number),
    })
    .from(students)
    .where(
      and(
        eq(students.schoolId, schoolId),
        eq(students.status, "ACTIVE"),
        isNotNull(students.classId),
      ),
    )
    .groupBy(students.classId);
  const rosterByClass = new Map(rosters.map((r) => [r.classId as string, r.size]));

  const cls = await tx
    .select({ id: classes.id, name: classes.name })
    .from(classes)
    .where(eq(classes.schoolId, schoolId));
  const classById = new Map(cls.map((c) => [c.id, c]));
  const subs = await tx
    .select({ id: subjects.id, name: subjects.name })
    .from(subjects)
    .where(eq(subjects.schoolId, schoolId));
  const subjectById = new Map(subs.map((s) => [s.id, s.name]));

  const pathByCtx = new Map(paths.map((p) => [`${p.classId}:${p.subjectId}`, p]));

  // Resolve teacher names — bounded to the referenced ids (ref_user is a global table).
  const userIds = Array.from(new Set(assignments.map((a) => a.teacherUserId)));
  const nameById = new Map<string, string | null>();
  if (userIds.length > 0) {
    const rows = await tx
      .select({ id: users.id, name: users.fullName })
      .from(users)
      .where(inArray(users.id, userIds));
    for (const u of rows) nameById.set(u.id, u.name);
  }

  const aggByCtx = new Map(
    agg.filter((a) => a.classId).map((a) => [`${a.classId}:${a.subjectId}`, a]),
  );

  const out: VhmProgressRow[] = [];
  for (const asn of assignments) {
    const classId = asn.classId;
    const subjectId = asn.subjectId;
    const key = `${classId}:${subjectId}`;
    const a = aggByCtx.get(key);
    const p = pathByCtx.get(key);
    const cl = classById.get(classId);
    const rosterSize = rosterByClass.get(classId) ?? 0;
    const teacherId: string | null = asn.teacherUserId;
    const filled = {
      asgn: a?.asgn ?? 0,
      midSem: a?.midSem ?? 0,
      endSem: a?.endSem ?? 0,
      project: a?.project ?? 0,
      portfolio: a?.portfolio ?? 0,
    };
    // "n/5" and STPSHS tier (§1.7 / §1.11) — the same pure function unit tests exercise.
    const { categoriesDone, status } = computeVhmTier(filled, rosterSize);

    // Last activity across the ledger and the path row.
    const stamps: Date[] = [];
    if (a?.lastActivityAt) stamps.push(new Date(a.lastActivityAt));
    if (p?.updatedAt) stamps.push(new Date(p.updatedAt));
    const lastActivityAt = stamps.length
      ? new Date(Math.max(...stamps.map((d) => d.getTime())))
      : null;
    const daysInactive = lastActivityAt
      ? Math.floor((now.getTime() - lastActivityAt.getTime()) / DAY_MS)
      : null;

    const flags: string[] = [];
    if (daysInactive != null && daysInactive >= INACTIVE_DAYS && status !== "ready") {
      flags.push(`Teacher inactive ${daysInactive} days`);
    }

    out.push({
      classId,
      className: cl?.name ?? "—",
      subjectId,
      subjectName: subjectById.get(subjectId) ?? "—",
      path: (p?.path ?? "AUTO_COMPILE") as CapturePath,
      teacherName: teacherId ? (nameById.get(teacherId) ?? null) : null,
      rosterSize,
      filled,
      categoriesDone,
      lastActivityAt,
      daysInactive,
      status,
      flags,
    });
  }

  // Default sort (§6.1): most-behind first (so the VHM sees who's at risk), then by name.
  const rank: Record<VhmStatus, number> = { at_risk: 0, behind: 1, ready: 2 };
  // Staleness tiebreak: a never-touched row (null) is the MOST stale — it sorts first among
  // equals, so a never-started teacher isn't buried under one merely touched today (Quinn).
  const staleness = (d: number | null) => d ?? Number.MAX_SAFE_INTEGER;
  out.sort(
    (x, y) =>
      rank[x.status] - rank[y.status] ||
      x.categoriesDone - y.categoriesDone ||
      staleness(y.daysInactive) - staleness(x.daysInactive) ||
      x.className.localeCompare(y.className) ||
      x.subjectName.localeCompare(y.subjectName),
  );
  return out;
}
