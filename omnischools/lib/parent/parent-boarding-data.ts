import "server-only";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { withParentScope } from "@/lib/db/rls";
import type { Tx } from "@/lib/db";
import { students, boardingCalendarEvent, boardingSettings, academicPeriod } from "@/db/schema";

/**
 * 🔴 INCR-BOARD · the PARENT-facing Boarding reader (lean v1 · Kofi AC-BOARD-*). SERVER-ONLY — imports the
 * db driver, so a client component must never import it (only `pnpm build` catches that leak).
 *
 * Three panels, three RLS classes:
 *  • PLACEMENT (own child) — House/dorm/prefect via the SECURITY DEFINER `parent_boarding_placement` fn
 *    (prod-paste-0097; boarding_bunk/boarding_dormitory/house STAY parent_deny — the fn is the guard, GUC-clear
 *    device). The OWNER dropped the bunk NUMBER, so the projection returns house_name/dorm_name/prefect_role only.
 *  • VISITING (school-wide) — `boarding_calendar_event` (grant CONSTRAINED to event_type='VISITING' — exeat
 *    windows are structurally denied) + `boarding_settings` (visiting policy fields only; never
 *    visiting_book_owner / exeat_* / inspection_*).
 *  • RESUMPTION/VACATION (school-wide) — `academic_period` (already parent-readable since #278), INCLUDING
 *    SENIOR_F3 (the calendar reader excludes it; here Form-3 early vacation is in scope).
 *
 * Residency gate (own child, students is parent-readable): only residency='BOARDER' children get a placement
 * panel. DAY / DEBOARDINIZED / null collapse to the honest "not a boarder" empty — the removal + its reason
 * are NEVER surfaced (the discipline/deboardinization ledger stays parent_deny). One row per own child; the
 * dorm roster / bunk-mates are never enumerated.
 */

export type BoarderState = "PLACED" | "AWAITING";
export type ParentBoarderChild = {
  studentId: string; // own child — the exeat-request form targets this (the fn re-fences own-child)
  firstName: string;
  state: BoarderState;
  houseName: string | null;
  dormName: string | null;
  prefectLabel: string | null; // celebratory badge label, own child only
};
export type ParentVisitingDay = { label: string; date: string };
export type ParentVisitingPolicy = {
  cadence: string;
  hours: string; // "12:00 → 16:00"
  lunch: string;
  dormitories: string;
  approvedVisitors: string;
};
export type ParentBoardingDate = { label: string; date: string };
export type ParentBoarding = {
  hasBoarder: boolean; // any own child residency='BOARDER'
  boarders: ParentBoarderChild[];
  visitingDays: ParentVisitingDay[];
  visitingPolicy: ParentVisitingPolicy | null;
  termDates: ParentBoardingDate[]; // resumption + vacation, SENIOR + SENIOR_F3
};

/** Celebratory, parent-facing prefect labels (never the operational HM phrasing). */
const PREFECT_LABEL: Record<string, string> = {
  HEAD: "Head of House Prefect",
  DINING: "Dining Hall Prefect",
  SANITATION: "Sanitation Prefect",
  PREP: "Prep Prefect",
  SICKBAY: "Sickbay Prefect",
};

