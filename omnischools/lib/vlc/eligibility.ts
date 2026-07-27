/**
 * VLC Peer Guide eligibility (SHS module 4.5 / INCR-41) — PURE, DB-free, unit-tested. The ONE place the
 * rule that "Form 1 students receive, they don't lead" (R301) lives, so the reader and the appoint action
 * read one source.
 *
 * The class-form resolution itself now lives in the shared senior resolver `@/lib/senior/form`
 * (extracted at INCR-42a — build-plan L3151, the 4th copy folded in). `classFormNumber` is re-exported
 * here so every INCR-41 caller (peer-guides-data, vlc-peer-guides actions, the seed, the tests) keeps
 * importing it from `./eligibility` unchanged.
 */
import { classFormNumber } from "@/lib/senior/form";

export { classFormNumber };

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
