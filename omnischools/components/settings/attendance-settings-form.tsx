"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateAttendanceSettings } from "@/lib/actions/attendance";
import type { AttendanceSettings } from "@/lib/attendance-settings";

const fieldClass =
  "rounded-md border border-border-2 bg-bg px-3 py-2 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface";
const labelClass = "mb-1 block text-xs font-semibold text-navy-2";

export function AttendanceSettingsForm({ initial }: { initial: AttendanceSettings }) {
  const router = useRouter();
  const [s, setS] = useState<AttendanceSettings>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const set = <K extends keyof AttendanceSettings>(k: K, v: AttendanceSettings[K]) =>
    setS((prev) => ({ ...prev, [k]: v }));
  const num = (k: keyof AttendanceSettings) => (e: { target: { value: string } }) =>
    set(k, Number(e.target.value) as never);

  const dirty = JSON.stringify(s) !== JSON.stringify(initial);

  async function save() {
    setBusy(true);
    setMsg(null);
    const res = await updateAttendanceSettings(s);
    setBusy(false);
    if (res.ok) {
      setMsg({ ok: true, text: "Saved." });
      router.refresh();
    } else setMsg({ ok: false, text: res.error ?? "Could not save." });
  }

  return (
    <div className="space-y-6">
      {/* Daily schedule */}
      <section className="rounded-xl border border-border bg-surface p-6">
        <h2 className="mb-1 font-display text-base font-semibold text-navy">
          Daily schedule &amp; marking
        </h2>
        <p className="mb-4 text-xs text-navy-3">
          When the school day runs, and how long teachers can edit a submitted register.
        </p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <label className={labelClass}>Day starts</label>
            <input
              type="time"
              value={s.dayStart}
              onChange={(e) => set("dayStart", e.target.value)}
              className={`${fieldClass} w-full`}
            />
          </div>
          <div>
            <label className={labelClass}>Late after</label>
            <input
              type="time"
              value={s.lateThreshold}
              onChange={(e) => set("lateThreshold", e.target.value)}
              className={`${fieldClass} w-full`}
            />
          </div>
          <div>
            <label className={labelClass}>Day ends</label>
            <input
              type="time"
              value={s.dayEnd}
              onChange={(e) => set("dayEnd", e.target.value)}
              className={`${fieldClass} w-full`}
            />
          </div>
          <div>
            <label className={labelClass}>Edit window (hrs)</label>
            <input
              type="number"
              min={0}
              max={336}
              value={s.editWindowHours}
              onChange={num("editWindowHours")}
              className={`${fieldClass} w-full`}
            />
          </div>
        </div>
        <p className="mt-2 text-[11px] text-navy-3">
          After the edit window closes, changes to a register require an approved
          correction request.
        </p>
      </section>

      {/* Notifications */}
      <section className="rounded-xl border border-border bg-surface p-6">
        <h2 className="mb-3 font-display text-base font-semibold text-navy">
          Notifications
        </h2>
        <label className="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={s.absenceSms}
            onChange={(e) => set("absenceSms", e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-navy"
          />
          <span className="text-navy-2">
            Send an absence SMS to the primary guardian when a student is marked absent
            <span className="mt-0.5 block text-xs text-navy-3">
              Sent on save. Turn off to mark absences without notifying guardians.
            </span>
          </span>
        </label>
      </section>

      {/* Flag thresholds */}
      <section className="rounded-xl border border-border bg-surface p-6">
        <h2 className="mb-1 font-display text-base font-semibold text-navy">
          Attention flags
        </h2>
        <p className="mb-4 text-xs text-navy-3">
          When a student is flagged on the dashboard. Critical must be at least as strict
          as Watching.
        </p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <label className={labelClass}>Long absence · watch (days)</label>
            <input
              type="number"
              min={1}
              max={30}
              value={s.absWatchDays}
              onChange={num("absWatchDays")}
              className={`${fieldClass} w-full`}
            />
          </div>
          <div>
            <label className={labelClass}>Long absence · critical (days)</label>
            <input
              type="number"
              min={1}
              max={60}
              value={s.absCriticalDays}
              onChange={num("absCriticalDays")}
              className={`${fieldClass} w-full`}
            />
          </div>
          <div>
            <label className={labelClass}>Below · watch (%)</label>
            <input
              type="number"
              min={1}
              max={100}
              value={s.pctWatch}
              onChange={num("pctWatch")}
              className={`${fieldClass} w-full`}
            />
          </div>
          <div>
            <label className={labelClass}>Below · critical (%)</label>
            <input
              type="number"
              min={1}
              max={100}
              value={s.pctCritical}
              onChange={num("pctCritical")}
              className={`${fieldClass} w-full`}
            />
          </div>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={busy || !dirty}
          className="rounded-md bg-navy px-5 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save settings"}
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
