"use client";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  recordVisit,
  arriveVisit,
  departVisit,
  authoriseVisit,
  addApprovedVisitor,
  approveApprovedVisitor,
  removeApprovedVisitor,
  sendVisitingReminder,
  runVisitingOverstayChecks,
} from "@/lib/actions/boarding-visiting";
import { VISITOR_ZONES } from "@/lib/boarding/visiting";
import type { VisitStatus, VisitVerification, ListMatchKind } from "@/lib/boarding/visiting";
import type {
  BoarderOption,
  ApprovedVisitorOption,
  ApprovedListCard,
} from "@/lib/boarding/visiting-data";

type Result = { ok: boolean; error?: string; message?: string };

const btn = "rounded-md border px-2.5 py-1 text-[11px] font-semibold disabled:opacity-50";
const btnPlain = `${btn} border-border-2 bg-surface text-navy hover:bg-bg`;
const btnPrimary = `${btn} border-navy bg-navy text-bg`;
const btnGold = `${btn} border-gold bg-gold text-navy`;
const btnTerra = `${btn} border-terra bg-terra text-bg`;
const input = "w-full rounded-md border border-border-2 bg-surface px-2.5 py-1.5 text-[13px]";

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

/** Header CTAs — cohort RSVP reminder (T-3) + overstay sweep (both console SMS, idempotent). */
export function HeaderActions({ eventId, live }: { eventId: string | null; live: boolean }) {
  const { pending, error, note, run } = useAction();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {note && <span className="text-[11px] text-green">{note}</span>}
      {error && <span className="text-[11px] text-terra">{error}</span>}
      <button
        className={btnPlain}
        disabled={pending || !eventId}
        onClick={() => eventId && run(() => sendVisitingReminder(eventId))}
        title="Sends the RSVP reminder SMS to each in-scope boarder's primary guardian (console · idempotent)."
      >
        Send RSVP reminder
      </button>
      {live && (
        <button
          className={btnGold}
          disabled={pending || !eventId}
          onClick={() => eventId && run(() => runVisitingOverstayChecks(eventId))}
          title="On-read overstay sweep — HM console SMS per overstaying visit. No discipline written."
        >
          Send overstay reminders
        </button>
      )}
    </div>
  );
}

/** Per-row gate actions (Arrive / Depart / HM override / Review). Never a hard turn-away. */
export function VisitRowActions({
  visitId,
  studentId,
  status,
  verification,
  listMatchKind,
  query,
}: {
  visitId: string;
  studentId: string;
  status: VisitStatus;
  verification: VisitVerification;
  listMatchKind: ListMatchKind;
  query: Record<string, string | undefined>;
}) {
  const { pending, error, run } = useAction();
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {error && <span className="text-[10px] text-terra">{error}</span>}
      {listMatchKind === "review" && (
        <Link href={buildHref(query, { student: studentId }) + "#approved"} className={btnTerra}>
          Review
        </Link>
      )}
      {verification === "FLAGGED" && (
        <button
          className={btnGold}
          disabled={pending}
          onClick={() => run(() => authoriseVisit(visitId))}
          title="Flagged not-on-list — admit on actor-stamped HM authorisation. Does NOT add to the approved list."
        >
          HM authorise
        </button>
      )}
      {status === "RSVP" && (
        <button className={btnPrimary} disabled={pending} onClick={() => run(() => arriveVisit(visitId))}>
          Arrive
        </button>
      )}
      {status === "ARRIVED" && (
        <button className={btnPlain} disabled={pending} onClick={() => run(() => departVisit(visitId))}>
          Depart
        </button>
      )}
      {status === "DEPARTED" && <span className="text-[10px] font-semibold uppercase text-navy-3">Departed</span>}
    </div>
  );
}

/**
 * The gate-check modal (surface §2: list-CHECK not list-RECORD). Pick a boarder → pick an approved
 * visitor (VERIFIED on APPROVED match) OR record a walk-in (FLAGGED → HM authorise). RSVP or arrive.
 */
