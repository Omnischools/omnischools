/**
 * Friendly surfacing of the chronic-register DB constraints (SHS module 4.4 / INCR-23a write path) —
 * PURE (no driver import, classifies through `pgError`), so a raw pg failure never reaches the matron
 * and the mapping is unit-tested without a database (chronic-write-errors.test.ts).
 *
 * The three constraints the writer surfaces, and the one collision:
 *   • R96 `chronic_mental_health_referral_managed` — MENTAL_HEALTH ⇒ NOT on_site_treatable AND
 *     referral_managed. A DB CHECK (product policy, every school); the writer also DERIVES the two
 *     booleans for a MENTAL_HEALTH plan so the matron cannot author the violation, and this maps the
 *     backstop if a hand-crafted call trips it anyway.
 *   • R99 `chronic_med_prn_xor_slot` — is_prn XOR slot_id. A DB CHECK; the writer refuses it first
 *     with THIS message (so the friendly text is identical whichever layer catches it).
 *   • the per-(school, student, condition) partial unique `uniq_sickbay_chronic_entry_condition`.
 *
 * 🔴 R102 (`on_site_treatable = false ⇒ zero med rows`) is NOT a DB CHECK — it is cross-row, so it
 * lives in the writer as a NAMED refusal (R102_REFUSAL below), never a silent drop. It is surfaced
 * from the action directly, not through this mapper.
 */
import { pgError } from "@/lib/db/pg-error";

/** R102 — the app-layer refusal when a med insert (or a plan flip to referral-managed) would strand a dose. */
export const R102_REFUSAL =
  "This plan is referral-managed — the sickbay does not medicate it on site. Make the plan " +
  "on-site treatable before adding medication.";

/** R99 — the is_prn XOR slot message, shared by the writer's own check and the DB backstop. */
export const PRN_XOR_SLOT =
  "A medication is either PRN (as needed) or given at a scheduled round — not both, and not neither.";

/**
 * Map a caught pg error to a friendly message by CONSTRAINT NAME (works for both a 23505 unique
 * violation and a 23514 CHECK violation — postgres.js carries `constraint_name` on both). Anything
 * unrecognised falls back to the caller's own message, never the raw `Failed query: …` text.
 */
export function chronicWriteError(err: unknown, fallback: string): string {
  switch (pgError(err).constraint) {
    case "uniq_sickbay_chronic_entry_condition":
      return "This student already has a live plan for that condition. Edit the existing plan instead of opening a second one.";
    case "uniq_sickbay_chronic_med_dose":
      return "That drug is already scheduled for that round on this plan.";
    case "chronic_mental_health_referral_managed":
      return "A mental-health condition is referral-managed and not treated on site — the register records it that way, so the plan carries no on-site medication.";
    case "chronic_med_prn_xor_slot":
      return PRN_XOR_SLOT;
    default:
      return fallback;
  }
}
