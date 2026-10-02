import { env } from "@/lib/env";
import { getAuthContext } from "@/lib/auth";
import { verifyTotp } from "@/lib/auth/mfa";

/**
 * THE §6 STEP-UP ASSERTION — branded, and mintable in exactly one place (Kofi R6 · Lucy G7).
 *
 * ── THE DEFECT THIS CLOSES (Dex B1) ──────────────────────────────────────────────────────────────
 * The step-up used to be expressed as a plain `{ fresh: boolean }`, and both server actions handed
 * the choke point a LITERAL `{ fresh: true }`. So `assertMayOpenNamedRecord()` was checking a value
 * the caller had typed. Everything about that is the shape this increment spent its whole diff
 * removing from `OfficerSession` and `JurisdictionScope` — and it was sitting at the one irreversible
 * surface in the product: a named individual's record released, and a GRANTED row written to an
 * append-only audit log under an officer's name. A future action could have called
 * `openNamedStaffRecord(request, { fresh: true })` without ever consulting the session, typechecked
 * cleanly, and passed every test in the suite.
 *
 * The fix is the same one, applied for the third time, deliberately identically:
 *   · a module-private `unique symbol` brands the assertion, so it cannot be written as a literal
 *     anywhere in the app — `{ fresh: true }` does not typecheck as a `StepUpAssertion`;
 *   · the raw shape is NOT exported, so it cannot be named and satisfied either;
 *   · `resolveStepUpAssertion()` below is the ONLY production mint, and it derives `fresh` from the
 *     server-verified token (`getAuthContext().stepUpFresh`) or from a TOTP code it has just
 *     verified — never from an argument;
 *   · `sealStepUpAssertion()` exists for the suite alone, with an importer allow-list asserted by
 *     tests/auth-boundaries.test.ts.
 *
 * ── WHY `fresh` IS STILL A BOOLEAN ON THE OBJECT ─────────────────────────────────────────────────
 * It would be tempting to make presence mean freshness (an assertion exists ⇒ it is fresh) and drop
 * the field. Two reasons not to. First, the choke point's own check would become vacuous — it would
 * "verify" by accepting any object, and the ordering guarantee (tier BEFORE freshness) would have
 * nothing to order. Second, a future second constructor — a recovery-code path, an impersonation
 * flow for support — would then be unable to express "minted, but stale", and the natural thing to
 * write would be `undefined`, i.e. a check the caller can skip. Carrying the derived value keeps
 * `lib/oversight/gate-step-up.ts` an actual guard rather than a type-level ceremony. In PRODUCTION
 * the field is always `true` when the record path is entered, because the action returns the
 * interstitial otherwise; `false` is reachable from the suite and from any future minter that gets
 * it wrong, and both are refused by the same line of code.
 *
 * ── WHAT IS NOT STATE ────────────────────────────────────────────────────────────────────────────
 * No step-up cookie, no server-side step-up table, nothing to expire or clear. Freshness is read
 * from the last MFA `amr` timestamp inside the token Supabase signed (see
 * lib/auth/session-policy.ts `stepUpFresh`), so a stolen cookie cannot extend the window and there
 * is no second clock to keep in sync with the session's own.
 */

declare const STEP_UP_VERIFIED: unique symbol;

/** NOT EXPORTED — naming it is how a caller would satisfy it. */
interface RawStepUpAssertion {
  /**
   * Derived, never supplied: the session asserted a second factor inside the configured reuse
   * window, or a TOTP code was verified during this very request.
   */
  fresh: boolean;
}

/** Proof that a step-up was RESOLVED. Opaque: readable, passable, not constructible. */
export type StepUpAssertion = RawStepUpAssertion & {
  readonly [STEP_UP_VERIFIED]: true;
};

/**
 * ⚠ TEST-ONLY MINT, with an allow-list.
 *
 * The suite has to be able to drive `lib/oversight/gate-step-up.ts` with a STALE assertion — that is
 * the test that proves a refused step-up writes no audit row and fetches nothing, which is the whole
 * security claim. It cannot do that through `resolveStepUpAssertion()` without a live Supabase
 * session, so this exists for the same reason `sealOfficerSession()` does, and is fenced the same
 * way: tests/auth-boundaries.test.ts asserts that `tests/helpers.ts` is its ONLY importer. A
 * production module appearing in that list fails the suite, which is the point — the fence is a
 * named list a reviewer can read, not a convention.
 */
export function sealStepUpAssertion(fields: RawStepUpAssertion): StepUpAssertion {
  return fields as StepUpAssertion;
}

export interface StepUpResolution {
  /**
   * The branded assertion to hand the choke point. Always present — it carries the DERIVED
   * `fresh`, so the guard re-reads the same resolved value rather than a caller's claim about it.
   */
  assertion: StepUpAssertion;
  /** Mirror of `assertion.fresh`, for the surface's own "show the interstitial" branch. */
  fresh: boolean;
  /** The officer's enrolled TOTP factor, echoed to the modal. Never used as authorisation. */
  factorId: string | null;
  /** Set when a submitted code failed to verify — rendered on the step-up modal. */
  error?: string;
}

export interface StepUpInput {
  /** A 6-digit code submitted with this request, if the officer was shown the interstitial. */
  code?: string | null;
  /** The factor id the form echoed back. Convenience only — see the note below. */
  factorId?: string | null;
}

/**
 * THE ONLY PRODUCTION MINT (Dex B1).
 *
 * Three outcomes, unchanged from the behaviour this replaces:
 *  · the session's last MFA assertion is inside the reuse window (default 5 minutes) and no code was
 *    submitted ⇒ fresh. Browse → pick → view → export is ONE assertion, not four (Kofi R6).
 *  · a code was submitted ⇒ verify it NOW, through `lib/auth/mfa.ts`. A success issues a new access
 *    token with a fresh `amr` entry, so the window restarts from this moment.
 *  · neither ⇒ stale. The caller returns the interstitial having written nothing and fetched nothing.
 *
 * The code is verified HERE, before the caller can reach the gate, so a wrong code cannot get as far
 * as the audit writer. The `factorId` travels in the form only to save a round trip listing factors:
 * `verifyTotp()` challenges that factor against the officer's OWN session, so a borrowed id verifies
 * nothing.
 */
export async function resolveStepUpAssertion(
  input: StepUpInput = {},
): Promise<StepUpResolution> {
  const code = input.code?.trim() ?? "";
  const factorId = input.factorId?.trim() || null;

  const context = await getAuthContext();

  // Reuse window: a boolean computed in lib/auth from the token's own amr timestamps.
  if (context.stepUpFresh && !code) {
    return { assertion: sealStepUpAssertion({ fresh: true }), fresh: true, factorId };
  }

  if (!code) {
    return { assertion: sealStepUpAssertion({ fresh: false }), fresh: false, factorId };
  }

  const verified = await verifyTotp(factorId ?? "", code);
  if (!verified.ok) {
    return {
      assertion: sealStepUpAssertion({ fresh: false }),
      fresh: false,
      factorId,
      error: verified.error,
    };
  }
  return { assertion: sealStepUpAssertion({ fresh: true }), fresh: true, factorId };
}

/** The configured reuse window, for copy that needs to state it. */
export function stepUpWindowMinutes(): number {
  return env.OVERSIGHT_STEP_UP_WINDOW_MINUTES;
}
