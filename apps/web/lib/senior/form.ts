/**
 * The ONE senior-tier form resolver (SHS module 4). The senior tier carries no structured form column,
 * so a `classes` row's SHS form (1|2|3) is DERIVED from its `level` ("Form 2") with its `name`
 * ("Form 2 General Arts A") as a fallback — NEVER re-invented off free-text alone. PURE, DB-free.
 *
 * Roadmap-directed extraction (INCR-42a, build-plan L3151/L3158): this `(?:Form|F)\s*([123])` regex was
 * the 4th copy — `lib/vlc/eligibility.ts::classFormNumber` + three boarding readers
 * (lib/boarding/{resumption-data, visiting-data, visiting-notify}) each carried their own. All four now
 * route through this single source (VLC re-exports it; the boarding readers import it directly), so the
 * rule "level first, then name" cannot drift between modules.
 */

/** Form number 1|2|3 from a class's `level` ("Form 2") then its `name`; null when neither carries one. */
export function classFormNumber(
  level: string | null | undefined,
  name: string | null | undefined,
): number | null {
  const src = `${level ?? ""} ${name ?? ""}`;
  const m = src.match(/(?:Form|F)\s*([123])/i);
  return m ? Number(m[1]) : null;
}
