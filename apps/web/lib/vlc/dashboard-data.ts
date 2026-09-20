/**
 * 🔴 SERVER-ONLY VLC School dashboard read (SHS module 4.5 / INCR-44) — the HM/Dean/ADMIN school-wide
 * METADATA rollup. COUNTS / AVERAGES / DERIVED aggregates ONLY, NEVER confidential content.
 *
 * 🔴 THE METADATA BOUNDARY (R343 — the whole increment's value). This reader is the counts-only path. It
 * MUST NOT import the three confidential readers (getStudentCasework / getCharacterParagraph /
 * getPastoralFlags) and MUST NOT SELECT any `severity` / `context` / `surfaced_by` from vlc_pastoral_flag
 * or any `.body` / `.summary` / `.observed_by` from any `vlc_pastoral_*` table — only COUNT / AVG / derived.
 * It MAY join flag→student→class to compute a per-class GROUP-BY count (the student's `student_id` is a
 * JOIN key, NEVER a projected column) and MAY COUNT rows of a `vlc_pastoral_*` table (the reflection-count).
 * This preserves the 42b/43a sole-content-path invariant: the confidential columns stay projected ONLY in
 * pastoral-data.ts / paragraph-data.ts; this reader is in NEITHER list.
 *
 * EVERYTHING DERIVES (no stored scalar): sessions-held = COUNT(vlc_session); attendance % = enrolled −
 * ABSENT rows; curriculum coverage = DISTINCT classes with a session per value / classes; flag totals =
 * COUNT (open = resolved_at IS NULL, escalated = severity='CRISIS' AND open — severity used ONLY as a
 * FILTER predicate, never projected); per-class open-flag COUNT = GROUP BY the student's class; reflection
 * submission % = COUNT(distinct student with ≥1 journal) / enrolled. PG counts reuse the OPERATIONAL
 * peer-guides reader (NOT a confidential path). Tenant-scoped via withSchool; RLS is the boundary.
 */
import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import {
  classes,
  students,
  users,
  vlcSession,
  vlcSessionAttendance,
  vlcSessionTemplate,
  vlcValue,
  vlcPastoralFlag,
  vlcPastoralJournal,
} from "@/db/schema";
import { classFormNumber } from "@/lib/senior/form";
import { getPeerGuides } from "./peer-guides-data";

const PROGRAMME_LABEL: Record<string, string> = {
  GENERAL_ARTS: "General Arts",
  GENERAL_SCIENCE: "General Science",
  BUSINESS: "Business",
  AGRICULTURE: "Agriculture",
  VISUAL_ARTS: "Visual Arts",
  HOME_ECONOMICS: "Home Economics",
  TECHNICAL: "Technical",
};

const pct = (num: number, den: number): number | null =>
  den > 0 ? Math.round((num / den) * 100) : null;

// ── view types (plain serializable — the page renders these directly) ─────────────────────────────

export interface DashboardClassRow {
  classId: string;
  className: string;
  form: number;
  formLabel: string; // "F2"
  programmeLabel: string | null;
  enrolled: number;
  fmName: string | null;
  sessionsHeld: number;
  curriculumLabel: string | null; // "07B Patriotism" (latest value reached) | null (none yet)
  attendancePct: number | null;
  submissionPct: number | null; // bare COUNT (distinct journal submitters / enrolled) — no content
  pgFillLabel: string; // "2 / 2" | "1 / 2" | "—" (not eligible)
  pgVacancy: boolean;
  openFlagCount: number; // per-class OPEN-flag COUNT — class-level LOAD, no student/severity/why
}

export interface CoverageValue {
  ordinal: number;
  nameEn: string;
  nameTwi: string | null;
  ratePct: number; // % of classes that have reached the value
  state: "done" | "current" | "upcoming";
}

export interface FlagTotals {
  raised: number;
  open: number;
  escalated: number; // severity='CRISIS' AND open — a COUNT, never a per-student projection
  resolved: number;
}

export interface AttendanceByForm {
  form: number;
  formLabel: string;
  pct: number;
}

