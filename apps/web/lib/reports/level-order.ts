/**
 * The ONE canonical Ghanaian year-group ladder comparator (issue #305). Levels sort by ladder
 * TIER first — KG → Primary → JHS → SHS/Form — then by the year number WITHIN the tier
 * ("Primary 2" before "Primary 10", numeric not lexical), with unknown levels and the literal
 * "Unspecified" bucket last. PURE + DB-free so every reader/component routes through the SAME
 * order; before this, sites sorted levels lexically ("JHS 1" landed before "Primary 2") or by the
 * bare number (KG/Primary/JHS/Form 1 all collided at rank 1).
 *
 * Level strings are the seeded GES labels ("KG 1", "KG 2", "Primary 1"–"6", "JHS 1"–"3") and the
 * senior tier's "Form 1"–"3" / "SHS 1"–"3". Matching is case-insensitive and tolerant of a section
 * suffix ("JHS 1 A") so class labels sort on the same ladder as bare levels.
 */

/** Classes with no `level` bucket here (mirrors the census UNSPECIFIED). Sorts strictly last. */
export const UNSPECIFIED_LEVEL = "Unspecified";

// Ladder tiers in canonical order; first keyword hit wins (the keyword sets are mutually exclusive).
const TIER_PATTERNS: RegExp[] = [
  /\bKG\b|kindergarten/i, // 0 · KG 1, KG 2
  /\bprimary\b|\bbasic\b/i, // 1 · Primary 1–6 (GES designates these "Basic 1–6")
  /\bjhs\b|\bjss\b/i, // 2 · JHS 1–3
  /\bshs\b|\bsss\b|\bform\b/i, // 3 · SHS / Form 1–3
];

function levelTier(lvl: string): number {
  if (lvl === UNSPECIFIED_LEVEL) return TIER_PATTERNS.length + 1; // strictly last, after unknowns
  const i = TIER_PATTERNS.findIndex((re) => re.test(lvl));
  return i >= 0 ? i : TIER_PATTERNS.length; // unknown custom level → after the known ladder
}

function levelNumber(lvl: string): number {
  const m = lvl.match(/\d+/);
  return m ? parseInt(m[0], 10) : Number.MAX_SAFE_INTEGER; // a number-less label sorts last in its tier
}

/**
 * Canonical ladder comparator: tier (KG<Primary<JHS<SHS) → numeric year within tier → the label as a
 * stable tiebreak. `Unspecified` and unknown/custom levels sort after the ladder.
 */
export function compareLevelLabel(a: string, b: string): number {
  const ta = levelTier(a);
  const tb = levelTier(b);
  if (ta !== tb) return ta - tb;
  const na = levelNumber(a);
  const nb = levelNumber(b);
  if (na !== nb) return na - nb;
  return a.localeCompare(b);
}
