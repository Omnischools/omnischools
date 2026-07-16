/**
 * SERVER-ONLY aggregate read for the boarding programme surface (INCR-8 · surface 01). Composes the
 * frozen config contract (config.ts) with the derived-from-roster reads (House occupancy, boarder /
 * day / deboardinized counts, capacity). Imports the DB driver — NEVER import from a client
 * component; the page passes plain serializable props to the client editors. Every number here is
 * DERIVED (summary cards, occupancy %, utilisation) — nothing is hard-coded from the mock.
 */
import "server-only";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import {
  houses,
  students,
  users,
  roleAssignments,
  boardingDormitory,
  boardingBunk,
  academicPeriod,
} from "@/db/schema";
import { isLightColour } from "./roster";
import {
  getAllScheduleTemplates,
  getBoardingCalendar,
  getBoardingSettings,
  getDeboardinizationLadder,
  type BoardingCalendar,
  type BoardingSettingsValues,
  type DeboardinizationRung,
  type ScheduleTemplate,
} from "./config";
import type { HouseGender } from "./reassign-decision";

export interface StaffOption {
  id: string;
  name: string;
}
export interface HouseConfigCard {
  id: string;
  name: string;
  colour: string | null;
  isLight: boolean;
  gender: HouseGender | null;
  capacity: number | null;
  hmUserId: string | null;
  hmName: string | null;
  foundedYear: number | null;
  namedAfter: string | null;
  dormCount: number;
  bedCount: number;
  filled: number;
  occupancyPct: number;
  occupancyWarn: boolean;
}
export interface ProgrammeSummary {
  housesConfigured: number;
  boysHouses: number;
  girlsHouses: number;
  coedHouses: number;
  capEachLabel: string;
  totalCapacity: number;
  totalBeds: number;
  boardingCount: number;
  vacantBunks: number;
  utilisationPct: number;
  dayStudents: number;
  totalEnrolment: number;
  deboardinizedCount: number;
  exeatQuota: number;
}
export interface ProgrammeConfig {
  academicYear: string;
  summary: ProgrammeSummary;
  housesGrid: HouseConfigCard[];
  staff: StaffOption[];
  settings: BoardingSettingsValues;
  calendar: BoardingCalendar;
  templates: ScheduleTemplate[];
  ladder: readonly DeboardinizationRung[];
}

// ponytail: near-capacity threshold is a chosen rule (surface leaves it undefined), computed from
// the real bed count — NOT the mock's hard-coded 97%. Flag a House at/above 95% occupancy.
const OCCUPANCY_WARN_AT = 0.95;
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

/** The current academic year for the school (latest configured), for the calendar derivation. */
async function currentAcademicYear(schoolId: string): Promise<string> {
  return withSchool(schoolId, async (tx) => {
    const rows = await tx
      .selectDistinct({ y: academicPeriod.academicYear })
      .from(academicPeriod)
      .where(eq(academicPeriod.schoolId, schoolId));
    return rows.map((r) => r.y).sort((a, b) => b.localeCompare(a))[0] ?? "2025/26";
  });
}

