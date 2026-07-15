/**
 * Pure STPSHS-sheet logic — no DB, no I/O (INCR-3 · Score Ledger Item 8). The de-scale/cap
 * math and the two generation gates (completeness + over-100), kept side-effect-free so they
 * are directly unit-testable and drive both the server data builder (lib/data/stpshs-sheet-data)
 * and the download route (app/api/senior/stpshs-sheet). Kofi rulings Q2/Q3/Q5, AC §B/§D/§G.
 */
import { round2 } from "@/lib/gradebook-helpers";

/** The regulator field is a 0–100 scale — the export caps here before de-scaling (Q5). */
export const STPSHS_CAP = 100;

export type LedgerStatus = "DRAFT" | "COMPLETE" | "STPSHS_READY";

/** The five categories, in STPSHS Capture-Per-Subject order. */
export const STPSHS_CATEGORIES = [
  "asgn",
  "midSem",
  "endSem",
  "project",
  "portfolio",
] as const;
export type StpshsCategory = (typeof STPSHS_CATEGORIES)[number];

/** Human labels for the over-100 rejection message (no marks — just which cell). */
export const STPSHS_CATEGORY_LABEL: Record<StpshsCategory, string> = {
  asgn: "assignment",
  midSem: "mid-sem",
  endSem: "end-of-sem",
  project: "project",
  portfolio: "portfolio",
};

/** Stored 0–100 (or bonus >100) per category; null = not yet entered. */
export type StpshsCats = Record<StpshsCategory, number | null>;

/**
 * Kofi Q2/Q5 — cap the stored percent to 100 (never silent; the teacher was forced to act
 * first), THEN de-scale by the category denominator to reproduce the teacher's raw paper mark:
 *   exportValue = round2(min(storedPercent, 100) × denominator / 100)
 * Portfolio /10 stored 80 → 8; a /100 category is identity. round2 keeps 2 dp — NEVER rounded
 * to an integer (85 /10 → 8.5; 71.43 /100 → 71.43).
 */
export function deScaleCap(storedPercent: number, denominator: number): number {
  const capped = Math.max(0, Math.min(storedPercent, STPSHS_CAP));
  return round2((capped * denominator) / 100);
}

/**
 * Format one de-scaled value for the sheet: trailing zeros stripped (8.50 → "8.5", 8.00 → "8")
 * while 2 dp precision is kept (71.43 → "71.43"). `String(round2(n))` strips zeros without ever
 * forcing an integer. Null → em-dash (never reached on a gated sheet — every cell is filled).
 */
export function formatExportScore(value: number | null): string {
  return value == null ? "—" : String(value);
}

/** Pre-formatted export cell = cap → de-scale → strip zeros. Null → "—". */
export function categoryExport(storedPercent: number | null, denominator: number): string {
  if (storedPercent == null) return "—";
  return formatExportScore(deScaleCap(storedPercent, denominator));
}

/**
 * Q3 — a ledger row qualifies for the STPSHS sheet only when every category is filled, i.e.
 * status is COMPLETE or STPSHS_READY (STPSHS_READY qualifies exactly like COMPLETE — no forced
 * transition). A DRAFT or a missing ledger row (null) does not qualify.
 */
export function isLedgerQualifying(status: LedgerStatus | null): boolean {
  return status === "COMPLETE" || status === "STPSHS_READY";
}

/**
 * Q3 completeness gate — the whole class must be ready: every active student COMPLETE/
 * STPSHS_READY and the roster non-empty. An empty roster or any DRAFT/missing row blocks
 * generation (server-enforced, not UI-only).
 */
export function rosterQualifies(statuses: (LedgerStatus | null)[]): boolean {
  return statuses.length > 0 && statuses.every(isLedgerQualifying);
}

export type OverHundredCell = {
  studentId: string;
  name: string;
  category: StpshsCategory;
};

/**
 * Q5 over-100 gate predicate — every qualifying category cell whose STORED value exceeds 100
 * (before any cap). An empty result means nothing to resolve; a non-empty result blocks
 * generation unless the caller passes the explicit acknowledge-and-cap flag.
 */
export function overHundredCells(
  rows: { studentId: string; name: string; cats: StpshsCats }[],
): OverHundredCell[] {
  const out: OverHundredCell[] = [];
  for (const r of rows) {
    for (const category of STPSHS_CATEGORIES) {
      const v = r.cats[category];
      if (v != null && v > STPSHS_CAP) {
        out.push({ studentId: r.studentId, name: r.name, category });
      }
    }
  }
  return out;
}
