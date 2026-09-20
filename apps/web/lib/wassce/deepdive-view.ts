/**
 * PURE, db-free view-model layer for the WASSCE student-readiness DEEP-DIVE (SHS module 4.3 / INCR-20 —
 * the Module 4.3 CAPSTONE). Holds BOTH the pre-formatted view types the CLIENT panels consume and the
 * pure builder functions the server-only loader (`deepdive-data.ts`) calls. NO db import, NO runtime dep
 * on the driver — so a client panel importing these types/builders can never pull the loader (repo memory
 * `reports-data-is-server-only`; only `pnpm build` catches that leak), and the builders are unit-testable
 * by feeding plain objects (no DB stand-up).
 *
 * SCOPE DISCIPLINE (Decision-12 made visible): the ledger grid is a FROZEN, CONTEXTUAL read of
 * `senior_score_ledger`. It reads stored category scores + the stored weighted total + the FROZEN
 * `*_weight_used` snapshot ON the row — it recomputes NOTHING, imports NO `compile.ts`/`resolveWeights`/
 * `projectAggregate`, and produces NO projected grade. A live weight change never moves a cell here.
 */

/* ───────────────────────────── §4 ledger-trajectory grid (NEW-1, the capstone) ───────────────────── */

/** One SENIOR semester column on the grid axis (F1S1…F3S2, ordered academic_year, period_number). */
export type LedgerPeriodInput = {
  periodId: string;
  /** Column header, e.g. "Sem 1 · 2025/26". */
  label: string;
  /** Sub-line date range, e.g. "Sep 2025 – Dec 2025". */
  periodSub: string;
};

/**
 * One stored `senior_score_ledger` row for the selected (student × subject × period). Every value is
 * already a number|null (the loader converts the numeric strings); the builder NEVER computes a total or
 * a weight — it displays what is stored, and the frozen `*_weight_used` is the ONLY weight source.
 */
export type LedgerRowInput = {
  periodId: string;
  asgnScore: number | null;
  midSemScore: number | null;
  endSemScore: number | null;
  projectScore: number | null;
  portfolioScore: number | null;
  weightedTotal: number | null;
  asgnWeightUsed: number | null;
  midSemWeightUsed: number | null;
  endSemWeightUsed: number | null;
  projectWeightUsed: number | null;
  portfolioWeightUsed: number | null;
};

export type LedgerCategoryRowView = {
  label: string; // "Assignments"
  weightLabel: string; // "15%" (frozen snapshot) or "—"
  cells: string[]; // per-period display; "—" for a null category (NEVER 0)
};

export type LedgerColumnView = { periodId: string; label: string; periodSub: string };

export type LedgerGridView = {
  subjectId: string; // wassce_subjects.id — the subject-switch key (view-state only)
  subjectName: string;
  /** true = the wassce subject name-matched a gradebook subject the ledger keys on. */
  resolved: boolean;
  /** any ledger row across the six semesters. false → honest "no ledger for this subject" state. */
  hasLedger: boolean;
  teacherLabel: string | null; // senior_subject_teacher for the (class × subject); null → omit (never faked)
  weightsLabel: string | null; // representative frozen snapshot "15/15/40/15/15" or null
  columns: LedgerColumnView[];
  categories: LedgerCategoryRowView[]; // exactly five rows
  totals: string[]; // stored weighted_total per column, displayed AS-IS; "—" if null
};

const LEDGER_CATEGORIES = [
  { label: "Assignments", scoreKey: "asgnScore", weightKey: "asgnWeightUsed" },
  { label: "Mid-semester exam", scoreKey: "midSemScore", weightKey: "midSemWeightUsed" },
  { label: "End-of-semester exam", scoreKey: "endSemScore", weightKey: "endSemWeightUsed" },
  { label: "Project work", scoreKey: "projectScore", weightKey: "projectWeightUsed" },
  { label: "Portfolio", scoreKey: "portfolioScore", weightKey: "portfolioWeightUsed" },
] as const satisfies readonly {
  label: string;
  scoreKey: keyof LedgerRowInput;
  weightKey: keyof LedgerRowInput;
}[];

