/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THE STAGE / CLASS-FORM RESOLVER (increment H second slice, task H9 — Kofi's ruling).
 *
 * PURE: no DB, no clock, no randomness. Given a class's `level` and `name` it answers the two
 * questions `fact_enrolment` is bucketed by:
 *   `stageOf`      → the `dim_stage` key (KG | PRIMARY | JHS | SHS), or one of the two NON-STAGES.
 *   `classFormOf`  → the normalised year-group token the breakdown row carries ("P4", "Form 2").
 *
 * ── THE STAGE COMES FROM THE CLASS, NEVER FROM THE SCHOOL ──────────────────────────────────────
 * A COMBINED school teaches KG, Primary AND JHS; a "BASIC" school in the register may be running an
 * SHS stream it has not told GES about. Deriving the stage from `dim_jurisdiction.school_type` would
 * therefore file a Form 2 class under PRIMARY — and the enrolment-vs-population rate (fact_enrolment
 * ⋈ ref_gss_population on `stage`) would then divide 15-year-olds by the 6–11 population, which is a
 * wrong number that looks entirely plausible. So the stage is parsed PER CLASS, from the class's own
 * label, and a school_type that disagrees with its classes is reported as DRIFT (see
 * `lib/etl/enrolment.ts`) rather than used as the answer.
 *
 * ── "LEVEL FIRST, THEN NAME" ───────────────────────────────────────────────────────────────────
 * Operational `class.level` is the structured-ish field ("JHS 1") and `class.name` the free one
 * ("JHS 1 A"). `level` is nullable, so the name is the fallback — the same precedence
 * `apps/web/lib/senior/form.ts::classFormNumber` already uses, so the two cannot drift. Matching is
 * case-insensitive and tolerant of a section suffix, as `apps/web/lib/reports/level-order.ts` is.
 *
 * ── THE MAPPING TABLE (Kofi H9, implemented exactly) ───────────────────────────────────────────
 *   stage    tier keywords                                            N
 *   KG       KG, Kindergarten, Kinder                                 1–2
 *   PRIMARY  Primary, Pri, Class, P+digit ("P4"), Basic N=1–6         1–6
 *   JHS      JHS, JSS, J.H.S,            Basic N=7–9 → JHS N−6        1–3
 *   SHS      SHS, SSS, S.H.S, Form (ALWAYS SHS, never JHS)            1–3
 *
 * ⚠ TWO CORRECTIONS TO THE EXISTING apps/web HELPERS, both deliberate:
 *   1. "BASIC 7–9" IS JHS, NOT PRIMARY. `level-order.ts` lumps every "basic" label into the Primary
 *      TIER, which is correct for its purpose — it only ever SORTS — but filing Basic 8 under PRIMARY
 *      here would move a 13-year-old's headcount into the 6–11 denominator. GES designates Primary
 *      1–6 as Basic 1–6 and JHS 1–3 as Basic 7–9, so the NUMBER is what decides, and `level-order.ts`
 *      must NOT be reused for stage.
 *   2. "FORM" IS SHS. It is the senior tier's own voice (`apps/web/lib/senior/form.ts`), and
 *      `census-enrolment-data.ts::officialAgeForLevel` already treats FORM as the 15-year-old base.
 *
 * ── THE TWO NON-STAGES, AND WHY NEITHER FAILS THE SCHOOL ───────────────────────────────────────
 * OUT_OF_SCOPE  Nursery / Creche / Pre-K / Pre-School — real children, taught BELOW KG, and outside
 *               the GES basic-education ladder `dim_stage` describes. There is no stage to file them
 *               under and no population band to divide them by.
 * UNMAPPED      no tier keyword, or no usable year number ("Transition Stream", "Special Unit",
 *               "KG 7"). A per-school free-text label nobody has standardised.
 *
 * NEITHER is bucketed into a real stage, and neither fails the school. Both are TALLIED per school
 * (`outOfScopeHeadcount` / `unmappedHeadcount`) so the children are visibly accounted for instead of
 * silently vanishing from a national figure: coercing them into PRIMARY would inflate a stage that
 * has a population denominator, and dropping them silently would make the school's roll read lower
 * than its own register with nothing to point at.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */

/** The four `dim_stage` keys, in `display_order`. The analytics config vocabulary, mirrored. */
export const ANALYTICS_STAGES = ["KG", "PRIMARY", "JHS", "SHS"] as const;
export type AnalyticsStage = (typeof ANALYTICS_STAGES)[number];

/**
 * A stage key, or one of the two non-stages. `OUT_OF_SCOPE` and `UNMAPPED` are NOT `dim_stage` rows
 * and never reach `fact_enrolment.stage` — they are tallies, and the type says so.
 */
export type StageResolution = AnalyticsStage | "OUT_OF_SCOPE" | "UNMAPPED";

/** Below KG. Checked FIRST: "Nursery 1" carries a usable 1 and would otherwise look like KG 1. */
const OUT_OF_SCOPE_RE =
  /\b(?:NURSERY|CRECHE|CRÈCHE|PRE[\s.-]?K|PRE[\s.-]?SCHOOL|PRE[\s.-]?PRIMARY)\b/;

/**
 * Tier keywords, in CHECK ORDER. SHS before JHS so "Form" can never be read as a junior form, and
 * the explicit tiers before BASIC so a school that writes both ("JHS 1 / Basic 7") is read as JHS.
 */
// ⚠ EACH TIER ENDS IN `(?![A-Z])` RATHER THAN `\b`. "JHS2" and "KG2" — no space — are extremely common
// real labels, and `\bJHS\b` does NOT match "JHS2" (S and 2 are both word characters, so there is no
// boundary between them): the whole senior-junior ladder would have read UNMAPPED for every school that
// writes its classes that way. The negative lookahead admits a digit and still refuses a longer word,
// so "FORMER" and "CLASSICAL" are not tiers.
const KG_RE = /\b(?:KG|K\.G\.?|KINDERGARTEN|KINDER)(?![A-Z])/;
const SHS_RE = /\b(?:S\.?H\.?S|S\.?S\.?S|FORM)(?![A-Z])/;
const JHS_RE = /\b(?:J\.?H\.?S|J\.?S\.?S)(?![A-Z])/;
const PRIMARY_RE = /\b(?:PRIMARY|PRI|CLASS)(?![A-Z])|\bP\s?\d/;
const BASIC_RE = /\bBASIC(?![A-Z])/;

/** The resolved tier plus the year number, before the N-range rules are applied. */
interface Parsed {
  tier: "KG" | "PRIMARY" | "JHS" | "SHS" | "BASIC" | "OUT_OF_SCOPE" | null;
  n: number | null;
}

/**
 * `level` if it says anything, else `name`. A blank/whitespace-only level is treated as absent —
 * operationally it is the same thing as NULL, and a reader that only checked `=== null` would parse
 * "" and return UNMAPPED for a class whose NAME was perfectly readable.
 */
function sourceText(
  level: string | null | undefined,
  name: string | null | undefined,
): string {
  const fromLevel = (level ?? "").trim();
  if (fromLevel.length > 0) return fromLevel.toUpperCase();
  return (name ?? "").trim().toUpperCase();
}

function parse(
  level: string | null | undefined,
  name: string | null | undefined,
): Parsed {
  const text = sourceText(level, name);
  if (text.length === 0) return { tier: null, n: null };
  // The FIRST integer in the label. A section suffix ("JHS 1 A") carries no digits, and a label with
  // two numbers ("Primary 4 of 6") is answered by the first, which is the year group in every real
  // GES label shape.
  const match = text.match(/\d+/);
  const n = match ? Number.parseInt(match[0], 10) : null;

  if (OUT_OF_SCOPE_RE.test(text)) return { tier: "OUT_OF_SCOPE", n };
  if (KG_RE.test(text)) return { tier: "KG", n };
  if (SHS_RE.test(text)) return { tier: "SHS", n };
  if (JHS_RE.test(text)) return { tier: "JHS", n };
  if (PRIMARY_RE.test(text)) return { tier: "PRIMARY", n };
  if (BASIC_RE.test(text)) return { tier: "BASIC", n };
  return { tier: null, n };
}

/** The tier + N rules, in one place, so `stageOf` and `classFormOf` cannot disagree. */
function resolve(
  level: string | null | undefined,
  name: string | null | undefined,
): { stage: StageResolution; classForm: string | null } {
  const { tier, n } = parse(level, name);
  // Below KG is out of scope whether or not it carries a number: "Nursery" is as much a nursery as
  // "Nursery 2", and there is no stage to file either under.
  if (tier === "OUT_OF_SCOPE") return { stage: "OUT_OF_SCOPE", classForm: null };
  if (tier === null || n === null) return { stage: "UNMAPPED", classForm: null };

  switch (tier) {
    case "KG":
      return n >= 1 && n <= 2
        ? { stage: "KG", classForm: `KG${n}` }
        : { stage: "UNMAPPED", classForm: null };
    case "PRIMARY":
      return n >= 1 && n <= 6
        ? { stage: "PRIMARY", classForm: `P${n}` }
        : { stage: "UNMAPPED", classForm: null };
    case "JHS":
      return n >= 1 && n <= 3
        ? { stage: "JHS", classForm: `JHS${n}` }
        : { stage: "UNMAPPED", classForm: null };
    case "SHS":
      // The SHS "Form" voice is KEPT in the token ("Form 2", not "SHS2"): it is what the senior tier
      // calls itself everywhere in apps/web, and `class_form` is the figure a head teacher reads back.
      return n >= 1 && n <= 3
        ? { stage: "SHS", classForm: `Form ${n}` }
        : { stage: "UNMAPPED", classForm: null };
    case "BASIC":
      // THE CORRECTION. Basic 1–6 = Primary 1–6; Basic 7–9 = JHS 1–3.
      if (n >= 1 && n <= 6) return { stage: "PRIMARY", classForm: `P${n}` };
      if (n >= 7 && n <= 9) return { stage: "JHS", classForm: `JHS${n - 6}` };
      return { stage: "UNMAPPED", classForm: null };
  }
}

/** The `dim_stage` key for a class label, or one of the two non-stages. See the header. */
export function stageOf(
  level: string | null | undefined,
  name: string | null | undefined,
): StageResolution {
  return resolve(level, name).stage;
}

/**
 * The normalised `class_form` token — KG1/KG2, P1…P6, JHS1…JHS3, "Form 1"…"Form 3".
 *
 * NULL means "no year group was resolved" (an out-of-scope or unmapped label). On a WRITTEN fact row,
 * `class_form IS NULL` means something different and load-bearing: it is the STAGE-TOTAL row. The two
 * never meet, because an out-of-scope / unmapped class produces no fact row at all.
 */
export function classFormOf(
  level: string | null | undefined,
  name: string | null | undefined,
): string | null {
  return resolve(level, name).classForm;
}
