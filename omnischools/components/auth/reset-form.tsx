"use client";
import { useState } from "react";
import Link from "next/link";
import { requestOtp, requestPasswordReset, verifyResetOtp } from "@/lib/actions/auth";
import { SetNewPassword } from "@/components/auth/set-new-password";

/**
 * INCR-36 (L3) — the reset flow (INCR-36 · Module L / L3). Two prove-identity paths (owner: BOTH), NOT
 * auto-routed by input (many users are phone-only):
 *  · Phone: phone → `requestOtp` → 6-digit code → `verifyResetOtp` (no redirect) → set new password →
 *    /dashboard (the OTP verify already established the session).
 *  · Email: email → `requestPasswordReset` (NEUTRAL-ALWAYS) → terminal enumeration-safe "check inbox".
 * Reuses the login-card visual language verbatim (shell, tabs, fieldClass, OTP input, primary button,
 * back-link). Enumeration-safe: Step-1→2 copy is identical whether or not the handle exists.
 */
const fieldClass =
  "w-full rounded-md border border-border-2 bg-bg px-3.5 py-2.5 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface";

const emItalic = "not-italic text-gold [font-style:italic]";
const primaryBtn =
  "w-full rounded-md bg-navy px-5 py-3 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-60";
const backLink = "w-full text-center text-sm text-navy-3 hover:text-gold";

export function ResetForm() {
  const [method, setMethod] = useState<"phone" | "email">("phone");
  const [step, setStep] = useState<"entry" | "otp" | "setpw" | "sent">("entry");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode() {
    setBusy(true);
    setError(null);
    const res = await requestOtp(phone);
    setBusy(false);
    if (res.ok) setStep("otp");
    else setError(res.error ?? "Could not send code.");
  }

  async function verify() {
    setBusy(true);
    setError(null);
    const res = await verifyResetOtp(phone, otp);
    setBusy(false);
    if (res.ok) setStep("setpw");
    else setError(res.error ?? "Invalid code.");
  }

  async function sendLink() {
    setBusy(true);
    setError(null);
    // NEUTRAL-ALWAYS — the action never surfaces existence; we always advance to the same card.
    await requestPasswordReset({ email });
    setBusy(false);
    setStep("sent");
  }

  const tab = (m: "phone" | "email", label: string) => (
    <button
      onClick={() => {
        setMethod(m);
        setStep("entry");
        setError(null);
      }}
      className={`flex-1 rounded-md py-2 text-sm font-semibold transition-colors ${
        method === m ? "bg-navy text-bg" : "text-navy-2 hover:bg-bg"
      }`}
    >
      {label}
    </button>
  );

  // Step 3 — set the new password (phone path, session already established by the OTP verify).
  if (step === "setpw") {
    return (
      <div className="mx-auto w-full max-w-sm rounded-2xl border border-border bg-surface p-7 shadow-md">
        <SetNewPassword redirectTo="/dashboard" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-sm rounded-2xl border border-border bg-surface p-7 shadow-md">
      {step === "entry" ? (
        <>
          <h1 className="mb-1 font-display text-3xl font-semibold text-navy">
            Reset your <em className={emItalic}>password.</em>
          </h1>
          <p className="mt-1 text-sm text-navy-3">Choose how you&apos;d like to prove it&apos;s you.</p>

          <div className="mb-5 mt-5 flex gap-1 rounded-lg border border-border-2 p-1">
            {tab("phone", "Phone")}
            {tab("email", "Email")}
          </div>

          {method === "phone" ? (
            <div className="space-y-3">
              <input
                className={fieldClass}
                type="tel"
                placeholder="024 000 0000"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendCode()}
              />
              <button onClick={sendCode} disabled={busy} className={primaryBtn}>
                {busy ? "Sending…" : "Send code"}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <input
                className={fieldClass}
                type="email"
                placeholder="you@school.edu.gh"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendLink()}
              />
              <button onClick={sendLink} disabled={busy} className={primaryBtn}>
                {busy ? "Sending…" : "Send reset link"}
              </button>
            </div>
          )}

          {error && <p className="mt-4 text-sm text-terra">{error}</p>}
          <Link href="/login" className={`${backLink} mt-4 block`}>
            ← Back to sign in
          </Link>
        </>
      ) : step === "otp" ? (
        <>
          <h1 className="mb-1 font-display text-3xl font-semibold text-navy">
            Check your <em className={emItalic}>phone.</em>
          </h1>
          <p className="mt-1 text-sm text-navy-3">
            If that number has an account, we&apos;ve sent a 6-digit code. Enter it below.
          </p>
          <div className="mt-5 space-y-3">
            <input
              className={`${fieldClass} text-center font-mono text-lg tracking-[0.3em]`}
              inputMode="numeric"
              placeholder="••••••"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && verify()}
            />
            <button onClick={verify} disabled={busy} className={primaryBtn}>
              {busy ? "Verifying…" : "Verify & continue"}
            </button>
            <button
              onClick={() => {
                setStep("entry");
                setOtp("");
                setError(null);
              }}
              className={backLink}
            >
              ← Use a different number
            </button>
          </div>
          {error && <p className="mt-4 text-sm text-terra">{error}</p>}
        </>
      ) : (
        // step === "sent" — terminal enumeration-safe email confirmation (nothing to submit).
        <>
          <h1 className="mb-1 font-display text-3xl font-semibold text-navy">
            Check your <em className={emItalic}>email.</em>
          </h1>
          <p className="mt-2 text-sm text-navy-2">
            If that email has an account, we&apos;ve sent a link to reset your password. Open it on this
            device to continue.
          </p>
          <p className="mt-2 text-xs text-navy-3">
            The link expires in 30 minutes. Didn&apos;t get it? Check spam, or try again.
          </p>
          <Link href="/login" className={`${backLink} mt-5 block`}>
            ← Back to sign in
          </Link>
        </>
      )}
    </div>
  );
}
