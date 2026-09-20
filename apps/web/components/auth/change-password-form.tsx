"use client";
import { useState } from "react";
import { changeOwnPassword } from "@/lib/actions/auth";
import { passwordProblem } from "@/lib/password";
import { rekeySnapshots } from "@/lib/score-ledger/pwa-store";
import { CaptchaWidget, useCaptcha } from "@/components/auth/captcha-widget";

/**
 * INCR-34 (L2a) — self-service change password. Shared by the staff Settings › Login & security page
 * and the parent portal account page (the action is `requireUser`-gated, so both work). Requires the
 * current password (R264), min-8 + confirm-match (mirrors accept-form). The action re-auths + updates
 * the CURRENT session only — this form never names a target user.
 */
const fieldClass =
  "w-full rounded-md border border-border-2 bg-bg px-3.5 py-2.5 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface";
const labelClass = "mb-1 block text-xs font-semibold text-navy";

export function ChangePasswordForm({ sessionId }: { sessionId?: string }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const captcha = useCaptcha();

  const pwProblem = next.length > 0 ? passwordProblem(next) : null;
  const mismatch = confirm.length > 0 && next !== confirm;
  const canSubmit =
    !!current && !passwordProblem(next) && next === confirm && !captcha.missing() && !busy;

  async function submit() {
    setError(null);
    setDone(false);
    const problem = passwordProblem(next);
    if (problem) return setError(problem);
    if (next !== confirm) return setError("Passwords don't match.");
    if (captcha.missing()) return setError("Please complete the verification below.");
    setBusy(true);
    const res = await changeOwnPassword({
      currentPassword: current,
      newPassword: next,
      captchaToken: captcha.token || undefined,
    });
    if (res.ok) {
      // INCR-39: the R264 re-auth rotated the session id — our offline-buffer partition prefix. Re-key
      // THIS user's own pending scores old→new BEFORE the success state / any nav, so the next
      // PwaSession purge-on-identify keeps them. Best-effort: a re-key miss must never block the
      // confirmed password change (and it's a harmless no-op for a parent with no ledger buffer).
      if (res.newSessionId && sessionId && res.newSessionId !== sessionId) {
        try {
          await rekeySnapshots(sessionId, res.newSessionId);
        } catch {
          // swallow — the password already changed; re-key is best-effort.
        }
      }
      setBusy(false);
      setDone(true);
      setCurrent("");
      setNext("");
      setConfirm("");
    } else {
      setBusy(false);
      captcha.reset(); // the re-auth consumed the single-use token
      setError(res.error ?? "Could not update your password.");
    }
  }

  return (
    <div className="max-w-[420px] space-y-3">
      <div>
        <label className={labelClass}>Current password</label>
        <input
          className={fieldClass}
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          placeholder="••••••••"
        />
      </div>
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
      {done && (
        <p className="rounded-md bg-green-bg px-3 py-2 text-sm font-medium text-green">
          Password updated. Use it next time you sign in.
        </p>
      )}

      <CaptchaWidget onToken={captcha.setToken} resetKey={captcha.resetKey} />
      <button
        onClick={submit}
        disabled={!canSubmit}
        className="rounded-md bg-navy px-5 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-60"
      >
        {busy ? "Updating…" : "Change password"}
      </button>
    </div>
  );
}