export interface DashboardView {
  classCount: number;
  sessionsHeld: number; // total school-wide
  yearProgressPct: number | null;
  sessionsHeldAvg: number; // representative "X of Y" numerator
  sessionsExpected: number; // active values × 2 slots
  avgAttendancePct: number | null;
  attendanceByForm: AttendanceByForm[];
  activePgCount: number;
  pgVacancyCount: number;
  trainingsDone: number;
  trainingPct: number | null;
  reflectionSubmissionPct: number | null; // class-avg bare COUNT — no journal content
  coverage: CoverageValue[];
  flags: FlagTotals;
  classes: DashboardClassRow[];
}

export async function getVlcDashboard(schoolId: string): Promise<DashboardView> {
  return withSchool(schoolId, async (tx) => {
    // ── classes (+ Form Master name) ──
    const classRows = await tx
      .select({
        id: classes.id,
        name: classes.name,
        level: classes.level,
        programme: classes.programme,
        fmName: users.fullName,
      })
      .from(classes)
      .leftJoin(users, eq(classes.classTeacherUserId, users.id))
      .where(eq(classes.schoolId, schoolId));

    // ── enrolled (ACTIVE) per class ──
    const enrolledRows = await tx
      .select({ classId: students.classId, n: sql<number>`count(*)::int` })
      .from(students)
      .where(and(eq(students.schoolId, schoolId), eq(students.status, "ACTIVE")))
      .groupBy(students.classId);
    const enrolledByClass = new Map(enrolledRows.map((r) => [r.classId, r.n]));

    // ── every held session (class × value ordinal/slot) — school-wide ──
    const sessionRows = await tx
      .select({
        id: vlcSession.id,
        classId: vlcSession.classId,
        ordinal: vlcValue.ordinal,
        nameEn: vlcValue.nameEn,
        slot: vlcSessionTemplate.slot,
      })
      .from(vlcSession)
      .innerJoin(
        vlcSessionTemplate,
        and(
          eq(vlcSessionTemplate.schoolId, vlcSession.schoolId),
          eq(vlcSessionTemplate.id, vlcSession.sessionTemplateId),
        ),
      )
      .innerJoin(
        vlcValue,
        and(eq(vlcValue.schoolId, vlcSessionTemplate.schoolId), eq(vlcValue.id, vlcSessionTemplate.valueId)),
      )
      .where(eq(vlcSession.schoolId, schoolId));

    // ── ABSENT rows per session (present = enrolled − ABSENT; present-by-default) ──
    const absentRows = await tx
      .select({ sessionId: vlcSessionAttendance.sessionId, n: sql<number>`count(*)::int` })
      .from(vlcSessionAttendance)
      .where(and(eq(vlcSessionAttendance.schoolId, schoolId), eq(vlcSessionAttendance.status, "ABSENT")))
      .groupBy(vlcSessionAttendance.sessionId);
    const absentBySession = new Map(absentRows.map((r) => [r.sessionId, r.n]));

    // ── the curriculum spine (active values, ordered) ──
    const valueRows = await tx
      .select({ ordinal: vlcValue.ordinal, nameEn: vlcValue.nameEn, nameTwi: vlcValue.nameTwi })
      .from(vlcValue)
      .where(and(eq(vlcValue.schoolId, schoolId), eq(vlcValue.active, true)))
      .orderBy(asc(vlcValue.ordinal));

    // ── flag SCHOOL TOTALS — counts only. `severity` is referenced ONLY as a raw-SQL FILTER predicate
    //    inside a COUNT (Kofi R343: "escalated = severity='CRISIS' as a COUNT not a projection"), never as a
    //    drizzle column projection — so this reader never SELECTs the confidential column and the 42b
    //    sole-content-path invariant (pastoral-data.ts stays the ONE projector of the confidential flag
    //    columns) is untouched. The projected columns here are three integer counts. The FROM is the flag
    //    table alone, so the unqualified `severity` / `resolved_at` are unambiguous. ──
    const [flagTotalsRow] = await tx
      .select({
        raised: sql<number>`count(*)::int`,
        open: sql<number>`count(*) filter (where resolved_at is null)::int`,
        escalated: sql<number>`count(*) filter (where severity = 'CRISIS' and resolved_at is null)::int`,
      })
      .from(vlcPastoralFlag)
      .where(eq(vlcPastoralFlag.schoolId, schoolId));
    const raised = flagTotalsRow?.raised ?? 0;
    const open = flagTotalsRow?.open ?? 0;
    const flags: FlagTotals = {
      raised,
      open,
      escalated: flagTotalsRow?.escalated ?? 0,
      resolved: raised - open,
    };

    // ── per-class OPEN-flag COUNT — join flag→student, GROUP BY the student's class. `student_id` is the
    //    join key (never projected); the projection is the class id + an integer count. ──
    const classFlagRows = await tx
      .select({ classId: students.classId, n: sql<number>`count(*)::int` })
      .from(vlcPastoralFlag)
      .innerJoin(
        students,
        and(eq(students.schoolId, vlcPastoralFlag.schoolId), eq(students.id, vlcPastoralFlag.studentId)),
      )
      .where(and(eq(vlcPastoralFlag.schoolId, schoolId), isNull(vlcPastoralFlag.resolvedAt)))
      .groupBy(students.classId);
    const openFlagsByClass = new Map(classFlagRows.map((r) => [r.classId, r.n]));

    // ── reflection submission — a BARE COUNT: distinct students with ≥1 journal, per class. Counts rows
    //    of vlc_pastoral_journal (allowed); projects NO `.body` (R345). ──
    const journalRows = await tx
      .select({
        classId: students.classId,
        submitters: sql<number>`count(distinct ${vlcPastoralJournal.studentId})::int`,
      })
      .from(vlcPastoralJournal)
      .innerJoin(
        students,
        and(eq(students.schoolId, vlcPastoralJournal.schoolId), eq(students.id, vlcPastoralJournal.studentId)),
      )
      .where(eq(vlcPastoralJournal.schoolId, schoolId))
      .groupBy(students.classId);
    const submittersByClass = new Map(journalRows.map((r) => [r.classId, r.submitters]));

    // ── PG fill / count / training — reuse the OPERATIONAL peer-guides reader (not a confidential path) ──
    const pg = await getPeerGuides(schoolId);
    const pgFillByClass = new Map(
      pg.classes.map((c) => [c.classId, { filled: c.slots.length, eligible: c.eligible, vacancy: c.vacancy }]),
    );

    // ── group sessions by class + distinct-class-per-value (coverage) ──
    const sessionsByClass = new Map<string, typeof sessionRows>();
    const classesByValue = new Map<number, Set<string>>();
    for (const s of sessionRows) {
      const list = sessionsByClass.get(s.classId) ?? [];
      list.push(s);
      sessionsByClass.set(s.classId, list);
      const set = classesByValue.get(s.ordinal) ?? new Set<string>();
      set.add(s.classId);
      classesByValue.set(s.ordinal, set);
    }

    // ── the per-class matrix (senior classes only — VLC is an SHS module) ──
    const seniorClasses = classRows.filter((c) => classFormNumber(c.level, c.name) !== null);
    const rows: DashboardClassRow[] = seniorClasses
      .map((c) => {
        const form = classFormNumber(c.level, c.name)!;
        const enrolled = enrolledByClass.get(c.id) ?? 0;
        const cs = sessionsByClass.get(c.id) ?? [];
        // present/possible for the class attendance %
        let present = 0;
        let possible = 0;
        let latest: (typeof cs)[number] | null = null;
        for (const s of cs) {
          possible += enrolled;
          present += Math.max(0, enrolled - (absentBySession.get(s.id) ?? 0));
          if (!latest || s.ordinal > latest.ordinal || (s.ordinal === latest.ordinal && s.slot > latest.slot)) {
            latest = s;
          }
        }
        const fill = pgFillByClass.get(c.id);
        const submitters = submittersByClass.get(c.id) ?? 0;
        return {
          classId: c.id,
          className: c.name,
          form,
          formLabel: `F${form}`,
          programmeLabel: c.programme ? (PROGRAMME_LABEL[c.programme] ?? c.programme) : null,
          enrolled,
          fmName: c.fmName ?? null,
          sessionsHeld: cs.length,
          curriculumLabel: latest
            ? `${String(latest.ordinal).padStart(2, "0")}${latest.slot} ${latest.nameEn}`
            : null,
          attendancePct: pct(present, possible),
          submissionPct: pct(submitters, enrolled),
          pgFillLabel: fill?.eligible ? `${fill.filled} / 2` : "—",
          pgVacancy: fill?.vacancy ?? false,
          openFlagCount: openFlagsByClass.get(c.id) ?? 0,
        } satisfies DashboardClassRow;
      })
      .sort((a, b) => a.form - b.form || a.className.localeCompare(b.className));

    // ── Tier-1 totals derived from the matrix + spine ──
    const classCount = rows.length;
    const sessionsHeld = rows.reduce((n, r) => n + r.sessionsHeld, 0);
    const sessionsExpected = valueRows.length * 2;
    const sessionsHeldAvg = classCount ? Math.round(sessionsHeld / classCount) : 0;
    const yearProgressPct = pct(sessionsHeldAvg, sessionsExpected);

    let totPresent = 0;
    let totPossible = 0;
    const formAgg = new Map<number, { present: number; possible: number }>();
    for (const r of rows) {
      const cs = sessionsByClass.get(r.classId) ?? [];
      for (const s of cs) {
        totPossible += r.enrolled;
        const p = Math.max(0, r.enrolled - (absentBySession.get(s.id) ?? 0));
        totPresent += p;
        const fa = formAgg.get(r.form) ?? { present: 0, possible: 0 };
        fa.present += p;
        fa.possible += r.enrolled;
        formAgg.set(r.form, fa);
      }
    }
    const attendanceByForm: AttendanceByForm[] = [...formAgg.entries()]
      .map(([form, a]) => ({ form, formLabel: `F${form}`, pct: pct(a.present, a.possible) ?? 0 }))
      .sort((a, b) => a.form - b.form);

    // reflection submission — class-avg of the per-class bare COUNT (classes with enrolment)
    const submissionPcts = rows.map((r) => r.submissionPct).filter((p): p is number => p !== null);
    const reflectionSubmissionPct = submissionPcts.length
      ? Math.round(submissionPcts.reduce((n, p) => n + p, 0) / submissionPcts.length)
      : null;

    // curriculum coverage per value
    const coverage: CoverageValue[] = valueRows.map((v) => {
      const reached = [...(classesByValue.get(v.ordinal) ?? new Set())].filter((cid) =>
        rows.some((r) => r.classId === cid),
      ).length;
      const ratePct = classCount ? Math.round((reached / classCount) * 100) : 0;
      const state: CoverageValue["state"] = ratePct >= 100 ? "done" : ratePct > 0 ? "current" : "upcoming";
      return { ordinal: v.ordinal, nameEn: v.nameEn, nameTwi: v.nameTwi, ratePct, state };
    });

    return {
      classCount,
      sessionsHeld,
      yearProgressPct,
      sessionsHeldAvg,
      sessionsExpected,
      avgAttendancePct: pct(totPresent, totPossible),
      attendanceByForm,
      activePgCount: pg.summary.activeCount,
      pgVacancyCount: pg.summary.vacancyCount,
      trainingsDone: pg.summary.trainingsDone,
      trainingPct: pg.summary.trainingPct,
      reflectionSubmissionPct,
      coverage,
      flags,
      classes: rows,
    };
  });
}

