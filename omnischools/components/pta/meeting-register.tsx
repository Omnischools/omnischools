"use client";
/**
 * PTA meeting-register client interactives (SHS module 4.7 / INCR-52) — the DUAL teacher/parent register
 * (the teacher arm ports the PLC PlcAttendanceRegister VERBATIM; the parent arm adapts it for absent-by-
 * default + search + "show absent only" + pagination), the quorum panel (the Secretary's judgment stamp),
 * the agenda checklist, and the convene form. Each takes plain serializable props (NEVER the DB driver) and
 * calls the gated server actions; the server re-checks the officer write-gate + the auto-lock, so a disabled
 * control is a convenience, not the boundary — a viewer who can't write gets a READ-ONLY render (P/L/A as
 * <div> not <button> + an italic notice, the PLC pattern).
 *
 * No-alpha token care ([[no-alpha-token-opacity]]): P/L/A rows use the dedicated `-bg` tint tokens
 * (green-bg / warn-bg / terra-bg) + solid dot colours; the navy foot bar uses `text-gold-soft`, never a
 * slash-opacity on a raw-hex token.
 */
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PtaTeacherRow, PtaParentRow, PtaAgendaItem, RegisterStatus } from "@/lib/pta/meeting-data";
import type { ConvenablePta, StaffOption } from "@/lib/pta/meeting-data";
import {
  conveneMeeting,
  conveneEmergencyMeeting,
  editAgenda,
  markAttendance,
  stampQuorum,
} from "@/lib/actions/pta-meeting";

type Pick = "present" | "late" | "absent";
const STATUS_ENUM: Record<Pick, "PRESENT" | "LATE" | "ABSENT"> = { present: "PRESENT", late: "LATE", absent: "ABSENT" };

/** The display status the server will derive AFTER a mark (mirrors the reader's polarity). */
function displayAfter(register: "TEACHER" | "PARENT", pick: Pick, closed: boolean): RegisterStatus {
  if (register === "PARENT" && pick === "absent") return closed ? "absent" : "awaiting";
  return pick;
}

function rowTint(status: RegisterStatus): string {
  if (status === "absent") return "border-terra bg-terra-bg";
  if (status === "late") return "border-warn bg-warn-bg";
  if (status === "present") return "border-green bg-green-bg";
  return "border-border bg-surface"; // awaiting / unmarked
}

// ── shared: one register row with the P/L/A cluster ──────────────────────────────────────────────────

interface UiRow {
  id: string;
  name: string;
  initials: string;
  context: string;
  status: RegisterStatus;
  officerTag: string | null;
  officerExOfficio: boolean;
}

function RegisterRow({
  row,
  teacher,
  canWrite,
  pending,
  onPick,
}: {
  row: UiRow;
  teacher: boolean;
  canWrite: boolean;
  pending: boolean;
  onPick: (pick: Pick) => void;
}) {
  return (
    <div className={`grid grid-cols-[36px_1fr_auto] items-center gap-3 rounded-lg border px-3 py-2.5 ${rowTint(row.status)}`}>
      <span
        className={`grid h-9 w-9 place-items-center rounded-full font-display text-[12px] font-semibold ${
          teacher ? "bg-navy text-gold" : "bg-gold-bg text-gold"
        }`}
      >
        {row.initials}
      </span>
      <div className="min-w-0">
        <div className="truncate text-[13px] font-semibold text-navy">{row.name}</div>
        <div className="truncate text-[11px] text-navy-3">
          {row.context}
          {row.officerTag && (
            <span
              className={`ml-1.5 rounded-pill px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.04em] ${
                row.officerExOfficio ? "bg-green text-bg" : "bg-gold text-navy"
              }`}
            >
              {row.officerTag}
            </span>
          )}
        </div>
      </div>
      <div className="flex gap-1">
        {(["present", "late", "absent"] as const).map((s) => {
          // "awaiting" (unmarked parent while live) lights no button; every other status maps 1:1.
          const active = row.status === s;
          const tone = active
            ? s === "absent"
              ? "bg-terra text-bg border-terra"
              : s === "late"
                ? "bg-warn text-bg border-warn"
                : "bg-green text-bg border-green"
            : "bg-surface text-navy-3 border-border-2";
          const Tag = canWrite ? "button" : "div";
          return (
            <Tag
              key={s}
              {...(canWrite ? { type: "button" as const, onClick: () => onPick(s), disabled: pending } : {})}
              className={`grid h-7 w-7 place-items-center rounded-md border text-[12px] font-bold ${tone} ${
                canWrite ? "hover:brightness-95 disabled:opacity-60" : ""
              }`}
              title={canWrite ? `Mark ${s}` : undefined}
            >
              {s.charAt(0).toUpperCase()}
            </Tag>
          );
        })}
      </div>
    </div>
  );
}

