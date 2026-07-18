/**
 * Boarding programme config — GES defaults, the canonical daily-rhythm templates, the calendar
 * seed events, and the PURE contract logic (schedule resolution, settings coalesce, calendar
 * derivation). No DB, no I/O — every function here is deterministic and unit-tested (config.test.ts).
 *
 * The server contract (lib/boarding/config.ts) reads rows through withSchool, then delegates the
 * shaping to these pure helpers. Keeping the logic here (not in config.ts) means the tests never
 * import the DB driver, and the frozen contract shape is defined in one pure place (INCR-9–13 read
 * it). Every default string is verbatim from surface 01 and mirrors the boarding_settings DB
 * DEFAULTs — so a coalesce (missing row → this constant) reads identically to a freshly-seeded row.
 */

export type BoardingDayType = "WEEKDAY" | "SATURDAY" | "SUNDAY" | "VISITING_SUNDAY";

/** One block of a daily-rhythm template. `section` = a heading row; `activity` = a timed row. */
export type ScheduleBlock =
  | { kind: "section"; label: string }
  | {
      kind: "activity";
      /** The time range string, e.g. "04:30 — 05:00" or a single "21:30". */
      range: string;
      /** Display duration, e.g. "30 min" / "7 hr 20" / "—" (heterogeneous, so stored not derived). */
      duration?: string;
      /** The activity name (surface's Fraunces heading). */
      activity: string;
      /** The gold-emphasised detail fragment, e.g. "· dormitory cleaning, surroundings". */
      note?: string;
      /** Who runs / owns it, e.g. "Housemaster" / "Prep Master rota". */
      who: string;
    };

export interface ScheduleTemplate {
  dayType: BoardingDayType;
  formScope: string; // 'ALL' | 'FORM_1' | 'FORM_2' | 'FORM_3'
  activities: ScheduleBlock[];
  active: boolean;
}

/** The editable per-school scalars (mirrors the boarding_settings columns 1:1). */
export interface BoardingSettingsValues {
  exeatScheduledPerTerm: number;
  exeatReturnBy: string;
  exeatFeeOwingMustCollect: boolean;
  exeatSpecialApprover: string;
  exeatParentInitiated: boolean;
  exeatDressCode: string;
  exeatCardSigner: string;
  visitingCadence: string;
  visitingHoursStart: string;
  visitingHoursEnd: string;
  visitingLunchTime: string;
  visitingDormitoriesRule: string;
  visitingApprovedVisitors: string;
  visitingBookOwner: string;
  inspectionDailyStart: string;
  inspectionDailyEnd: string;
  inspectionDailyScope: string;
  inspectionWeekly: string;
  inspectionWeeklyScope: string;
  inspectionScrubbing: string;
  inspectionWashingDays: string;
  inspectionInspector: string;
}

export interface ExeatPolicy {
  scheduledPerTerm: number;
  returnByTime: string;
  feeOwingMustCollect: boolean;
  specialApprover: string;
  parentInitiated: boolean;
  dressCode: string;
  cardSigner: string;
}
export interface VisitingPolicy {
  cadence: string;
  hoursStart: string;
  hoursEnd: string;
  lunchTime: string;
  dormitoriesRule: string;
  approvedVisitors: string;
  bookOwner: string;
}
export interface InspectionPolicy {
  dailyStart: string;
  dailyEnd: string;
  dailyScope: string;
  weekly: string;
  weeklyScope: string;
  scrubbing: string;
  washingDays: string;
  inspector: string;
}

export interface CalendarPeriodEntry {
  productLine: "SENIOR" | "SENIOR_F3";
  periodLabel: string;
  date: string; // ISO yyyy-mm-dd
}
export interface CalendarEvent {
  id: string;
  eventType: "VISITING" | "EXEAT_WINDOW";
  date: string;
  label: string;
  formScope: string | null;
  sequence: number | null;
}
export interface BoardingCalendar {
  academicYear: string;
  resumption: CalendarPeriodEntry[];
  vacation: CalendarPeriodEntry[];
  events: CalendarEvent[];
  nextVisiting: CalendarEvent | null;
}

/**
 * The GES-default boarding_settings values — verbatim from surface 01's three policy cards, and
 * identical to the boarding_settings column DEFAULTs. Readers coalesce a missing row to this (AC
 * A2), so a day-only school or a not-yet-seeded boarding school reads the same values a fresh
 * `INSERT (school_id)` would produce, never a throw or an empty policy.
 */
