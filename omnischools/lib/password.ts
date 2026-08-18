import { z } from "zod";

/**
 * App-side password policy (audit item #5) — THE single source of truth. Every signup / invite-accept /
 * self-change / reset path validates through this, so the rule cannot drift across the ~10 call sites it
 * used to be copy-pasted into.
 *
 * Rule: at least 8 characters AND at least one letter AND at least one number. This rejects the common
 * weak passwords (all-letters like "password", all-digits like "12345678") without symbol-required
 * friction for non-technical school admins. It is COMPLEMENTARY to Supabase's own min-length +
 * leaked-password (HIBP) protection (Auth dashboard), which the deploy guide recommends enabling too —
 * this is the app-enforced floor that holds regardless of the provider's settings.
 */
export const PASSWORD_MIN = 8;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters`)
  .regex(/\p{L}/u, "Password must include at least one letter")
  .regex(/\d/, "Password must include at least one number");

/**
 * The first password-policy problem, or null if the password passes. For the imperative (non-Zod) call
 * sites — the client forms' live/submit hints and the self-change / reset server actions.
 */
export function passwordProblem(pw: string): string | null {
  const r = passwordSchema.safeParse(pw);
  return r.success ? null : (r.error.issues[0]?.message ?? "Invalid password");
}
