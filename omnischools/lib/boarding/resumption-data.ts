/**
 * SERVER-ONLY boarding resumption/vacation read (SHS module 4.2 / INCR-11) — surface 03. Imports the
 * DB driver via withSchool; NEVER import from a client component (the page passes plain serializable
 * props). Every query is tenant-scoped through withSchool (RLS boundary) and house-scoped for a plain
 * HOUSEMASTER (canAccessHouse — Dean/HM/Admin school-wide + totals).
 *
 * READS + DERIVES only (NO storage): the windows, live counter, House progress and issues queue are
 * pure derivations (./resumption) fed by the boarding_arrival rows + the frozen config contract
 * (getBoardingCalendar / the canonical getCurrentPeriod — READ-ONLY). Fee-owing is the live
 * feeOwingForStudent READ (frozen into a snapshot at check, then read from the row here — AC E4);
 * the confirmed bunk is a live read of students.current_bunk_id (no bunk column — AC F1).
 */
import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import {
  boardingArrival,
  students,
  houses,
  classes,
  users,
  boardingBunk,
  boardingDormitory,
  schools,
} from "@/db/schema";
import { canAccessHouse } from "@/lib/access";
import { getCurrentPeriod } from "./period";
import { isLightColour } from "./roster";
import {
  cohortOf,
  cohortStates,
  deriveArrivalWindows,
  deriveCounter,
  deriveHouseProgress,
  deriveIssues,
  checklistItemsFor,
  checklistPct,
  shortfallItems,
  windowState,
  DEFAULT_WINDOWS,
  RESUMPTION_DAY_TIMES,
  VACATION_DAY_TIMES,
  UNACCOUNTED_GRACE_MIN,
  type ArrivalWindow,
  type BoardingMode,
  type Checklist,
  type ChecklistState,
  type Cohort,
  type DerivedIssue,
  type HouseGender,
} from "./resumption";

const PROGRAMME_ABBR: Record<string, string> = {
  GENERAL_ARTS: "GA",
  GENERAL_SCIENCE: "GS",
  BUSINESS: "BUS",
  AGRICULTURE: "AGRIC",
  VISUAL_ARTS: "VA",
  HOME_ECONOMICS: "HE",
  TECHNICAL: "TECH",
};