// ── the dual register (teacher arm + parent arm) ─────────────────────────────────────────────────────

export function PtaDualRegister({
  meetingId,
  teacherRows,
  parentRows,
  canWrite,
  closed,
}: {
  meetingId: string;
  teacherRows: PtaTeacherRow[];
  parentRows: PtaParentRow[];
  canWrite: boolean;
  closed: boolean;
}) {
  const router = useRouter();
  const [teachers, setTeachers] = useState<UiRow[]>(() => teacherRows.map((r) => ({ ...r, id: r.userId })));
  const [parents, setParents] = useState<UiRow[]>(() => parentRows.map((r) => ({ ...r, id: r.studentGuardianId })));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [absentOnly, setAbsentOnly] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const PAGE = 12;

  const mark = (register: "TEACHER" | "PARENT", id: string, pick: Pick) => {
    if (!canWrite || pending) return;
    const target = displayAfter(register, pick, closed);
    const set = register === "TEACHER" ? setTeachers : setParents;
    const prevT = teachers;
    const prevP = parents;
    set((rs) => rs.map((r) => (r.id === id ? { ...r, status: target } : r)));
    start(async () => {
      setError(null);
      const payload =
        register === "TEACHER"
          ? { meetingId, register, userId: id, status: STATUS_ENUM[pick] }
          : { meetingId, register, studentGuardianId: id, status: STATUS_ENUM[pick] };
      const res = await markAttendance(payload);
      if (!res.ok) {
        setTeachers(prevT);
        setParents(prevP);
        setError(res.error ?? "Could not save that mark.");
      } else {
        router.refresh();
      }
    });
  };

  const teacherPresent = teachers.filter((r) => r.status === "present" || r.status === "late").length;
  const parentPresent = parents.filter((r) => r.status === "present" || r.status === "late").length;

  const visibleParents = useMemo(() => {
    let v = parents;
    const q = query.trim().toLowerCase();
    if (q) v = v.filter((r) => `${r.name} ${r.context}`.toLowerCase().includes(q));
    if (absentOnly) v = v.filter((r) => r.status === "absent" || r.status === "awaiting");
    return v;
  }, [parents, query, absentOnly]);
  const shownParents = showAll ? visibleParents : visibleParents.slice(0, PAGE);

  return (
    <div className="grid grid-cols-1 gap-0 overflow-hidden rounded-2xl border border-border lg:grid-cols-2">
      {/* Teachers */}
      <div className="border-b border-border bg-bg p-5 lg:border-b-0 lg:border-r">
        <div className="mb-4 flex items-end justify-between border-b border-border pb-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-navy">Register one of two</div>
            <h3 className="font-display text-lg font-semibold text-navy">
              Teachers <em className="italic text-navy-3">· {teachers.length} expected</em>
            </h3>
          </div>
          <div className="text-right">
            <div className="font-display text-xl font-semibold text-navy">
              <em className="not-italic text-gold">{teacherPresent}</em> / {teachers.length}
            </div>
            <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-navy-3">Present · by default</div>
          </div>
        </div>
        <div className="space-y-2">
          {teachers.length === 0 ? (
            <p className="text-[13px] italic text-navy-3">No teachers on this register yet.</p>
          ) : (
            teachers.map((r) => (
              <RegisterRow key={r.id} row={r} teacher canWrite={canWrite} pending={pending} onPick={(p) => mark("TEACHER", r.id, p)} />
            ))
          )}
        </div>
      </div>

      {/* Parents */}
      <div className="bg-surface p-5">
        <div className="mb-4 flex items-end justify-between border-b border-border pb-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">Register two of two</div>
            <h3 className="font-display text-lg font-semibold text-navy">
              Parents <em className="italic text-gold">· {parents.length} expected</em>
            </h3>
          </div>
          <div className="text-right">
            <div className="font-display text-xl font-semibold text-navy">
              <em className="not-italic text-gold">{parentPresent}</em> / {parents.length}
            </div>
            <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-navy-3">
              {closed ? "Final · absent by default" : "Arriving · absent by default"}
            </div>
          </div>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-gold-soft bg-gold-bg px-3 py-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search parent or student…"
            className="min-w-[160px] flex-1 rounded-pill border border-gold-soft bg-surface px-3 py-1.5 text-[11px] text-navy"
          />
          <button
            type="button"
            onClick={() => setAbsentOnly((v) => !v)}
            className={`rounded-pill border px-3 py-1.5 text-[10px] font-semibold ${
              absentOnly ? "border-terra bg-terra text-bg" : "border-gold-soft bg-surface text-navy"
            }`}
          >
            {closed ? "Show absent only" : "Show awaiting only"}
          </button>
        </div>

        <div className="space-y-2">
          {parents.length === 0 ? (
            <p className="text-[13px] italic text-navy-3">No parents on this register — no primary guardians in scope.</p>
          ) : shownParents.length === 0 ? (
            <p className="text-[13px] italic text-navy-3">No parents match that filter.</p>
          ) : (
            shownParents.map((r) => (
              <RegisterRow key={r.id} row={r} teacher={false} canWrite={canWrite} pending={pending} onPick={(p) => mark("PARENT", r.id, p)} />
            ))
          )}
        </div>
        {!showAll && visibleParents.length > PAGE && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="mt-3 w-full rounded-lg border border-border-2 bg-bg py-2 text-[11px] font-semibold text-navy hover:bg-gold-bg"
          >
            Show all {visibleParents.length} parents
          </button>
        )}
      </div>

      {error && <p className="col-span-full px-5 pb-3 text-[12px] text-terra">{error}</p>}
      {!canWrite && (
        <p className="col-span-full border-t border-border px-5 py-3 text-[12px] italic text-navy-3">
          The register is read-only — only the PTA&rsquo;s Secretary (or an admin) can mark it while the meeting is open.
        </p>
      )}
    </div>
  );
}

