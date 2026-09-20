const STOPWORDS = new Set(["the", "of", "and", "a", "an", "for"]);
const TIER_WORDS = new Set([
  "jhs",
  "shs",
  "shts",
  "school",
  "schools",
  "basic",
  "senior",
  "primary",
  "kg",
  "academy",
  "international",
  "preparatory",
  "prep",
  "college",
]);

/**
 * Short mark for a school's logo placeholder — e.g. "Christ the King JHS" → "CK".
 * Skips stopwords ("the", "of") and tier suffixes ("JHS", "School") so the initials read
 * from the meaningful name; falls back to the first two letters for a single-word name.
 */
export function schoolInitials(name: string): string {
  const all = name.trim().split(/\s+/).filter(Boolean);
  const significant = all.filter((w) => {
    const lw = w.toLowerCase().replace(/[^a-z]/g, "");
    return lw !== "" && !STOPWORDS.has(lw) && !TIER_WORDS.has(lw);
  });
  const pick = significant.length > 0 ? significant : all;
  if (pick.length === 0) return "S";
  if (pick.length === 1) return pick[0].slice(0, 2).toUpperCase();
  return pick
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}