/** A stored score → display cell: null → em-dash "—" (never 0, never fabricated); else the number as-is. */
const fmtCell = (n: number | null): string => (n == null ? "—" : String(n));

/**
 * Build one subject's frozen ledger grid. The weight LABEL per category is the FROZEN `*_weight_used` of
 * the LATEST period that has a ledger row (the representative snapshot per Lucy D.4) — never a live weight,
 * never averaged. Each period's stored `weighted_total` already reflects its own frozen weights, so an
 * earlier period whose snapshot differs stays honest in its own total column. A period with no ledger row
 * renders an em-dash column; the page still renders (no throw).
 */
export function buildLedgerGridView(args: {
  subjectId: string;
  subjectName: string;
  resolved: boolean;
  teacherLabel: string | null;
  periods: LedgerPeriodInput[];
  rows: LedgerRowInput[];
}): LedgerGridView {
  const { subjectId, subjectName, resolved, teacherLabel, periods, rows } = args;
  const byPeriod = new Map(rows.map((r) => [r.periodId, r]));

  // Representative row = the last period column (grid order) that actually has a ledger row.
  let rep: LedgerRowInput | null = null;
  for (const p of periods) {
    const r = byPeriod.get(p.periodId);
    if (r) rep = r;
  }

  const categories: LedgerCategoryRowView[] = LEDGER_CATEGORIES.map((cat) => ({
    label: cat.label,
    weightLabel: rep && rep[cat.weightKey] != null ? `${rep[cat.weightKey] as number}%` : "—",
    cells: periods.map((p) => fmtCell((byPeriod.get(p.periodId)?.[cat.scoreKey] as number | null) ?? null)),
  }));

  const repWeights = rep
    ? [rep.asgnWeightUsed, rep.midSemWeightUsed, rep.endSemWeightUsed, rep.projectWeightUsed, rep.portfolioWeightUsed]
    : null;

  return {
    subjectId,
    subjectName,
    resolved,
    hasLedger: rows.length > 0,
    teacherLabel,
    weightsLabel: repWeights && repWeights.every((w) => w != null) ? repWeights.join("/") : null,
    columns: periods.map((p) => ({ periodId: p.periodId, label: p.label, periodSub: p.periodSub })),
    categories,
    totals: periods.map((p) => fmtCell(byPeriod.get(p.periodId)?.weightedTotal ?? null)),
  };
}

/* ───────────────────────────── §2 WASSCE paper schedule (NEW-2) ───────────────────────────────────── */

export type ScheduleStatus = "SAT" | "MISSED" | "UPCOMING";

export type ScheduleRowInput = {
  paperId: string;
  name: string;
  paperType: string; // wasscePaperTypeEnum
  scheduledDate: Date | null;
  scheduledTime: string | null; // "09:30"
  durationMinutes: number | null;
  satAt: Date | null;
  exemptedAt: Date | null;
};

export type ScheduleRowView = {
  paperId: string;
  dateLabel: string; // "Mon 12 May"
  timeLabel: string | null; // "09:30"
  paperName: string;
  durationLabel: string | null; // "1h 30m"
  typeLabel: string; // "Objective"
  status: ScheduleStatus;
  statusLabel: string; // "Sat" | "Missed · medical" | "Upcoming · 19 days"
};

export type ScheduleView = {
  rows: ScheduleRowView[];
  total: number;
  sat: number;
  missed: number;
  upcoming: number;
};

/** Sat (sat_at set) / Missed (exempted_at set) / Upcoming (neither) — derived ONLY from stored fields. */
export function deriveScheduleStatus(r: { satAt: unknown; exemptedAt: unknown }): ScheduleStatus {
  if (r.satAt != null) return "SAT";
  if (r.exemptedAt != null) return "MISSED";
  return "UPCOMING";
}