export const GES_DEFAULT_BOARDING_SETTINGS: BoardingSettingsValues = {
  exeatScheduledPerTerm: 3,
  exeatReturnBy: "16:00",
  exeatFeeOwingMustCollect: true,
  exeatSpecialApprover: "Senior HM only",
  exeatParentInitiated: true,
  exeatDressCode: "Uniform or outing dress",
  exeatCardSigner: "Signed by Housemaster",
  visitingCadence: "2nd Sun · monthly",
  visitingHoursStart: "12:00",
  visitingHoursEnd: "16:00",
  visitingLunchTime: "11:30",
  visitingDormitoriesRule: "Out of bounds",
  visitingApprovedVisitors: "Parent · guardian · sibling",
  visitingBookOwner: "Digital · SoD owns",
  inspectionDailyStart: "06:10",
  inspectionDailyEnd: "06:20",
  inspectionDailyScope: "Bunks · lockers · attire",
  inspectionWeekly: "Saturday 08:00",
  inspectionWeeklyScope: "Whole House · top to bottom",
  inspectionScrubbing: "Wed 16:00 — 17:00",
  inspectionWashingDays: "Wed & Fri afternoons",
  inspectionInspector: "HM & House Prefects",
};

/** The canonical weekday rhythm — surface 01 §daily-rhythm verbatim (4 sections + 15 activities). */
const WEEKDAY_ACTIVITIES: ScheduleBlock[] = [
  { kind: "section", label: "Morning · the inspection block · 4:30 → 7:00 AM" },
  { kind: "activity", range: "04:30 — 05:00", duration: "30 min", activity: "Rising · prayer · personal hygiene begins", who: "House" },
  { kind: "activity", range: "05:00 — 05:30", duration: "30 min", activity: "Bathing, dressing, bed-laying", who: "House · self" },
  { kind: "activity", range: "05:30 — 06:10", duration: "40 min", activity: "Morning duties", note: "· dormitory cleaning, surroundings", who: "Prefect-led" },
  { kind: "activity", range: "06:10 — 06:20", duration: "10 min", activity: "Daily inspection", note: "· bunks, lockers, attire", who: "Housemaster" },
  { kind: "activity", range: "06:20 — 06:30", duration: "10 min", activity: "Roll call · trafficking to assembly hall", who: "House · SoD" },
  { kind: "activity", range: "06:30 — 06:50", duration: "20 min", activity: "Assembly · prayers · school anthem · announcements", who: "School-wide" },
  { kind: "section", label: "Academic day · 7:00 AM → 2:20 PM" },
  { kind: "activity", range: "07:00 — 14:20", duration: "7 hr 20", activity: "Classes", note: "· 9 periods, 1 break, 1 mid-morning snack", who: "Academic timetable" },
  { kind: "activity", range: "14:20 — 14:50", duration: "30 min", activity: "Lunch · dining hall", note: "· all boarders, sittings by House", who: "Dining Hall Prefect" },
  { kind: "section", label: "Afternoon · siesta block · 3:00 → 4:30 PM" },
  { kind: "activity", range: "15:00 — 16:00", duration: "60 min", activity: "Siesta", note: "· mandatory rest, no movement", who: "House · silent" },
  { kind: "activity", range: "16:00 — 16:30", duration: "30 min", activity: "Wash down · uniform change to outing wear", who: "Self" },
  { kind: "activity", range: "16:30 — 17:30", duration: "60 min", activity: "Readwide · remedial classes", note: "· optional Tue / Thu", who: "Teaching staff" },
  { kind: "section", label: "Evening · prep block · 5:30 → 9:30 PM" },
  { kind: "activity", range: "17:30 — 18:00", duration: "30 min", activity: "Supper · dining hall", who: "Dining Hall Prefect" },
  { kind: "activity", range: "19:00 — 21:00", duration: "2 hr", activity: "Prep", note: "· supervised study · classrooms by year", who: "Prep Master rota" },
  { kind: "activity", range: "21:00 — 21:30", duration: "30 min", activity: "Night prayer · lights out announcement", who: "House · SoD" },
  { kind: "activity", range: "21:30", duration: "—", activity: "Lights out", note: "· no movement", who: "Housemaster" },
];

/**
 * The Form 3 WASSCE-prep variant of the weekday rhythm — identical up to the evening, then prep is
 * extended and lights-out moves to 22:00 (AC C3). This is a FORM_3-scoped WEEKDAY template that
 * getScheduleTemplate resolves before the 'ALL' base; INCR-10 reads it for Form 3 boarders.
 */
