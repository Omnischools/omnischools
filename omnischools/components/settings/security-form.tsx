"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateSecurityPrefs } from "@/lib/actions/settings";

const fieldClass =
  "w-full rounded-md border border-border-2 bg-bg px-3.5 py-2.5 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface";

const SESSIONS = [
  { v: 1, l: "1 hour" },
  { v: 8, l: "8 hours (a school day)" },
  { v: 24, l: "1 day" },
  { v: 168, l: "7 days" },
  { v: 720, l: "30 days" },
];

export function SecurityForm({
  initial,
}: {
  initial: { require2fa: boolean; sessionHours: number };
}) {
  const router = useRouter();
  const [require2fa, setRequire2fa] = useState(initial.require2fa);
  const [sessionHours, setSessionHours] = useState(initial.sessionHours);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const dirty =
    require2fa !== initial.require2fa || sessionHours !== initial.sessionHours;

  async function save() {
    setBusy(true);
    setMsg(null);
    const res = await updateSecurityPrefs({ require2fa, sessionHours });
    setBusy(false);
    if (res.ok) {
      setMsg({ ok: true, text: "Saved." });
      router.refresh();
    } else setMsg({ ok: false, text: res.error ?? "Could not save." });
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-surface p-6">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={require2fa}
            onChange={(e) => {
              setRequire2fa(e.target.checked);
              setMsg(null);
            }}
            className="mt-0.5 h-4 w-4 accent-gold"
          />
          <span>
            <span className="block text-sm font-semibold text-navy">
              Require two-factor for administrators
            </span>
            <span className="mt-0.5 block text-[12px] leading-relaxed text-navy-3">
              Admins must confirm an SMS code on sign-in, in addition to their password. The
              enrolment flow ships with the auth release; this records the requirement now.
            </span>
          </span>
        </label>
      </div>

      <div className="rounded-xl border border-border bg-surface p-6">
        <label className="mb-1.5 block text-xs font-semibold text-navy-2">Session length</label>
        <select
          className={`${fieldClass} max-w-xs`}
          value={sessionHours}
          onChange={(e) => {
            setSessionHours(Number(e.target.value));
            setMsg(null);
          }}
        >
          {SESSIONS.map((s) => (
            <option key={s.v} value={s.v}>
              {s.l}
            </option>
          ))}
        </select>
        <p className="mt-1 text-[11px] text-navy-3">
          How long a sign-in stays valid before re-authentication is required.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={busy || !dirty}
          className="rounded-md bg-navy px-5 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save security settings"}
        </button>
        {msg && (
          <span className={`text-sm ${msg.ok ? "text-green" : "text-terra"}`}>{msg.text}</span>
        )}
      </div>
    </div>
  );
}
