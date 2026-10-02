"use server";

import { redirect } from "next/navigation";
import {
  BAD_CODE_COPY,
  enrolTotp,
  mfaStatus,
  signInWithCredentials,
  signOutSession,
  verifyTotp,
  type TotpEnrolment,
} from "@/lib/auth/mfa";
import { safeReturnPath } from "@/lib/auth/route-guard";

/**
 * The sign-in server actions (Lucy G1).
 *
 * Every one of them goes through `lib/auth/mfa.ts` — no `supabase.auth.*` call appears in this file,
 * or in any other route/action file. That is the architectural rule from the head of
 * lib/auth/index.ts, and the reason it is worth keeping even for the auth surfaces themselves: the
 * MFA policy (mandatory, no device memory, no recovery self-flow) is then a property of one module
 * rather than of each form that happens to call the SDK.
 *
 * NOTE WHAT IS NOT HERE: no sign-up, no password reset, no "forgot your code" (Lucy A.1 — "There is
 * NO create account / sign up / forgot password → self-serve link anywhere. The absence is the
 * design"). Recovery routes to the administrator, so there is nothing to implement.
 */

export type SignInStep = "credentials" | "enrol" | "challenge";

export type SignInState =
  | { step: "credentials"; error?: string; rateLimited?: boolean }
  | { step: "enrol"; enrolment: TotpEnrolment; error?: string }
  | { step: "challenge"; factorId: string; error?: string };

/*
 * ⚠ NO VALUE EXPORTS IN THIS FILE. A `"use server"` module may export ONLY async functions — Next
 * refuses the build otherwise ("a 'use server' file can only export async functions, found
 * object"), because every export becomes a callable server endpoint. The initial form state is
 * therefore declared in the client component that uses it (./sign-in-form.tsx), which is where it
 * belongs anyway: it is a UI starting point, not an action. Types are fine — they are erased.
 */

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

/**
 * Step 1 → step 2. The primary factor, then immediately the MFA branch.
 *
 * There is no state in between: an officer who has authenticated but not completed MFA has a session
 * the route guard refuses (`routeDecision` → `mfa-required`), so there is no window in which a
 * half-authenticated session can reach a surface. That is the same decision the middleware makes on
 * every later request, so a user who closes the tab here and comes back lands on the challenge
 * rather than inside the app.
 */
export async function signInAction(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const result = await signInWithCredentials(
    field(formData, "email"),
    String(formData.get("password") ?? ""),
  );
  if (!result.ok) {
    return {
      step: "credentials",
      error: result.error,
      rateLimited: result.code === "RATE_LIMITED",
    };
  }
  return nextMfaStep();
}

/** Decide between enrolment (first-ever sign-in) and the challenge (returning officer). */
async function nextMfaStep(): Promise<SignInState> {
  const status = await mfaStatus();
  if (status?.verifiedFactorId) {
    return { step: "challenge", factorId: status.verifiedFactorId };
  }
  // MANDATORY ENROLMENT (Kofi R5 / Lucy G1.b): an officer with no factor does not reach the app,
  // they reach the enrol step. There is no "later" button.
  const enrolled = await enrolTotp();
  if (!enrolled.ok) return { step: "credentials", error: enrolled.error };
  return { step: "enrol", enrolment: enrolled.enrolment };
}

/**
 * Step 2 → the app. Used by BOTH the enrol confirmation and the returning-officer challenge: the
 * same `verifyTotp` either way, so an enrolment cannot become a weaker verification.
 *
 * On success this REDIRECTS rather than returning a state, so the browser lands on a page rendered
 * with the now-aal2 session. `redirect()` throws, which is why it is the last statement.
 */
export async function verifyMfaAction(
  prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const factorId = field(formData, "factorId");
  const code = field(formData, "code");
  const next = safeReturnPath(field(formData, "next") || null);

  const result = await verifyTotp(factorId, code);
  if (!result.ok) {
    // Keep the officer on the step they were on, with the QR still visible if they were enrolling.
    if (prev.step === "enrol") {
      return { step: "enrol", enrolment: prev.enrolment, error: result.error };
    }
    return { step: "challenge", factorId, error: result.error || BAD_CODE_COPY };
  }
  redirect(next);
}

/** Sign out (Lucy G3) → the neutral confirmation screen. */
export async function signOutAction(): Promise<void> {
  await signOutSession();
  redirect("/signed-out");
}