const WEEKDAY_FORM_3_ACTIVITIES: ScheduleBlock[] = WEEKDAY_ACTIVITIES.map((b) => {
  if (b.kind !== "activity") return b;
  if (b.range === "19:00 — 21:00") {
    return { ...b, range: "19:00 — 21:40", duration: "2 hr 40", note: "· extended · WASSCE preparation" };
  }
  if (b.range === "21:00 — 21:30") {
    return { ...b, range: "21:40 — 22:00", duration: "20 min" };
  }
  if (b.range === "21:30") {
    return { ...b, range: "22:00", note: "· no movement · Form 3 WASSCE extension" };
  }
  return b;
});

/** Saturday — general labour, the weekly inspection, sports/entertainment (distinct: AC C1). */
const SATURDAY_ACTIVITIES: ScheduleBlock[] = [
  { kind: "section", label: "Morning · general labour & the weekly inspection" },
  { kind: "activity", range: "05:00 — 05:30", duration: "30 min", activity: "Rising · prayer · personal hygiene", who: "House" },
  { kind: "activity", range: "05:30 — 06:30", duration: "60 min", activity: "General labour", note: "· compound & dormitory scrubbing", who: "Prefect-led" },
  { kind: "activity", range: "08:00 — 09:30", duration: "90 min", activity: "Weekly inspection", note: "· whole House, top to bottom", who: "HM & House Prefects" },
  { kind: "activity", range: "09:30 — 12:30", duration: "3 hr", activity: "Remedial classes · clubs & societies", who: "Teaching staff" },
  { kind: "section", label: "Afternoon · sports & entertainment" },
  { kind: "activity", range: "12:30 — 13:30", duration: "60 min", activity: "Lunch · dining hall", who: "Dining Hall Prefect" },
  { kind: "activity", range: "15:00 — 17:30", duration: "2 hr 30", activity: "Inter-House sports · entertainment", note: "· optional", who: "Sports Prefect" },
  { kind: "section", label: "Evening · prep block" },
  { kind: "activity", range: "17:30 — 18:30", duration: "60 min", activity: "Supper · wash down", who: "Self" },
  { kind: "activity", range: "19:00 — 21:00", duration: "2 hr", activity: "Prep · supervised study", who: "Prep Master rota" },
  { kind: "activity", range: "21:00 — 21:30", duration: "30 min", activity: "Night prayer · lights out announcement", who: "House · SoD" },
  { kind: "activity", range: "21:30", duration: "—", activity: "Lights out", note: "· no movement", who: "Housemaster" },
];

/** Sunday — worship & rest (distinct from VISITING_SUNDAY: AC C2). */
const SUNDAY_ACTIVITIES: ScheduleBlock[] = [
  { kind: "section", label: "Morning · worship" },
  { kind: "activity", range: "06:00 — 06:45", duration: "45 min", activity: "Rising · prayer · personal hygiene", who: "House" },
  { kind: "activity", range: "07:00 — 07:45", duration: "45 min", activity: "Breakfast · dining hall", who: "Dining Hall Prefect" },
  { kind: "activity", range: "08:00 — 10:30", duration: "2 hr 30", activity: "Church service · worship", note: "· denominations by roster", who: "Chaplaincy" },
  { kind: "section", label: "Afternoon · rest & letters" },
  { kind: "activity", range: "12:30 — 13:30", duration: "60 min", activity: "Lunch · dining hall", who: "Dining Hall Prefect" },
  { kind: "activity", range: "13:30 — 15:00", duration: "90 min", activity: "Siesta · rest · letter-writing", note: "· mandatory rest", who: "House · silent" },
  { kind: "activity", range: "16:00 — 17:30", duration: "90 min", activity: "Scripture Union · societies", note: "· optional", who: "Chaplaincy" },
  { kind: "section", label: "Evening · prep block" },
  { kind: "activity", range: "17:30 — 18:30", duration: "60 min", activity: "Supper · wash down", who: "Self" },
  { kind: "activity", range: "19:00 — 21:00", duration: "2 hr", activity: "Prep · supervised study", who: "Prep Master rota" },
  { kind: "activity", range: "21:00 — 21:30", duration: "30 min", activity: "Night prayer · lights out announcement", who: "House · SoD" },
  { kind: "activity", range: "21:30", duration: "—", activity: "Lights out", note: "· no movement", who: "Housemaster" },
];

