/**
 * SERVER-ONLY boarding daily-life read (SHS module 4.2 / INCR-10) — surface 04. Imports the DB
 * driver via withSchool; NEVER import from a client component (the page passes plain serializable
 * props). Every query is tenant-scoped through withSchool (RLS) and house-scoped for a plain
 * HOUSEMASTER (canAccessHouse — mirrors the roster page).
 *
 * READS + DERIVES only (no storage): the timeline/NOW/day-type/F3-accent all come from the pure
 * core (./daily-life) fed by the FROZEN config contract (getScheduleTemplate / getInspectionPolicy /
 * getBoardingCalendar — READ-ONLY, never re-derived). Counts are live derivations of boarding_exeat
 * (exeats-today, currently-out, in-House) and the BOARDER set; sick-bay is a counts-only PLACEHOLDER
 * (module 4.4 unbuilt — reads no table, feeds nothing). Inspections read latest-wins per
 * (dorm × type × UTC-date); prep is the per-boarder exception log for the night.
 */
import "server-only";
import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import {
  houses,
  students,
  classes,
  users,
  boardingDormitory,
  boardingBunk,
  boardingExeat,
  inspections,
  prepAttendance,
} from "@/db/schema";
import { canAccessHouse } from "@/lib/access";
import {
  getScheduleTemplate,
  getAllScheduleTemplates,
  getInspectionPolicy,
  getBoardingCalendar,
  type BoardingDayType,
  type InspectionPolicy,
} from "./config";
import { getCurrentPeriod } from "./exeat-data";
import type { HouseGender } from "./reassign-decision";
import {
  resolveDayType,
  weekdayToken,
  buildTimeline,
  deriveF3Accent,
  policyHasDay,
  policyTimeRange,
  computePrepSummary,
  dailyFindingsSchema,
  weeklyFindingsSchema,
  type Timeline,
  type F3Accent,
  type PrepSummary,
  type PrepExceptionStatus,
  type DailyFindings,
  type WeeklyFindings,
} from "./daily-life";

const shortName = (first: string, last: string) => `${first.charAt(0)}. ${last}`;
const fmtTime = (d: Date): string =>
  new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(d);

/** Aggrey/others' inspection result union — mirrors inspection_result_enum. */
export type InspectionResult = "PASS" | "PARTIAL" | "FAIL";

export interface DailyLifeHouse {
  id: string;
  name: string;
  colour: string | null;
  gender: HouseGender | null;
  capacity: number | null;
  hmName: string | null;
}
export interface DormInspection {
  dormId: string;
  name: string;
  sectionLabel: string | null;
  boarderCount: number;
  latest: {
    result: InspectionResult;
    bunksClean: number | null;
    bunksTotal: number | null;
    findings: DailyFindings | null;
    anomalies: number;
    inspectedAtLabel: string;
    inspectorName: string | null;
  } | null; // null = not yet inspected today (pending — T1)
}
export interface WeeklyInspectionView {
  result: InspectionResult;
  findings: WeeklyFindings | null;
  anomalies: number;
  inspectedAtLabel: string;
  inspectorName: string | null;
}
export interface DailyLifeView {
  house: DailyLifeHouse;
  dateIso: string;
  dayType: BoardingDayType;
  dayLabel: string;
  isToday: boolean;
  configured: boolean;
  timeline: Timeline | null;
  f3Accent: F3Accent | null;
  policy: InspectionPolicy;
  scrubbing: { active: boolean; range: string | null };
  washing: { active: boolean };
  counts: {
    boarderCount: number;
    inHouse: number;
    currentlyOut: number;
    exeatsToday: number;
    lightsOut: string | null;
  };
  inspection: {
    dorms: DormInspection[];
    total: number;
    pass: number;
    partial: number;
    fail: number;
    pending: number;
  };
  weekly: WeeklyInspectionView | null;
  weeklyDay: boolean;
  prep: PrepSummary;
  prepEntries: {
    studentName: string;
    formLabel: string | null;
    status: PrepExceptionStatus;
    minutesLate: number | null;
    note: string | null;
    loggedByName: string | null;
  }[];
  boarderOptions: { id: string; name: string; formLabel: string | null }[];
}

