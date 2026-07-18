/**
 * Boarding resumption / vacation (SHS module 4.2 / INCR-11) — the PURE derivation + checklist core
 * for surface 03. No DB, no I/O: every function is deterministic and unit-tested (resumption.test.ts).
 * The server read layer (resumption-data.ts) fetches rows and delegates the shaping here; the write
 * action (lib/actions/boarding-resumption.ts) validates the checklist here. Keeping it pure means the
 * arrival WINDOWS, live COUNTER, House PROGRESS and ISSUES queue are display-and-write derivation with
 * ZERO storage (Kofi OQ3/OQ5): no window-state row, no counter column, no issues table, no trigger.
 *
 * Time frame: Ghana runs on UTC (GMT+0), so a window's wall-clock time == UTC. Every clock comparison
 * (window done/active/pending, arrived-this-hour) uses UTC — never the runtime machine's local zone.
 */
import { z } from "zod";

export type BoardingMode = "RESUMPTION" | "VACATION";
export type ChecklistState = "ok" | "partial" | "missing";
export type HouseGender = "BOYS" | "GIRLS" | "COED";

// ---------------------------------------------------------------------------
// Checklist canonical constants + Zod (Kofi OQ2) — the deboardinization-ladder pattern: fixed
// lib/ constants, `schoolId` in the getter signature (unused) so a future per-school override is
// not a cross-increment signature break. NO config table (YAGNI).
// ---------------------------------------------------------------------------

export interface ChecklistItem {
  key: string;
  label: string;
  /** The uppercase pip label, surface verbatim. */
  pip: string;
}

/** GES prospectus — the 6 resumption inspection points (surface 03: CHOP·MATTRESS·MAC·NET·BUCKET·BIBLE). */
export const RESUMPTION_ITEMS = [
  { key: "chop_box", label: "Chop box", pip: "CHOP" },
  { key: "mattress", label: "Mattress", pip: "MATTRESS" },
  { key: "mackintosh", label: "Mackintosh", pip: "MAC" },
  { key: "mosquito_net", label: "Mosquito net", pip: "NET" },
  { key: "bucket", label: "Bucket", pip: "BUCKET" },
  { key: "bible_or_quran", label: "Bible / Quran", pip: "BIBLE" },
] as const satisfies readonly ChecklistItem[];

/** The 5 vacation departure checks (surface 03 notes — the inverse of arrival). */
export const VACATION_ITEMS = [
  { key: "bunk_cleared", label: "Bunk cleared", pip: "BUNK" },
  { key: "locker_emptied", label: "Locker emptied", pip: "LOCKER" },
  { key: "chop_box_collected", label: "Chop box collected", pip: "CHOP" },
  { key: "transport_contact_verified", label: "Transport contact verified", pip: "TRANSPORT" },
  { key: "exeat_card_returned", label: "Exeat card returned", pip: "CARD" },
] as const satisfies readonly ChecklistItem[];

/** Contract getter (a future INCR reads this). `schoolId` accepted (unused) — override-ready. */
export function getResumptionProspectus(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  schoolId: string,
): readonly ChecklistItem[] {
  return RESUMPTION_ITEMS;
}
export function getVacationChecklist(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  schoolId: string,
): readonly ChecklistItem[] {
  return VACATION_ITEMS;
}

export function checklistItemsFor(mode: BoardingMode): readonly ChecklistItem[] {
  return mode === "RESUMPTION" ? RESUMPTION_ITEMS : VACATION_ITEMS;
}

const stateEnum = z.enum(["ok", "partial", "missing"]);

/**
 * Mode-discriminated checklist schemas (Kofi OQ1 — Zod-in-lib, NO DB CHECK). `.strict()` rejects any
 * extra key; every listed key is required — so the RESUMPTION schema rejects the 5 VACATION keys (all
 * 6 required keys missing + 5 unrecognised) and vice-versa (AC D2/D5). Each value is a 3-state.
 */
export const resumptionChecklistSchema = z
  .object({
    chop_box: stateEnum,
    mattress: stateEnum,
    mackintosh: stateEnum,
    mosquito_net: stateEnum,
    bucket: stateEnum,
    bible_or_quran: stateEnum,
  })
  .strict();
