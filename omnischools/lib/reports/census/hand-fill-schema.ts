import { z } from "zod";
import { SEN_CATEGORIES } from "@/lib/reports/census/sen-data";

/**
 * GOV-9 · the ANNUAL census HAND-FILL contract (R419) — the sections Omnischools genuinely doesn't track
 * (repetition / trained-untrained qualifications / full movement-exits / GSFP feeding / textbooks), plus the
 * SEN §5 12-cell ONLY when the SEN register isn't adopted. Stored in the EXISTING `census_return.hand_fill`
 * jsonb (no schema change) — the DB column stays plain jsonb (a GES filing drifts 50+ fields per revision,
 * the same reason `auto_snapshot` is jsonb); THIS versioned Zod schema owns the shape at the app boundary.
 *
 * EVERY section is optional/nullable — an un-entered section is NOT a zero: the PDF prints a hatched blank
 * for pen completion (R422 honesty), never a fabricated figure. Lean by design (OC-CENSUS-HANDFILL-DEPTH):
 * summary totals here; the tedious per-class / per-subject grids stay print-and-pen.
 */

export const CENSUS_HAND_FILL_VERSION = 1 as const;

const sexPair = z.object({ male: z.number().int().min(0), female: z.number().int().min(0) });

export const censusHandFillSchema = z.object({
  version: z.literal(CENSUS_HAND_FILL_VERSION),
  /** Repeaters by sex (total; the per-class grid stays pen-fill). */
  repetition: sexPair.nullable().optional(),
  /** Teaching staff trained/untrained split by sex (no `trained` flag on profiles → hand-fill). */
  qualifications: z
    .object({
      trainedMale: z.number().int().min(0),
      trainedFemale: z.number().int().min(0),
      untrainedMale: z.number().int().min(0),
      untrainedFemale: z.number().int().min(0),
    })
    .nullable()
    .optional(),
  /** Full-year exits — withdrawals + transfers in/out (movement is admissions-only in-app → hand-fill). */
  movementExits: z
    .object({
      withdrawals: z.number().int().min(0),
      transfersIn: z.number().int().min(0),
      transfersOut: z.number().int().min(0),
    })
    .nullable()
    .optional(),
  /** GSFP feeding participation. */
  feeding: z
    .object({
      participates: z.boolean(),
      pupilsFed: z.number().int().min(0).nullable().optional(),
      caterer: z.string().trim().max(120).nullable().optional(),
    })
    .nullable()
    .optional(),
  /** Textbook adequacy (the per-subject grid stays pen-fill). */
  textbooks: z
    .object({
      adequate: z.boolean(),
      note: z.string().trim().max(300).nullable().optional(),
    })
    .nullable()
    .optional(),
  /** SEN §5 12-cell — de-identified counts ONLY, used ONLY when the SEN register is NOT adopted (R423).
   *  Structurally counts-only (no name/id) — the confidential sole-content-path is untouched. `partialRecord`
   *  (NOT `record`) so a subset of categories is valid — the admin enters only the categories present, and
   *  Zod v4's `z.record(z.enum(...))` would otherwise demand all 6 keys (Quinn MAJOR-1). Single-sourced from
   *  `SEN_CATEGORIES` so it can't drift from the register's taxonomy (Dex LOW-1). */
  specialNeeds: z.partialRecord(z.enum(SEN_CATEGORIES), sexPair).nullable().optional(),
});

export type CensusHandFill = z.infer<typeof censusHandFillSchema>;

/** An empty (never-filled) hand-fill — a fresh versioned object; every section absent → all hatched blanks. */
export const emptyCensusHandFill = (): CensusHandFill => ({ version: CENSUS_HAND_FILL_VERSION });

/**
 * Parse a stored `hand_fill` jsonb (NULL until first entered, GOV-8) into the app-typed shape. A null / legacy
 * empty blob becomes a fresh versioned object; a populated blob is validated (an unversioned/garbage payload
 * is rejected — GOV9-02).
 */
export function parseCensusHandFill(raw: unknown): CensusHandFill {
  if (raw == null || (typeof raw === "object" && Object.keys(raw as object).length === 0)) {
    return emptyCensusHandFill();
  }
  return censusHandFillSchema.parse(raw);
}