/** [dayStartUtc, dayEndUtc) — the UTC day window used for latest-wins reads (Kofi handle). */
function utcDayRange(dateIso: string): { start: Date; end: Date } {
  const start = new Date(`${dateIso}T00:00:00Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}
const inWindow = (d: Date | null, start: Date, end: Date) => !!d && d >= start && d < end;

/**
 * The full daily-life view for one House on a date (default today, UTC), or null when the House is
 * not in this tenant / the plain HM can't access it (RLS + canAccessHouse both scope). Coherent on
 * every edge: an unseeded day_type returns configured=false (empty "not configured", never
 * fabricated — AC A6); zero dorms / zero boarders return empty, not a throw.
 */
export async function getDailyLife(
  schoolId: string,
  houseId: string,
  roles: readonly string[],
  userId: string | null,
  dateIso?: string,
  now: Date = new Date(),
): Promise<DailyLifeView | null> {
  const viewedDate = dateIso ?? now.toISOString().slice(0, 10);
  const isToday = viewedDate === now.toISOString().slice(0, 10);
  const { start: dayStart, end: dayEnd } = utcDayRange(viewedDate);

  // Config reads via the FROZEN contract only (READ-ONLY — never re-modeled).
  const policy = await getInspectionPolicy(schoolId);

  return withSchool(schoolId, async (tx) => {
    const [house] = await tx
      .select({
        id: houses.id,
        name: houses.name,
        colour: houses.colour,
        gender: houses.gender,
        capacity: houses.capacity,
        hmUserId: houses.hmUserId,
        hmName: users.fullName,
      })
      .from(houses)
      .leftJoin(users, eq(houses.hmUserId, users.id))
      .where(and(eq(houses.schoolId, schoolId), eq(houses.id, houseId)));
    if (!house) return null;
    if (!canAccessHouse(roles, userId, house.hmUserId)) return null;

    // Day-type from the calendar (VISITING Sunday vs normal Sunday) — resolved in UTC.
    const cur = await getCurrentPeriod(tx, schoolId);
    const calendar = cur ? await getBoardingCalendar(schoolId, cur.academicYear) : null;
    const visitingDates = new Set(
      (calendar?.events ?? []).filter((e) => e.eventType === "VISITING").map((e) => e.date),
    );
    const dayType = resolveDayType(viewedDate, visitingDates);

    // Timeline (main rail = ALL) + the F3 accent (exact FORM_3 variant, not the ALL fallback).
    const template = await getScheduleTemplate(schoolId, dayType);
    let f3Template = null;
    if (dayType === "WEEKDAY") {
      const all = await getAllScheduleTemplates(schoolId);
      f3Template = all.find((t) => t.dayType === "WEEKDAY" && t.formScope === "FORM_3") ?? null;
    }
    const timeline = template ? buildTimeline(template, viewedDate, now) : null;
    const f3Accent = template ? deriveF3Accent(template, f3Template) : null;

    const token = weekdayToken(viewedDate);
    const scrubbingActive = policyHasDay(policy.scrubbing, token);
    const washingActive = policyHasDay(policy.washingDays, token);

    // BOARDER set of this House (residency filter — AC A of the roster spine).
    const boarders = await tx
      .select({
        id: students.id,
        firstName: students.firstName,
        lastName: students.lastName,
        formLabel: classes.name,
        currentBunkId: students.currentBunkId,
      })
      .from(students)
      .leftJoin(classes, eq(students.classId, classes.id))
      .where(
        and(
          eq(students.schoolId, schoolId),
          eq(students.houseId, houseId),
          eq(students.residency, "BOARDER"),
          eq(students.status, "ACTIVE"),
        ),
      )
      .orderBy(asc(students.lastName));

    // Exeats for this House — currently-out (in-House subtraction) + exeats-today (informational).
    const exeats = await tx
      .select({
        studentId: boardingExeat.studentId,
        status: boardingExeat.status,
        departedAt: boardingExeat.departedAt,
        returnedAt: boardingExeat.returnedAt,
      })
      .from(boardingExeat)
      .where(and(eq(boardingExeat.schoolId, schoolId), eq(boardingExeat.houseId, houseId)));
    const outStudentIds = new Set(
      exeats.filter((e) => e.status === "DEPARTED" && !e.returnedAt).map((e) => e.studentId),
    );
    const exeatsToday = exeats.filter(
      (e) =>
        (e.status === "DEPARTED" && !e.returnedAt) ||
        inWindow(e.departedAt, dayStart, dayEnd) ||
        inWindow(e.returnedAt, dayStart, dayEnd),
    ).length;
    const inHouse = boarders.length - outStudentIds.size; // sick-bay NOT subtracted (Kofi G2)

    // Dorms of this House + which boarder sits in which dorm (for the per-dorm boarder count).
    const dorms = await tx
      .select({
        id: boardingDormitory.id,
        name: boardingDormitory.name,
        sectionLabel: boardingDormitory.sectionLabel,
      })
      .from(boardingDormitory)
      .where(and(eq(boardingDormitory.schoolId, schoolId), eq(boardingDormitory.active, true)))
      .orderBy(asc(boardingDormitory.name));
    // Restrict to this House's dorms.
    const houseDormIds = await tx
      .select({ id: boardingDormitory.id })
      .from(boardingDormitory)
      .where(and(eq(boardingDormitory.schoolId, schoolId), eq(boardingDormitory.houseId, houseId)));
    const dormIdSet = new Set(houseDormIds.map((d) => d.id));
    const houseDorms = dorms.filter((d) => dormIdSet.has(d.id));
    const dormIds = houseDorms.map((d) => d.id);

    const bunks = dormIds.length
      ? await tx
          .select({ id: boardingBunk.id, dormId: boardingBunk.dormitoryId })
          .from(boardingBunk)
          .where(and(eq(boardingBunk.schoolId, schoolId), inArray(boardingBunk.dormitoryId, dormIds)))
      : [];
    const dormByBunk = new Map(bunks.map((b) => [b.id, b.dormId]));
    const boardersByDorm = new Map<string, number>();
    for (const b of boarders) {
      const dormId = b.currentBunkId ? dormByBunk.get(b.currentBunkId) : undefined;
      if (dormId) boardersByDorm.set(dormId, (boardersByDorm.get(dormId) ?? 0) + 1);
    }

    // Inspections for the day window (both cadences) — reduced latest-wins per (dorm × type).
    const inspRows = dormIds.length
      ? await tx
          .select({
            id: inspections.id,
            dormitoryId: inspections.dormitoryId,
            type: inspections.type,
            result: inspections.result,
            bunksClean: inspections.bunksClean,
            bunksTotal: inspections.bunksTotal,
            findingsJson: inspections.findingsJson,
            anomaliesCount: inspections.anomaliesCount,
            inspectedAt: inspections.inspectedAt,
            inspectorName: users.fullName,
          })
          .from(inspections)
          .leftJoin(users, eq(inspections.inspectedByUserId, users.id))
          .where(
            and(
              eq(inspections.schoolId, schoolId),
              inArray(inspections.dormitoryId, dormIds),
              gte(inspections.inspectedAt, dayStart),
              lt(inspections.inspectedAt, dayEnd),
            ),
          )
          .orderBy(asc(inspections.inspectedAt))
      : [];

    // Latest-wins: last row (rows are ordered ascending by inspected_at) per (dorm, type) wins.
    const latestDaily = new Map<string, (typeof inspRows)[number]>();
    let latestWeekly: (typeof inspRows)[number] | null = null;
    for (const r of inspRows) {
      if (r.type === "DAILY") latestDaily.set(r.dormitoryId, r);
      else if (!latestWeekly || r.inspectedAt >= latestWeekly.inspectedAt) latestWeekly = r;
    }

    const dormInspections: DormInspection[] = houseDorms.map((d) => {
      const r = latestDaily.get(d.id) ?? null;
      const parsed = r ? dailyFindingsSchema.safeParse(r.findingsJson) : null;
      return {
        dormId: d.id,
        name: d.name,
        sectionLabel: d.sectionLabel,
        boarderCount: boardersByDorm.get(d.id) ?? 0,
        latest: r
          ? {
              result: r.result as InspectionResult,
              bunksClean: r.bunksClean,
              bunksTotal: r.bunksTotal,
              findings: parsed && parsed.success ? parsed.data : null,
              anomalies: r.anomaliesCount,
              inspectedAtLabel: fmtTime(r.inspectedAt),
              inspectorName: r.inspectorName ?? null,
            }
          : null,
      };
    });
    const pass = dormInspections.filter((d) => d.latest?.result === "PASS").length;
    const partial = dormInspections.filter((d) => d.latest?.result === "PARTIAL").length;
    const fail = dormInspections.filter((d) => d.latest?.result === "FAIL").length;
    const pending = dormInspections.filter((d) => d.latest === null).length;

    const weeklyParsed = latestWeekly ? weeklyFindingsSchema.safeParse(latestWeekly.findingsJson) : null;
    const weekly: WeeklyInspectionView | null = latestWeekly
      ? {
          result: latestWeekly.result as InspectionResult,
          findings: weeklyParsed && weeklyParsed.success ? weeklyParsed.data : null,
          anomalies: latestWeekly.anomaliesCount,
          inspectedAtLabel: fmtTime(latestWeekly.inspectedAt),
          inspectorName: latestWeekly.inspectorName ?? null,
        }
      : null;

    // Prep exception rows for this House-night.
    const prepRows = await tx
      .select({
        studentId: prepAttendance.studentId,
        status: prepAttendance.status,
        minutesLate: prepAttendance.minutesLate,
        note: prepAttendance.note,
        loggedByName: users.fullName,
      })
      .from(prepAttendance)
      .leftJoin(users, eq(prepAttendance.loggedByUserId, users.id))
      .where(
        and(
          eq(prepAttendance.schoolId, schoolId),
          eq(prepAttendance.houseId, houseId),
          eq(prepAttendance.sessionDate, viewedDate),
        ),
      );
    const exceptionByStudent = new Map<string, PrepExceptionStatus>(
      prepRows.map((r) => [r.studentId, r.status as PrepExceptionStatus]),
    );
    const prep = computePrepSummary(
      boarders.map((b) => ({ id: b.id, formLabel: b.formLabel ?? null })),
      exceptionByStudent,
      outStudentIds,
    );
    const nameById = new Map(boarders.map((b) => [b.id, shortName(b.firstName, b.lastName)]));
    const formById = new Map(boarders.map((b) => [b.id, b.formLabel ?? null]));
    const prepEntries = prepRows.map((r) => ({
      studentName: nameById.get(r.studentId) ?? "—",
      formLabel: formById.get(r.studentId) ?? null,
      status: r.status as PrepExceptionStatus,
      minutesLate: r.minutesLate,
      note: r.note,
      loggedByName: r.loggedByName ?? null,
    }));

    const dayLabel = new Intl.DateTimeFormat("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${viewedDate}T12:00:00Z`));

    return {
      house: {
        id: house.id,
        name: house.name,
        colour: house.colour,
        gender: house.gender as HouseGender | null,
        capacity: house.capacity,
        hmName: house.hmName ?? null,
      },
      dateIso: viewedDate,
      dayType,
      dayLabel,
      isToday,
      configured: !!template,
      timeline,
      f3Accent,
      policy,
      scrubbing: { active: scrubbingActive, range: policyTimeRange(policy.scrubbing) },
      washing: { active: washingActive },
      counts: {
        boarderCount: boarders.length,
        inHouse,
        currentlyOut: outStudentIds.size,
        exeatsToday,
        lightsOut: timeline?.lightsOutLabel ?? null,
      },
      inspection: {
        dorms: dormInspections,
        total: houseDorms.length,
        pass,
        partial,
        fail,
        pending,
      },
      weekly,
      weeklyDay: dayType === "SATURDAY",
      prep,
      prepEntries,
      boarderOptions: boarders.map((b) => ({
        id: b.id,
        name: shortName(b.firstName, b.lastName),
        formLabel: b.formLabel ?? null,
      })),
    } satisfies DailyLifeView;
  });
}

