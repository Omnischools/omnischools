"use client";
import { useState } from "react";
import { requestOtp, verifyLogin } from "@/lib/actions/auth";

const fieldClass =
  "w-full rounded-md border border-border-2 bg-bg px-3.5 py-2.5 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface";

export function LoginForm() {
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
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
    // On success this server action redirects; only errors return here.
    const res = await verifyLogin(phone, otp);
    setBusy(false);
    if (res && !res.ok) setError(res.error);
  }

  return (
    <div className="bg-surface mx-auto w-full max-w-sm rounded-2xl border border-border p-7 shadow-md">
      <h1 className="mb-1 font-display text-3xl font-semibold text-navy">
        Welcome <em className="not-italic text-gold [font-style:italic]">back.</em>
      </h1>
      <p className="mb-6 text-sm text-navy-3">
        {step === "phone"
          ? "Sign in with your phone number."
          : `Enter the code we sent to ${phone}.`}
      </p>

      {step === "phone" ? (
        <div className="space-y-3">
          <input
            className={fieldClass}
            type="tel"
            placeholder="024 000 0000"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendCode()}
          />
          <button
            onClick={sendCode}
            disabled={busy}
            className="text-bg w-full rounded-md bg-navy px-5 py-3 text-sm font-semibold transition-colors hover:bg-navy-deep disabled:opacity-60"
          >
            {busy ? "Sending…" : "Send code"}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <input
            className={`${fieldClass} text-center font-mono text-lg tracking-[0.3em]`}
            inputMode="numeric"
            placeholder="••••••"
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && verify()}
          />
          <button
            onClick={verify}
            disabled={busy}
            className="text-bg w-full rounded-md bg-navy px-5 py-3 text-sm font-semibold transition-colors hover:bg-navy-deep disabled:opacity-60"
          >
            {busy ? "Verifying…" : "Verify & sign in"}
          </button>
          <button
            onClick={() => {
              setStep("phone");
              setOtp("");
              setError(null);
            }}
            className="w-full text-center text-sm text-navy-3 hover:text-gold"
          >
            ← Use a different number
          </button>
        </div>
      )}

      {error && <p className="mt-4 text-sm text-terra">{error}</p>}
    </div>
  );
}