export const vacationChecklistSchema = z
  .object({
    bunk_cleared: stateEnum,
    locker_emptied: stateEnum,
    chop_box_collected: stateEnum,
    transport_contact_verified: stateEnum,
    exeat_card_returned: stateEnum,
  })
  .strict();

export type ResumptionChecklist = z.infer<typeof resumptionChecklistSchema>;
export type VacationChecklist = z.infer<typeof vacationChecklistSchema>;
export type Checklist = Record<string, ChecklistState>;

export function checklistSchemaFor(mode: BoardingMode) {
  return mode === "RESUMPTION" ? resumptionChecklistSchema : vacationChecklistSchema;
}

/** The keys that are not `ok` (partial/missing) — the prospectus/departure shortfall (D3). */
export function shortfallItems(checklist: Checklist, mode: BoardingMode): string[] {
  return checklistItemsFor(mode)
    .filter((it) => checklist[it.key] !== "ok")
    .map((it) => it.pip);
}
/** % of items marked `ok` (surface's per-scan pct). All-ok → 100, no items → 0. */
export function checklistPct(checklist: Checklist, mode: BoardingMode): number {
  const items = checklistItemsFor(mode);
  if (items.length === 0) return 0;
  const ok = items.filter((it) => checklist[it.key] === "ok").length;
  return Math.round((ok / items.length) * 100);
}

// ---------------------------------------------------------------------------
// Open-UI default times (Lucy: no config source — a small lib/ default, NOT an overload of
// getExeatPolicy). Gate-close / supper / lock-down copy for the head-row + foot-bar.
// ---------------------------------------------------------------------------
export const RESUMPTION_DAY_TIMES = {
  gateClose: "18:00",
  supper: "18:30",
  signInClose: "18:30",
} as const;
export const VACATION_DAY_TIMES = {
  lockDown: "18:00",
  keysToSeniorHm: "18:30",
} as const;

/** Minutes past a window's close before an un-arrived boarder is flagged unaccounted (surface: 60). */
export const UNACCOUNTED_GRACE_MIN = 60;

// ---------------------------------------------------------------------------
// Cohort + windows (AC A) — derived, no window-state row
// ---------------------------------------------------------------------------

export type Cohort = "F3" | "F2_BOYS" | "F2_GIRLS" | "F1_BOYS" | "F1_GIRLS";
export type WindowState = "done" | "active" | "pending";

/**
 * The staggered arrival cohort of a boarder (AC A5 — House gender drives the F2/F1 split). Form 3 is
 * one all-Houses cohort; F2/F1 split boys/girls by the boarder's HOUSE gender (a COED house has no
 * single gender, so those boarders fall back to their own sex — every boarder lands in exactly one
 * cohort). A student outside F1–F3 → null (uncounted in windows, still in the live counter).
 */
export function cohortOf(
  form: number | null,
  houseGender: HouseGender | null,
  sex: "MALE" | "FEMALE" | null,
): Cohort | null {
  if (form === 3) return "F3";
  if (form !== 1 && form !== 2) return null;
  const boys =
    houseGender === "BOYS" ? true : houseGender === "GIRLS" ? false : sex === "MALE";
  if (form === 2) return boys ? "F2_BOYS" : "F2_GIRLS";
  return boys ? "F1_BOYS" : "F1_GIRLS";
}

interface WindowDef {
  key: string;
  start: string; // HH:MM UTC
  end: string;
  formLabel: string;
  scopeLabel: string;
  cohort: Cohort | null; // null = the Late time-bucket (no denominator)
}
/** The 6 default windows (AC A1) — F3 all → F2 boys → F2 girls → F1 boys → F1 girls → Late all. */
export const DEFAULT_WINDOWS: readonly WindowDef[] = [
  { key: "W1", start: "05:00", end: "07:00", formLabel: "Form 3", scopeLabel: "all Houses", cohort: "F3" },
  { key: "W2", start: "07:00", end: "09:00", formLabel: "Form 2", scopeLabel: "boys", cohort: "F2_BOYS" },
  { key: "W3", start: "09:00", end: "12:00", formLabel: "Form 2", scopeLabel: "girls", cohort: "F2_GIRLS" },
  { key: "W4", start: "12:00", end: "14:00", formLabel: "Form 1", scopeLabel: "boys", cohort: "F1_BOYS" },
  { key: "W5", start: "14:00", end: "16:00", formLabel: "Form 1", scopeLabel: "girls", cohort: "F1_GIRLS" },
  { key: "W6", start: "16:00", end: "18:00", formLabel: "Late", scopeLabel: "all forms", cohort: null },
] as const;