/** Visiting Sunday — worship, then visiting hours (12:00–16:00) with lunch at 11:30 (AC C2). */
const VISITING_SUNDAY_ACTIVITIES: ScheduleBlock[] = [
  { kind: "section", label: "Morning · worship" },
  { kind: "activity", range: "06:00 — 06:45", duration: "45 min", activity: "Rising · prayer · hygiene · uniform or outing dress", who: "House" },
  { kind: "activity", range: "07:00 — 07:45", duration: "45 min", activity: "Breakfast · dining hall", who: "Dining Hall Prefect" },
  { kind: "activity", range: "08:00 — 10:30", duration: "2 hr 30", activity: "Church service · worship", who: "Chaplaincy" },
  { kind: "section", label: "Midday · visiting" },
  { kind: "activity", range: "11:30 — 12:00", duration: "30 min", activity: "Lunch served · dining hall", who: "Dining Hall Prefect" },
  { kind: "activity", range: "12:00 — 16:00", duration: "4 hr", activity: "Visiting hours", note: "· approved visitors · dormitories out of bounds", who: "SoD" },
  { kind: "activity", range: "16:00 — 16:30", duration: "30 min", activity: "Visitors depart · roll call", who: "House · SoD" },
  { kind: "section", label: "Evening · prep block" },
  { kind: "activity", range: "17:30 — 18:30", duration: "60 min", activity: "Supper · wash down", who: "Self" },
  { kind: "activity", range: "19:00 — 21:00", duration: "2 hr", activity: "Prep · supervised study", who: "Prep Master rota" },
  { kind: "activity", range: "21:00 — 21:30", duration: "30 min", activity: "Night prayer · lights out announcement", who: "House · SoD" },
  { kind: "activity", range: "21:30", duration: "—", activity: "Lights out", note: "· no movement", who: "Housemaster" },
];

/** The seed templates (day_type, form_scope, activities) — the four day types + the F3 variant. */
export const CANONICAL_SCHEDULE_TEMPLATES: {
  dayType: BoardingDayType;
  formScope: string;
  activities: ScheduleBlock[];
}[] = [
  { dayType: "WEEKDAY", formScope: "ALL", activities: WEEKDAY_ACTIVITIES },
  { dayType: "WEEKDAY", formScope: "FORM_3", activities: WEEKDAY_FORM_3_ACTIVITIES },
  { dayType: "SATURDAY", formScope: "ALL", activities: SATURDAY_ACTIVITIES },
  { dayType: "SUNDAY", formScope: "ALL", activities: SUNDAY_ACTIVITIES },
  { dayType: "VISITING_SUNDAY", formScope: "ALL", activities: VISITING_SUNDAY_ACTIVITIES },
];

/**
 * The seed VISITING/EXEAT calendar events — surface 01 calendar rows 4,5,6,8,9,10,11 verbatim.
 * NEVER the resumption/vacation rows (1,2,3,7,12) — those derive from academic_period (Kofi OQ4).
 */
export const SEED_CALENDAR_EVENTS: {
  eventType: "VISITING" | "EXEAT_WINDOW";
  eventDate: string;
  label: string;
  formScope: string | null;
  sequence: number | null;
}[] = [
  { eventType: "VISITING", eventDate: "2026-05-17", label: "Visiting Sunday · this Sunday", formScope: null, sequence: null },
  { eventType: "EXEAT_WINDOW", eventDate: "2026-05-31", label: "Semester 2 · scheduled exeat 1 of 3", formScope: null, sequence: 1 },
  { eventType: "VISITING", eventDate: "2026-06-14", label: "Visiting Sunday · Form 3 WASSCE wk", formScope: null, sequence: null },
  { eventType: "EXEAT_WINDOW", eventDate: "2026-07-05", label: "Semester 2 · scheduled exeat 2 of 3", formScope: null, sequence: 2 },
  { eventType: "VISITING", eventDate: "2026-07-12", label: "Visiting Sunday · Forms 1 & 2 only", formScope: "FORMS_1_2", sequence: null },
  { eventType: "EXEAT_WINDOW", eventDate: "2026-08-02", label: "Semester 2 · scheduled exeat 3 of 3", formScope: null, sequence: 3 },
  { eventType: "VISITING", eventDate: "2026-08-09", label: "Visiting Sunday · Forms 1 & 2 only", formScope: "FORMS_1_2", sequence: null },
];

// ============================================================================
// PURE contract logic — the shaping the server contract delegates to.
// ============================================================================