// ── the Form-3 leaver roster — NON-confidential directory ONLY (name / class / form) ─────────────────
// R347: a discoverable list into the EXISTING gated /senior/vlc/reference/[studentId]. NO paragraph body,
// NO draft/locked state, NO flag existence — ordinary staff-visible directory data.

export interface LeaverRosterEntry {
  studentId: string;
  fullName: string;
  className: string | null;
  formLabel: string; // "F3"
}

export async function getVlcLeaverRoster(schoolId: string): Promise<LeaverRosterEntry[]> {
  return withSchool(schoolId, async (tx) => {
    const rows = await tx
      .select({
        id: students.id,
        firstName: students.firstName,
        lastName: students.lastName,
        className: classes.name,
        classLevel: classes.level,
      })
      .from(students)
      .leftJoin(classes, and(eq(classes.schoolId, students.schoolId), eq(classes.id, students.classId)))
      .where(and(eq(students.schoolId, schoolId), eq(students.status, "ACTIVE")));

    return rows
      .filter((r) => classFormNumber(r.classLevel, r.className) === 3) // Form 3 = the leaver cohort (OC3)
      .map((r) => ({
        studentId: r.id,
        fullName: `${r.firstName} ${r.lastName}`,
        className: r.className,
        formLabel: "F3",
      }))
      .sort((a, b) => (a.className ?? "").localeCompare(b.className ?? "") || a.fullName.localeCompare(b.fullName));
  });
}
