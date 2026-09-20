"use client";
/**
 * 🔴 INCR-43a — the CONFIDENTIAL casework WRITE affordances (SHS module 4.5). Rendered by the journal
 * page ONLY for a gated viewer (own-class FM / Dean) — the whole page is behind the pastoral gate, so a
 * non-gated viewer never mounts this. Every submit calls a server action that RE-CHECKS the gate
 * (`canWritePastoralFlag`), so the disabled/hidden control is convenience; the action is the boundary.
 *
 * APPEND-ONLY chrome: the three streams (entry / note / observation) have an ADD affordance only — there
 * is NO edit and NO delete control anywhere (the "a journal that cannot be edited can be trusted"
 * contract). The case summary is the SOLE editable surface: open once per flag, then revise in place.
 *
 * No-alpha token discipline (memory `no-alpha-token-opacity`): every terra/gold tint is a SOLID token
 * (`bg-terra-bg` / `border-terra` / `bg-gold` / `text-gold`), never a slash-opacity — the 42b
 * `pastoral-flag.tsx` idiom, reused.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createJournalEntry,
  createPastoralNote,
  createObservation,
  createCase,
  editCase,
} from "@/lib/actions/vlc-casework";

type Kind = "entry" | "note" | "observation";

const TABS: { kind: Kind; label: string; placeholder: string }[] = [
  { kind: "entry", label: "Add entry", placeholder: "Record the reflection the student shared…" },
  { kind: "note", label: "Add note", placeholder: "A private FM / Dean note on this student…" },
  { kind: "observation", label: "Record observation", placeholder: "What the Peer Guide observed…" },
];

/** The three append-only composers (entry / note / observation) — one open at a time. */
export function CaseworkComposer({ studentId }: { studentId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState<Kind | null>(null);
  const [body, setBody] = useState("");
  const [observedBy, setObservedBy] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setBody("");
    setObservedBy("");
    setError(null);
  };

  const submit = () => {
    if (pending || !open) return;
    setError(null);
    start(async () => {
      const res =
        open === "entry"
          ? await createJournalEntry({ studentId, body })
          : open === "note"
            ? await createPastoralNote({ studentId, body })
            : await createObservation({ studentId, observedBy, body });
      if (!res.ok) setError(res.error ?? "Could not save.");
      else {
        setOpen(null);
        reset();
        router.refresh();
      }
    });
  };

  const active = TABS.find((t) => t.kind === open);

  return (
    <div className="mb-6 rounded-xl border-[1.5px] border-gold-soft bg-gold-bg px-[22px] py-[18px]">
      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t.kind}
            type="button"
            onClick={() => {
              setOpen((v) => (v === t.kind ? null : t.kind));
              reset();
            }}
            className={`rounded-md border px-3 py-1.5 text-[11px] font-bold ${
              open === t.kind
                ? "border-gold bg-gold text-navy"
                : "border-gold-soft bg-surface text-gold hover:bg-gold-bg"
            }`}
          >
            {open === t.kind ? "Cancel" : t.label}
          </button>
        ))}
        <span className="ml-auto text-[10px] font-bold uppercase tracking-[0.08em] text-gold">
          Append-only · FM + Dean only
        </span>
      </div>

      {active && (
        <div className="mt-3">
          {open === "observation" && (
            <label className="mb-2 flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-navy-2">
              Peer Guide{" "}
              <span className="normal-case text-navy-3">(named as data — the PG does not log in)</span>
              <input
                type="text"
                value={observedBy}
                maxLength={80}
                onChange={(e) => setObservedBy(e.target.value)}
                placeholder="Prince Otoo (PG · boys' rep)"
                className="rounded-md border border-border-2 bg-surface px-3 py-2 text-[13px] font-normal normal-case text-navy"
              />
            </label>
          )}
          <textarea
            value={body}
            maxLength={4000}
            rows={4}
            onChange={(e) => setBody(e.target.value)}
            placeholder={active.placeholder}
            className="w-full rounded-md border border-border-2 bg-surface px-3 py-2 text-[13px] leading-relaxed text-navy"
          />
          <button
            type="button"
            onClick={submit}
            disabled={pending || !body.trim() || (open === "observation" && !observedBy.trim())}
            className="mt-2 rounded-md border border-gold bg-gold px-4 py-2 text-xs font-bold text-navy hover:brightness-95 disabled:opacity-60"
          >
            {pending ? "Saving…" : active.label}
          </button>
          {error && <p className="mt-2 text-[12px] text-terra">{error}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * The case-file summary editor — the ONE mutable surface. Opens the 1:1 case on a flag (createCase), or
 * revises the running summary in place (editCase). No delete.
 */
export function CaseEditor({
  activeCase,
  openableFlags,
}: {
  activeCase: { flagId: string; summary: string } | null;
  openableFlags: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [summary, setSummary] = useState(activeCase?.summary ?? "");
  const [flagId, setFlagId] = useState(openableFlags[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);

  // Nothing to act on: no case open and no flag to open one against.
  if (!activeCase && openableFlags.length === 0) return null;

  const submit = () => {
    if (pending) return;
    setError(null);
    start(async () => {
      const res = activeCase
        ? await editCase({ flagId: activeCase.flagId, summary })
        : await createCase({ flagId, summary });
      if (!res.ok) setError(res.error ?? "Could not save the case.");
      else {
        setEditing(false);
        router.refresh();
      }
    });
  };

  if (!editing) {
    return (
      <div className="mt-3">
        <button
          type="button"
          onClick={() => {
            setSummary(activeCase?.summary ?? "");
            setEditing(true);
            setError(null);
          }}
          className="rounded-md border border-terra px-3 py-1.5 text-[11px] font-bold text-terra hover:bg-terra-bg"
        >
          {activeCase ? "Edit case-file summary" : "Open a case"}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-lg border-[1.5px] border-terra bg-terra-bg p-3">
      {!activeCase && (
        <label className="mb-2 flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-navy-2">
          Anchor flag
          <select
            value={flagId}
            onChange={(e) => setFlagId(e.target.value)}
            className="rounded-md border border-border-2 bg-surface px-3 py-2 text-[13px] font-normal normal-case text-navy"
          >
            {openableFlags.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <textarea
        value={summary}
        maxLength={8000}
        rows={6}
        onChange={(e) => setSummary(e.target.value)}
        placeholder="The FM-maintained case picture — revised in place, never versioned…"
        className="w-full rounded-md border border-border-2 bg-surface px-3 py-2 text-[13px] leading-relaxed text-navy"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending || !summary.trim() || (!activeCase && !flagId)}
          className="rounded-md border border-terra bg-terra px-4 py-2 text-xs font-bold text-bg hover:brightness-95 disabled:opacity-60"
        >
          {pending ? "Saving…" : activeCase ? "Save revision" : "Open case"}
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="rounded-md border border-border-2 bg-bg px-3 py-2 text-xs font-bold text-navy hover:brightness-95"
        >
          Cancel
        </button>
      </div>
      {error && <p className="mt-2 text-[12px] text-terra">{error}</p>}
    </div>
  );
}
