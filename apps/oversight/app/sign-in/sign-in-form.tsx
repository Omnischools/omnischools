"use client";

import { useActionState } from "react";
import Image from "next/image";
import {
  AuthButton,
  AuthCard,
  AuthCrest,
  AuthError,
  FieldInput,
  FieldLabel,
  ProvisionedByPanel,
} from "@/components/oversight/auth-frame";
import { Banner } from "@/components/oversight/primitives";
import { OtpInput } from "@/components/oversight/otp-input";
import { signInAction, verifyMfaAction, type SignInState } from "./actions";

/**
 * The initial form state. Declared HERE and not in `./actions.ts` because a `"use server"` module
 * may export only async functions — see the note at the top of that file.
 */
const SIGN_IN_INITIAL: SignInState = { step: "credentials" };

/**
 * G1 — sign-in, in three states on one card: primary factor → MFA enrol (first sign-in) → MFA
 * challenge (returning). Ported from Surfaces/schoolup-oversight-onboarding.html §01–§02 via Lucy's
 * map; every colour is a token class.
 *
 * ONE CARD, NOT THREE ROUTES, because the officer is doing one thing (signing in) and a URL change
 * mid-flow would make the back button mean something unhelpful — and because the MFA step must not
 * be reachable as a bookmark: it is only ever the continuation of a primary factor that just
 * succeeded in this same request chain.
 */
export function SignInForm({ next, reason }: { next: string; reason: string | null }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(
    stepAction,
    SIGN_IN_INITIAL,
  );

  return (
    <AuthCard>
      <AuthCrest />

      {reason ? <ReasonNotice reason={reason} /> : null}

      {state.step === "credentials" ? (
        <form action={action}>
          <h1 className="mt-6 font-display text-2xl text-navy">
            Welcome, <em className="accent-italic">Director.</em>
          </h1>
          <p className="mt-2 text-sm text-navy-2">
            Your Oversight account has been created by the GES Oversight administrator.
            Sign in with your GES work email to continue.
          </p>

          <div className="mt-6 space-y-4">
            <div>
              <FieldLabel htmlFor="email">GES work email</FieldLabel>
              <FieldInput
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                required
                placeholder="name@ges.gov.gh"
              />
            </div>
            <div>
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <FieldInput
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
          </div>

          {state.error ? (
            state.rateLimited ? (
              // Lucy G1.a: rate-limiting is GOLD, not terra. The officer has done nothing wrong.
              <div className="mt-4">
                <Banner tone="gold" glyph="⊘" title="Sign-in paused.">
                  {state.error}
                </Banner>
              </div>
            ) : (
              <AuthError>{state.error}</AuthError>
            )
          ) : null}

          <AuthButton type="submit" disabled={pending}>
            {pending ? "Verifying…" : "Verify & continue →"}
          </AuthButton>

          <ProvisionedByPanel />
          <p className="mt-4 text-[11px] text-navy-3">
            Oversight requires a second factor at every sign-in. If you have lost access
            to your authenticator, contact your GES Oversight administrator — there is no
            self-service reset.
          </p>
        </form>
      ) : null}

      {state.step === "enrol" ? (
        <form action={action}>
          <input type="hidden" name="intent" value="verify" />
          <input type="hidden" name="factorId" value={state.enrolment.factorId} />
          <input type="hidden" name="next" value={next} />

          <p className="mt-6 text-[10px] uppercase tracking-[0.14em] text-gold">
            Step 1 · secure your account
          </p>
          <h1 className="mt-1 font-display text-2xl text-navy">
            Set up your <em className="accent-italic">authenticator.</em>
          </h1>
          <p className="mt-2 text-sm text-navy-2">
            Oversight requires a second factor every time you sign in. Scan this code with
            an authenticator app (Google Authenticator, Microsoft Authenticator, or
            similar), then enter the 6-digit code it shows to confirm.
          </p>

          <div className="mt-5 rounded-md border border-border-1 bg-bg p-4">
            {/* The QR is an SVG data URI from Supabase. `unoptimized` because there is nothing to
                optimise and the loader must not try to fetch a data URI. */}
            <Image
              src={state.enrolment.qrCode}
              alt="Authenticator QR code"
              width={180}
              height={180}
              unoptimized
              className="mx-auto"
            />
            <div className="mt-4">
              <FieldLabel htmlFor="totp-secret">Or enter this key manually</FieldLabel>
              <FieldInput
                id="totp-secret"
                readOnly
                value={state.enrolment.secret}
                onFocus={(e) => e.currentTarget.select()}
              />
            </div>
          </div>

          <p className="mt-3 text-[11px] text-navy-3">
            Keep this app — you&apos;ll use it at every sign-in and whenever you open a
            named record.
          </p>

          <div className="mt-5">
            <FieldLabel htmlFor="code">Enter the 6-digit code</FieldLabel>
            <OtpInput disabled={pending} autoFocus />
          </div>

          {state.error ? <AuthError>{state.error}</AuthError> : null}

          <AuthButton type="submit" disabled={pending}>
            {pending ? "Verifying…" : "Confirm & continue →"}
          </AuthButton>
        </form>
      ) : null}

      {state.step === "challenge" ? (
        <form action={action}>
          <input type="hidden" name="intent" value="verify" />
          <input type="hidden" name="factorId" value={state.factorId} />
          <input type="hidden" name="next" value={next} />

          <h1 className="mt-6 font-display text-2xl text-navy">
            Enter your <em className="accent-italic">code.</em>
          </h1>
          <p className="mt-2 text-sm text-navy-2">
            Open your authenticator app and enter the current 6-digit code.
          </p>

          <div className="mt-5">
            <FieldLabel htmlFor="code">Authenticator code</FieldLabel>
            <OtpInput disabled={pending} autoFocus />
          </div>

          {state.error ? <AuthError>{state.error}</AuthError> : null}

          <AuthButton type="submit" disabled={pending}>
            {pending ? "Verifying…" : "Verify & continue →"}
          </AuthButton>
        </form>
      ) : null}
    </AuthCard>
  );
}

/**
 * One `useActionState` for a two-action flow: the hidden `intent` field decides which server action
 * runs. The alternative (two `useActionState` hooks) would give the two steps separate error state,
 * so a failed code would clear a message the officer had not read yet.
 */
async function stepAction(prev: SignInState, formData: FormData): Promise<SignInState> {
  if (String(formData.get("intent") ?? "") === "verify") {
    return verifyMfaAction(prev, formData);
  }
  return signInAction(prev, formData);
}

/** G6 / G1 entry notices — why the officer is looking at this screen. Calm gold, never terra. */
function ReasonNotice({ reason }: { reason: string }) {
  if (reason === "expired") {
    return (
      <div className="mt-5">
        <Banner tone="gold" glyph="⊘" title="Session timed out.">
          For security, Oversight sessions end after a working day. Sign in again to
          continue.
        </Banner>
      </div>
    );
  }
  if (reason === "idle") {
    return (
      <div className="mt-5">
        <Banner tone="gold" glyph="⊘" title="Session timed out.">
          You&apos;ve been inactive for a while, so we&apos;ve signed you out to keep
          records secure. Sign in again to continue where you left off.
        </Banner>
      </div>
    );
  }
  if (reason === "mfa") {
    return (
      <div className="mt-5">
        <Banner tone="gold" glyph="⊘" title="One more step.">
          Oversight requires a second factor at every sign-in. Sign in again to complete
          it.
        </Banner>
      </div>
    );
  }
  return null;
}
