/**
 * VLC Peer Guide eligibility (SHS module 4.5 / INCR-41) — PURE, DB-free, unit-tested. The ONE place a
 * `classes` row's SHS form (F1/F2/F3) is resolved for Peer Guide eligibility, so the rule that "Form 1
 * students receive, they don't lead" (R301) has a single source both the reader and the appoint action
 * read.
 *
 * `classFormNumber` mirrors the senior-tier form resolver already used across boarding
 * (lib/boarding/resumption-data · visiting-data · visiting-notify — the same `(?:Form|F)\s*([123])`
 * regex over `level` then `name`): the senior tier carries no structured form column, so the form is
 * derived from the class's `level` ("Form 2") with its `name` ("Form 2 General Arts A") as a fallback —
 * NEVER re-invented off free-text alone. Kept VLC-local rather than refactoring the three boarding copies
 * into a shared import (that cross-module extraction + its re-test is out of INCR-41 scope).
 * ponytail: one small duplicated regex vs touching three shipped boarding readers + their gates.
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

/**
 * Peer Guides are appointed only in Form 2 and Form 3 classes (R301). Form 1 — and any class whose form
 * cannot be resolved to 2 or 3 — is ineligible (it renders the "no Peer Guides by policy" card, never a
 * vacancy). Advisory gender balance (1 boy + 1 girl) is NOT part of eligibility and is never enforced.
 */
export function isPeerGuideEligibleForm(form: number | null | undefined): boolean {
  return form === 2 || form === 3;
}

/** Convenience: resolve a class row to its form number and whether it may hold Peer Guides. */
export function classPeerGuideEligibility(
  level: string | null | undefined,
  name: string | null | undefined,
): { form: number | null; eligible: boolean } {
  const form = classFormNumber(level, name);
  return { form, eligible: isPeerGuideEligibleForm(form) };
}
