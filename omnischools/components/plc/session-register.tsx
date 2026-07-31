"use client";
/**
 * PLC session register — client interactives (SHS module 4.6 / INCR-48): the present-by-default P/L/A
 * attendance register, the facilitator's live agenda checklist, the "open session" affordance, and the
 * reflection panel (a member submits their OWN 3 answers; the facilitator confirms). Everything else on
 * the register is server-rendered. Each component takes plain serializable props (NEVER the DB driver) and
 * calls the gated server actions; the server re-checks the facilitator gate + the auto-lock + the
 * reflection window, so a disabled control is a convenience, not the boundary.
 *
 * No-alpha token care ([[no-alpha-token-opacity]]): the P/L/A rows + reflection chips use the dedicated
 * `-bg` tint tokens (green-bg / warn-bg / terra-bg / gold-bg) + solid dot colours — never a slash-opacity
 * on a raw-hex token.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PlcSessionMemberView, PlcAgendaItem } from "@/lib/plc/session-data";
import type { PlcReflectionState } from "@/lib/plc/points";
import {
  confirmReflection,
  editAgenda,
  markAttendance,
  openSession,
  submitReflection,
} from "@/lib/actions/plc-session";

type Status = "present" | "late" | "absent";
const STATUS_ENUM: Record<Status, "PRESENT" | "LATE" | "ABSENT"> = {
  present: "PRESENT",
  late: "LATE",
  absent: "ABSENT",
};

// ── open session ────────────────────────────────────────────────────────────────────────────────────

export function PlcOpenSessionForm({ plcId, date }: { plcId: string; date: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        type="button"
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await openSession({ plcId, date });
            if (!res.ok) setError(res.error ?? "Could not open the session.");
            else router.refresh();
          })
        }
        disabled={pending}
        className="rounded-md border border-gold bg-gold px-4 py-2 text-xs font-bold text-navy hover:brightness-95 disabled:opacity-60"
      >
        {pending ? "Opening…" : "Open session"}
      </button>
      {error && <p className="mt-2 text-[12px] text-terra">{error}</p>}
    </div>
  );
}

// ── attendance register (present-by-default) ─────────────────────────────────────────────────────────

const REFLECTION_CHIP: Record<PlcReflectionState, { dot: string; text: string; label: string }> = {
  na: { dot: "bg-border-2", text: "text-navy-3", label: "Reflection N/A" },
  pending: { dot: "bg-warn", text: "text-warn", label: "Reflection pending" },
  submitted: { dot: "bg-gold", text: "text-gold", label: "Reflection submitted" },
  confirmed: { dot: "bg-green", text: "text-green", label: "Reflection confirmed" },
};

function rowTokens(status: Status): string {
  if (status === "absent") return "border-terra bg-terra-bg";
  if (status === "late") return "border-warn bg-warn-bg";
  return "border-green bg-green-bg";
}

export function PlcAttendanceRegister({
  sessionId,
  members: initial,
  canEdit,
}: {
  sessionId: string;
  members: PlcSessionMemberView[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [members, setMembers] = useState(initial);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const setStatus = (userId: string, status: Status) => {
    if (!canEdit || pending) return;
    const prev = members;
    setMembers((ms) => ms.map((m) => (m.userId === userId ? { ...m, status } : m)));
    start(async () => {
      setError(null);
      const res = await markAttendance({ sessionId, userId, status: STATUS_ENUM[status] });
      if (!res.ok) {
        setMembers(prev);
        setError(res.error ?? "Could not save that mark.");
      } else {
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-2">
      {members.map((m) => {
        const chip = REFLECTION_CHIP[m.reflectionState];
        return (
          <div
            key={m.userId}
            className={`grid grid-cols-[40px_1fr_auto] items-center gap-3 rounded-lg border px-3 py-2.5 sm:grid-cols-[40px_1fr_160px_auto] ${rowTokens(m.status)}`}
          >
            <span
              className={`grid h-9 w-9 place-items-center rounded-full font-display text-[12px] font-semibold ${
                m.isFacilitator ? "bg-navy text-gold" : "bg-gold-bg text-gold"
              }`}
            >
              {m.initials}
            </span>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold text-navy">{m.name}</div>
              <div className="truncate text-[11px] text-navy-3">
                {m.roleLabel}
                {m.isFacilitator && (
                  <span className="ml-1.5 rounded-pill bg-navy px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.04em] text-gold">
                    Facilitator
                  </span>
                )}
              </div>
            </div>
            <div className={`hidden items-center gap-1.5 text-[10px] sm:flex ${chip.text}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${chip.dot}`} aria-hidden />
              {chip.label}
            </div>
            <div className="flex gap-1">
              {(["present", "late", "absent"] as const).map((s) => {
                const active = m.status === s;
                const tone = active
                  ? s === "absent"
                    ? "bg-terra text-bg border-terra"
                    : s === "late"
                      ? "bg-warn text-bg border-warn"
                      : "bg-green text-bg border-green"
                  : "bg-surface text-navy-3 border-border-2";
                const Tag = canEdit ? "button" : "div";
                return (
                  <Tag
                    key={s}
                    {...(canEdit ? { type: "button" as const, onClick: () => setStatus(m.userId, s), disabled: pending } : {})}
                    className={`grid h-7 w-7 place-items-center rounded-md border text-[12px] font-bold ${tone} ${
                      canEdit ? "hover:brightness-95 disabled:opacity-60" : ""
                    }`}
                    title={canEdit ? `Mark ${s}` : undefined}
                  >
                    {s.charAt(0).toUpperCase()}
                  </Tag>
                );
              })}
            </div>
          </div>
        );
      })}
      {error && <p className="text-[12px] text-terra">{error}</p>}
      {!canEdit && (
        <p className="text-[12px] italic text-navy-3">
          The register is read-only — only the PLC facilitator can mark it while the session is live.
        </p>
      )}
    </div>
  );
}

// ── agenda checklist (facilitator-authored, tick live) ───────────────────────────────────────────────

export function PlcAgendaChecklist({
  sessionId,
  items: initial,
  canEdit,
}: {
  sessionId: string;
  items: PlcAgendaItem[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newText, setNewText] = useState("");
  const [newMin, setNewMin] = useState("");

  const persist = (next: PlcAgendaItem[]) => {
    const prev = items;
    setItems(next);
    start(async () => {
      setError(null);
      const res = await editAgenda({ sessionId, items: next });
      if (!res.ok) {
        setItems(prev);
        setError(res.error ?? "Could not save the agenda.");
      } else {
        router.refresh();
      }
    });
  };

  const toggle = (i: number) => {
    if (!canEdit || pending) return;
    persist(items.map((it, idx) => (idx === i ? { ...it, done: !it.done } : it)));
  };
  const remove = (i: number) => {
    if (!canEdit || pending) return;
    persist(items.filter((_, idx) => idx !== i));
  };
  const add = () => {
    const text = newText.trim();
    if (!text || pending) return;
    const durationMin = newMin.trim() ? Math.max(0, Math.min(600, parseInt(newMin, 10) || 0)) : null;
    setNewText("");
    setNewMin("");
    persist([...items, { text, durationMin, done: false }]);
  };

  const doneCount = items.filter((i) => i.done).length;

  return (
    <div className="rounded-2xl border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5 text-[11px] font-semibold text-navy-3">
        <span>Tick each item as you go</span>
        <span className="font-display text-sm text-navy">
          <em className="not-italic text-gold">{doneCount}</em> / {items.length} done
        </span>
      </div>
      {items.length === 0 && (
        <p className="px-4 py-4 text-[13px] italic text-navy-3">
          No agenda items yet.{canEdit ? " Add the running order below." : ""}
        </p>
      )}
      {items.map((it, i) => (
        <div key={i} className="flex items-start gap-3 border-b border-border px-4 py-3 last:border-b-0">
          <button
            type="button"
            onClick={() => toggle(i)}
            disabled={!canEdit || pending}
            aria-pressed={it.done}
            className={`mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded border text-[11px] font-bold ${
              it.done ? "border-green bg-green text-bg" : "border-border-2 bg-surface text-transparent"
            } ${canEdit ? "hover:brightness-95 disabled:opacity-60" : ""}`}
          >
            ✓
          </button>
          <div className={`flex-1 text-[13px] leading-snug ${it.done ? "text-navy-3 line-through" : "text-navy-2"}`}>
            {it.text}
          </div>
          {it.durationMin != null && (
            <span className="shrink-0 font-mono text-[10px] text-navy-3">{it.durationMin} min</span>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={() => remove(i)}
              disabled={pending}
              className="shrink-0 text-[13px] text-navy-3 hover:text-terra disabled:opacity-60"
              title="Remove item"
            >
              ×
            </button>
          )}
        </div>
      ))}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
          <input
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="Add an agenda item…"
            maxLength={200}
            className="min-w-[220px] flex-1 rounded-md border border-border-2 bg-surface px-3 py-2 text-[13px] text-navy"
          />
          <input
            value={newMin}
            onChange={(e) => setNewMin(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="min"
            inputMode="numeric"
            className="w-16 rounded-md border border-border-2 bg-surface px-2 py-2 text-[13px] text-navy"
          />
          <button
            type="button"
            onClick={add}
            disabled={pending || !newText.trim()}
            className="rounded-md border border-border-2 bg-surface px-3 py-2 text-[12px] font-semibold text-navy hover:bg-gold-bg disabled:opacity-60"
          >
            Add
          </button>
        </div>
      )}
      {error && <p className="px-4 pb-3 text-[12px] text-terra">{error}</p>}
    </div>
  );
}

// ── reflection panel (member submit + facilitator confirm) ───────────────────────────────────────────

export function PlcReflectionPanel({
  sessionId,
  questions,
  viewer,
  windowOpen,
  canConfirm,
  members,
}: {
  sessionId: string;
  questions: readonly string[];
  viewer: { isMember: boolean; isFacilitator: boolean; state: PlcReflectionState | null };
  windowOpen: boolean;
  canConfirm: boolean;
  members: PlcSessionMemberView[];
}) {
  const submitted = members.filter((m) => m.reflection);
  return (
    <div className="space-y-4">
      {/* the viewer's OWN reflection form / status */}
      {viewer.isMember && !viewer.isFacilitator && (
        <ViewerReflection sessionId={sessionId} questions={questions} state={viewer.state} windowOpen={windowOpen} />
      )}

      {/* facilitator confirm list — the submitted reflections + their answers (SHOWN) */}
      {canConfirm && (
        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-gold">
            Confirm reflections · {submitted.filter((m) => m.reflection?.confirmed).length} of {submitted.length} confirmed
          </div>
          {submitted.length === 0 ? (
            <p className="text-[13px] italic text-navy-3">No reflections submitted yet.</p>
          ) : (
            <div className="space-y-3">
              {submitted.map((m) => (
                <ConfirmRow key={m.userId} sessionId={sessionId} member={m} questions={questions} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ViewerReflection({
  sessionId,
  questions,
  state,
  windowOpen,
}: {
  sessionId: string;
  questions: readonly string[];
  state: PlcReflectionState | null;
  windowOpen: boolean;
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState(["", "", ""]);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Already submitted → a status line, no form (append-only).
  if (state === "submitted" || state === "confirmed") {
    return (
      <div className="rounded-xl border border-green bg-green-bg p-4 text-[13px] text-navy-2">
        <b className="font-semibold text-green">Reflection submitted.</b>{" "}
        {state === "confirmed"
          ? "The facilitator has confirmed it — the reflection point is awarded."
          : "Awaiting the facilitator's confirmation in the next session."}
      </div>
    );
  }

  if (!windowOpen) {
    return (
      <div className="rounded-xl border border-border bg-bg p-4 text-[13px] italic text-navy-3">
        The reflection window opens at session close (in-app only). Answer the three questions within the
        window to earn your reflection point.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-green bg-green-bg p-5">
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-green">Your reflection · in-app · within the window</div>
      <p className="mb-3 mt-1 text-[12px] text-navy-2">
        Answer the three questions to earn your reflection point once the facilitator confirms it.
      </p>
      {questions.map((q, i) => (
        <label key={i} className="mb-3 block">
          <span className="mb-1 block text-[12px] font-semibold text-navy">
            Q{i + 1} · {q}
          </span>
          <textarea
            value={answers[i]}
            onChange={(e) => setAnswers((a) => a.map((v, idx) => (idx === i ? e.target.value : v)))}
            rows={2}
            maxLength={2000}
            className="w-full rounded-md border border-border-2 bg-surface px-3 py-2 text-[13px] text-navy"
          />
        </label>
      ))}
      <button
        type="button"
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await submitReflection({ sessionId, q1: answers[0], q2: answers[1], q3: answers[2] });
            if (!res.ok) setError(res.error ?? "Could not submit the reflection.");
            else router.refresh();
          })
        }
        disabled={pending || answers.some((a) => !a.trim())}
        className="rounded-md border border-green bg-green px-4 py-2 text-xs font-bold text-bg hover:brightness-95 disabled:opacity-60"
      >
        {pending ? "Submitting…" : "Submit reflection"}
      </button>
      {error && <p className="mt-2 text-[12px] text-terra">{error}</p>}
    </div>
  );
}

function ConfirmRow({
  sessionId,
  member,
  questions,
}: {
  sessionId: string;
  member: PlcSessionMemberView;
  questions: readonly string[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const refl = member.reflection!;
  const answers = [refl.q1, refl.q2, refl.q3];
  return (
    <div className="rounded-xl border border-border bg-bg p-3">
      <div className="flex items-center justify-between">
        <div className="text-[12px] font-semibold text-navy">
          {member.name} <span className="font-normal text-navy-3">· {refl.submittedLabel}</span>
        </div>
        {refl.confirmed ? (
          <span className="rounded-pill bg-green-bg px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.04em] text-green">
            Confirmed
          </span>
        ) : (
          <button
            type="button"
            onClick={() =>
              start(async () => {
                setError(null);
                const res = await confirmReflection({ sessionId, userId: member.userId });
                if (!res.ok) setError(res.error ?? "Could not confirm.");
                else router.refresh();
              })
            }
            disabled={pending}
            className="rounded-md border border-gold bg-gold px-3 py-1.5 text-[11px] font-bold text-navy hover:brightness-95 disabled:opacity-60"
          >
            {pending ? "Confirming…" : "Confirm"}
          </button>
        )}
      </div>
      <div className="mt-2 space-y-1.5">
        {answers.map((a, i) => (
          <div key={i} className="text-[12px] leading-snug text-navy-2">
            <b className="font-semibold text-navy-3">Q{i + 1}.</b> {a || <em className="italic text-navy-3">—</em>}
          </div>
        ))}
      </div>
      {error && <p className="mt-1 text-[12px] text-terra">{error}</p>}
    </div>
  );
}
