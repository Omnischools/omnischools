/**
 * SERVER-ONLY boarding programme config read API (SHS module 4.2 / INCR-8) — THE FROZEN CONTRACT.
 * Every downstream boarding increment (9–13) reads config through these getters and NEVER
 * re-derives it, so the shape here is load-bearing: a field rename later is a cross-increment
 * break. Imports the DB driver via withSchool — must NEVER be imported by a client component (the
 * page passes plain serializable props to client editors). All reads are tenant-scoped (RLS).
 *
 * The pure shaping (schedule resolution, GES-default coalesce, calendar derivation) lives in
 * ./defaults (unit-tested without the DB); this file only fetches rows and delegates.
 */
import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import {
  dailyScheduleTemplate,
  boardingSettings,
  boardingCalendarEvent,
  academicPeriod,
} from "@/db/schema";
import {
  buildCalendar,
  coalesceSettings,
  resolveScheduleTemplate,
  toExeatPolicy,
  toInspectionPolicy,
  toVisitingPolicy,
  type BoardingCalendar,
  type BoardingDayType,
  type BoardingSettingsValues,
  type CalendarEvent,
  type ExeatPolicy,
  type InspectionPolicy,
  type ScheduleBlock,
  type ScheduleTemplate,
  type VisitingPolicy,
} from "./defaults";

// Re-export the contract types + the ladder getter so consumers import everything from here.
export type {
  BoardingCalendar,
  BoardingDayType,
  BoardingSettingsValues,
  CalendarEvent,
  CalendarPeriodEntry,
  ExeatPolicy,
  InspectionPolicy,
  ScheduleBlock,
  ScheduleTemplate,
  VisitingPolicy,
} from "./defaults";
export {
  getDeboardinizationLadder,
  DEBOARDINIZATION_LADDER,
  type DeboardinizationRung,
  type DeboardinizationSeverity,
} from "./deboardinization-ladder";

/** All schedule templates for a school, typed. Internal — the getters resolve against this. */
async function readScheduleTemplates(schoolId: string): Promise<ScheduleTemplate[]> {
  return withSchool(schoolId, async (tx) => {
    const rows = await tx
      .select({
        dayType: dailyScheduleTemplate.dayType,
        formScope: dailyScheduleTemplate.formScope,
        activitiesJson: dailyScheduleTemplate.activitiesJson,
        active: dailyScheduleTemplate.active,
      })
      .from(dailyScheduleTemplate)
      .where(eq(dailyScheduleTemplate.schoolId, schoolId));
    return rows.map((r) => ({
      dayType: r.dayType as BoardingDayType,
      formScope: r.formScope,
      activities: (r.activitiesJson as ScheduleBlock[]) ?? [],
      active: r.active,
    }));
  });
}

/** Every school's full template set (for the schedule editor UI — not a per-day resolve). */
export async function getAllScheduleTemplates(schoolId: string): Promise<ScheduleTemplate[]> {
  return readScheduleTemplates(schoolId);
}

/**
 * getScheduleTemplate → INCR-10. Resolves `(dayType, form)` → else `(dayType, 'ALL')` → else null
 * (an unseeded day_type returns null, never a fabricated rhythm — AC A4/C3).
 */
export async function getScheduleTemplate(
  schoolId: string,
  dayType: BoardingDayType,
  form?: string | null,
): Promise<ScheduleTemplate | null> {
  const rows = await readScheduleTemplates(schoolId);
  return resolveScheduleTemplate(rows, dayType, form);
}

/** The single boarding_settings row for a school, or null (missing). Internal. */
async function readSettings(schoolId: string): Promise<BoardingSettingsValues | null> {
  return withSchool(schoolId, async (tx) => {
    const [row] = await tx
      .select({
        exeatScheduledPerTerm: boardingSettings.exeatScheduledPerTerm,
        exeatReturnBy: boardingSettings.exeatReturnBy,
        exeatFeeOwingMustCollect: boardingSettings.exeatFeeOwingMustCollect,
        exeatSpecialApprover: boardingSettings.exeatSpecialApprover,
        exeatParentInitiated: boardingSettings.exeatParentInitiated,
        exeatDressCode: boardingSettings.exeatDressCode,
        exeatCardSigner: boardingSettings.exeatCardSigner,
        visitingCadence: boardingSettings.visitingCadence,
        visitingHoursStart: boardingSettings.visitingHoursStart,
        visitingHoursEnd: boardingSettings.visitingHoursEnd,
        visitingLunchTime: boardingSettings.visitingLunchTime,
        visitingDormitoriesRule: boardingSettings.visitingDormitoriesRule,
        visitingApprovedVisitors: boardingSettings.visitingApprovedVisitors,
        visitingBookOwner: boardingSettings.visitingBookOwner,
        inspectionDailyStart: boardingSettings.inspectionDailyStart,
        inspectionDailyEnd: boardingSettings.inspectionDailyEnd,
        inspectionDailyScope: boardingSettings.inspectionDailyScope,
        inspectionWeekly: boardingSettings.inspectionWeekly,
        inspectionWeeklyScope: boardingSettings.inspectionWeeklyScope,
        inspectionScrubbing: boardingSettings.inspectionScrubbing,
        inspectionWashingDays: boardingSettings.inspectionWashingDays,
        inspectionInspector: boardingSettings.inspectionInspector,
      })
      .from(boardingSettings)
      .where(eq(boardingSettings.schoolId, schoolId))
      .limit(1);
    return row ?? null;
  });
}