export interface ArrivalWindow {
  key: string;
  timeLabel: string; // "05:00 — 07:00"
  formLabel: string;
  scopeLabel: string;
  cohort: Cohort | null;
  hasDenominator: boolean;
  expected: number;
  arrived: number;
  pct: number;
  state: WindowState;
  /** The surface count string: "238 / 240 · 99%" or, for the Late bucket, "12 arrived" / "— pending —". */
  countLabel: string;
}

export interface WindowBoarder {
  studentId: string;
  cohort: Cohort | null;
}
export interface WindowArrival {
  studentId: string;
  checkedAt: Date;
}

const toMin = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const utcMin = (d: Date): number => d.getUTCHours() * 60 + d.getUTCMinutes();
const isoUtc = (d: Date): string => d.toISOString().slice(0, 10);

/** done/active/pending for a window on `dayIso`, from the clock alone (AC A3 — never stored). */
export function windowState(win: { start: string; end: string }, dayIso: string, now: Date): WindowState {
  const nowIso = isoUtc(now);
  if (dayIso < nowIso) return "done";
  if (dayIso > nowIso) return "pending";
  const t = utcMin(now);
  if (t >= toMin(win.end)) return "done";
  return t >= toMin(win.start) ? "active" : "pending";
}

/**
 * The six arrival windows with per-window %arrived DERIVED from the records (AC A2). A cohort window's
 * expected/arrived count the boarders/arrivals in that Form-cohort (the % attributes a wrong-Form
 * arrival to its own cohort — domain trap). The Late window (W6) is a count-only time bucket of
 * arrivals stamped 16:00–18:00, with no denominator (AC A4). Windows derive on `dayIso` (AC A6 — a
 * shifted SENIOR resumption date shifts the clock the windows read).
 */
export function deriveArrivalWindows(
  boarders: readonly WindowBoarder[],
  arrivals: readonly WindowArrival[],
  dayIso: string,
  now: Date,
): ArrivalWindow[] {
  const expectedByCohort = new Map<Cohort, number>();
  for (const b of boarders) {
    if (b.cohort) expectedByCohort.set(b.cohort, (expectedByCohort.get(b.cohort) ?? 0) + 1);
  }
  const cohortByStudent = new Map(boarders.map((b) => [b.studentId, b.cohort]));
  const arrivedByCohort = new Map<Cohort, number>();
  for (const a of arrivals) {
    const c = cohortByStudent.get(a.studentId);
    if (c) arrivedByCohort.set(c, (arrivedByCohort.get(c) ?? 0) + 1);
  }

  return DEFAULT_WINDOWS.map((w) => {
    const state = windowState(w, dayIso, now);
    if (w.cohort === null) {
      // Late time-bucket — count arrivals stamped inside 16:00–18:00 on the day (count-only).
      const arrived = arrivals.filter(
        (a) =>
          isoUtc(a.checkedAt) === dayIso &&
          utcMin(a.checkedAt) >= toMin(w.start) &&
          utcMin(a.checkedAt) < toMin(w.end),
      ).length;
      return {
        key: w.key,
        timeLabel: `${w.start} — ${w.end}`,
        formLabel: w.formLabel,
        scopeLabel: w.scopeLabel,
        cohort: null,
        hasDenominator: false,
        expected: 0,
        arrived,
        pct: 0,
        state,
        countLabel: arrived > 0 ? `${arrived} arrived` : "— pending —",
      };
    }
    const expected = expectedByCohort.get(w.cohort) ?? 0;
    const arrived = arrivedByCohort.get(w.cohort) ?? 0;
    const pct = expected > 0 ? Math.round((arrived / expected) * 100) : 0;
    return {
      key: w.key,
      timeLabel: `${w.start} — ${w.end}`,
      formLabel: w.formLabel,
      scopeLabel: w.scopeLabel,
      cohort: w.cohort,
      hasDenominator: true,
      expected,
      arrived,
      pct,
      countLabel: `${arrived} / ${expected} · ${pct}%`,
      state,
    };
  });
}

