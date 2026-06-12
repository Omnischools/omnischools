"use client";
import { useState } from "react";
import { updateSchoolProfile } from "@/lib/actions/settings";

const fieldClass =
  "w-full rounded-md border border-border-2 bg-bg px-3.5 py-2.5 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface";

export function ProfileForm({
  initialName,
  initialShortName,
}: {
  initialName: string;
  initialShortName: string;
}) {
  const [name, setName] = useState(initialName);
  const [shortName, setShortName] = useState(initialShortName);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const dirty = name !== initialName || shortName !== initialShortName;

  async function save() {
    setBusy(true);
    setMsg(null);
    const res = await updateSchoolProfile({ name, shortName });
    setBusy(false);
    setMsg(
      res.ok
        ? { ok: true, text: "Saved." }
        : { ok: false, text: res.error ?? "Could not save." },
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-navy-2">
            School name
          </span>
          <input
            className={fieldClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-navy-2">
            SMS sign-off{" "}
            <span className="font-normal text-navy-3">(short name, e.g. ASANKSHS)</span>
          </span>
          <input
            className={`${fieldClass} font-mono uppercase tracking-wide`}
            value={shortName}
            maxLength={12}
            placeholder="OPTIONAL"
            onChange={(e) => setShortName(e.target.value)}
          />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={busy || !dirty || name.trim().length < 2}
          className="rounded-md bg-navy px-5 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save changes"}
        </button>
        {msg && (
          <span className={`text-sm ${msg.ok ? "text-green" : "text-terra"}`}>
            {msg.text}
          </span>
        )}
      </div>
    </div>
  );
}