// ── quorum panel (the Secretary's nullable judgment, R438) ───────────────────────────────────────────

export function PtaQuorumPanel({
  meetingId,
  ruleText,
  presentCount,
  totalParents,
  pct,
  quorumMet,
  canWrite,
  writeLocked,
}: {
  meetingId: string;
  ruleText: string;
  presentCount: number;
  totalParents: number;
  pct: number | null;
  quorumMet: boolean | null;
  canWrite: boolean;
  writeLocked: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const stamp = (value: boolean | null) => {
    if (!canWrite || pending) return;
    start(async () => {
      setError(null);
      const res = await stampQuorum({ meetingId, quorumMet: value });
      if (!res.ok) setError(res.error ?? "Could not record the quorum judgment.");
      else router.refresh();
    });
  };

  return (
    <div className="rounded-2xl border border-navy bg-navy p-6 text-bg">
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold-soft">Quorum · the Secretary&rsquo;s call</div>
      <div className="mt-2 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center">
        <div>
          <p className="text-[13px] leading-relaxed text-gold-soft">
            <b className="font-semibold text-bg">Rule:</b> {ruleText || "No quorum rule configured for this tier."}
          </p>
          <p className="mt-2 text-[12px] text-gold-soft">
            Present-count (P + L) is DERIVED; whether quorum is <em className="not-italic text-gold">met</em> is your judgment —
            the rule can carry clauses a count can&rsquo;t settle.
          </p>
        </div>
        <div className="text-right">
          <div className="font-display text-3xl font-semibold leading-none text-gold">
            {presentCount}
            <span className="text-lg text-gold-soft"> / {totalParents}</span>
          </div>
          <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.08em] text-gold-soft">
            parents present{pct != null ? ` · ${pct}%` : ""}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/10 pt-4">
        <span className="text-[11px] font-semibold text-gold-soft">Quorum judgment:</span>
        {canWrite && !writeLocked ? (
          <>
            <button
              type="button"
              onClick={() => stamp(true)}
              disabled={pending}
              className={`rounded-md border px-3 py-1.5 text-[11px] font-bold disabled:opacity-60 ${
                quorumMet === true ? "border-green bg-green text-bg" : "border-white/20 bg-white/5 text-bg hover:bg-white/10"
              }`}
            >
              Quorum met
            </button>
            <button
              type="button"
              onClick={() => stamp(false)}
              disabled={pending}
              className={`rounded-md border px-3 py-1.5 text-[11px] font-bold disabled:opacity-60 ${
                quorumMet === false ? "border-terra bg-terra text-bg" : "border-white/20 bg-white/5 text-bg hover:bg-white/10"
              }`}
            >
              Not met
            </button>
            {quorumMet != null && (
              <button
                type="button"
                onClick={() => stamp(null)}
                disabled={pending}
                className="rounded-md border border-white/20 px-3 py-1.5 text-[11px] font-semibold text-gold-soft hover:bg-white/10 disabled:opacity-60"
              >
                Clear
              </button>
            )}
          </>
        ) : (
          <span className="text-[12px] font-semibold text-bg">
            {quorumMet === true ? "Met" : quorumMet === false ? "Not met" : "Not yet decided"}
          </span>
        )}
      </div>
      <p className="mt-3 text-[11px] leading-snug text-gold-soft">
        {quorumMet === true
          ? "Quorum met — binding resolutions can now be recorded in the minutes."
          : "Binding resolutions unlock in the minutes once quorum is confirmed."}
      </p>
      {error && <p className="mt-2 text-[12px] text-terra">{error}</p>}
    </div>
  );
}

