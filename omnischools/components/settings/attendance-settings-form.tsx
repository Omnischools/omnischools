"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { updateAttendanceSettings } from "@/lib/actions/attendance";
import { ATTENDANCE_SETTINGS_DEFAULTS, type AttendanceSettings } from "@/lib/attendance-settings";
import { FLAG_THRESHOLDS } from "@/lib/attendance-flags";

/** Mirrors SMS_SEGMENT_RATE_GHS in lib/sms (server-only module — not imported here). */
const SMS_SEGMENT_RATE_GHS = 0.035;

const time12 = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  const ap = h < 12 ? "AM" : "PM";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${ap}`;
};
/** Position of a HH:MM time across the 6 AM–6 PM axis, as a 0–100 %. */
const timePos = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return Math.max(0, Math.min(100, ((h * 60 + m - 360) / 720) * 100));
};

function SectionHead({ num, title, meta }: { num: string; title: string; meta?: string }) {
  return (
    <div className="mb-3 mt-8 flex flex-wrap items-baseline gap-3">
      <span className="font-display text-xl font-semibold italic text-gold">{num}</span>
      <h2 className="font-display text-lg font-semibold text-navy">{title}</h2>
      {meta && <span className="text-[11px] uppercase tracking-wide text-navy-3">{meta}</span>}
    </div>
  );
}

function Stepper({
  value,
  onChange,
  min,
  max,
  suffix,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  suffix?: string;
}) {
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  return (
    <span className="inline-flex items-center gap-1 rounded-pill border border-border-2 bg-bg px-1 py-0.5">
      <button
        type="button"
        onClick={() => onChange(clamp(value - 1))}
        className="flex h-6 w-6 items-center justify-center rounded-full text-navy-2 hover:bg-surface"
      >
        −
      </button>
      <span className="min-w-[3.5rem] text-center font-display text-[13px] font-semibold text-navy">
        {value}
        {suffix ? <em className="not-italic text-gold"> {suffix}</em> : null}
      </span>
      <button
        type="button"
        onClick={() => onChange(clamp(value + 1))}
        className="flex h-6 w-6 items-center justify-center rounded-full text-navy-2 hover:bg-surface"
      >
        +
      </button>
    </span>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full transition-colors",
        on ? "bg-green" : "bg-border-2",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all",
          on ? "left-[22px]" : "left-0.5",
        )}
      />
    </button>
  );
}

const FIELD_LABEL: Record<keyof AttendanceSettings, string> = {
  dayStart: "Day starts",
  lateThreshold: "Late after",
  dayEnd: "Day ends",
  editWindowHours: "Edit window",
  absenceSms: "Absence SMS",
  absWatchDays: "Long-absence watch",
  absCriticalDays: "Long-absence critical",
  pctWatch: "Below-watch",
  pctCritical: "Below-critical",
};

function display(k: keyof AttendanceSettings, v: AttendanceSettings[keyof AttendanceSettings]) {
  if (k === "absenceSms") return v ? "on" : "off";
  if (k === "dayStart" || k === "lateThreshold" || k === "dayEnd") return time12(String(v));
  if (k === "editWindowHours") return `${v}h`;
  if (k === "pctWatch" || k === "pctCritical") return `${v}%`;
  return `${v}`;
}

export function AttendanceSettingsForm({
  initial,
  schoolName,
}: {
  initial: AttendanceSettings;
  schoolName: string;
}) {
  const router = useRouter();
  const [s, setS] = useState<AttendanceSettings>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const set = <K extends keyof AttendanceSettings>(k: K, v: AttendanceSettings[K]) =>
    setS((p) => ({ ...p, [k]: v }));

  const changed = (Object.keys(initial) as (keyof AttendanceSettings)[]).filter(
    (k) => s[k] !== initial[k],
  );
  const dirty = changed.length > 0;

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
    <div className="pb-24">
      {/* ── Region 02 — Daily schedule & marking ─────────────────── */}
      <SectionHead num="02" title="Daily schedule & marking" meta={`how late is "late"`} />

      <div className="rounded-xl border border-border bg-surface p-6">
        <h3 className="font-display text-lg font-semibold text-navy">
          A <em className="text-gold">typical</em> day at {schoolName}
        </h3>
        <p className="mb-6 text-xs text-navy-3">Edit the times below; the bar follows along.</p>

        {/* Time bar */}
        <div className="relative mx-1 mb-1 mt-8 h-3 rounded-full bg-bg">
          <div
            className="absolute h-3 rounded-full bg-green/30"
            style={{ left: `${timePos(s.dayStart)}%`, width: `${timePos(s.dayEnd) - timePos(s.dayStart)}%` }}
          />
          {[
            { t: s.dayStart, lbl: "Day starts", color: "border-green" },
            { t: s.lateThreshold, lbl: "Late after", color: "border-gold" },
            { t: s.dayEnd, lbl: "Day ends", color: "border-terra" },
          ].map((m) => (
            <div
              key={m.lbl}
              className="absolute -translate-x-1/2"
              style={{ left: `${timePos(m.t)}%`, top: "-2px" }}
            >
              <div className="absolute bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-center">
                <div className="font-mono text-[11px] font-semibold text-navy">{time12(m.t)}</div>
              </div>
              <div className={cn("h-[22px] w-[22px] rounded-full border-[2.5px] bg-surface", m.color)} />
              <div className="absolute top-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-center text-[9px] font-bold uppercase tracking-wide text-navy-3">
                {m.lbl}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-10 flex justify-between font-mono text-[9px] text-navy-3">
          {["6 AM", "8 AM", "10 AM", "12 PM", "2 PM", "4 PM", "6 PM"].map((h) => (
            <span key={h}>{h}</span>
          ))}
        </div>

        {/* Schedule controls */}
        <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-3">
          {[
            {
              k: "dayStart" as const,
              label: "School day starts",
              help: "Time before which students must arrive to be marked Present.",
            },
            {
              k: "lateThreshold" as const,
              label: "Late threshold",
              help: "Students arriving after this are marked Late instead of Present.",
            },
            {
              k: "dayEnd" as const,
              label: "School day ends",
              help: "Used for the daily auto-SMS to absent students' guardians.",
            },
          ].map((f) => (
            <div key={f.k}>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-navy-3">
                {f.label}
              </label>
              <input
                type="time"
                value={s[f.k]}
                onChange={(e) => set(f.k, e.target.value)}
                className="w-full rounded-md border border-border-2 bg-bg px-3 py-2 font-mono text-sm font-semibold text-navy outline-none focus:border-gold focus:bg-surface"
              />
              <p className="mt-1 text-[11px] italic text-navy-3">{f.help}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Edit-window card */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface p-6">
        <div className="max-w-xl">
          <div className="font-display text-sm font-semibold text-navy">
            Register edit <em className="text-gold">window</em>
          </div>
          <p className="mt-1 text-xs text-navy-3">
            After a register is submitted, teachers can edit it freely for this long. After the
            window closes, edits require <b className="font-semibold text-navy-2">your approval</b>{" "}
            through the edit-request flow.
          </p>
        </div>
        <Stepper
          value={s.editWindowHours}
          onChange={(v) => set("editWindowHours", v)}
          min={0}
          max={336}
          suffix="hours"
        />
      </div>

      {/* ── Region 03 — Notifications & alert rules ──────────────── */}
      <SectionHead num="03" title="Notifications & alert rules" meta="what the system says to whom" />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* SMS to parents */}
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-gold">
            SMS to parents
          </div>
          <h3 className="mt-1 font-display text-base font-semibold text-navy">
            When to <em className="text-gold">auto-message</em> guardians
          </h3>
          <p className="mt-1 text-xs text-navy-3">
            Short SMS sent automatically to a guardian when their child&apos;s attendance changes.
            Each costs{" "}
            <b className="font-semibold text-navy-2">GHS {SMS_SEGMENT_RATE_GHS.toFixed(3)}</b> per
            recipient · sent through your school&apos;s SMS account.
          </p>
          <div className="mt-3 flex items-start justify-between gap-3 rounded-lg border border-border bg-bg p-3">
            <div className="min-w-0">
              <div className="text-[13px] font-bold text-navy">
                Absence SMS · end of day
              </div>
              <p className="mt-0.5 text-[11px] italic text-navy-3">
                &ldquo;James was absent today. Please contact the school if there is a reason.&rdquo;
                Sent to guardians of absent students when you submit the register.
              </p>
            </div>
            <Toggle on={s.absenceSms} onChange={(v) => set("absenceSms", v)} />
          </div>
          <p className="mt-2 text-[11px] text-navy-3">
            Late-arrival, reassurance and auto-correction SMS are on the roadmap.
          </p>
        </div>

        {/* Pattern detection */}
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-gold">
            Pattern detection
          </div>
          <h3 className="mt-1 font-display text-base font-semibold text-navy">
            When the system <em className="text-gold">flags</em> a student
          </h3>
          <p className="mt-1 text-xs text-navy-3">
            Evaluated at end of day, after registers close. New flags appear next morning on your
            dashboard.
          </p>

          <FlagBlock letter="L" tone="text-terra" title="Long absence">
            <RuleRow severity="watching" text={`at ${s.absWatchDays}+ consecutive absent days`}>
              <Stepper value={s.absWatchDays} onChange={(v) => set("absWatchDays", v)} min={1} max={30} suffix="d" />
            </RuleRow>
            <RuleRow severity="critical" text={`at ${s.absCriticalDays}+ consecutive absent days`}>
              <Stepper value={s.absCriticalDays} onChange={(v) => set("absCriticalDays", v)} min={1} max={60} suffix="d" />
            </RuleRow>
          </FlagBlock>

          <FlagBlock letter="B" tone="text-warn" title="Below threshold">
            <RuleRow severity="watching" text={`term attendance drops below ${s.pctWatch}%`}>
              <Stepper value={s.pctWatch} onChange={(v) => set("pctWatch", v)} min={1} max={100} suffix="%" />
            </RuleRow>
            <RuleRow severity="critical" text={`term attendance drops below ${s.pctCritical}%`}>
              <Stepper value={s.pctCritical} onChange={(v) => set("pctCritical", v)} min={1} max={100} suffix="%" />
            </RuleRow>
          </FlagBlock>

          <FlagBlock letter="P" tone="text-gold" title="Pattern shift">
            <RuleRow severity="watching" text={`drop of ${FLAG_THRESHOLDS.dropPct}%+ over rolling 14 days`} />
            <RuleRow
              severity="watching"
              text={`same-day-of-week pattern · ${FLAG_THRESHOLDS.dowMiss} of ${FLAG_THRESHOLDS.dowWindow}`}
            />
            <p className="mt-1 text-[10px] italic text-navy-3">Fixed defaults — not yet adjustable.</p>
          </FlagBlock>
        </div>
      </div>

      {/* ── Sticky save bar ──────────────────────────────────────── */}
      <div className="sticky bottom-0 z-10 mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-5 py-3 shadow-sm">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-[11px]">
          {dirty ? (
            <>
              <span className="rounded-pill bg-terra-bg px-2 py-0.5 text-[9px] font-bold uppercase text-terra">
                {changed.length} unsaved change{changed.length === 1 ? "" : "s"}
              </span>
              <span className="text-navy-2">
                {changed
                  .map(
                    (k) => `${FIELD_LABEL[k]}: ${display(k, initial[k])} → ${display(k, s[k])}`,
                  )
                  .join(" · ")}
              </span>
            </>
          ) : (
            <span className="text-navy-3">No unsaved changes.</span>
          )}
          {msg && (
            <span className={msg.ok ? "text-green" : "text-terra"}>{msg.text}</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setS(ATTENDANCE_SETTINGS_DEFAULTS)}
            className="rounded-md px-3 py-2 text-xs font-semibold text-navy-3 hover:text-gold"
          >
            Reset to defaults
          </button>
          <button
            type="button"
            onClick={() => setS(initial)}
            disabled={!dirty}
            className="rounded-md border border-border-2 bg-bg px-3 py-2 text-sm font-semibold text-navy disabled:opacity-50"
          >
            Discard
          </button>
          <button
            onClick={save}
            disabled={busy || !dirty}
            className="rounded-md bg-navy px-5 py-2 text-sm font-bold text-bg transition-colors hover:bg-navy-deep disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function FlagBlock({
  letter,
  tone,
  title,
  children,
}: {
  letter: string;
  tone: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-3 rounded-lg border border-border bg-bg p-3">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-bold text-navy">
        <span className={cn("font-display", tone)}>{letter}</span>
        {title}
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function RuleRow({
  severity,
  text,
  children,
}: {
  severity: "watching" | "critical";
  text: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            "shrink-0 rounded-pill px-2 py-0.5 text-[9px] font-bold uppercase",
            severity === "critical" ? "bg-terra-bg text-terra" : "bg-warn-bg text-warn",
          )}
        >
          {severity}
        </span>
        <span className="text-[11px] text-navy-2">{text}</span>
      </div>
      {children}
    </div>
  );
}