/** Resolve the House's HM (house-scope guard) + first active dorm (weekly anchor). Null if absent. */
export async function getHouseWriteContext(
  schoolId: string,
  houseId: string,
): Promise<{ hmUserId: string | null; firstDormId: string | null } | null> {
  return withSchool(schoolId, async (tx) => {
    const [house] = await tx
      .select({ hmUserId: houses.hmUserId })
      .from(houses)
      .where(and(eq(houses.schoolId, schoolId), eq(houses.id, houseId)))
      .limit(1);
    if (!house) return null;
    const [dorm] = await tx
      .select({ id: boardingDormitory.id })
      .from(boardingDormitory)
      .where(
        and(
          eq(boardingDormitory.schoolId, schoolId),
          eq(boardingDormitory.houseId, houseId),
          eq(boardingDormitory.active, true),
        ),
      )
      .orderBy(asc(boardingDormitory.name))
      .limit(1);
    return { hmUserId: house.hmUserId, firstDormId: dorm?.id ?? null };
  });
}

/** The House HM for a given dormitory (daily-inspection house-scope guard). Null if dorm absent. */
export async function getDormHouseContext(
  schoolId: string,
  dormId: string,
): Promise<{ houseId: string; hmUserId: string | null } | null> {
  return withSchool(schoolId, async (tx) => {
    const [row] = await tx
      .select({ houseId: boardingDormitory.houseId, hmUserId: houses.hmUserId })
      .from(boardingDormitory)
      .innerJoin(
        houses,
        and(eq(houses.schoolId, boardingDormitory.schoolId), eq(houses.id, boardingDormitory.houseId)),
      )
      .where(and(eq(boardingDormitory.schoolId, schoolId), eq(boardingDormitory.id, dormId)))
      .limit(1);
    return row ?? null;
  });
}
