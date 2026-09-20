"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateVlcProgramme } from "@/lib/actions/vlc";
import {
  formatVlcTime,
  formatVlcWindow,
  VLC_DAY_NAMES,
  addMinutes,
  type VlcProgramme,
} from "@/lib/vlc/defaults";

const fieldClass =
  "rounded-md border border-border-2 bg-bg px-3 py-2 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface";

type Durations = Record<VlcProgramme["phases"][number]["field"], number>;

/**
 * The Wednesday rhythm — the gold cadence card + the navy 5-phase strip. Phase names/roles are
 * LOCKED (frozen editorial from lib/vlc/defaults); only the durations + cadence day/start are
 * editable, and only when `canEdit` (a HM/FM reads the same card with no controls). Phase-column
 * widths are literally proportional to the minutes (the surface's deliberate detail).
 *
 * No-alpha token trap: the navy strip's tints are `bg-white/5` / `border-white/10` (white is a real
 * colour) and `text-gold-soft` / literal `text-[rgba(...)]` — never a slash-opacity on a raw-hex token.
 */
export function RhythmEditor({
  programme,
  canEdit,
}: {
  programme: VlcProgramme;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [day, setDay] = useState(programme.sessionDay);
  const [start, setStart] = useState(programme.sessionStart);
  const [mins, setMins] = useState<Durations>(
    Object.fromEntries(programme.phases.map((p) => [p.field, p.min])) as Durations,
  );

  const draftTotal = programme.phases.reduce((n, p) => n + (mins[p.field] || 0), 0);
  const cal = formatVlcTime(programme.sessionStart);

  function cancel() {
    setDay(programme.sessionDay);
    setStart(programme.sessionStart);
    setMins(Object.fromEntries(programme.phases.map((p) => [p.field, p.min])) as Durations);
    setEditing(false);
    setError(null);
  }
  function save() {
    setError(null);
    startTransition(async () => {
      const res = await updateVlcProgramme({ sessionDay: day, sessionStart: start, ...mins });
      if (!res.ok) {
        setError(res.error ?? "Could not save.");
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {/* ── Cadence card (gold-bg, protected-slot lock) ── */}
      <div className="grid grid-cols-1 gap-5 rounded-2xl border border-gold-soft bg-gold-bg p-6 md:grid-cols-[auto_1fr_auto]">
        <div className="flex h-[88px] w-[88px] flex-col items-center justify-center rounded-xl border border-gold bg-surface">
          <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-gold">
            {VLC_DAY_NAMES[programme.sessionDay - 1].slice(0, 3).toUpperCase()}
          </div>
          <div className="font-display text-4xl font-medium leading-none text-navy">{cal.time}</div>
          <div className="mt-0.5 font-mono text-[10px] text-navy-3">{cal.meridiem}</div>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">
            Master timetable · protected slot
          </div>
          <h4 className="mt-1 font-display text-xl font-medium text-navy">
            Every {programme.dayName}{" "}
            <em className="italic text-gold">
              {formatVlcWindow(programme.sessionStart, programme.endTime)}
            </em>
          </h4>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-navy-2">
            Last period of the day.{" "}
            <b className="font-semibold text-navy">
              No classes, no assemblies, no clubs scheduled in this slot
            </b>{" "}
            · master timetable enforces. Different day from PLC (Friday) so teacher load is spread.
            Form Master + 2 Peer Guides facilitate; whole class attends in their normal classroom.{" "}
            <b className="font-semibold text-navy">22 sessions across the academic year</b> · 8 weeks
            of slack for exams, sports days, public holidays, and other disruptions baked into the
            planning.
          </p>
        </div>
        {canEdit && !editing && (
          <div className="flex flex-col gap-2 md:items-end">
            <button
              onClick={() => setEditing(true)}
              className="rounded-md border border-border-2 bg-surface px-3.5 py-2 text-xs font-semibold text-navy hover:bg-gold-bg"
            >
              Adjust cadence
            </button>
          </div>
        )}
      </div>

      {/* ── Adjust-cadence editor (Dean/Admin only) ── */}
      {canEdit && editing && (
        <div className="rounded-2xl border border-border bg-surface p-6">
          <div className="mb-4 flex flex-wrap items-end gap-4">
            <label className="block text-[11px]">
              <span className="mb-0.5 block font-medium text-navy-3">Session day</span>
              <select
                className={fieldClass}
                value={day}
                onChange={(e) => setDay(Number(e.target.value))}
              >
                {VLC_DAY_NAMES.map((name, i) => (
                  <option key={name} value={i + 1}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[11px]">
              <span className="mb-0.5 block font-medium text-navy-3">Start time</span>
              <input
                type="time"
                className={fieldClass}
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
          </div>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {programme.phases.map((p) => (
              <label key={p.field} className="block text-[11px]">
                <span className="mb-0.5 block font-medium text-navy-3">{p.name} · min</span>
                <input
                  type="number"
                  min={1}
                  max={180}
                  className={`${fieldClass} w-full`}
                  value={mins[p.field]}
                  onChange={(e) =>
                    setMins((m) => ({ ...m, [p.field]: Number(e.target.value) }))
                  }
                />
              </label>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <div className="text-[11px] text-navy-3">
              Total <b className="font-semibold text-navy">{draftTotal} min</b> · ends{" "}
              {formatVlcTime(addMinutes(start, draftTotal)).time}{" "}
              {formatVlcTime(addMinutes(start, draftTotal)).meridiem} · durations are free (no fixed
              sum)
            </div>
            <div className="flex gap-2">
              <button
                onClick={cancel}
                disabled={pending}
                className="rounded-md border border-border-2 bg-surface px-3.5 py-2 text-xs font-semibold text-navy disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={pending}
                className="rounded-md bg-navy px-4 py-2 text-xs font-semibold text-bg hover:bg-navy-deep disabled:opacity-50"
              >
                {pending ? "Saving…" : "Save cadence"}
              </button>
            </div>
          </div>
          {error && <p className="mt-2 text-xs font-semibold text-terra">{error}</p>}
        </div>
      )}

      {/* ── Five-phase rhythm strip (navy) — names/roles locked, widths ∝ minutes ── */}
      <div className="rounded-2xl bg-navy p-7 text-bg">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2 border-b border-white/10 pb-3.5">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">
              Five-phase session structure
            </div>
            <h4 className="mt-0.5 font-display text-lg font-medium">
              Every session <em className="italic text-gold">follows the same rhythm</em>
            </h4>
          </div>
          <div className="text-[11px] text-gold-soft">
            Total <b className="font-semibold text-bg">{programme.totalMin} min</b> · phase widths
            reflect time
          </div>
        </div>
        {/* Phase widths ∝ minutes: flex-grow set to the duration, flex-basis 0 (surface detail). */}
        <div className="flex flex-col gap-2.5 sm:flex-row">
          {programme.phases.map((p) => (
            <div
              key={p.field}
              style={{ flexGrow: p.min, flexBasis: 0 }}
              className="min-w-0 rounded-lg border-t-[3px] border-gold bg-white/5 p-3 sm:min-w-[92px]"
            >
              <div className="font-display text-xl font-semibold leading-none">
                <em className="italic text-gold">{p.min}</em> min
              </div>
              <div className="mt-1 text-[11px] font-semibold text-bg">{p.name}</div>
              <div className="mt-1 text-[9px] font-bold uppercase tracking-[0.06em] text-gold-soft">
                {p.who}
              </div>
              <div className="mt-1.5 text-[10px] leading-relaxed text-[rgba(250,247,242,0.65)]">
                {p.description}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
