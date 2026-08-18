"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { completePasswordReset } from "@/lib/actions/auth";
import { passwordProblem } from "@/lib/password";

/**
 * INCR-36 (L3) — Step 3 of the reset flow: set a NEW password on the already-proven session (phone OTP
 * verified, or email recovery link exchanged). The third instance of the New/Confirm/min-8 pattern
 * (`accept-form` = invite, `change-password-form` = L2a self-serve) — deliberately identical, but with
 * NO "Current password" field: identity is already proven, so it's `accept-form`-shaped (set from
 * nothing), not `change-password-form`-shaped (re-auth the old one). Inner content only — the caller
 * supplies the card/shell and the post-success `redirectTo` (/dashboard for phone, /login?reset=1 for
 * the email landing).
 */
const fieldClass =
  "w-full rounded-md border border-border-2 bg-bg px-3.5 py-2.5 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface";
const labelClass = "mb-1 block text-xs font-semibold text-navy";

export function SetNewPassword({ redirectTo }: { redirectTo: string }) {
  const router = useRouter();
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pwProblem = next.length > 0 ? passwordProblem(next) : null;
  const mismatch = confirm.length > 0 && next !== confirm;
  const canSubmit = !passwordProblem(next) && next === confirm && !busy;

  async function submit() {
    setError(null);
    const problem = passwordProblem(next);
    if (problem) return setError(problem);
    if (next !== confirm) return setError("Passwords don't match.");
    setBusy(true);
    const res = await completePasswordReset({ newPassword: next });
    setBusy(false);
    if (res.ok) router.push(redirectTo);
    else setError(res.error ?? "Could not update your password.");
  }

  return (
    <div className="space-y-3">
      <h1 className="font-display text-2xl font-semibold text-navy">
        Set a new <em className="not-italic text-gold [font-style:italic]">password.</em>
      </h1>
      <p className="mt-1 text-sm text-navy-3">Almost done — choose a password you&apos;ll remember.</p>
      <div>
        <label className={labelClass}>New password</label>
        <input
          className={fieldClass}
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          placeholder="At least 8 characters"
        />
      </div>
      <div>
        <label className={labelClass}>Confirm new password</label>
        <input
          className={fieldClass}
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && canSubmit && submit()}
          autoComplete="new-password"
          placeholder="••••••••"
        />
      </div>

      {pwProblem && <p className="text-[12px] text-terra">{pwProblem}.</p>}
      {mismatch && <p className="text-[12px] text-terra">Passwords don&apos;t match.</p>}
      {error && <p className="text-sm text-terra">{error}</p>}

      <button
        onClick={submit}
        disabled={!canSubmit}
        className="w-full rounded-md bg-navy px-5 py-3 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-60"
      >
        {busy ? "Saving…" : "Set new password"}
      </button>
    </div>
  );
}
