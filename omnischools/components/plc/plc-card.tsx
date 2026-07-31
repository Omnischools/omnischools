"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addPlcMember,
  archivePlc,
  removePlcMember,
  renamePlc,
  setPlcCadenceOverride,
  setPlcFacilitator,
  setPlcTermFocus,
} from "@/lib/actions/plc";
import type { PlcCardView, PlcStaffOption } from "@/lib/plc/setup-data";
import { ACCENT, DAY_OPTIONS, fieldClass } from "./shared";

type Result = { ok: boolean; error?: string };

/**
 * One PLC card (surface `.plc-card`) — type-coloured left border + icon, facilitator pill, member
 * count + avatar stack, term focus (or an honest empty state), and an optional cadence-override pill.
 * The session foot / VIEW SESSIONS / "session N of Y" are OMITTED (INCR-48 data — omit-not-fake).
 *
 * When `canEdit`, an Edit panel exposes rename / facilitator / focus / override / members / archive —
 * each calling a discrete server action that re-checks the write gate. Archive is soft (never delete).
 */
export function PlcCard({
  plc,
  staffOptions,
  canEdit,
  periodLabel,
}: {
  plc: PlcCardView;
  staffOptions: PlcStaffOption[];
  canEdit: boolean;
  periodLabel: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const a = ACCENT[plc.accent];
  const overflow = plc.memberCount - plc.members.slice(0, 5).length;

  function run(action: () => Promise<Result>) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (!res.ok) return setError(res.error ?? "Could not save.");
      router.refresh();
    });
  }

  return (
    <div className={`overflow-hidden rounded-2xl border border-border border-l-4 ${a.borderL} bg-surface`}>
      {/* ── Head ── */}
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-4 border-b border-border bg-bg px-6 py-4 sm:grid-cols-[auto_1fr_auto_auto]">
        <div
          className={`flex h-12 w-12 items-center justify-center rounded-[10px] font-display text-base font-bold ${a.icon}`}
        >
          {plc.iconInitials}
        </div>
        <div className="min-w-0">
          <div className={`text-[9px] font-bold uppercase tracking-[0.14em] ${a.lab}`}>
            {plc.typeLabel} · {plc.mandatory ? "Mandatory" : "Voluntary"}
          </div>
          <h4 className="mt-0.5 font-display text-lg font-semibold leading-tight text-navy">
            {plc.name} <em className="italic font-medium text-gold">PLC</em>
          </h4>
        </div>
        {/* Facilitator pill */}
        <div className="flex items-center gap-2 rounded-pill border border-border bg-surface px-3 py-1.5">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gold font-display text-[10px] font-bold text-navy">
            {plc.facilitator?.initials ?? "—"}
          </div>
          <div className="text-[11px] leading-tight">
            <div className="text-[9px] font-bold uppercase tracking-[0.08em] text-navy-3">
              Facilitator
            </div>
            <div className="font-semibold text-navy">
              {plc.facilitator
                ? `${plc.facilitator.name}${plc.facilitator.roleLabel ? ` · ${plc.facilitator.roleLabel}` : ""}`
                : "Unassigned"}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="font-display text-xl font-semibold text-navy">
            <em className="italic text-gold">{plc.memberCount}</em>
          </div>
          <div className="text-[9px] font-bold uppercase tracking-[0.1em] text-navy-3">
            {plc.type === "new-teacher" ? "New teachers" : "Teachers"}
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="grid grid-cols-1 gap-6 px-6 py-5 md:grid-cols-2">
        <div>
          <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-navy-3">
            {periodLabel ? `${periodLabel} focus` : "Term focus"}
          </div>
          {plc.focus ? (
            <div className="mt-1.5 rounded-r-md border-l-[3px] border-gold bg-bg px-3.5 py-2.5 text-[12px] italic leading-relaxed text-navy-2">
              {plc.focus}
            </div>
          ) : (
            <div className="mt-1.5 rounded-md border border-dashed border-border-2 bg-bg px-3.5 py-2.5 text-[12px] italic text-navy-3">
              No focus set{periodLabel ? ` for ${periodLabel}` : ""} yet.
            </div>
          )}
        </div>
        <div>
          <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-navy-3">
            Members{plc.type === "cross-cutting" ? " · voluntary attendance" : ""}
          </div>
          <div className="mt-1.5 flex items-center">
            {plc.members.slice(0, 5).map((m) => (
              <div
                key={m.userId}
                title={m.name}
                className="-ml-1.5 flex h-7 w-7 items-center justify-center rounded-full border-2 border-surface bg-gold-bg font-display text-[10px] font-bold text-gold first:ml-0"
              >
                {m.initials}
              </div>
            ))}
            {overflow > 0 && (
              <div className="-ml-1.5 flex h-7 w-7 items-center justify-center rounded-full border-2 border-surface bg-navy font-display text-[10px] font-bold text-gold">
                +{overflow}
              </div>
            )}
            {plc.memberCount === 0 && (
              <span className="text-[11px] italic text-navy-3">No members yet</span>
            )}
            <span className="ml-2.5 text-[11px] text-navy-3">
              <b className="font-semibold text-navy-2">{plc.memberCount}</b>{" "}
              {plc.memberCount === 1 ? "member" : "members"}
            </span>
          </div>
        </div>
      </div>

      {/* ── Foot (override pill + Edit) ── */}
      {(plc.overrideLabel || canEdit) && (
        <div className="flex items-center justify-between gap-2 border-t border-border bg-bg px-6 py-2.5">
          <div className="text-[11px] text-navy-3">
            {plc.overrideLabel ? (
              <span className="rounded-pill bg-gold-bg px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.06em] text-gold">
                Override · {plc.overrideLabel}
              </span>
            ) : (
              <span className="italic">Inherits school cadence</span>
            )}
          </div>
          {canEdit && (
            <button
              onClick={() => {
                setEditing((v) => !v);
                setError(null);
              }}
              className="rounded-md border border-border-2 bg-surface px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.04em] text-navy-2 hover:bg-gold-bg"
            >
              {editing ? "Close" : "Edit"}
            </button>
          )}
        </div>
      )}

      {/* ── Edit panel ── */}
      {canEdit && editing && (
        <div className="space-y-4 border-t border-border bg-surface px-6 py-5">
          <EditRow label="Name">
            <RenameField plc={plc} run={run} pending={pending} />
          </EditRow>

          <EditRow label="Facilitator">
            <FacilitatorField plc={plc} staffOptions={staffOptions} run={run} pending={pending} />
          </EditRow>

          <EditRow label={periodLabel ? `${periodLabel} focus` : "Term focus"}>
            <FocusField plc={plc} run={run} pending={pending} />
          </EditRow>

          <EditRow label="Cadence override">
            <OverrideField plc={plc} run={run} pending={pending} />
          </EditRow>

          <EditRow label="Members">
            <MembersField plc={plc} staffOptions={staffOptions} run={run} pending={pending} />
          </EditRow>

          <div className="flex items-center justify-between border-t border-border pt-3">
            <button
              onClick={() => {
                if (confirm(`Archive the ${plc.name} PLC? Its history is kept; it can't be undone here.`))
                  run(() => archivePlc({ plcId: plc.id }));
              }}
              disabled={pending}
              className="rounded-md border border-terra bg-terra-bg px-3 py-1.5 text-[11px] font-semibold text-terra hover:brightness-95 disabled:opacity-50"
            >
              Archive PLC
            </button>
            {error && <p className="text-xs font-semibold text-terra">{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function EditRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[140px_1fr] sm:items-start">
      <div className="pt-2 text-[10px] font-bold uppercase tracking-[0.1em] text-navy-3">{label}</div>
      <div>{children}</div>
    </div>
  );
}

function RenameField({
  plc,
  run,
  pending,
}: {
  plc: PlcCardView;
  run: (a: () => Promise<Result>) => void;
  pending: boolean;
}) {
  const [name, setName] = useState(plc.name);
  return (
    <div className="flex flex-wrap gap-2">
      <input
        className={`${fieldClass} min-w-0 flex-1`}
        value={name}
        maxLength={120}
        onChange={(e) => setName(e.target.value)}
      />
      <button
        onClick={() => run(() => renamePlc({ plcId: plc.id, name }))}
        disabled={pending || name.trim() === plc.name || name.trim() === ""}
        className="rounded-md border border-border-2 bg-surface px-3 py-2 text-xs font-semibold text-navy disabled:opacity-50"
      >
        Rename
      </button>
    </div>
  );
}

function FacilitatorField({
  plc,
  staffOptions,
  run,
  pending,
}: {
  plc: PlcCardView;
  staffOptions: PlcStaffOption[];
  run: (a: () => Promise<Result>) => void;
  pending: boolean;
}) {
  const [sel, setSel] = useState(plc.facilitator?.userId ?? "");
  return (
    <div className="flex flex-wrap gap-2">
      <select
        className={`${fieldClass} min-w-0 flex-1`}
        value={sel}
        onChange={(e) => setSel(e.target.value)}
      >
        <option value="">Unassigned</option>
        {staffOptions.map((s) => (
          <option key={s.userId} value={s.userId}>
            {s.name}
            {s.roleLabel ? ` · ${s.roleLabel}` : ""}
          </option>
        ))}
      </select>
      <button
        onClick={() =>
          run(() => setPlcFacilitator({ plcId: plc.id, facilitatorUserId: sel || null }))
        }
        disabled={pending || sel === (plc.facilitator?.userId ?? "")}
        className="rounded-md border border-border-2 bg-surface px-3 py-2 text-xs font-semibold text-navy disabled:opacity-50"
      >
        Assign
      </button>
    </div>
  );
}

function FocusField({
  plc,
  run,
  pending,
}: {
  plc: PlcCardView;
  run: (a: () => Promise<Result>) => void;
  pending: boolean;
}) {
  const [focus, setFocus] = useState(plc.focus ?? "");
  return (
    <div className="space-y-2">
      <textarea
        className={`${fieldClass} w-full`}
        rows={3}
        maxLength={500}
        placeholder="What this PLC is working on this semester (free text)…"
        value={focus}
        onChange={(e) => setFocus(e.target.value)}
      />
      <button
        onClick={() => run(() => setPlcTermFocus({ plcId: plc.id, focus }))}
        disabled={pending || focus.trim() === "" || focus.trim() === (plc.focus ?? "")}
        className="rounded-md border border-border-2 bg-surface px-3 py-2 text-xs font-semibold text-navy disabled:opacity-50"
      >
        Save focus
      </button>
    </div>
  );
}

function OverrideField({
  plc,
  run,
  pending,
}: {
  plc: PlcCardView;
  run: (a: () => Promise<Result>) => void;
  pending: boolean;
}) {
  const [on, setOn] = useState(!!plc.overrideFrequency);
  const [freq, setFreq] = useState(plc.overrideFrequency ?? "WEEKLY");
  const [day, setDay] = useState(plc.overrideSessionDay ?? 5);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-1.5 text-[12px] text-navy-2">
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
        Override school cadence
      </label>
      {on && (
        <>
          <select className={fieldClass} value={freq} onChange={(e) => setFreq(e.target.value)}>
            <option value="WEEKLY">Weekly</option>
            <option value="BIWEEKLY">Biweekly</option>
          </select>
          <select
            className={fieldClass}
            value={day}
            onChange={(e) => setDay(Number(e.target.value))}
          >
            {DAY_OPTIONS.map((d) => (
              <option key={d.v} value={d.v}>
                {d.l}
              </option>
            ))}
          </select>
        </>
      )}
      <button
        onClick={() =>
          run(() =>
            setPlcCadenceOverride({
              plcId: plc.id,
              overrideFrequency: on ? freq : null,
              overrideSessionDay: on ? day : null,
            }),
          )
        }
        disabled={pending}
        className="rounded-md border border-border-2 bg-surface px-3 py-2 text-xs font-semibold text-navy disabled:opacity-50"
      >
        Save override
      </button>
    </div>
  );
}

function MembersField({
  plc,
  staffOptions,
  run,
  pending,
}: {
  plc: PlcCardView;
  staffOptions: PlcStaffOption[];
  run: (a: () => Promise<Result>) => void;
  pending: boolean;
}) {
  const memberIds = new Set(plc.members.map((m) => m.userId));
  const addable = staffOptions.filter((s) => !memberIds.has(s.userId));
  const [add, setAdd] = useState("");
  const isFacilitator = (id: string) => plc.facilitator?.userId === id;
  return (
    <div className="space-y-2">
      {plc.members.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {plc.members.map((m) => (
            <span
              key={m.userId}
              className="inline-flex items-center gap-1.5 rounded-pill border border-border bg-bg px-2.5 py-1 text-[11px] text-navy-2"
            >
              {m.name}
              {isFacilitator(m.userId) ? (
                <em className="not-italic text-[9px] font-bold uppercase text-gold">facilitator</em>
              ) : (
                <button
                  onClick={() => run(() => removePlcMember({ plcId: plc.id, userId: m.userId }))}
                  disabled={pending}
                  title="Remove member"
                  className="text-navy-3 hover:text-terra disabled:opacity-50"
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <select
          className={`${fieldClass} min-w-0 flex-1`}
          value={add}
          onChange={(e) => setAdd(e.target.value)}
        >
          <option value="">Add a member…</option>
          {addable.map((s) => (
            <option key={s.userId} value={s.userId}>
              {s.name}
              {s.roleLabel ? ` · ${s.roleLabel}` : ""}
            </option>
          ))}
        </select>
        <button
          onClick={() => {
            if (add) run(() => addPlcMember({ plcId: plc.id, userId: add }));
            setAdd("");
          }}
          disabled={pending || !add}
          className="rounded-md border border-border-2 bg-surface px-3 py-2 text-xs font-semibold text-navy disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </div>
  );
}