/** All policy scalars, coalesced to GES defaults when no row exists (AC A2). For the editor UI. */
export async function getBoardingSettings(schoolId: string): Promise<BoardingSettingsValues> {
  return coalesceSettings(await readSettings(schoolId));
}

/** getExeatPolicy → INCR-9. Coalesces a missing row to the GES-default constant (AC A2). */
export async function getExeatPolicy(schoolId: string): Promise<ExeatPolicy> {
  return toExeatPolicy(await readSettings(schoolId));
}

/** getVisitingPolicy → INCR-12. */
export async function getVisitingPolicy(schoolId: string): Promise<VisitingPolicy> {
  return toVisitingPolicy(await readSettings(schoolId));
}

/** getInspectionPolicy → INCR-10. */
export async function getInspectionPolicy(schoolId: string): Promise<InspectionPolicy> {
  return toInspectionPolicy(await readSettings(schoolId));
}

/**
 * getBoardingCalendar → INCR-11/9/12. resumption/vacation DERIVE from academic_period (SENIOR,
 * live); the Form 3 early vacation derives from the SENIOR_F3 product-line default; only
 * VISITING/EXEAT_WINDOW rows come from boarding_calendar_event (AC D). Nothing here duplicates the
 * term model — editing a term date shifts this calendar with no boarding-table write.
 */
export async function getBoardingCalendar(
  schoolId: string,
  academicYear: string,
): Promise<BoardingCalendar> {
  return withSchool(schoolId, async (tx) => {
    // Main resumption/vacation source — the school's own SENIOR semesters (INCR-11 tweak #1: scoped
    // to product_line='SENIOR' so the SENIOR_F3 row never leaks into the F1/F2 lists — AC J2).
    const periods = await tx
      .select({
        periodLabel: academicPeriod.periodLabel,
        startsOn: academicPeriod.startsOn,
        endsOn: academicPeriod.endsOn,
      })
      .from(academicPeriod)
      .where(
        and(
          eq(academicPeriod.schoolId, schoolId),
          eq(academicPeriod.academicYear, academicYear),
          eq(academicPeriod.productLine, "SENIOR"),
        ),
      )
      .orderBy(asc(academicPeriod.periodNumber));

    // Form 3's early post-WASSCE vacation — now the school's OWN academic_period SENIOR_F3 row
    // (INCR-11 tweak #1: was the global gen_period_defaults; editing the school row shifts F3 — AC
    // J1), seeded from gen_period_defaults at onboarding / the 0048 backfill. Take its last period's
    // ends_on. No SENIOR_F3 row → f3 undefined → null → no F3 vacation entry, no throw (AC J4). The
    // BoardingCalendar shape + buildCalendar signature are byte-for-byte unchanged (AC J3).
    const [f3] = await tx
      .select({
        periodLabel: academicPeriod.periodLabel,
        endsOn: academicPeriod.endsOn,
      })
      .from(academicPeriod)
      .where(
        and(
          eq(academicPeriod.schoolId, schoolId),
          eq(academicPeriod.academicYear, academicYear),
          eq(academicPeriod.productLine, "SENIOR_F3"),
        ),
      )
      .orderBy(desc(academicPeriod.periodNumber))
      .limit(1);

    const rawEvents = await tx
      .select({
        id: boardingCalendarEvent.id,
        eventType: boardingCalendarEvent.eventType,
        eventDate: boardingCalendarEvent.eventDate,
        label: boardingCalendarEvent.label,
        formScope: boardingCalendarEvent.formScope,
        sequence: boardingCalendarEvent.sequence,
      })
      .from(boardingCalendarEvent)
      .where(
        and(
          eq(boardingCalendarEvent.schoolId, schoolId),
          eq(boardingCalendarEvent.academicYear, academicYear),
        ),
      )
      .orderBy(asc(boardingCalendarEvent.eventDate));

    const events: CalendarEvent[] = rawEvents.map((e) => ({
      id: e.id,
      eventType: e.eventType as "VISITING" | "EXEAT_WINDOW",
      date: e.eventDate,
      label: e.label,
      formScope: e.formScope,
      sequence: e.sequence,
    }));

    return buildCalendar(academicYear, periods, f3 ?? null, events, new Date());
  });
}
