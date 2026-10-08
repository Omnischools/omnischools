/**
 * THE VACANCY TONE, IN ONE PLACE (VACANCY-SURFACING-RULING V6) — the colour half of the sign
 * convention, shared by every surface that states a signed vacancy figure.
 *
 * THREE surfaces render a vacancy net and all three must tone it identically: the establishment
 * panel's net line (breakdown-visuals.tsx), the breakdown table's Vacancies cell
 * (breakdown-table.tsx) and the comparison table's vacancy row (comparison-table.tsx). Each keeps its
 * OWN WORDING — "12 posts unfilled" / "+12 unfilled" / "12% short" are three legitimate phrasings for
 * three column widths — but the valence must not be re-decided per surface, because the one thing that
 * must never drift is the rule below.
 *
 * ⚠ NEVER GREEN. Positive is a SHORTAGE, the adverse state, in terra. Negative is a SURPLUS: an
 * allocation inefficiency — teachers sitting over establishment while other schools are short — and NOT
 * a success, so it takes the NEUTRAL navy rather than the green a "good end" would get. A real zero is
 * neutral too, and navy is that neutral: "at establishment" is a fact, not an achievement.
 */
export function vacancyTone(net: number): string {
  if (net > 0) return "text-terra";
  // Surplus (<0) and a true zero share the neutral navy — see the never-green note above.
  return "text-navy";
}