// ── agenda checklist (convener-authored, tick live) ──────────────────────────────────────────────────

export function PtaAgendaChecklist({
  meetingId,
  items: initial,
  canWrite,
}: {
  meetingId: string;
  items: PtaAgendaItem[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newText, setNewText] = useState("");

  const persist = (next: PtaAgendaItem[]) => {
    const prev = items;
    setItems(next);
    start(async () => {
      setError(null);
      const res = await editAgenda({ meetingId, items: next });
      if (!res.ok) {
        setItems(prev);
        setError(res.error ?? "Could not save the agenda.");
      } else {
        router.refresh();
      }
    });
  };

  const toggle = (i: number) => {
    if (!canWrite || pending) return;
    persist(items.map((it, idx) => (idx === i ? { ...it, done: !it.done } : it)));
  };
  const remove = (i: number) => {
    if (!canWrite || pending) return;
    persist(items.filter((_, idx) => idx !== i));
  };
  const add = () => {
    const text = newText.trim();
    if (!text || pending) return;
    setNewText("");
    persist([...items, { text, durationMin: null, done: false }]);
  };
  const doneCount = items.filter((i) => i.done).length;

  return (
    <div className="rounded-2xl border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5 text-[11px] font-semibold text-navy-3">
        <span>Agenda · tick each item as you go</span>
        <span className="font-display text-sm text-navy">
          <em className="not-italic text-gold">{doneCount}</em> / {items.length} done
        </span>
      </div>
      {items.length === 0 && (
        <p className="px-4 py-4 text-[13px] italic text-navy-3">
          No agenda items yet.{canWrite ? " Add the running order below." : ""}
        </p>
      )}
      {items.map((it, i) => (
        <div key={i} className="flex items-start gap-3 border-b border-border px-4 py-3 last:border-b-0">
          <button
            type="button"
            onClick={() => toggle(i)}
            disabled={!canWrite || pending}
            aria-pressed={it.done}
            className={`mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded border text-[11px] font-bold ${
              it.done ? "border-green bg-green text-bg" : "border-border-2 bg-surface text-transparent"
            } ${canWrite ? "hover:brightness-95 disabled:opacity-60" : ""}`}
          >
            ✓
          </button>
          <div className={`flex-1 text-[13px] leading-snug ${it.done ? "text-navy-3 line-through" : "text-navy-2"}`}>{it.text}</div>
          {canWrite && (
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
      {canWrite && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
          <input
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="Add an agenda item…"
            maxLength={200}
            className="min-w-[220px] flex-1 rounded-md border border-border-2 bg-surface px-3 py-2 text-[13px] text-navy"
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

// ── convene form (regular ∥ emergency) — SMS + dues DROPPED (R443) ───────────────────────────────────

const fieldClass = "w-full rounded-md border border-border bg-bg px-3 py-2 text-[13px] text-navy";
const labelClass = "mb-1.5 block text-[10px] font-bold uppercase tracking-[0.12em] text-navy-3";

export function PtaConveneForm({
  emergency,
  ptas,
  staff,
}: {
  emergency: boolean;
  ptas: ConvenablePta[];
  staff: StaffOption[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ptaId, setPtaId] = useState(ptas[0]?.ptaId ?? "");
  const [meetingType, setMeetingType] = useState(emergency ? "Emergency PTA meeting" : "Regular PTA meeting");
  const [meetingDate, setMeetingDate] = useState("");
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("12:00");
  const [location, setLocation] = useState("");
  const [agenda, setAgenda] = useState("");
  const [invited, setInvited] = useState<Set<string>>(new Set());

  const toggleInvite = (id: string) =>
    setInvited((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = () => {
    if (pending) return;
    const agendaItems = agenda
      .split("\n")
      .map((l) => l.replace(/^\s*\d+[.)]\s*/, "").trim())
      .filter(Boolean);
    const base = {
      meetingType,
      meetingDate,
      startTime,
      endTime,
      location: location.trim() || null,
      agendaItems,
      invitedTeacherUserIds: [...invited],
    };
    start(async () => {
      setError(null);
      const res = emergency
        ? await conveneEmergencyMeeting(base)
        : await conveneMeeting({ ...base, ptaId });
      if (!res.ok) setError(res.error ?? "Could not convene the meeting.");
      else if (res.meetingId) router.push(`/senior/pta/meetings/${res.meetingId}`);
      else router.push("/senior/pta/meetings");
    });
  };

  const canSubmit = meetingDate && startTime && endTime && meetingType.trim() && (emergency || ptaId);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <div className="rounded-2xl border border-border bg-surface p-6">
        <h3 className="mb-4 border-b border-border pb-3 font-display text-lg font-semibold text-navy">
          Meeting <em className="italic text-gold">details</em>
        </h3>

        {!emergency && (
          <div className="mb-4">
            <label className={labelClass}>Which PTA</label>
            {ptas.length === 0 ? (
              <p className="text-[13px] italic text-terra">
                You are not the Secretary of any PTA — ask an admin to convene, or an admin can use break-glass.
              </p>
            ) : (
              <select value={ptaId} onChange={(e) => setPtaId(e.target.value)} className={fieldClass}>
                {ptas.map((p) => (
                  <option key={p.ptaId} value={p.ptaId}>
                    {p.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        <div className="mb-4">
          <label className={labelClass}>Meeting type</label>
          <input value={meetingType} onChange={(e) => setMeetingType(e.target.value)} maxLength={120} className={fieldClass} />
          <p className="mt-1 text-[11px] italic text-navy-3">A display label only — no logic branches on it.</p>
        </div>

        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className={labelClass}>Date</label>
            <input type="date" value={meetingDate} onChange={(e) => setMeetingDate(e.target.value)} className={fieldClass} />
          </div>
          <div>
            <label className={labelClass}>Start</label>
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={fieldClass} />
          </div>
          <div>
            <label className={labelClass}>End</label>
            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={fieldClass} />
          </div>
        </div>

        <div className="mb-4">
          <label className={labelClass}>Location</label>
          <input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={200} placeholder="e.g. Block C, room 4" className={fieldClass} />
        </div>

        <div className="mb-1">
          <label className={labelClass}>Agenda</label>
          <textarea
            value={agenda}
            onChange={(e) => setAgenda(e.target.value)}
            rows={7}
            placeholder={"1. Welcome and prayer\n2. Reading of last meeting minutes\n3. Academic performance review\n4. AOB\n5. Closing prayer"}
            className={`${fieldClass} min-h-[120px] resize-y`}
          />
          <p className="mt-1 text-[11px] italic text-navy-3">One item per line · editable until the register locks.</p>
        </div>

        {error && <p className="mt-3 text-[12px] text-terra">{error}</p>}
        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            onClick={submit}
            disabled={pending || !canSubmit}
            className="rounded-md border border-navy bg-navy px-5 py-2.5 text-[13px] font-bold text-bg hover:brightness-110 disabled:opacity-50"
          >
            {pending ? "Convening…" : emergency ? "Convene emergency meeting" : "Convene & open register"}
          </button>
          <button
            type="button"
            onClick={() => router.push("/senior/pta/meetings")}
            className="text-[12px] font-semibold text-navy-3 hover:text-navy"
          >
            Cancel
          </button>
        </div>
      </div>

      <aside className="rounded-2xl border border-gold-soft bg-gold-bg p-5">
        <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-gold">Invite teachers</div>
        <h4 className="mb-3 mt-1 font-display text-[15px] font-semibold text-navy">Beyond the Secretary</h4>
        <p className="mb-3 text-[11px] leading-snug text-navy-2">
          Subject teachers you want in the room. They join the teacher register (present-by-default).
        </p>
        <div className="max-h-[320px] space-y-1 overflow-y-auto">
          {staff.length === 0 ? (
            <p className="text-[12px] italic text-navy-3">No staff found.</p>
          ) : (
            staff.map((s) => (
              <label key={s.userId} className="flex cursor-pointer items-center gap-2 rounded-md border border-transparent px-2 py-1.5 hover:bg-surface">
                <input type="checkbox" checked={invited.has(s.userId)} onChange={() => toggleInvite(s.userId)} className="accent-navy" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-semibold text-navy">{s.name}</span>
                  <span className="block truncate text-[10px] text-navy-3">{s.roleLabel}</span>
                </span>
              </label>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}
