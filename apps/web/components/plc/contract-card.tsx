"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updatePlcContract } from "@/lib/actions/plc";
import type { PlcProgramme } from "@/lib/plc/defaults";
import { NTC_ANNUAL_TOTAL } from "./shared";

/**
 * The navy CPD-points contract card (surface `.contract-card`) — the 4 editable scalars + the DERIVED
 * "max 1.0 per session" read-only tile (R371). Editable only when `canEdit`; every write re-checks the
 * PLC config write gate server-side.
 *
 * No-alpha token trap: white-on-navy tints are `bg-white/5` / `border-white/10` (white is a real
 * colour) and off-white labels use `text-gold-soft` / a literal `text-[rgba(...)]` — NEVER a
 * slash-opacity on the raw-hex `--bg` token (verify in the live preview, not the build).
 */
const numInput =
  "w-24 rounded-md border border-white/10 bg-white/5 px-2 py-1.5 font-display text-2xl font-semibold text-gold outline-none focus:border-gold";

export function ContractCard({
  programme,
  canEdit,
}: {
  programme: PlcProgramme;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [attended, setAttended] = useState(programme.ptsPerAttendedSession);
  const [reflection, setReflection] = useState(programme.ptsPerReflection);
  const [windowHours, setWindowHours] = useState(programme.reflectionWindowHours);
  const [annual, setAnnual] = useState(programme.annualPlcTarget);

  const max = Math.round((attended + reflection) * 100) / 100; // DERIVED, never stored
  const sessionsForTarget = max > 0 ? Math.ceil(annual / max) : 0;
  const otherPts = Math.max(0, NTC_ANNUAL_TOTAL - annual);
  const dirty =
    attended !== programme.ptsPerAttendedSession ||
    reflection !== programme.ptsPerReflection ||
    windowHours !== programme.reflectionWindowHours ||
    annual !== programme.annualPlcTarget;

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await updatePlcContract({
        ptsPerAttendedSession: attended,
        ptsPerReflection: reflection,
        reflectionWindowHours: windowHours,
        annualPlcTarget: annual,
      });
      if (!res.ok) return setError(res.error ?? "Could not save.");
      router.refresh();
    });
  }

  return (
    <div className="rounded-2xl bg-navy p-8 text-bg">
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">
        The CPD points contract · automatic from this configuration
      </div>
      <h3 className="mt-1 font-display text-2xl font-medium">
        What teachers <em className="italic text-gold">earn</em> for full PLC participation
      </h3>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Tile 1 — attended (editable) */}
        <div className="rounded-lg border border-white/10 bg-white/5 p-4">
          {canEdit ? (
            <input
              type="number"
              min={0}
              max={10}
              step={0.5}
              className={numInput}
              value={attended}
              onChange={(e) => setAttended(Number(e.target.value))}
            />
          ) : (
            <div className="font-display text-3xl font-medium text-gold">{attended}</div>
          )}
          <div className="mt-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-gold-soft">
            Pts per <b className="text-bg">attended session</b>
          </div>
          <div className="mt-1 text-[11px] leading-snug text-[rgba(250,247,242,0.6)]">
            Present or Late · counts the same · Absent = no points
          </div>
        </div>

        {/* Tile 2 — reflection (editable) + within-window hours */}
        <div className="rounded-lg border border-white/10 bg-white/5 p-4">
          {canEdit ? (
            <input
              type="number"
              min={0}
              max={10}
              step={0.5}
              className={numInput}
              value={reflection}
              onChange={(e) => setReflection(Number(e.target.value))}
            />
          ) : (
            <div className="font-display text-3xl font-medium text-gold">+{reflection}</div>
          )}
          <div className="mt-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-gold-soft">
            Pts for <b className="text-bg">session reflection</b>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] leading-snug text-[rgba(250,247,242,0.6)]">
            Submitted within
            {canEdit ? (
              <input
                type="number"
                min={1}
                max={336}
                className="w-14 rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-center text-[11px] text-bg outline-none focus:border-gold"
                value={windowHours}
                onChange={(e) => setWindowHours(Number(e.target.value))}
              />
            ) : (
              <b className="text-bg">{windowHours}</b>
            )}
            hours · facilitator-confirmed
          </div>
        </div>

        {/* Tile 3 — max per session (DERIVED, read-only) */}
        <div className="rounded-lg border border-white/10 bg-white/5 p-4">
          <div className="font-display text-3xl font-medium text-gold">{max}</div>
          <div className="mt-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-gold-soft">
            Max pts <b className="text-bg">per session</b>
          </div>
          <div className="mt-1 text-[11px] leading-snug text-[rgba(250,247,242,0.6)]">
            Attended + reflected · {sessionsForTarget} sessions for full {annual} pts · derived
          </div>
        </div>

        {/* Tile 4 — annual PLC contribution (editable) */}
        <div className="rounded-lg border border-white/10 bg-white/5 p-4">
          <div className="flex items-baseline gap-1">
            {canEdit ? (
              <input
                type="number"
                min={0}
                max={NTC_ANNUAL_TOTAL}
                step={0.5}
                className={numInput}
                value={annual}
                onChange={(e) => setAnnual(Number(e.target.value))}
              />
            ) : (
              <span className="font-display text-3xl font-medium text-gold">{annual}</span>
            )}
            <span className="font-display text-xl font-medium text-gold-soft">
              / {NTC_ANNUAL_TOTAL}
            </span>
          </div>
          <div className="mt-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-gold-soft">
            Annual <b className="text-bg">PLC contribution</b>
          </div>
          <div className="mt-1 text-[11px] leading-snug text-[rgba(250,247,242,0.6)]">
            Of NTC&apos;s {NTC_ANNUAL_TOTAL}-point annual target · other {otherPts} from workshops,
            courses, mentoring
          </div>
        </div>
      </div>

      {canEdit && (
        <div className="mt-5 flex items-center gap-3">
          <button
            onClick={save}
            disabled={pending || !dirty}
            className="rounded-md bg-gold px-4 py-2 text-xs font-bold text-navy hover:brightness-95 disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save CPD contract"}
          </button>
          {error && <p className="text-xs font-semibold text-gold-soft">{error}</p>}
        </div>
      )}
    </div>
  );
}
