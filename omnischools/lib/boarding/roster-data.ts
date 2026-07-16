/**
 * SERVER-ONLY roster read (INCR-7). Imports the DB driver via withSchool — must NEVER be
 * imported by a client component; the page passes plain serializable props to the client board.
 * Every query is tenant-scoped through withSchool (RLS boundary). Residency is the load-bearing
 * filter: only ACTIVE BOARDERs of the House appear; DAY students never do (BUILD_STACK #1 / AC A2).
 */
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import {
  houses,
  students,
  classes,
  users,
  academicPeriod,
  boardingDormitory,
  boardingBunk,
  bunkAllocation,
} from "@/db/schema";
import {
  assembleDorms,
  buildPrefectStrip,
  summarize,
  type PrefectRole,
  type RosterDorm,
  type RosterOccupant,
  type RosterSummary,
  type PrefectSlot,
} from "./roster";
import { isPastorallyFlagged } from "./pastoral-stub";
import { canAccessHouse } from "@/lib/access";
import type { HouseGender, Sex } from "./reassign-decision";

const shortName = (first: string, last: string) => `${first.charAt(0)}. ${last}`;
const fmtDate = (d: Date): string =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(d);

export interface HouseIdentity {
  id: string;
  name: string;
  colour: string | null;
  gender: HouseGender | null;
  capacity: number | null;
  hmName: string | null;
}
export interface SwapEntry {
  id: string;
  studentName: string;
  fromAddress: string | null;
  toAddress: string | null;
  reason: string;
  staffName: string | null;
  atLabel: string;
}
export interface HouseRoster {
  house: HouseIdentity;
  summary: RosterSummary;
  dorms: RosterDorm[];
  prefects: PrefectSlot[];
  unallocated: RosterOccupant[];
  swaps: SwapEntry[];
  swapsThisSem: number;
  currentTermLabel: string | null;
}

/** The academic period whose start is the most recent one that has begun — "this semester" for
 *  the moved-this-sem state (green). Null when a school has no periods configured. */
function pickCurrentPeriod<T extends { startsOn: string }>(periods: T[]): T | null {
  const now = Date.now();
  const started = periods
    .filter((p) => new Date(p.startsOn).getTime() <= now)
    .sort((a, b) => new Date(b.startsOn).getTime() - new Date(a.startsOn).getTime());
  return started[0] ?? periods[0] ?? null;
}

/**
 * Full roster for one House, or null if the House is not in this tenant (RLS + the school_id
 * predicate both enforce isolation). Safe on every edge: a House with boarders but no dorms,
 * zero boarders, etc. all return a coherent (possibly empty) roster rather than throwing (AC E).
 */