/** The cohort→state map (feeds House-progress "behind pace"). Derived from the same clock. */
export function cohortStates(dayIso: string, now: Date): Map<Cohort, WindowState> {
  const m = new Map<Cohort, WindowState>();
  for (const w of DEFAULT_WINDOWS) {
    if (w.cohort) m.set(w.cohort, windowState(w, dayIso, now));
  }
  return m;
}

// ---------------------------------------------------------------------------
// Live counter + foot stats (AC C) — derived, nothing stored
// ---------------------------------------------------------------------------

export interface LiveCounter {
  arrived: number;
  expected: number;
  pct: number;
  remaining: number;
  arrivedThisHour: number;
  ratePerHour: number;
  peakHourLabel: string | null;
  peakHourCount: number;
  lastArrivalAt: Date | null;
}

/** The live arrival counter + rate + peak-hour, all DERIVED from the arrival stamps (AC C1/C2/C3). */
export function deriveCounter(
  expected: number,
  arrivals: readonly WindowArrival[],
  now: Date,
): LiveCounter {
  const arrived = arrivals.length;
  const pct = expected > 0 ? Math.round((arrived / expected) * 100) : 0;
  const hourAgo = now.getTime() - 60 * 60 * 1000;
  const arrivedThisHour = arrivals.filter((a) => a.checkedAt.getTime() > hourAgo).length;
  // Peak hour = the UTC hour bucket with the most arrivals.
  const byHour = new Map<number, number>();
  let lastArrivalAt: Date | null = null;
  for (const a of arrivals) {
    const h = a.checkedAt.getUTCHours();
    byHour.set(h, (byHour.get(h) ?? 0) + 1);
    if (!lastArrivalAt || a.checkedAt > lastArrivalAt) lastArrivalAt = a.checkedAt;
  }
  let peakHour = -1;
  let peakHourCount = 0;
  for (const [h, n] of byHour) {
    if (n > peakHourCount) {
      peakHourCount = n;
      peakHour = h;
    }
  }
  const pad = (h: number) => String(h).padStart(2, "0");
  return {
    arrived,
    expected,
    pct,
    remaining: Math.max(0, expected - arrived),
    arrivedThisHour,
    ratePerHour: arrivedThisHour,
    peakHourLabel: peakHour >= 0 ? `${pad(peakHour)}:00 — ${pad(peakHour + 1)}:00` : null,
    peakHourCount,
    lastArrivalAt,
  };
}

// ---------------------------------------------------------------------------
// House-by-House progress (AC B) — derived per accessible House
// ---------------------------------------------------------------------------

export interface HouseProgressBoarder {
  studentId: string;
  form: number | null;
  cohort: Cohort | null;
}
export interface HouseProgressArrival {
  studentId: string;
  form: number | null;
  feeOwing: number;
}
export interface FormProgress {
  form: number;
  arrived: number;
  expected: number;
}
export interface HouseProgress {
  arrived: number;
  expected: number;
  pct: number;
  warn: boolean;
  status: "live" | "done" | "waiting";
  byForm: FormProgress[];
  feeShortfalls: number;
}

/**
 * One House's arrival progress (AC B) — arrived/expected + per-Form breakdown + fee-shortfall count,
 * all from row-count (no counter column). `warn` = fewer have arrived than the boarders whose window
 * has already closed or is active (a derived "behind pace"); status pill live/done/waiting.
 */
export function deriveHouseProgress(
  boarders: readonly HouseProgressBoarder[],
  arrivals: readonly HouseProgressArrival[],
  cohortState: ReadonlyMap<Cohort, WindowState>,
): HouseProgress {
  const expected = boarders.length;
  const arrived = arrivals.length;
  const pct = expected > 0 ? Math.round((arrived / expected) * 100) : 0;
  const byForm: FormProgress[] = [1, 2, 3].map((form) => ({
    form,
    expected: boarders.filter((b) => b.form === form).length,
    arrived: arrivals.filter((a) => a.form === form).length,
  }));
  const feeShortfalls = arrivals.filter((a) => a.feeOwing > 0).length;
  const expectedByNow = boarders.filter((b) => {
    const st = b.cohort ? cohortState.get(b.cohort) : undefined;
    return st === "done" || st === "active";
  }).length;
  const warn = expectedByNow > 0 && arrived < expectedByNow;
  const status: HouseProgress["status"] =
    expected > 0 && arrived >= expected ? "done" : arrived === 0 ? "waiting" : "live";
  return { arrived, expected, pct, warn, status, byForm, feeShortfalls };
}

