import type { ExamType } from "@/lib/reports/terminal-results-data";
import type { SchoolType } from "@/lib/reports/school-type-data";

/**
 * GOV-6 · terminal-results (BECE / WASSCE) bulk-import spec + validator. Pure + client-safe (no DOM, no
 * DB) so the review table validates live before anything is saved. AGGREGATE-ONLY: the header carries NO
 * candidate-identifying column (R371/R372) — only the sex-split leaf counts per exam × year.
 *
 * REJECT-NOT-FABRICATE (R371): an invalid row is rejected with a per-row error; the valid rows in the
 * SAME file still import. Nothing is coerced or invented — a bad exam_type / non-integer / negative /
 * passed>candidates / zero-candidate / wrong-tier row is flagged, never silently fixed.
 */

/** Template header — EXACTLY the four leaf columns + exam/year, plus an optional free-text note. */
export const TERMINAL_IMPORT_HEADERS = [
  "exam_type",
  "year",
  "female_candidates",
  "male_candidates",
  "female_passed",
  "male_passed",
  "note",
];

export const TERMINAL_IMPORT_SAMPLE: string[][] = [
  ["BECE", "2025", "58", "62", "51", "49", "Main sitting"],
  ["WASSCE", "2025", "44", "40", "39", "35", ""],
];

/** Which exam(s) a school sits, by tier (R367). BASIC → BECE only; SENIOR → WASSCE only; COMBINED → both. */
export function examTypesFor(schoolType: SchoolType): ExamType[] {
  if (schoolType === "BASIC") return ["BECE"];
  if (schoolType === "SENIOR") return ["WASSCE"];
  return ["BECE", "WASSCE"];
}

/** The plausible sitting-year window — a 4-digit year, no future beyond next year (results are past). */
export const MIN_SITTING_YEAR = 2000;
export const maxSittingYear = (now: Date = new Date()) => now.getUTCFullYear() + 1;

export type TerminalImportRow = {
  index: number; // 1-based data-row number for display
  examType: ExamType | null;
  year: number | null;
  femaleCandidates: number | null;
  maleCandidates: number | null;
  femalePassed: number | null;
  malePassed: number | null;
  note: string;
  errors: string[];
};

export type ImportSummary = { total: number; ready: number; error: number };

/** A non-negative integer, parsed strictly (no decimals, no signs, no blanks). Returns null on failure. */
function parseCount(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Validate parsed data rows (excluding the header) for one school's tier. Every row carries its own
 * `errors[]`; a row with none is importable. `offered` gates exam_type to the school's tier.
 */
export function validateTerminalRows(
  dataRows: string[][],
  schoolType: SchoolType,
  now: Date = new Date(),
): { rows: TerminalImportRow[]; summary: ImportSummary } {
  const offered = examTypesFor(schoolType);
  const yearMax = maxSittingYear(now);

  const rows = dataRows.map((cells, i): TerminalImportRow => {
    const get = (n: number) => (cells[n] ?? "").trim();
    const errors: string[] = [];

    // exam_type — allow-list + tier gate.
    const rawType = get(0).toUpperCase();
    let examType: ExamType | null = null;
    if (rawType === "BECE" || rawType === "WASSCE") examType = rawType;
    if (!examType) errors.push("exam_type must be BECE or WASSCE");
    else if (!offered.includes(examType))
      errors.push(`${examType} is not offered by this school (wrong tier)`);

    // year — 4-digit integer in the plausible window.
    const year = parseCount(get(1));
    if (year == null) errors.push("year must be a whole number");
    else if (year < MIN_SITTING_YEAR || year > yearMax)
      errors.push(`year must be between ${MIN_SITTING_YEAR} and ${yearMax}`);

    // the four leaf counts — non-negative integers.
    const femaleCandidates = parseCount(get(2));
    const maleCandidates = parseCount(get(3));
    const femalePassed = parseCount(get(4));
    const malePassed = parseCount(get(5));
    const labels = ["female_candidates", "male_candidates", "female_passed", "male_passed"];
    [femaleCandidates, maleCandidates, femalePassed, malePassed].forEach((v, k) => {
      if (v == null) errors.push(`${labels[k]} must be a whole number ≥ 0`);
    });

    // passed ≤ candidates, per sex (a pass count can never exceed its sitters).
    if (femalePassed != null && femaleCandidates != null && femalePassed > femaleCandidates)
      errors.push("female_passed cannot exceed female_candidates");
    if (malePassed != null && maleCandidates != null && malePassed > maleCandidates)
      errors.push("male_passed cannot exceed male_candidates");

    // ≥ 1 candidate — a sitting with zero candidates is not a sitting (mirrors the DB CHECK).
    if (
      femaleCandidates != null &&
      maleCandidates != null &&
      femaleCandidates + maleCandidates < 1
    )
      errors.push("a sitting needs at least one candidate");

    return {
      index: i + 1,
      examType,
      year,
      femaleCandidates,
      maleCandidates,
      femalePassed,
      malePassed,
      note: get(6),
      errors,
    };
  });

  const summary: ImportSummary = {
    total: rows.length,
    ready: rows.filter((r) => r.errors.length === 0).length,
    error: rows.filter((r) => r.errors.length > 0).length,
  };
  return { rows, summary };
}