export async function getHouseRoster(
  schoolId: string,
  houseId: string,
  roles: readonly string[],
  userId: string | null,
): Promise<HouseRoster | null> {
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
    // G4 — a plain HOUSEMASTER only reaches the House they master; others any House in-school.
    if (!canAccessHouse(roles, userId, house.hmUserId)) return null;

    // Current-semester threshold for the moved-this-sem (green) state.
    const periodList = await tx
      .select({
        startsOn: academicPeriod.startsOn,
        periodLabel: academicPeriod.periodLabel,
      })
      .from(academicPeriod)
      .where(eq(academicPeriod.schoolId, schoolId))
      .orderBy(asc(academicPeriod.startsOn));
    const currentPeriod = pickCurrentPeriod(periodList);
    const movedThreshold = currentPeriod ? new Date(currentPeriod.startsOn).getTime() : null;

    // Boarders of THIS House — the residency filter (AC A). DAY / non-ACTIVE never selected.
    const boarders = await tx
      .select({
        id: students.id,
        code: students.studentCode,
        firstName: students.firstName,
        lastName: students.lastName,
        sex: students.sex,
        currentBunkId: students.currentBunkId,
        formLabel: classes.name,
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
    const studentIds = boarders.map((b) => b.id);

    const dorms = await tx
      .select({
        id: boardingDormitory.id,
        name: boardingDormitory.name,
        sectionLabel: boardingDormitory.sectionLabel,
      })
      .from(boardingDormitory)
      .where(
        and(eq(boardingDormitory.schoolId, schoolId), eq(boardingDormitory.houseId, houseId)),
      );
    const dormIds = dorms.map((d) => d.id);
    const bunks = dormIds.length
      ? await tx
          .select({
            id: boardingBunk.id,
            dormId: boardingBunk.dormitoryId,
            position: boardingBunk.positionNumber,
            prefectRole: boardingBunk.prefectRole,
          })
          .from(boardingBunk)
          .where(
            and(
              eq(boardingBunk.schoolId, schoolId),
              inArray(boardingBunk.dormitoryId, dormIds),
            ),
          )
      : [];

    // Open (current) allocation per student — from_at drives moved-this-sem + allocated date.
    const openAllocs = studentIds.length
      ? await tx
          .select({
            studentId: bunkAllocation.studentId,
            fromAt: bunkAllocation.fromAt,
            reason: bunkAllocation.reason,
          })
          .from(bunkAllocation)
          .where(
            and(
              eq(bunkAllocation.schoolId, schoolId),
              inArray(bunkAllocation.studentId, studentIds),
              isNull(bunkAllocation.toAt),
            ),
          )
      : [];
    const openByStudent = new Map(openAllocs.map((a) => [a.studentId, a]));

    // Occupants keyed by bunk; unallocated boarders (J1) go to the tray.
    const occupantByBunkId = new Map<string, RosterOccupant>();
    const unallocated: RosterOccupant[] = [];
    for (const b of boarders) {
      const open = openByStudent.get(b.id);
      const fromAt = open?.fromAt ? new Date(open.fromAt) : null;
      const occ: RosterOccupant = {
        studentId: b.id,
        studentCode: b.code,
        name: shortName(b.firstName, b.lastName),
        fullName: `${b.firstName} ${b.lastName}`,
        sex: b.sex as Sex,
        formLabel: b.formLabel ?? null,
        flagged: isPastorallyFlagged(b.code),
        movedThisSem:
          movedThreshold != null && fromAt != null && fromAt.getTime() >= movedThreshold,
        allocatedAtLabel: fromAt ? fmtDate(fromAt) : null,
        allocationReason: open?.reason ?? null,
      };
      if (b.currentBunkId) occupantByBunkId.set(b.currentBunkId, occ);
      else unallocated.push(occ);
    }

    const assembled = assembleDorms(
      dorms,
      bunks.map((b) => ({ ...b, prefectRole: b.prefectRole as PrefectRole | null })),
      occupantByBunkId,
    );
    const summary = summarize(assembled, boarders.length, unallocated.length);
    const prefects = buildPrefectStrip(assembled);

    // Swap log — pair each student's allocations chronologically into from→to moves. The first
    // allocation is the initial placement (not a swap); later ones are the logged reassigns.
    const addressByBunk = new Map<string, string>();
    for (const d of assembled) for (const bk of d.bunks) addressByBunk.set(bk.id, bk.addressShort);
    const nameByStudent = new Map(
      boarders.map((b) => [b.id, shortName(b.firstName, b.lastName)]),
    );
    const allAllocs = studentIds.length
      ? await tx
          .select({
            id: bunkAllocation.id,
            studentId: bunkAllocation.studentId,
            bunkId: bunkAllocation.bunkId,
            fromAt: bunkAllocation.fromAt,
            reason: bunkAllocation.reason,
            staffName: users.fullName,
          })
          .from(bunkAllocation)
          .leftJoin(users, eq(bunkAllocation.allocatedByUserId, users.id))
          .where(
            and(
              eq(bunkAllocation.schoolId, schoolId),
              inArray(bunkAllocation.studentId, studentIds),
            ),
          )
          .orderBy(asc(bunkAllocation.studentId), asc(bunkAllocation.fromAt))
      : [];
    const byStudentAlloc = new Map<string, typeof allAllocs>();
    for (const a of allAllocs) {
      const list = byStudentAlloc.get(a.studentId) ?? [];
      list.push(a);
      byStudentAlloc.set(a.studentId, list);
    }
    const swaps: SwapEntry[] = [];
    for (const list of Array.from(byStudentAlloc.values())) {
      for (let i = 1; i < list.length; i++) {
        const to = list[i];
        const from = list[i - 1];
        swaps.push({
          id: to.id,
          studentName: nameByStudent.get(to.studentId) ?? "—",
          fromAddress: addressByBunk.get(from.bunkId) ?? null,
          toAddress: addressByBunk.get(to.bunkId) ?? null,
          reason: to.reason,
          staffName: to.staffName ?? null,
          atLabel: fmtDate(new Date(to.fromAt)),
        });
      }
    }
    // Newest-first by the reassign timestamp (AC C5).
    const tsById = new Map(allAllocs.map((a) => [a.id, new Date(a.fromAt).getTime()]));
    swaps.sort((a, b) => (tsById.get(b.id) ?? 0) - (tsById.get(a.id) ?? 0));
    const swapsThisSem =
      movedThreshold == null
        ? 0
        : swaps.filter((s) => (tsById.get(s.id) ?? 0) >= movedThreshold).length;

    return {
      house: {
        id: house.id,
        name: house.name,
        colour: house.colour,
        gender: house.gender as HouseGender | null,
        capacity: house.capacity,
        hmName: house.hmName ?? null,
      },
      summary,
      dorms: assembled,
      prefects,
      unallocated,
      swaps,
      swapsThisSem,
      currentTermLabel: currentPeriod?.periodLabel ?? null,
    } satisfies HouseRoster;
  });
}