const pad2 = (n: number) => String(n).padStart(2, "0");
const shortName = (first: string, last: string) => `${first.charAt(0)}. ${last}`;
const initials = (first: string, last: string) =>
  `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
const money = (n: number) =>
  `GHS ${n.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtTime = (d: Date): string =>
  new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(d);

/** Form number (1|2|3) from the class level ("Form 2") else its name — null when neither carries one. */
function formNumberOf(level: string | null, name: string | null): number | null {
  const src = `${level ?? ""} ${name ?? ""}`;
  const m = src.match(/(?:Form|F)\s*([123])/i);
  return m ? Number(m[1]) : null;
}
/** Short form label "F2 GA" (form + programme abbreviation), else the class name, else "—". */
function shortForm(form: number | null, programme: string | null, className: string | null): string {
  if (form && programme) return `F${form} ${PROGRAMME_ABBR[programme] ?? programme}`;
  if (form) return `F${form}`;
  return className ?? "—";
}

export interface FeeStatus {
  owed: boolean;
  label: string; // "CLEAR" or "GHS 340.00"
}
export interface ChecklistPip {
  pip: string;
  state: ChecklistState;
}
export interface ArrivalRow {
  studentId: string;
  name: string;
  initials: string;
  address: string;
  pips: ChecklistPip[];
  fee: FeeStatus;
  bunkLabel: string;
  bunkAllocated: boolean;
  pct: number;
  action: "view" | "note" | "process";
  checkedAtLabel: string;
  actorName: string | null;
  note: string | null;
}
export interface HouseCard {
  id: string;
  name: string;
  colour: string | null;
  isLight: boolean;
  gender: HouseGender | null;
  hmName: string | null;
  arrived: number;
  expected: number;
  pct: number;
  warn: boolean;
  status: "live" | "done" | "waiting";
  byForm: { form: number; arrived: number; expected: number }[];
  feeShortfalls: number;
}
export interface CounterView {
  arrived: number;
  expected: number;
  pct: number;
  remaining: number;
  arrivedThisHour: number;
  ratePerHour: number;
  peakHourLabel: string | null;
  peakHourCount: number;
  lastArrivalLabel: string | null;
}
export interface FootStats {
  arrivedLabel: string; // "423 / 712"
  pct: number;
  feeOwingArrivals: number;
  shortfalls: number;
  timeToGateCloseLabel: string;
}
export interface BoarderOption {
  id: string;
  name: string;
  formLabel: string;
  houseName: string;
  checkedIn: boolean;
}
export interface ResumptionBoard {
  mode: BoardingMode;
  dateIso: string;
  isToday: boolean;
  dayLabel: string;
  periodLabel: string | null;
  schoolName: string;
  hasBoarders: boolean;
  clockLabel: string;
  clockMeridian: string;
  hoursIn: number;
  hoursRemaining: number;
  counter: CounterView;
  windows: ArrivalWindow[];
  houses: HouseCard[];
  arrivals: ArrivalRow[];
  issues: DerivedIssue[];
  foot: FootStats;
  boarderOptions: BoarderOption[];
  times: { gateCloseLabel: string; supperLabel: string; lockDownLabel: string };
}

interface BoarderRow {
  studentId: string;
  houseId: string;
  firstName: string;
  lastName: string;
  sex: "MALE" | "FEMALE" | null;
  form: number | null;
  shortFormLabel: string;
  houseName: string;
  houseGender: HouseGender | null;
  currentBunkId: string | null;
  bunkLabel: string;
  bunkAllocated: boolean;
  cohort: Cohort | null;
}

/** Minutes-past-close helper — true when a window has closed AND its grace has elapsed on `dayIso`. */
function pastWindowGrace(win: { end: string }, dayIso: string, now: Date): boolean {
  const nowIso = now.toISOString().slice(0, 10);
  if (dayIso < nowIso) return true;
  if (dayIso > nowIso) return false;
  const [h, m] = win.end.split(":").map(Number);
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  return nowMin >= h * 60 + m + UNACCOUNTED_GRACE_MIN;
}

/**
 * The full resumption/vacation board for the accessible Houses (AC A–H). School-scoped roles see
 * every House + totals; a plain HOUSEMASTER sees only the House they master (canAccessHouse). Returns
 * coherent (possibly empty) data on every edge — no period, no boarders, no arrivals all render a
 * calm empty board, never a throw. `now` is injected for tests; defaults to Date.now.
 */
export async function getResumptionBoard(
  schoolId: string,
  mode: BoardingMode,
  roles: readonly string[],
  userId: string | null,
  dateIso?: string,
  now: Date = new Date(),
): Promise<ResumptionBoard> {
  const viewedDate = dateIso ?? now.toISOString().slice(0, 10);
  const isToday = viewedDate === now.toISOString().slice(0, 10);
  const times =
    mode === "RESUMPTION"
      ? { gateCloseLabel: RESUMPTION_DAY_TIMES.gateClose, supperLabel: RESUMPTION_DAY_TIMES.supper, lockDownLabel: RESUMPTION_DAY_TIMES.gateClose }
      : { gateCloseLabel: VACATION_DAY_TIMES.lockDown, supperLabel: VACATION_DAY_TIMES.keysToSeniorHm, lockDownLabel: VACATION_DAY_TIMES.lockDown };

  return withSchool(schoolId, async (tx): Promise<ResumptionBoard> => {
    const [school] = await tx
      .select({ name: schools.name })
      .from(schools)
      .where(eq(schools.id, schoolId))
      .limit(1);
    const schoolName = school?.name ?? "School";
    const period = await getCurrentPeriod(tx, schoolId);

    // Accessible Houses (house-scope for a plain HM).
    const houseRows = await tx
      .select({
        id: houses.id,
        name: houses.name,
        colour: houses.colour,
        gender: houses.gender,
        hmUserId: houses.hmUserId,
        hmName: users.fullName,
      })
      .from(houses)
      .leftJoin(users, eq(houses.hmUserId, users.id))
      .where(eq(houses.schoolId, schoolId));
    const accessibleHouses = houseRows.filter((h) => canAccessHouse(roles, userId, h.hmUserId));
    const houseIds = accessibleHouses.map((h) => h.id);
    const houseById = new Map(accessibleHouses.map((h) => [h.id, h]));

    const emptyBoard = (): ResumptionBoard => ({
      mode,
      dateIso: viewedDate,
      isToday,
      dayLabel: dayLabelOf(viewedDate),
      periodLabel: period?.periodLabel ?? null,
      schoolName,
      hasBoarders: false,
      clockLabel: fmtTime(now),
      clockMeridian: meridianOf(now),
      hoursIn: 0,
      hoursRemaining: 0,
      counter: {
        arrived: 0,
        expected: 0,
        pct: 0,
        remaining: 0,
        arrivedThisHour: 0,
        ratePerHour: 0,
        peakHourLabel: null,
        peakHourCount: 0,
        lastArrivalLabel: null,
      },
      windows: deriveArrivalWindows([], [], viewedDate, now),
      houses: [],
      arrivals: [],
      issues: [],
      foot: {
        arrivedLabel: "0 / 0",
        pct: 0,
        feeOwingArrivals: 0,
        shortfalls: 0,
        timeToGateCloseLabel: timeToGateClose(times.gateCloseLabel, viewedDate, now),
      },
      boarderOptions: [],
      times,
    });

    if (houseIds.length === 0 || !period) return emptyBoard();

    // Active boarders in the accessible Houses + their live bunk (current_bunk_id → dorm-pos).
    const boarderRaw = await tx
      .select({
        studentId: students.id,
        houseId: students.houseId,
        firstName: students.firstName,
        lastName: students.lastName,
        sex: students.sex,
        programme: students.programme,
        classLevel: classes.level,
        className: classes.name,
        currentBunkId: students.currentBunkId,
        dormName: boardingDormitory.name,
        bunkPos: boardingBunk.positionNumber,
      })
      .from(students)
      .leftJoin(classes, and(eq(classes.schoolId, students.schoolId), eq(classes.id, students.classId)))
      .leftJoin(
        boardingBunk,
        and(eq(boardingBunk.schoolId, students.schoolId), eq(boardingBunk.id, students.currentBunkId)),
      )
      .leftJoin(
        boardingDormitory,
        and(
          eq(boardingDormitory.schoolId, boardingBunk.schoolId),
          eq(boardingDormitory.id, boardingBunk.dormitoryId),
        ),
      )
      .where(
        and(
          eq(students.schoolId, schoolId),
          inArray(students.houseId, houseIds),
          eq(students.residency, "BOARDER"),
          eq(students.status, "ACTIVE"),
        ),
      )
      .orderBy(students.lastName);

    const boarders: BoarderRow[] = boarderRaw.map((b) => {
      const house = houseById.get(b.houseId!);
      const form = formNumberOf(b.classLevel, b.className);
      const bunkAllocated = b.currentBunkId != null && b.bunkPos != null;
      return {
        studentId: b.studentId,
        houseId: b.houseId!,
        firstName: b.firstName,
        lastName: b.lastName,
        sex: b.sex as "MALE" | "FEMALE" | null,
        form,
        shortFormLabel: shortForm(form, b.programme, b.className),
        houseName: house?.name ?? "—",
        houseGender: (house?.gender ?? null) as HouseGender | null,
        currentBunkId: b.currentBunkId,
        bunkLabel: bunkAllocated ? `${b.dormName}-${pad2(b.bunkPos!)}` : "—",
        bunkAllocated,
        cohort: cohortOf(form, (house?.gender ?? null) as HouseGender | null, b.sex as "MALE" | "FEMALE" | null),
      };
    });
    const boarderById = new Map(boarders.map((b) => [b.studentId, b]));

    // Arrival rows for this (period × mode) in the accessible Houses.
    const arrivalRaw = await tx
      .select({
        studentId: boardingArrival.studentId,
        houseId: boardingArrival.houseId,
        checklistJson: boardingArrival.checklistJson,
        feeSnapshot: boardingArrival.feeOwingSnapshot,
        note: boardingArrival.note,
        checkedAt: boardingArrival.checkedAt,
        actorName: users.fullName,
      })
      .from(boardingArrival)
      .leftJoin(users, eq(boardingArrival.checkedByUserId, users.id))
      .where(
        and(
          eq(boardingArrival.schoolId, schoolId),
          eq(boardingArrival.academicPeriodId, period.periodId),
          eq(boardingArrival.mode, mode),
          inArray(boardingArrival.houseId, houseIds),
        ),
      )
      .orderBy(desc(boardingArrival.checkedAt));

    const arrivalByStudent = new Map(arrivalRaw.map((a) => [a.studentId, a]));
    const feeOf = (snap: string | null): number => (snap != null ? Number(snap) : 0);

    // --- Windows + counter (school-wide across accessible Houses) ---
    const windowBoarders = boarders.map((b) => ({ studentId: b.studentId, cohort: b.cohort }));
    const windowArrivals = arrivalRaw.map((a) => ({ studentId: a.studentId, checkedAt: a.checkedAt }));
    const windows = deriveArrivalWindows(windowBoarders, windowArrivals, viewedDate, now);
    const csMap = cohortStates(viewedDate, now);
    const counterRaw = deriveCounter(boarders.length, windowArrivals, now);
    const lastArr = counterRaw.lastArrivalAt
      ? arrivalRaw.find((a) => a.checkedAt.getTime() === counterRaw.lastArrivalAt!.getTime())
      : null;
    const lastArrB = lastArr ? boarderById.get(lastArr.studentId) : null;
    const counter: CounterView = {
      arrived: counterRaw.arrived,
      expected: counterRaw.expected,
      pct: counterRaw.pct,
      remaining: counterRaw.remaining,
      arrivedThisHour: counterRaw.arrivedThisHour,
      ratePerHour: counterRaw.ratePerHour,
      peakHourLabel: counterRaw.peakHourLabel,
      peakHourCount: counterRaw.peakHourCount,
      lastArrivalLabel:
        lastArr && lastArrB
          ? `${fmtTime(lastArr.checkedAt)} (${lastArrB.houseName} · ${shortName(lastArrB.firstName, lastArrB.lastName)}, ${lastArrB.shortFormLabel})`
          : null,
    };

    // --- House cards ---
    const houseCards: HouseCard[] = accessibleHouses
      .map((h) => {
        const hb = boarders.filter((b) => b.houseId === h.id);
        const ha = arrivalRaw
          .filter((a) => a.houseId === h.id)
          .map((a) => {
            const b = boarderById.get(a.studentId);
            return { studentId: a.studentId, form: b?.form ?? null, feeOwing: feeOf(a.feeSnapshot) };
          });
        const hp = deriveHouseProgress(
          hb.map((b) => ({ studentId: b.studentId, form: b.form, cohort: b.cohort })),
          ha,
          csMap,
        );
        return {
          id: h.id,
          name: h.name,
          colour: h.colour,
          isLight: isLightColour(h.colour),
          gender: (h.gender ?? null) as HouseGender | null,
          hmName: h.hmName ?? null,
          arrived: hp.arrived,
          expected: hp.expected,
          pct: hp.pct,
          warn: hp.warn,
          status: hp.status,
          byForm: hp.byForm,
          feeShortfalls: hp.feeShortfalls,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    // --- Live-arrivals checklist rows (most recent first) ---
    const items = checklistItemsFor(mode);
    const arrivals: ArrivalRow[] = arrivalRaw.slice(0, 12).map((a) => {
      const b = boarderById.get(a.studentId);
      const checklist = (a.checklistJson ?? {}) as Checklist;
      const pips: ChecklistPip[] = items.map((it) => ({
        pip: it.pip,
        state: (checklist[it.key] ?? "missing") as ChecklistState,
      }));
      const fee = feeOf(a.feeSnapshot);
      const shortfall = shortfallItems(checklist, mode);
      const action: ArrivalRow["action"] =
        fee > 0 ? "process" : shortfall.length > 0 ? "note" : "view";
      return {
        studentId: a.studentId,
        name: b ? shortName(b.firstName, b.lastName) : "—",
        initials: b ? initials(b.firstName, b.lastName) : "—",
        address: `${b?.shortFormLabel ?? "—"} · ${b?.houseName ?? "—"}`,
        pips,
        fee: fee > 0 ? { owed: true, label: money(fee) } : { owed: false, label: "CLEAR" },
        bunkLabel: b?.bunkLabel ?? "—",
        bunkAllocated: b?.bunkAllocated ?? false,
        pct: checklistPct(checklist, mode),
        action,
        checkedAtLabel: fmtTime(a.checkedAt),
        actorName: a.actorName ?? null,
        note: a.note,
      };
    });

    // --- Issues (derived + note) ---
    const issueArrivals = arrivalRaw.map((a) => {
      const b = boarderById.get(a.studentId);
      const checklist = (a.checklistJson ?? {}) as Checklist;
      return {
        studentId: a.studentId,
        name: b ? shortName(b.firstName, b.lastName) : "—",
        address: `${b?.shortFormLabel ?? "—"} · ${b?.houseName ?? "—"}`,
        timeLabel: fmtTime(a.checkedAt),
        feeOwing: feeOf(a.feeSnapshot),
        shortfall: shortfallItems(checklist, mode),
        bunkAllocated: b?.bunkAllocated ?? true,
        note: a.note,
      };
    });
    // Unaccounted (RESUMPTION only) — active boarder, no arrival, window closed + grace passed (AC G2).
    const cohortWindow = new Map<Cohort, (typeof DEFAULT_WINDOWS)[number]>();
    for (const w of DEFAULT_WINDOWS) if (w.cohort) cohortWindow.set(w.cohort, w);
    const unaccounted =
      mode === "RESUMPTION"
        ? boarders
            .filter((b) => !arrivalByStudent.has(b.studentId) && b.cohort)
            .filter((b) => {
              const w = cohortWindow.get(b.cohort!);
              return !!w && windowState(w, viewedDate, now) === "done" && pastWindowGrace(w, viewedDate, now);
            })
            .map((b) => {
              const w = cohortWindow.get(b.cohort!)!;
              return {
                studentId: b.studentId,
                name: shortName(b.firstName, b.lastName),
                address: `${b.shortFormLabel} · ${b.houseName}`,
                windowLabel: `${w.start} — ${w.end}`,
              };
            })
        : [];
    const issues = deriveIssues(issueArrivals, unaccounted, mode);

    // --- Boarder options for the gate-check modal ---
    const boarderOptions: BoarderOption[] = boarders
      .map((b) => ({
        id: b.studentId,
        name: shortName(b.firstName, b.lastName),
        formLabel: b.shortFormLabel,
        houseName: b.houseName,
        checkedIn: arrivalByStudent.has(b.studentId),
      }))
      .sort((a, b) => a.houseName.localeCompare(b.houseName) || a.name.localeCompare(b.name));

    const dayStartUtc = new Date(`${viewedDate}T00:00:00Z`).getTime();
    const hoursIn = isToday ? Math.max(0, Math.floor((now.getTime() - (dayStartUtc + 5 * 3600_000)) / 3600_000)) : 0;

    return {
      mode,
      dateIso: viewedDate,
      isToday,
      dayLabel: dayLabelOf(viewedDate),
      periodLabel: period.periodLabel,
      schoolName,
      hasBoarders: boarders.length > 0,
      clockLabel: fmtTime(now),
      clockMeridian: meridianOf(now),
      hoursIn,
      hoursRemaining: Math.max(0, 13 - hoursIn),
      counter,
      windows,
      houses: houseCards,
      arrivals,
      issues,
      foot: {
        arrivedLabel: `${counter.arrived} / ${counter.expected}`,
        pct: counter.pct,
        feeOwingArrivals: arrivalRaw.filter((a) => feeOf(a.feeSnapshot) > 0).length,
        shortfalls: issues.filter((i) => i.category === "prospectus").length,
        timeToGateCloseLabel: timeToGateClose(times.gateCloseLabel, viewedDate, now),
      },
      boarderOptions,
      times,
    };
  });
}

// ---------------------------------------------------------------------------
// Small display helpers (UTC — Ghana is GMT+0)
// ---------------------------------------------------------------------------
function meridianOf(now: Date): string {
  const dow = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][now.getUTCDay()];
  const ampm = now.getUTCHours() < 12 ? "AM" : "PM";
  return `${ampm} · ${dow}`;
}
function dayLabelOf(dateIso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${dateIso}T12:00:00Z`));
}
function timeToGateClose(closeHhmm: string, dateIso: string, now: Date): string {
  const [h, m] = closeHhmm.split(":").map(Number);
  const close = new Date(`${dateIso}T${pad2(h)}:${pad2(m)}:00Z`).getTime();
  const diff = close - now.getTime();
  if (diff <= 0) return "gate closed";
  const mins = Math.floor(diff / 60000);
  return `${Math.floor(mins / 60)} hr ${mins % 60} min`;
}
