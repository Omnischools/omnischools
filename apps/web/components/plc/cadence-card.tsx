"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updatePlcCadence } from "@/lib/actions/plc";
import type { PlcProgramme } from "@/lib/plc/defaults";
import { fieldClass, DAY_OPTIONS } from "./shared";

/**
 * The gold school-wide PLC cadence card (surface `.cadence-card`). Header shows the DERIVED window
 * (start + session length → end); the 4 fields (day / start / length / weeks) are editable only when
 * `canEdit` — a read-only staffer sees the same card with disabled controls and no Save button. Every
 * write re-checks PLC_CONFIG_WRITE_ROLES server-side.
 */
export function CadenceCard({
  programme,
  canEdit,
}: {
  programme: PlcProgramme;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [day, setDay] = useState(programme.sessionDay);
  const [start, setStart] = useState(programme.sessionStart);
  const [length, setLength] = useState(programme.sessionLengthMin);
  const [weeks, setWeeks] = useState(programme.weeksPerSemester);

  const dirty =
    day !== programme.sessionDay ||
    start !== programme.sessionStart ||
    length !== programme.sessionLengthMin ||
    weeks !== programme.weeksPerSemester;

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await updatePlcCadence({
        sessionDay: day,
        sessionStart: start,
        sessionLengthMin: length,
        weeksPerSemester: weeks,
      });
      if (!res.ok) return setError(res.error ?? "Could not save.");
      router.refresh();
    });
  }

  return (
    <div className="rounded-2xl border border-gold-soft bg-gold-bg p-6">
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">
        School-wide PLC cadence
      </div>
      <h3 className="mt-1 font-display text-xl font-semibold text-navy">
        Every{" "}
        <em className="italic text-gold">
          {programme.dayName} afternoon · {programme.windowLabel}
        </em>
      </h3>
      <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-navy-2">
        All PLCs at this school meet at the same hour.{" "}
        <b className="font-semibold text-navy">Single cadence makes it possible to protect the time</b>{" "}
        — no classes, no admin meetings, no parent calls during PLC hour. Individual PLCs can override
        if their facilitator coordinates differently, but the default is school-wide alignment.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <label className="block text-[11px]">
          <span className="mb-1.5 block font-bold uppercase tracking-[0.1em] text-navy-3">
            Day of week
          </span>
          <select
            className={`${fieldClass} w-full`}
            value={day}
            disabled={!canEdit}
            onChange={(e) => setDay(Number(e.target.value))}
          >
            {DAY_OPTIONS.map((d) => (
              <option key={d.v} value={d.v}>
                {d.l}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[11px]">
          <span className="mb-1.5 block font-bold uppercase tracking-[0.1em] text-navy-3">
            Start time
          </span>
          <input
            type="time"
            className={`${fieldClass} w-full`}
            value={start}
            disabled={!canEdit}
            onChange={(e) => setStart(e.target.value)}
          />
          <span className="mt-1 block italic text-navy-3">After last teaching period</span>
        </label>
        <label className="block text-[11px]">
          <span className="mb-1.5 block font-bold uppercase tracking-[0.1em] text-navy-3">
            Session length · min
          </span>
          <input
            type="number"
            min={1}
            max={600}
            className={`${fieldClass} w-full`}
            value={length}
            disabled={!canEdit}
            onChange={(e) => setLength(Number(e.target.value))}
          />
        </label>
        <label className="block text-[11px]">
          <span className="mb-1.5 block font-bold uppercase tracking-[0.1em] text-navy-3">
            Weeks per semester
          </span>
          <input
            type="number"
            min={1}
            max={60}
            className={`${fieldClass} w-full`}
            value={weeks}
            disabled={!canEdit}
            onChange={(e) => setWeeks(Number(e.target.value))}
          />
        </label>
      </div>

      {canEdit && (
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={save}
            disabled={pending || !dirty}
            className="rounded-md bg-navy px-4 py-2 text-xs font-semibold text-bg hover:bg-navy-deep disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save cadence"}
          </button>
          {error && <p className="text-xs font-semibold text-terra">{error}</p>}
        </div>
      )}
    </div>
  );
}
