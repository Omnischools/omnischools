"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { recordGateCheck, runUnaccountedChecks } from "@/lib/actions/boarding-resumption";
import type { BoarderOption } from "@/lib/boarding/resumption-data";
import type { BoardingMode, ChecklistItem, ChecklistState } from "@/lib/boarding/resumption";

type Result = { ok: boolean; error?: string; message?: string };

const btn = "rounded-md border px-2.5 py-1 text-[11px] font-semibold disabled:opacity-50";
const btnPlain = `${btn} border-border-2 bg-surface text-navy hover:bg-bg`;
const btnPrimary = `${btn} border-navy bg-navy text-bg`;
const btnGold = `${btn} border-gold bg-gold text-navy`;

function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const run = (fn: () => Promise<Result>, done?: () => void) => {
    setError(null);
    setNote(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong.");
      else {
        setNote(res.message ?? null);
        done?.();
        router.refresh();
      }
    });
  };
  return { pending, error, note, run };
}

/** The Resumption↔Vacation tab switch — plain links, ?date preserved (Lucy: one surface, mode enum). */
export function ModeSwitch({ mode, dateIso }: { mode: BoardingMode; dateIso: string }) {
  const q = `?date=${dateIso}`;
  const tab = (m: BoardingMode, label: string) => {
    const active = m === mode;
    return (
      <Link
        href={`/senior/boarding/operations/${m.toLowerCase()}${q}`}
        className={`rounded-md px-3.5 py-1.5 text-[11px] font-semibold ${
          active ? "bg-navy text-bg" : "text-navy-3 hover:text-navy"
        }`}
      >
        {label}
      </Link>
    );
  };
  return (
    <div className="flex gap-1 rounded-lg border border-border bg-surface p-[3px]">
      {tab("RESUMPTION", "Resumption")}
      {tab("VACATION", "Vacation")}
    </div>
  );
}

/** Header CTAs — the unaccounted reminder sweep (console SMS) + the derive-only gate-close note. */
export function HeaderActions({ mode }: { mode: BoardingMode }) {
  const { pending, error, note, run } = useAction();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {note && <span className="text-[11px] text-navy-3">{note}</span>}
      {error && <span className="text-[11px] text-terra">{error}</span>}
      {mode === "RESUMPTION" && (
        <button
          className={btnPlain}
          disabled={pending}
          onClick={() => run(() => runUnaccountedChecks())}
        >
          Send unaccounted reminder SMS
        </button>
      )}
      <button
        className={btnGold}
        title="The gate-close/lock-down state is derived from the clock, not stored (no window-state row)."
        disabled
      >
        {mode === "RESUMPTION" ? "Close gate at 6 PM" : "Lock down at 6 PM"}
      </button>
    </div>
  );
}

const STATES: { key: ChecklistState; label: string; cls: string }[] = [
  { key: "ok", label: "OK", cls: "bg-green-bg text-green border-green" },
  { key: "partial", label: "Partial", cls: "bg-warn-bg text-warn border-warn" },
  { key: "missing", label: "Missing", cls: "bg-terra-bg text-terra border-terra" },
];

/**
 * The gate-check modal (the surface's 90-second scan → mark → auto-fee/bunk → SMS write path). Pick a
 * boarder, mark each checklist item ok/partial/missing, add an optional note, submit — the action
 * upserts the arrival row, freezes the fee snapshot (flag never blocks) and fires the console SMS.
 */
export function GateCheckPanel({
  mode,
  boarders,
  items,
}: {
  mode: BoardingMode;
  boarders: BoarderOption[];
  items: ChecklistItem[];
}) {
  const { pending, error, note, run } = useAction();
  const [open, setOpen] = useState(false);
  const [studentId, setStudentId] = useState("");
  const [checklist, setChecklist] = useState<Record<string, ChecklistState>>(() =>
    Object.fromEntries(items.map((it) => [it.key, "ok" as ChecklistState])),
  );
  const [noteText, setNoteText] = useState("");

  const reset = () => {
    setStudentId("");
    setChecklist(Object.fromEntries(items.map((it) => [it.key, "ok" as ChecklistState])));
    setNoteText("");
  };

  function submit() {
    run(
      () =>
        recordGateCheck({
          studentId,
          mode,
          checklist,
          note: noteText.trim() || undefined,
        }),
      () => {
        reset();
      },
    );
  }

  if (!open) {
    return (
      <div className="flex items-center gap-2">
        {note && <span className="text-[11px] text-green">{note}</span>}
        <button className={btnPrimary} onClick={() => setOpen(true)}>
          {mode === "RESUMPTION" ? "Record arrival (gate check)" : "Record departure"}
        </button>
      </div>
    );
  }

  const selected = boarders.find((b) => b.id === studentId);
  const input = "w-full rounded-md border border-border-2 bg-surface px-2.5 py-1.5 text-[13px]";

  return (
    <div className="w-full rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="font-display text-base font-semibold text-navy">
          {mode === "RESUMPTION" ? "Gate check · record arrival" : "Departure check"}
        </h4>
        <button
          className={btnPlain}
          onClick={() => {
            setOpen(false);
            reset();
          }}
        >
          Cancel
        </button>
      </div>

      <label className="text-[11px] font-semibold uppercase tracking-wide text-navy-3">
        Boarder
        <select className={input} value={studentId} onChange={(e) => setStudentId(e.target.value)}>
          <option value="">Select a boarder…</option>
          {boarders.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} · {b.formLabel} · {b.houseName}
              {b.checkedIn ? " · re-scan" : ""}
            </option>
          ))}
        </select>
      </label>
      {selected?.checkedIn && (
        <p className="mt-1 text-[11px] text-warn">
          Already checked in — recording again updates the one row (idempotent re-scan).
        </p>
      )}

      <div className="mt-3">
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-navy-3">
          {mode === "RESUMPTION" ? "GES prospectus · 6 items" : "Departure checklist · 5 items"}
        </div>
        <div className="flex flex-col gap-1.5">
          {items.map((it) => (
            <div
              key={it.key}
              className="grid grid-cols-[1fr_auto] items-center gap-2 rounded-md border border-border bg-bg px-3 py-1.5"
            >
              <span className="text-[12px] font-semibold text-navy">{it.label}</span>
              <div className="flex gap-1">
                {STATES.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setChecklist((c) => ({ ...c, [it.key]: s.key }))}
                    className={`rounded-pill border px-2 py-0.5 text-[10px] font-semibold ${
                      checklist[it.key] === s.key ? s.cls : "border-border-2 bg-surface text-navy-3"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-navy-3">
        Note {mode === "RESUMPTION" ? "(transport delay · conditional admission · social-services)" : "(transport contact · follow-up)"}
        <textarea
          className={input}
          rows={2}
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          placeholder="Optional — the one lean issue note"
        />
      </label>

      <p className="mt-2 text-[11px] text-navy-3">
        Fees are read live and <b>frozen as a flag</b> — a fee-owing boarder is still admitted (GES
        cannot-detain). The bunk is confirmed from the live allocation. A confirmation SMS fires to the
        parent on the first check-in (console provider).
      </p>
      {error && <p className="mt-2 text-[12px] text-terra">{error}</p>}
      <div className="mt-3 flex justify-end">
        <button className={btnPrimary} disabled={pending || !studentId} onClick={submit}>
          {pending ? "Recording…" : mode === "RESUMPTION" ? "Confirm arrival" : "Confirm departure"}
        </button>
      </div>
    </div>
  );
}