export function GateCheckPanel({
  eventId,
  boarders,
  approvedByStudent,
}: {
  eventId: string | null;
  boarders: BoarderOption[];
  approvedByStudent: Record<string, ApprovedVisitorOption[]>;
}) {
  const { pending, error, note, run } = useAction();
  const [open, setOpen] = useState(false);
  const [studentId, setStudentId] = useState("");
  const [choice, setChoice] = useState<string>(""); // approvedVisitorId or "__walkin__"
  const [walkName, setWalkName] = useState("");
  const [walkRel, setWalkRel] = useState("");
  const [walkPhone, setWalkPhone] = useState("");
  const [zoneKey, setZoneKey] = useState("");
  const [noteText, setNoteText] = useState("");

  const approved = studentId ? approvedByStudent[studentId] ?? [] : [];
  const isWalkIn = choice === "__walkin__";

  const reset = () => {
    setStudentId("");
    setChoice("");
    setWalkName("");
    setWalkRel("");
    setWalkPhone("");
    setZoneKey("");
    setNoteText("");
  };

  function submit(action: "RSVP" | "ARRIVE") {
    run(
      () =>
        recordVisit({
          studentId,
          calendarEventId: eventId,
          approvedVisitorId: isWalkIn || !choice ? null : choice,
          visitorName: isWalkIn ? walkName.trim() : undefined,
          relationship: isWalkIn ? walkRel.trim() : undefined,
          phone: isWalkIn && walkPhone.trim() ? walkPhone.trim() : undefined,
          zoneKey: zoneKey || undefined,
          action,
          note: noteText.trim() || undefined,
        }),
      () => {
        reset();
        setOpen(false);
      },
    );
  }

  if (!open) {
    return (
      <div className="flex items-center gap-2">
        {note && <span className="text-[11px] text-green">{note}</span>}
        <button className={btnPrimary} onClick={() => setOpen(true)}>
          Gate check · record a visitor
        </button>
      </div>
    );
  }

  const canSubmit = !!studentId && (isWalkIn ? !!walkName.trim() && !!walkRel.trim() : !!choice);

  return (
    <div className="w-full rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="font-display text-base font-semibold text-navy">Gate check · the Visitor&apos;s Book</h4>
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
        <select
          className={input}
          value={studentId}
          onChange={(e) => {
            setStudentId(e.target.value);
            setChoice("");
          }}
        >
          <option value="">Select a boarder…</option>
          {boarders.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} · {b.formLabel} · {b.houseName}
              {b.rsvpd ? " · has RSVP" : ""}
            </option>
          ))}
        </select>
      </label>

      {studentId && (
        <div className="mt-3">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-navy-3">
            Visitor · matched to the approved list
          </div>
          <div className="flex flex-col gap-1.5">
            {approved.map((a) => (
              <label
                key={a.id}
                className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-[12px] ${
                  choice === a.id ? "border-navy bg-bg" : "border-border-2 bg-surface"
                }`}
              >
                <input
                  type="radio"
                  name="visitor"
                  checked={choice === a.id}
                  onChange={() => setChoice(a.id)}
                />
                <span className="font-semibold text-navy">{a.name}</span>
                <span className="text-navy-3">· {a.relationship}</span>
                <span
                  className={`ml-auto rounded-pill px-2 py-0.5 text-[9px] font-bold ${
                    a.status === "APPROVED" ? "bg-green-bg text-green" : "bg-warn-bg text-warn"
                  }`}
                >
                  {a.status === "APPROVED" ? "APPROVED → VERIFIED" : "PENDING → FLAGGED"}
                </span>
              </label>
            ))}
            <label
              className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-[12px] ${
                isWalkIn ? "border-terra bg-terra-bg" : "border-border-2 bg-surface"
              }`}
            >
              <input type="radio" name="visitor" checked={isWalkIn} onChange={() => setChoice("__walkin__")} />
              <span className="font-semibold text-navy">Walk-in · not on the list</span>
              <span className="ml-auto rounded-pill bg-terra-bg px-2 py-0.5 text-[9px] font-bold text-terra">
                FLAGGED → HM authorise
              </span>
            </label>
          </div>
        </div>
      )}

      {isWalkIn && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-navy-3">
            Visitor name
            <input className={input} value={walkName} onChange={(e) => setWalkName(e.target.value)} />
          </label>
          <label className="text-[10px] font-semibold uppercase tracking-wide text-navy-3">
            Relationship
            <input className={input} value={walkRel} onChange={(e) => setWalkRel(e.target.value)} />
          </label>
          <label className="text-[10px] font-semibold uppercase tracking-wide text-navy-3">
            Phone (stored, rendered masked)
            <input className={input} value={walkPhone} onChange={(e) => setWalkPhone(e.target.value)} />
          </label>
        </div>
      )}

      {studentId && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-navy-3">
            Visitor zone (optional)
            <select className={input} value={zoneKey} onChange={(e) => setZoneKey(e.target.value)}>
              <option value="">— unassigned —</option>
              {VISITOR_ZONES.map((z) => (
                <option key={z.key} value={z.key}>
                  {z.label} · ~{z.capacity}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[10px] font-semibold uppercase tracking-wide text-navy-3">
            Note (optional)
            <input className={input} value={noteText} onChange={(e) => setNoteText(e.target.value)} />
          </label>
        </div>
      )}

      <p className="mt-2 text-[11px] text-navy-3">
        The list is <b>checked, not recorded</b> — a not-on-list visitor is FLAGGED (never turned away),
        admitted on an actor-stamped HM authorisation. No photo/QR — the check is done out of the
        parent&apos;s sight (§2).
      </p>
      {error && <p className="mt-2 text-[12px] text-terra">{error}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button className={btnPlain} disabled={pending || !canSubmit} onClick={() => submit("RSVP")}>
          Record RSVP
        </button>
        <button className={btnPrimary} disabled={pending || !canSubmit} onClick={() => submit("ARRIVE")}>
          {pending ? "Saving…" : "Arrive now"}
        </button>
      </div>
    </div>
  );
}

/**
 * The approved-visitor detail card + CRUD editor (surface av-list-card). Student picker · 6 slots (filled
 * + empty add affordance) · PENDING → APPROVED · remove · pastoral (Dean-gated) add.
 */
export function ApprovedVisitorEditor({
  focus,
  focusOptions,
  canManagePastoral,
  query,
}: {
  focus: ApprovedListCard | null;
  focusOptions: { id: string; label: string }[];
  canManagePastoral: boolean;
  query: Record<string, string | undefined>;
}) {
  const router = useRouter();
  const { pending, error, note, run } = useAction();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [rel, setRel] = useState("");
  const [phone, setPhone] = useState("");
  const [idHint, setIdHint] = useState("");
  const [pastoral, setPastoral] = useState(false);

  const filled = useMemo(() => (focus ? focus.slots.filter((s) => s.id) : []), [focus]);
  const emptyCount = focus ? focus.slots.filter((s) => !s.id).length : 0;

  if (!focus) return null;

  function submitAdd() {
    if (!focus) return;
    run(
      () =>
        addApprovedVisitor({
          studentId: focus.studentId,
          name: name.trim(),
          relationship: rel.trim(),
          phone: phone.trim() || undefined,
          idHint: idHint.trim() || undefined,
          pastoralReview: pastoral || undefined,
        }),
      () => {
        setName("");
        setRel("");
        setPhone("");
        setIdHint("");
        setPastoral(false);
        setAdding(false);
      },
    );
  }

  return (
    <div id="approved" className="rounded-xl border border-gold bg-gold-bg p-5">
      <div className="mb-3 flex items-start justify-between border-b border-dashed border-gold pb-3">
        <div>
          <h4 className="font-display text-[17px] font-semibold leading-tight text-navy">
            {focus.studentName}{" "}
            <em className="italic text-gold">
              · {focus.approvedCount} approved{focus.pastoral ? " · pastoral active" : ""}
            </em>
          </h4>
          <div className="mt-0.5 text-[11px] text-navy-2">
            {focus.studentSub} · max 6 per student ·{" "}
            {focus.pendingCount > 0 ? `${focus.pendingCount} pending review` : "list clear"}
          </div>
        </div>
        <span className="rounded-pill bg-gold px-2.5 py-1 text-[9px] font-bold tracking-[0.08em] text-navy">
          HM CURATED
        </span>
      </div>

      {/* Student picker (the surface shows one card; here you choose whose list to manage). */}
      {focusOptions.length > 1 && (
        <label className="mb-3 block text-[10px] font-semibold uppercase tracking-wide text-navy-3">
          Whose list
          <select
            className={input}
            value={focus.studentId}
            onChange={(e) => router.push(buildHref(query, { student: e.target.value }) + "#approved")}
          >
            {focusOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {filled.map((s) => (
          <div key={s.id} className="flex items-center gap-2.5 rounded-lg border border-border bg-surface px-3.5 py-2.5 text-[11px]">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy font-display text-[10px] font-bold text-gold">
              {s.name.split(" ").map((w) => w.charAt(0)).slice(0, 2).join("").toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate font-bold text-navy">{s.name}</div>
              <div className="truncate text-[10px] text-navy-3">
                {s.relationship}
                {s.phoneMasked ? ` · ${s.phoneMasked}` : ""}
                {s.idHint ? ` · ${s.idHint}` : ""}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span
                className={`rounded-pill px-2 py-0.5 text-[8px] font-bold ${
                  s.status === "APPROVED" ? "bg-green-bg text-green" : "bg-warn-bg text-warn"
                }`}
              >
                {s.status === "APPROVED" ? "APPROVED" : "PENDING"}
                {s.pastoralReview ? " · DEAN" : ""}
              </span>
              <div className="flex gap-1">
                {s.status === "PENDING_REVIEW" && (
                  <button
                    className={btnGold}
                    disabled={pending || (s.pastoralReview && !canManagePastoral)}
                    title={s.pastoralReview && !canManagePastoral ? "Pastoral-sensitive — Dean of Boarding approves." : undefined}
                    onClick={() => s.id && run(() => approveApprovedVisitor(s.id!))}
                  >
                    Approve
                  </button>
                )}
                <button className={btnPlain} disabled={pending} onClick={() => s.id && run(() => removeApprovedVisitor(s.id!))}>
                  Remove
                </button>
              </div>
            </div>
          </div>
        ))}

        {/* The empty-slot add affordance (surface: "Slot N · empty · available to add"). */}
        {emptyCount > 0 && !adding && (
          <button
            className="flex items-center gap-2.5 rounded-lg border border-dashed border-gold bg-bg px-3.5 py-2.5 text-left text-[11px] opacity-80 hover:opacity-100"
            onClick={() => setAdding(true)}
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-gold font-display text-[13px] text-gold">
              +
            </span>
            <div>
              <div className="font-bold text-navy">Add approved visitor</div>
              <div className="text-[10px] text-navy-3">{emptyCount} slot{emptyCount === 1 ? "" : "s"} free · max 6</div>
            </div>
          </button>
        )}
      </div>

      {adding && (
        <div className="mt-3 rounded-lg border border-gold bg-surface p-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-navy-3">
              Name
              <input className={input} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="text-[10px] font-semibold uppercase tracking-wide text-navy-3">
              Relationship
              <input className={input} value={rel} onChange={(e) => setRel(e.target.value)} placeholder="Mother · grandfather · sibling" />
            </label>
            <label className="text-[10px] font-semibold uppercase tracking-wide text-navy-3">
              Phone (masked on display)
              <input className={input} value={phone} onChange={(e) => setPhone(e.target.value)} />
            </label>
            <label className="text-[10px] font-semibold uppercase tracking-wide text-navy-3">
              ID hint (not a document)
              <input className={input} value={idHint} onChange={(e) => setIdHint(e.target.value)} />
            </label>
          </div>
          <label className="mt-2 flex items-center gap-2 text-[11px] text-navy-2">
            <input type="checkbox" checked={pastoral} onChange={(e) => setPastoral(e.target.checked)} />
            Pastoral-sensitive · needs Dean of Boarding to approve (VLC 4.5 stub — no journal write)
          </label>
          {error && <p className="mt-1 text-[11px] text-terra">{error}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <button className={btnPlain} disabled={pending} onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button
              className={btnPrimary}
              disabled={pending || !name.trim() || !rel.trim()}
              onClick={submitAdd}
            >
              {pending ? "Adding…" : "Add · pending review"}
            </button>
          </div>
        </div>
      )}

      {note && <p className="mt-2 text-[11px] text-green">{note}</p>}
      {error && !adding && <p className="mt-2 text-[11px] text-terra">{error}</p>}
    </div>
  );
}

/** Build an href preserving date/eventId and overriding student. */
function buildHref(query: Record<string, string | undefined>, override: Record<string, string>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...query, ...override })) {
    if (v) params.set(k, v);
  }
  const qs = params.toString();
  return `/senior/boarding/operations/visiting${qs ? `?${qs}` : ""}`;
}