// ---------------------------------------------------------------------------
// Issues queue (AC G) — derived + one lean note, NO issues table
// ---------------------------------------------------------------------------

export type IssueCategory = "fee" | "prospectus" | "bunk" | "unaccounted" | "note";
export interface DerivedIssue {
  id: string;
  timeLabel: string;
  category: IssueCategory;
  text: string;
  routing: string;
  canEscalate: boolean;
}
export interface IssueArrival {
  studentId: string;
  name: string;
  address: string;
  timeLabel: string;
  feeOwing: number;
  shortfall: string[]; // pip labels that are partial/missing
  bunkAllocated: boolean;
  note: string | null;
}
export interface IssueUnaccounted {
  studentId: string;
  name: string;
  address: string;
  windowLabel: string;
}

const money = (n: number) =>
  `GHS ${n.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Derive the issues queue (AC G1) from the arrival records + the derived unaccounted set — four
 * categories (fee-shortfall / prospectus-or-departure shortfall / unaccounted-past-window / bunk-
 * unallocated) plus the one lean `note`. NOTHING is stored: no issues table, no status. Only the
 * unaccounted "escalate" is actionable (fires a console SMS — G4). Ordered most-recent first.
 */
export function deriveIssues(
  arrivals: readonly IssueArrival[],
  unaccounted: readonly IssueUnaccounted[],
  mode: BoardingMode,
): DerivedIssue[] {
  const issues: DerivedIssue[] = [];
  for (const a of arrivals) {
    if (a.feeOwing > 0) {
      issues.push({
        id: `fee-${a.studentId}`,
        timeLabel: a.timeLabel,
        category: "fee",
        text:
          mode === "RESUMPTION"
            ? `${a.name} · ${a.address} · fee shortfall ${money(a.feeOwing)} · admitted, follow-up (GES cannot-detain)`
            : `${a.name} · ${a.address} · departing with ${money(a.feeOwing)} outstanding · flagged, not detained`,
        routing: "Senior HM",
        canEscalate: false,
      });
    }
    if (a.shortfall.length > 0) {
      issues.push({
        id: `prospectus-${a.studentId}`,
        timeLabel: a.timeLabel,
        category: "prospectus",
        text:
          mode === "RESUMPTION"
            ? `${a.name} · ${a.address} · prospectus short: ${a.shortfall.join(", ")} · conditional, note logged`
            : `${a.name} · ${a.address} · departure check incomplete: ${a.shortfall.join(", ")}`,
        routing: "HM",
        canEscalate: false,
      });
    }
    if (!a.bunkAllocated && mode === "RESUMPTION") {
      issues.push({
        id: `bunk-${a.studentId}`,
        timeLabel: a.timeLabel,
        category: "bunk",
        text: `${a.name} · ${a.address} · no bunk allocated · unallocated (admitted, HM to place)`,
        routing: "HM",
        canEscalate: false,
      });
    }
    if (a.note) {
      issues.push({
        id: `note-${a.studentId}`,
        timeLabel: a.timeLabel,
        category: "note",
        text: `${a.name} · ${a.address} · ${a.note}`,
        routing: "HM",
        canEscalate: false,
      });
    }
  }
  for (const u of unaccounted) {
    issues.push({
      id: `unaccounted-${u.studentId}`,
      timeLabel: u.windowLabel,
      category: "unaccounted",
      text: `${u.name} · ${u.address} · expected ${u.windowLabel}, unaccounted past window + grace · parent SMS`,
      routing: "Senior HM",
      canEscalate: true,
    });
  }
  return issues;
}

// ---------------------------------------------------------------------------
// SMS bodies (AC H4/I) — console provider, pure copy builders
// ---------------------------------------------------------------------------

export function arrivalSms(studentName: string, schoolName: string): string {
  return `${studentName} safely arrived at ${schoolName}. Items checked. Welcome back.`;
}
export function departureSms(studentName: string, schoolName: string): string {
  return `${studentName} has departed ${schoolName} for vacation. Safe travels.`;
}
export function unaccountedSms(studentName: string, schoolName: string): string {
  return `${studentName} was expected for resumption at ${schoolName} but has not arrived. Please contact the school.`;
}
