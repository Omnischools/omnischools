/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THE FEE-CATEGORY RESOLVER (increment H fifth slice, task H11 — Kofi's Q9 ruling).
 *
 * PURE: no DB, no clock, no randomness. Given an operational `fee_category.name` it answers the one
 * question `fact_fees` is bucketed by:
 *   `feeCategoryOf` → the `ov_fee_category` member (TUITION | BOARDING | FEEDING | EXAM | OTHER).
 *
 * It is the `lib/etl/stage.ts` shape deliberately — a FUNCTION IN CODE, NOT A MAPPING TABLE — and
 * Kofi ruled that explicitly for two reasons:
 *   · A table would be a NEW analytics `public` object, which triggers the §6 prod-paste-0006 re-run
 *     rule (scope §6/§8) for a slice that otherwise adds no object at all.
 *   · A table would be DATA that drifts silently. The mapping is a RULE: it belongs in version control
 *     beside the transform that applies it, reviewable in a diff, and testable without a database.
 *
 * ── WHAT IT READS, AND THE ONE COLUMN IT MUST NEVER READ ───────────────────────────────────────
 * The input is `fee_category.name` — the per-school CATEGORY label ("Tuition", "Boarding Fees") —
 * reached through `invoice_line_item.fee_category_id`. It is NEVER
 * `invoice_line_item.description`, and that is a privacy rule rather than a modelling preference:
 * `description` is FREE TEXT a bursar typed onto one child's bill ("Ama's arrears, see mother"), so
 * nothing bounds what is in it and it is HARD-DENIED by the source reader's allow-list
 * (`lib/etl/fees-source.ts`). A line with NO `fee_category_id` therefore resolves from NOTHING, and
 * the honest answer for it is OTHER — not a guess parsed out of free text.
 *
 * ── PTA_DUES IS NOT IN THIS FUNCTION, AND THAT IS THE POINT ────────────────────────────────────
 * `ov_fee_category` has six members; this resolver can return only FIVE. PTA_DUES is decided by the
 * `pta_dues_charge` BRIDGE — a line item with a dues row IS dues, whatever its category is called —
 * and that precedence is applied in `lib/etl/fees.ts` AHEAD of this function, never by name-matching
 * "PTA" here. A school that files its dues under a category called "General Levy" must still land in
 * PTA_DUES, and a school with a category literally named "PTA" but no dues bridge has not levied dues:
 * it has a fee category with a misleading name, and guessing from the name would both over- and
 * under-count the one figure the PTA module is audited on.
 *
 * ── THE KEYWORD FAMILIES (Kofi Q9, implemented exactly) ────────────────────────────────────────
 *   category  keywords
 *   BOARDING  BOARDING, HOSTEL, DORMITORY, RESIDENTIAL
 *   FEEDING   FEEDING, CANTEEN, MEALS, FOOD, GSFP
 *   EXAM      EXAM(INATION), WAEC, BECE, WASSCE, MOCK
 *   TUITION   TUITION, SCHOOL FEES, SCH FEES, FEES, ACADEMIC
 *   OTHER     everything unmatched — UNIFORM, BOOKS, TRANSPORT, SPORTS, PRINTING, …
 *
 * ⚠ THE CHECK ORDER IS SPECIFIC-BEFORE-GENERIC, AND IT IS LOAD-BEARING. TUITION's family contains the
 * bare word FEES, which appears in "Boarding Fees", "Feeding Fees" and "Examination Fees" too — so if
 * TUITION were checked first, three quarters of Ghana's fee book would be published as tuition. The
 * three specific families are therefore matched FIRST and TUITION is the LAST positive branch, i.e.
 * the generic "…Fees" bucket is only reached when nothing more specific claimed the label. The same
 * reasoning as `stage.ts`'s "SHS before JHS so Form can never be read as a junior form".
 *
 * ⚠ AND THE RESIDUAL IS **OTHER**, NEVER A FAILURE. An unrecognised label is a per-school free-text
 * category nobody has standardised, not a defect: failing the school would lose its tuition figures
 * over the name of its printing levy. But OTHER is not a silent bin either — the run REPORTS the GHS
 * bucketed into OTHER and the COUNT OF DISTINCT UNMAPPED NAMES per school
 * (`EtlRunReport.feeTerms[].otherBilled` / `.otherCategoryNames`), so a school whose whole fee book
 * lands in OTHER is VISIBLE rather than merely tidy. That tally is this resolver's own coverage
 * signal, and it is the thing to read before adding a keyword.
 *
 * ── MATCHING IS CASE- AND SPACE-INSENSITIVE, AND NOTHING ELSE ──────────────────────────────────
 * Upper-cased, trimmed, internal whitespace collapsed (so "SCHOOL   FEES" and "school fees" are the
 * same label). There is NO stemming, NO fuzzy matching and NO language detection: a near-miss must land
 * in OTHER and be counted there, because a resolver that guessed would move money between published
 * categories on the strength of a typo.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */

/** The six `ov_fee_category` members, in enum order (db/schema/_enums.ts). The write vocabulary. */
export const OV_FEE_CATEGORIES = [
  "TUITION",
  "BOARDING",
  "FEEDING",
  "EXAM",
  "PTA_DUES",
  "OTHER",
] as const;
export type OvFeeCategory = (typeof OV_FEE_CATEGORIES)[number];

/**
 * The five members `feeCategoryOf` can return. PTA_DUES is excluded BY TYPE, not by discipline: it
 * comes from the dues bridge (see the header), so a call site that tried to get it out of a name would
 * not compile.
 */
export type ResolvedFeeCategory = Exclude<OvFeeCategory, "PTA_DUES">;

// ⚠ EACH FAMILY ENDS IN `(?![A-Z])` RATHER THAN `\b`, the `stage.ts` idiom: "BOARDING2" and "EXAM1"
// are real labels a school types, and `\bEXAM\b` does not match "EXAM1" (M and 1 are both word
// characters, so there is no boundary between them). The negative lookahead admits a digit and still
// refuses a longer word — except where a longer word is deliberately wanted, which is noted inline.
const BOARDING_RE = /\b(?:BOARDING|HOSTEL|DORMITORY|DORM|RESIDENTIAL)(?![A-Z])/;
const FEEDING_RE = /\b(?:FEEDING|CANTEEN|MEALS?|FOOD|GSFP)(?![A-Z])/;
// `EXAM` has NO trailing guard on purpose: EXAMS and EXAMINATION are the same family, and listing
// every inflection is how one of them gets forgotten.
const EXAM_RE = /\b(?:EXAM|WAEC|BECE|WASSCE|MOCK)/;
// SCHOOL FEES / SCH FEES are subsumed by the bare FEES branch and are still written out, because they
// are the labels Kofi's ruling names and a reader must be able to find them here. `[\s.-]?` tolerates
// "SCHOOL-FEES" and "SCH.FEES".
const TUITION_RE =
  /\b(?:TUITION|SCHOOL[\s.-]?FEES|SCH[\s.-]?FEES|FEES|ACADEMIC)(?![A-Z])/;

/**
 * Upper-cased, trimmed, internal whitespace collapsed. A blank or whitespace-only name is treated as
 * ABSENT — operationally it is the same thing as a NULL `fee_category_id`, and a reader that only
 * checked `=== null` would match nothing and still call it a resolution.
 */
function normalise(name: string | null | undefined): string {
  return (name ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

/**
 * The `ov_fee_category` member for an operational fee-category NAME, or OTHER.
 *
 * NULL / empty → OTHER: a line item with no `fee_category_id` has nothing to resolve from, and the
 * description is hard-denied (see the header). That line is still BILLED money, so it is counted — in
 * OTHER, visibly — rather than dropped.
 */
export function feeCategoryOf(name: string | null): ResolvedFeeCategory {
  const text = normalise(name);
  if (text.length === 0) return "OTHER";
  // SPECIFIC BEFORE GENERIC — see the header. TUITION is last because its family owns the bare "FEES".
  if (BOARDING_RE.test(text)) return "BOARDING";
  if (FEEDING_RE.test(text)) return "FEEDING";
  if (EXAM_RE.test(text)) return "EXAM";
  if (TUITION_RE.test(text)) return "TUITION";
  return "OTHER";
}