export interface HouseCard {
  id: string;
  name: string;
  colour: string | null;
  gender: HouseGender | null;
  capacity: number | null;
  hmName: string | null;
  boarderCount: number;
  dormCount: number;
}

/**
 * Houses the current user may open (landing page). School-scoped roles see every House;
 * a plain HOUSEMASTER sees only the House they master (G4). Empty result → the module renders
 * its empty/disabled state (AC E1/E2), never a 500.
 */
export async function listAccessibleHouses(
  schoolId: string,
  roles: readonly string[],
  userId: string | null,
): Promise<HouseCard[]> {
  return withSchool(schoolId, async (tx) => {
    const rows = await tx
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
      .where(eq(houses.schoolId, schoolId))
      .orderBy(asc(houses.name));

    const boarderCounts = await tx
      .select({ houseId: students.houseId, n: sql<number>`count(*)::int` })
      .from(students)
      .where(
        and(
          eq(students.schoolId, schoolId),
          eq(students.residency, "BOARDER"),
          eq(students.status, "ACTIVE"),
        ),
      )
      .groupBy(students.houseId);
    const dormCounts = await tx
      .select({ houseId: boardingDormitory.houseId, n: sql<number>`count(*)::int` })
      .from(boardingDormitory)
      .where(eq(boardingDormitory.schoolId, schoolId))
      .groupBy(boardingDormitory.houseId);
    const boarderByHouse = new Map(boarderCounts.map((r) => [r.houseId, r.n]));
    const dormByHouse = new Map(dormCounts.map((r) => [r.houseId, r.n]));

    return rows
      .filter((h) => canAccessHouse(roles, userId, h.hmUserId))
      .map((h) => ({
        id: h.id,
        name: h.name,
        colour: h.colour,
        gender: h.gender as HouseGender | null,
        capacity: h.capacity,
        hmName: h.hmName ?? null,
        boarderCount: boarderByHouse.get(h.id) ?? 0,
        dormCount: dormByHouse.get(h.id) ?? 0,
      }));
  });
}