/** House cards + the derived summary + the assignable-staff list, in one tenant-scoped read. */
async function readHousesAndSummary(schoolId: string): Promise<{
  housesGrid: HouseConfigCard[];
  summary: Omit<ProgrammeSummary, "exeatQuota">;
  staff: StaffOption[];
}> {
  return withSchool(schoolId, async (tx) => {
    const houseRows = await tx
      .select({
        id: houses.id,
        name: houses.name,
        colour: houses.colour,
        gender: houses.gender,
        capacity: houses.capacity,
        hmUserId: houses.hmUserId,
        hmName: users.fullName,
        foundedYear: houses.foundedYear,
        namedAfter: houses.namedAfter,
      })
      .from(houses)
      .leftJoin(users, eq(houses.hmUserId, users.id))
      .where(eq(houses.schoolId, schoolId))
      .orderBy(asc(houses.name));

    // Dorm + bed counts per House.
    const dormRows = await tx
      .select({
        houseId: boardingDormitory.houseId,
        dorms: sql<number>`count(*)::int`,
      })
      .from(boardingDormitory)
      .where(eq(boardingDormitory.schoolId, schoolId))
      .groupBy(boardingDormitory.houseId);
    const dormByHouse = new Map(dormRows.map((r) => [r.houseId, r.dorms]));

    const bedRows = await tx
      .select({
        houseId: boardingDormitory.houseId,
        beds: sql<number>`count(${boardingBunk.id})::int`,
      })
      .from(boardingDormitory)
      .leftJoin(
        boardingBunk,
        and(
          eq(boardingBunk.schoolId, boardingDormitory.schoolId),
          eq(boardingBunk.dormitoryId, boardingDormitory.id),
        ),
      )
      .where(eq(boardingDormitory.schoolId, schoolId))
      .groupBy(boardingDormitory.houseId);
    const bedByHouse = new Map(bedRows.map((r) => [r.houseId, r.beds]));

    // Filled = ACTIVE boarders with an allocated bunk, per House.
    const filledRows = await tx
      .select({ houseId: students.houseId, n: sql<number>`count(*)::int` })
      .from(students)
      .where(
        and(
          eq(students.schoolId, schoolId),
          eq(students.residency, "BOARDER"),
          eq(students.status, "ACTIVE"),
          isNotNull(students.currentBunkId),
        ),
      )
      .groupBy(students.houseId);
    const filledByHouse = new Map(filledRows.map((r) => [r.houseId, r.n]));

    const housesGrid: HouseConfigCard[] = houseRows.map((h) => {
      const beds = bedByHouse.get(h.id) ?? 0;
      const filled = filledByHouse.get(h.id) ?? 0;
      const occupancyPct = pct(filled, beds);
      return {
        id: h.id,
        name: h.name,
        colour: h.colour,
        isLight: isLightColour(h.colour),
        gender: h.gender as HouseGender | null,
        capacity: h.capacity,
        hmUserId: h.hmUserId,
        hmName: h.hmName ?? null,
        foundedYear: h.foundedYear,
        namedAfter: h.namedAfter,
        dormCount: dormByHouse.get(h.id) ?? 0,
        bedCount: beds,
        filled,
        occupancyPct,
        occupancyWarn: beds > 0 && filled / beds >= OCCUPANCY_WARN_AT,
      };
    });

    // Student-population counts (residency + status), one grouped pass.
    const popRows = await tx
      .select({ residency: students.residency, n: sql<number>`count(*)::int` })
      .from(students)
      .where(and(eq(students.schoolId, schoolId), eq(students.status, "ACTIVE")))
      .groupBy(students.residency);
    const popBy = new Map(popRows.map((r) => [r.residency ?? "UNSET", r.n]));
    const boardingCount = popBy.get("BOARDER") ?? 0;
    const dayStudents = popBy.get("DAY") ?? 0;
    const deboardinizedCount = popBy.get("DEBOARDINIZED") ?? 0;
    const totalEnrolment = popRows.reduce((a, r) => a + r.n, 0);

    // Assignable staff (any user with a role in this school).
    const staffRows = await tx
      .selectDistinct({ id: users.id, name: users.fullName })
      .from(roleAssignments)
      .innerJoin(users, eq(roleAssignments.userId, users.id))
      .where(eq(roleAssignments.schoolId, schoolId));
    const staff: StaffOption[] = staffRows
      .map((s) => ({ id: s.id, name: s.name ?? "Unnamed staff" }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const totalBeds = housesGrid.reduce((a, h) => a + h.bedCount, 0);
    const totalFilled = housesGrid.reduce((a, h) => a + h.filled, 0);
    const totalCapacity = housesGrid.reduce((a, h) => a + (h.capacity ?? 0), 0);
    const caps = Array.from(new Set(housesGrid.map((h) => h.capacity).filter((c): c is number => c != null)));
    const capEachLabel =
      caps.length === 1 ? `${caps[0]} cap each` : caps.length === 0 ? "capacity not set" : "capacity varies";

    return {
      housesGrid,
      staff,
      summary: {
        housesConfigured: housesGrid.length,
        boysHouses: housesGrid.filter((h) => h.gender === "BOYS").length,
        girlsHouses: housesGrid.filter((h) => h.gender === "GIRLS").length,
        coedHouses: housesGrid.filter((h) => h.gender === "COED").length,
        capEachLabel,
        totalCapacity,
        totalBeds,
        boardingCount,
        vacantBunks: Math.max(0, totalBeds - totalFilled),
        utilisationPct: totalCapacity > 0 ? pct(boardingCount, totalCapacity) : pct(totalFilled, totalBeds),
        dayStudents,
        totalEnrolment,
        deboardinizedCount,
      },
    };
  });
}

/** The whole surface's config, pre-formatted. Read-gate applied by the page. */
export async function getProgrammeConfig(schoolId: string): Promise<ProgrammeConfig> {
  const academicYear = await currentAcademicYear(schoolId);
  const [housesAndSummary, settings, calendar, templates] = await Promise.all([
    readHousesAndSummary(schoolId),
    getBoardingSettings(schoolId),
    getBoardingCalendar(schoolId, academicYear),
    getAllScheduleTemplates(schoolId),
  ]);
  return {
    academicYear,
    summary: { ...housesAndSummary.summary, exeatQuota: settings.exeatScheduledPerTerm },
    housesGrid: housesAndSummary.housesGrid,
    staff: housesAndSummary.staff,
    settings,
    calendar,
    templates,
    ladder: getDeboardinizationLadder(schoolId),
  };
}