/** MUST run on a `tx` already scoped by `withParentScope`. */
export async function loadParentBoardingTx(
  tx: Tx,
  schoolId: string,
  userId: string,
  today: string = new Date().toISOString().slice(0, 10),
): Promise<ParentBoarding> {
  // Own children + residency (students is parent-readable). NO bunk id / house id read here.
  const kids = await tx
    .select({ id: students.id, firstName: students.firstName, residency: students.residency })
    .from(students)
    .where(eq(students.schoolId, schoolId))
    .orderBy(asc(students.firstName));
  const boarderKids = kids.filter((k) => k.residency === "BOARDER");

  if (boarderKids.length === 0) {
    // Not a boarder (incl. DAY / DEBOARDINIZED — the removal is never revealed). Nothing else to show.
    return { hasBoarder: false, boarders: [], visitingDays: [], visitingPolicy: null, termDates: [] };
  }

  // Placement — the SECURITY DEFINER projection (own child; boarding tables stay parent_deny). No bunk number.
  const placeRows = (await tx.execute(
    sql`select student_id, house_name, dorm_name, prefect_role
        from parent_boarding_placement(${schoolId}::uuid, ${userId}::uuid)`,
  )) as unknown as { student_id: string; house_name: string; dorm_name: string; prefect_role: string | null }[];
  const placeById = new Map(placeRows.map((p) => [p.student_id, p]));

  const boarders: ParentBoarderChild[] = boarderKids.map((k) => {
    const p = placeById.get(k.id);
    return {
      studentId: k.id,
      firstName: k.firstName,
      state: p ? "PLACED" : "AWAITING",
      houseName: p?.house_name ?? null,
      dormName: p?.dorm_name ?? null,
      prefectLabel: p?.prefect_role ? (PREFECT_LABEL[p.prefect_role] ?? null) : null,
    };
  });

  // Resumption / vacation — SENIOR + SENIOR_F3 (SENIOR_F3 = Form 3 early vacation, IN scope here). Determine
  // the reference academic year (the term containing today, else the most recent) to bound the visiting list.
  const periods = await tx
    .select({
      label: academicPeriod.periodLabel,
      academicYear: academicPeriod.academicYear,
      startsOn: academicPeriod.startsOn,
      endsOn: academicPeriod.endsOn,
      productLine: academicPeriod.productLine,
    })
    .from(academicPeriod)
    .where(and(eq(academicPeriod.schoolId, schoolId), ne(academicPeriod.productLine, "BASIC")))
    .orderBy(asc(academicPeriod.startsOn), asc(academicPeriod.periodNumber));

  const refYear =
    periods.find((p) => p.startsOn <= today && today <= p.endsOn)?.academicYear ??
    periods[periods.length - 1]?.academicYear ??
    null;

  const termDates: ParentBoardingDate[] = [];
  for (const p of periods.filter((p) => refYear == null || p.academicYear === refYear)) {
    const f3 = p.productLine === "SENIOR_F3";
    termDates.push({ label: `${f3 ? "Form 3" : p.label} · resumes`, date: p.startsOn });
    termDates.push({ label: `${f3 ? "Form 3" : p.label} · vacates`, date: p.endsOn });
  }
  termDates.sort((a, b) => a.date.localeCompare(b.date));

  // Visiting days — VISITING events for the reference year (the grant already denies EXEAT_WINDOW; the
  // reader belt re-affirms it). ascending.
  const visitRows = await tx
    .select({
      label: boardingCalendarEvent.label,
      date: boardingCalendarEvent.eventDate,
      academicYear: boardingCalendarEvent.academicYear,
    })
    .from(boardingCalendarEvent)
    .where(
      and(
        eq(boardingCalendarEvent.schoolId, schoolId),
        eq(boardingCalendarEvent.eventType, "VISITING"),
      ),
    )
    .orderBy(asc(boardingCalendarEvent.eventDate));
  const visitingDays: ParentVisitingDay[] = visitRows
    .filter((v) => refYear == null || v.academicYear === refYear)
    .map((v) => ({ label: v.label, date: v.date }));

  // Visiting policy — boarding_settings (one row/school). Column guard: the visiting fields ONLY; never
  // visiting_book_owner, nor any exeat_*/inspection_* column on the same row.
  const [s] = await tx
    .select({
      cadence: boardingSettings.visitingCadence,
      hoursStart: boardingSettings.visitingHoursStart,
      hoursEnd: boardingSettings.visitingHoursEnd,
      lunch: boardingSettings.visitingLunchTime,
      dormitories: boardingSettings.visitingDormitoriesRule,
      approvedVisitors: boardingSettings.visitingApprovedVisitors,
    })
    .from(boardingSettings)
    .where(eq(boardingSettings.schoolId, schoolId))
    .limit(1);
  const visitingPolicy: ParentVisitingPolicy | null = s
    ? {
        cadence: s.cadence,
        hours: `${s.hoursStart} → ${s.hoursEnd}`,
        lunch: s.lunch,
        dormitories: s.dormitories,
        approvedVisitors: s.approvedVisitors,
      }
    : null;

  return { hasBoarder: true, boarders, visitingDays, visitingPolicy, termDates };
}

/** Entry point — the parent's boarding view (own children) under `withParentScope` (never `withSchool`). */
export async function loadParentBoarding(schoolId: string, userId: string): Promise<ParentBoarding> {
  return withParentScope(schoolId, userId, (tx) => loadParentBoardingTx(tx, schoolId, userId));
}