/** Whole days from `now` to `date` (ceil) — the "· N days" tail is derived, never stored. */
export function daysUntil(date: Date, now: Date): number {
  return Math.ceil((date.getTime() - now.getTime()) / 86_400_000);
}

/** minutes → "1h 30m" / "45m" / "3h 00m". */
export function fmtDuration(min: number | null): string | null {
  if (min == null) return null;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

/**
 * Culpable-attendance rate for the §7 context strip. EXCUSED and MEDICAL are excused days — a
 * hospitalised WASSCE candidate must never be penalised (Medical ≠ Absent), so they are excluded
 * from BOTH numerator and denominator: rate = (present + late) / (present + late + absent). Returns
 * null when there is no culpable day to rate — no div-by-zero, and an excused-only term does not
 * report a hollow 100%. Keeps the rate consistent with the sibling absence count, which likewise
 * excludes Medical (else a hospitalised candidate renders the contradictory "90% · 0 absences").
 */
export function attendanceRatePct(present: number, late: number, absent: number): number | null {
  const denom = present + late + absent;
  if (denom <= 0) return null;
  return Math.round(((present + late) / denom) * 1000) / 10;
}

const paperTypeLabel = (t: string): string => (t ? t.charAt(0) + t.slice(1).toLowerCase() : "—");

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Mon 12 May" — UTC-based so a `date` column never drifts across the server timezone. */
export function fmtSchedDate(d: Date): string {
  return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
}

function scheduleStatusLabel(status: ScheduleStatus, days: number | null): string {
  if (status === "SAT") return "Sat";
  if (status === "MISSED") return "Missed · medical";
  return days != null && days > 0 ? `Upcoming · ${days} day${days === 1 ? "" : "s"}` : "Upcoming";
}

const dateMs = (d: Date | null) => (d ? d.getTime() : Number.POSITIVE_INFINITY); // null dates sort last

/** Build the paper-by-paper schedule + the four summary tallies, from stored papers/sittings. */
export function buildScheduleView(papers: ScheduleRowInput[], now: Date): ScheduleView {
  const rows: ScheduleRowView[] = [...papers]
    .sort((a, b) => dateMs(a.scheduledDate) - dateMs(b.scheduledDate) || (a.scheduledTime ?? "").localeCompare(b.scheduledTime ?? ""))
    .map((p) => {
      const status = deriveScheduleStatus(p);
      const days = status === "UPCOMING" && p.scheduledDate ? daysUntil(p.scheduledDate, now) : null;
      return {
        paperId: p.paperId,
        dateLabel: p.scheduledDate ? fmtSchedDate(p.scheduledDate) : "—",
        timeLabel: p.scheduledTime ?? null,
        paperName: p.name,
        durationLabel: fmtDuration(p.durationMinutes),
        typeLabel: paperTypeLabel(p.paperType),
        status,
        statusLabel: scheduleStatusLabel(status, days),
      };
    });
  return {
    rows,
    total: rows.length,
    sat: rows.filter((r) => r.status === "SAT").length,
    missed: rows.filter((r) => r.status === "MISSED").length,
    upcoming: rows.filter((r) => r.status === "UPCOMING").length,
  };
}

/* ───────────────────────────── §7 context + §1 STPSHS strip (NEW-3 / NEW-4) ───────────────────────── */

export type ContextCellView = { value: string; meta: string };

export type StpshsStripView = {
  ref: string; // students.stpshs_ref, or the literal "pending" (INCR-3 Q1 convention)
  pending: boolean;
  sheetHref: string; // affordance to the shipped INCR-3 STPSHS score sheet
};

/** Everything the four NEW deep-dive panels render — all pre-formatted primitives (AC16). */
export type CandidateDeepDiveView = {
  ledgerGrids: LedgerGridView[];
  defaultSubjectId: string | null;
  schedule: ScheduleView;
  termLabel: string | null; // "Semester 2" — the context-cell window label
  attendance: ContextCellView;
  fees: ContextCellView;
  stpshs: StpshsStripView;
};
