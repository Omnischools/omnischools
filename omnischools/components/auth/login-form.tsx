"use client";
import { useState } from "react";
import { requestOtp, verifyLogin, passwordLogin } from "@/lib/actions/auth";

const fieldClass =
  "w-full rounded-md border border-border-2 bg-bg px-3.5 py-2.5 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface";

export function LoginForm({ accepted = false }: { accepted?: boolean }) {
  const [mode, setMode] = useState<"otp" | "password">("otp");
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
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
    const res = await verifyLogin(phone, otp);
    setBusy(false);
    if (res && !res.ok) setError(res.error);
  }

  async function signInPassword() {
    setBusy(true);
    setError(null);
    const res = await passwordLogin(phone, password);
    setBusy(false);
    if (res && !res.ok) setError(res.error);
  }

  const tab = (m: "otp" | "password", label: string) => (
    <button
      onClick={() => {
        setMode(m);
        setStep("phone");
        setError(null);
      }}
      className={`flex-1 rounded-md py-2 text-sm font-semibold transition-colors ${
        mode === m ? "bg-navy text-bg" : "text-navy-2 hover:bg-bg"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="mx-auto w-full max-w-sm rounded-2xl border border-border bg-surface p-7 shadow-md">
      <h1 className="mb-1 font-display text-3xl font-semibold text-navy">
        Welcome <em className="not-italic text-gold [font-style:italic]">back.</em>
      </h1>
      {accepted && (
        <p className="mb-4 rounded-md bg-green-bg px-3 py-2 text-sm font-medium text-green">
          Account ready — sign in below.
        </p>
      )}

      <div className="mb-5 flex gap-1 rounded-lg border border-border-2 p-1">
        {tab("otp", "Phone OTP")}
        {tab("password", "Password")}
      </div>

      {mode === "otp" ? (
        step === "phone" ? (
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
              className="w-full rounded-md bg-navy px-5 py-3 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-60"
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
              className="w-full rounded-md bg-navy px-5 py-3 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-60"
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
        )
      ) : (
        <div className="space-y-3">
          <input
            className={fieldClass}
            type="tel"
            placeholder="Phone — 024 000 0000"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <input
            className={fieldClass}
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && signInPassword()}
          />
          <button
            onClick={signInPassword}
            disabled={busy}
            className="w-full rounded-md bg-navy px-5 py-3 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-60"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </div>
      )}

      {error && <p className="mt-4 text-sm text-terra">{error}</p>}
    </div>
  );
}
