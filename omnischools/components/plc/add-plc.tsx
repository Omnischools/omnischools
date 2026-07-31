"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPlc } from "@/lib/actions/plc";
import type { PlcStaffOption } from "@/lib/plc/setup-data";
import { DAY_OPTIONS, PLC_TYPE_OPTIONS, fieldClass } from "./shared";

/**
 * The "Add another PLC" dashed card (surface `.add-plc`) → expands into the create form:
 * type / name / facilitator / members / optional focus / optional cadence override. There is NO
 * mandatoriness input — mandatory/voluntary DERIVES from type (R376). Assigning a facilitator
 * auto-ensures their active membership server-side (R374). Only rendered when `canEdit`.
 */
export function AddPlc({ staffOptions }: { staffOptions: PlcStaffOption[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<string>("subject");
  const [name, setName] = useState("");
  const [facilitator, setFacilitator] = useState("");
  const [members, setMembers] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState("");
  const [override, setOverride] = useState(false);
  const [freq, setFreq] = useState("WEEKLY");
  const [day, setDay] = useState(5);

  function reset() {
    setType("subject");
    setName("");
    setFacilitator("");
    setMembers(new Set());
    setFocus("");
    setOverride(false);
    setFreq("WEEKLY");
    setDay(5);
    setError(null);
  }

  function toggleMember(id: string) {
    setMembers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await createPlc({
        type,
        name,
        facilitatorUserId: facilitator || null,
        memberUserIds: [...members],
        focus: focus || null,
        overrideFrequency: override ? freq : null,
        overrideSessionDay: override ? day : null,
      });
      if (!res.ok) return setError(res.error ?? "Could not create the PLC.");
      reset();
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full rounded-2xl border border-dashed border-gold-soft bg-gold-bg px-6 py-6 text-center hover:brightness-[0.98]"
      >
        <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-full bg-surface font-display text-lg font-bold text-gold">
          +
        </div>
        <div className="mt-2 font-display text-[15px] font-semibold text-navy">Add another PLC</div>
        <div className="mt-0.5 text-[11px] text-navy-3">
          Subject-based, cross-cutting, or new-teacher · facilitator and members configurable
        </div>
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-gold-soft bg-gold-bg p-6">
      <div className="mb-4 font-display text-[15px] font-semibold text-navy">Add a PLC</div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block text-[11px]">
          <span className="mb-1 block font-bold uppercase tracking-[0.1em] text-navy-3">Type</span>
          <select
            className={`${fieldClass} w-full`}
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            {PLC_TYPE_OPTIONS.map((t) => (
              <option key={t.v} value={t.v}>
                {t.l}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[11px]">
          <span className="mb-1 block font-bold uppercase tracking-[0.1em] text-navy-3">Name</span>
          <input
            className={`${fieldClass} w-full`}
            placeholder="e.g. Mathematics"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="block text-[11px]">
          <span className="mb-1 block font-bold uppercase tracking-[0.1em] text-navy-3">
            Facilitator
          </span>
          <select
            className={`${fieldClass} w-full`}
            value={facilitator}
            onChange={(e) => setFacilitator(e.target.value)}
          >
            <option value="">Unassigned</option>
            {staffOptions.map((s) => (
              <option key={s.userId} value={s.userId}>
                {s.name}
                {s.roleLabel ? ` · ${s.roleLabel}` : ""}
              </option>
            ))}
          </select>
        </label>
        <div className="block text-[11px]">
          <span className="mb-1 block font-bold uppercase tracking-[0.1em] text-navy-3">
            Cadence override
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-[12px] text-navy-2">
              <input
                type="checkbox"
                checked={override}
                onChange={(e) => setOverride(e.target.checked)}
              />
              Override school cadence
            </label>
            {override && (
              <>
                <select
                  className={fieldClass}
                  value={freq}
                  onChange={(e) => setFreq(e.target.value)}
                >
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
          </div>
        </div>
      </div>

      <label className="mt-4 block text-[11px]">
        <span className="mb-1 block font-bold uppercase tracking-[0.1em] text-navy-3">
          Term focus · optional
        </span>
        <textarea
          className={`${fieldClass} w-full`}
          rows={2}
          maxLength={500}
          placeholder="What this PLC is working on this semester (free text)…"
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
        />
      </label>

      <div className="mt-4 text-[11px]">
        <span className="mb-1 block font-bold uppercase tracking-[0.1em] text-navy-3">
          Members · optional
        </span>
        <div className="max-h-44 overflow-y-auto rounded-md border border-border bg-surface p-2">
          {staffOptions.length === 0 && (
            <div className="px-1 py-1.5 italic text-navy-3">No staff to add yet.</div>
          )}
          {staffOptions.map((s) => (
            <label
              key={s.userId}
              className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[12px] text-navy-2 hover:bg-bg"
            >
              <input
                type="checkbox"
                checked={members.has(s.userId)}
                onChange={() => toggleMember(s.userId)}
              />
              {s.name}
              {s.roleLabel ? <span className="text-navy-3"> · {s.roleLabel}</span> : null}
            </label>
          ))}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={submit}
          disabled={pending || name.trim() === ""}
          className="rounded-md bg-navy px-4 py-2 text-xs font-semibold text-bg hover:bg-navy-deep disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create PLC"}
        </button>
        <button
          onClick={() => {
            reset();
            setOpen(false);
          }}
          disabled={pending}
          className="rounded-md border border-border-2 bg-surface px-3.5 py-2 text-xs font-semibold text-navy disabled:opacity-50"
        >
          Cancel
        </button>
        {error && <p className="text-xs font-semibold text-terra">{error}</p>}
      </div>
    </div>
  );
}