/** Coalesce a settings row (or a missing one) to concrete values — the GES-default fallback (A2). */
export function coalesceSettings(
  row: BoardingSettingsValues | null | undefined,
): BoardingSettingsValues {
  return row ?? GES_DEFAULT_BOARDING_SETTINGS;
}

export function toExeatPolicy(row: BoardingSettingsValues | null | undefined): ExeatPolicy {
  const s = coalesceSettings(row);
  return {
    scheduledPerTerm: s.exeatScheduledPerTerm,
    returnByTime: s.exeatReturnBy,
    feeOwingMustCollect: s.exeatFeeOwingMustCollect,
    specialApprover: s.exeatSpecialApprover,
    parentInitiated: s.exeatParentInitiated,
    dressCode: s.exeatDressCode,
    cardSigner: s.exeatCardSigner,
  };
}
export function toVisitingPolicy(row: BoardingSettingsValues | null | undefined): VisitingPolicy {
  const s = coalesceSettings(row);
  return {
    cadence: s.visitingCadence,
    hoursStart: s.visitingHoursStart,
    hoursEnd: s.visitingHoursEnd,
    lunchTime: s.visitingLunchTime,
    dormitoriesRule: s.visitingDormitoriesRule,
    approvedVisitors: s.visitingApprovedVisitors,
    bookOwner: s.visitingBookOwner,
  };
}
export function toInspectionPolicy(
  row: BoardingSettingsValues | null | undefined,
): InspectionPolicy {
  const s = coalesceSettings(row);
  return {
    dailyStart: s.inspectionDailyStart,
    dailyEnd: s.inspectionDailyEnd,
    dailyScope: s.inspectionDailyScope,
    weekly: s.inspectionWeekly,
    weeklyScope: s.inspectionWeeklyScope,
    scrubbing: s.inspectionScrubbing,
    washingDays: s.inspectionWashingDays,
    inspector: s.inspectionInspector,
  };
}

/**
 * Resolve a schedule template: `(dayType, form)` → else `(dayType, 'ALL')` → else `null` (AC C3).
 * Never fabricates a rhythm for an unseeded day_type — the caller renders "not configured".
 */
export function resolveScheduleTemplate(
  rows: ScheduleTemplate[],
  dayType: BoardingDayType,
  form?: string | null,
): ScheduleTemplate | null {
  const forDay = rows.filter((r) => r.dayType === dayType);
  if (form && form !== "ALL") {
    const exact = forDay.find((r) => r.formScope === form);
    if (exact) return exact;
  }
  return forDay.find((r) => r.formScope === "ALL") ?? null;
}

export interface RawPeriod {
  periodLabel: string;
  startsOn: string;
  endsOn: string;
}
export interface RawF3Vacation {
  periodLabel: string;
  endsOn: string;
}

/**
 * Derive the boarding calendar (AC D). resumption/vacation come from the school's academic_period
 * rows (productLine SENIOR — live, so a term-date edit shifts the calendar with no boarding write,
 * D1/D4). The Form 3 early post-WASSCE vacation comes from the SENIOR_F3 product-line period
 * (`gen_period_defaults`), tagged SENIOR_F3 — the only distinct-from-F1/F2 vacation (D2). Only the
 * stored VISITING/EXEAT_WINDOW events are passed in (resumption/vacation are NEVER event rows, D3).
 */
export function buildCalendar(
  academicYear: string,
  periods: RawPeriod[],
  f3Vacation: RawF3Vacation | null,
  events: CalendarEvent[],
  today: Date,
): BoardingCalendar {
  const resumption: CalendarPeriodEntry[] = periods.map((p) => ({
    productLine: "SENIOR",
    periodLabel: p.periodLabel,
    date: p.startsOn,
  }));
  const vacation: CalendarPeriodEntry[] = periods.map((p) => ({
    productLine: "SENIOR",
    periodLabel: p.periodLabel,
    date: p.endsOn,
  }));
  if (f3Vacation) {
    vacation.push({
      productLine: "SENIOR_F3",
      periodLabel: f3Vacation.periodLabel,
      date: f3Vacation.endsOn,
    });
  }
  const sortedEvents = [...events].sort((a, b) => a.date.localeCompare(b.date));
  const todayIso = today.toISOString().slice(0, 10);
  const nextVisiting =
    sortedEvents.find((e) => e.eventType === "VISITING" && e.date >= todayIso) ?? null;
  return { academicYear, resumption, vacation, events: sortedEvents, nextVisiting };
}
