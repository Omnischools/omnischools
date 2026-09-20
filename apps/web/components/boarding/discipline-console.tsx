"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  logInfraction,
  openDeboardinization,
  signBond,
  signDeboard,
  commitDeboardinization,
  fileBoardReview,
  reinstate,
  runAutoLogSweep,
} from "@/lib/actions/boarding-discipline";

type Result = { ok: boolean; error?: string; message?: string };

const btn = "rounded-md border px-2.5 py-1 text-[11px] font-semibold disabled:opacity-50";
const btnPlain = `${btn} border-border-2 bg-surface text-navy hover:bg-bg`;
const btnPrimary = `${btn} border-navy bg-navy text-bg`;
const btnGold = `${btn} border-gold bg-gold text-navy`;
const btnGreen = `${btn} border-green bg-green text-bg`;
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

/** Header actions — open the log-infraction form + run the idempotent auto-log sweep (console SMS). */
export function HeaderActions({ boarders }: { boarders: { id: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const { pending, error, note, run } = useAction();
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {note && <span className="text-[11px] text-green">{note}</span>}
        {error && <span className="text-[11px] text-terra">{error}</span>}
        <button
          className={btnPlain}
          disabled={pending}
          onClick={() => run(() => runAutoLogSweep())}
          title="Runs the exeat-overdue + resumption-absent derivations — each writes a real NOTE idempotently (a re-run logs nothing new). No invoice written."
        >
          Run auto-log sweep
        </button>
        <button className={btnPrimary} onClick={() => setOpen((v) => !v)}>
          {open ? "Close" : "Log new infraction"}
        </button>
      </div>
      {open && <LogInfractionForm boarders={boarders} onDone={() => setOpen(false)} />}
    </div>
  );
}

function LogInfractionForm({ boarders, onDone }: { boarders: { id: string; label: string }[]; onDone: () => void }) {
  const { pending, error, note, run } = useAction();
  const [studentId, setStudentId] = useState("");
  const [severity, setSeverity] = useState<"NOTE" | "WARNING" | "BOND" | "SUSPENSION" | "DEBOARDINIZATION">("NOTE");
  const [narrative, setNarrative] = useState("");
  const [penaltyDays, setPenaltyDays] = useState("");
  const [penaltyPerDay, setPenaltyPerDay] = useState("");
  const isDeboard = severity === "DEBOARDINIZATION";
  const canSubmit = !!studentId && narrative.trim().length >= 3;

  function submit() {
    if (isDeboard) {
      run(
        () =>
          openDeboardinization({
            studentId,
            narrativeText: narrative.trim(),
            penaltyDays: penaltyDays ? Number(penaltyDays) : undefined,
            penaltyPerDayAmount: penaltyPerDay ? Number(penaltyPerDay) : undefined,
          }),
        onDone,
      );
    } else {
      run(() => logInfraction({ studentId, severity, narrativeText: narrative.trim() }), onDone);
    }
  }

  return (
    <div className="w-full max-w-xl rounded-xl border border-border bg-surface p-4 text-left">
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[10px] font-semibold uppercase tracking-wide text-navy-3">
          Boarder
          <select className={input} value={studentId} onChange={(e) => setStudentId(e.target.value)}>
            <option value="">Select a boarder…</option>
            {boarders.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[10px] font-semibold uppercase tracking-wide text-navy-3">
          Rung
          <select className={input} value={severity} onChange={(e) => setSeverity(e.target.value as typeof severity)}>
            <option value="NOTE">i · Note</option>
            <option value="WARNING">ii · Warning</option>
            <option value="BOND">iii · Bond</option>
            <option value="SUSPENSION">iv · Suspension</option>
            <option value="DEBOARDINIZATION">v · Deboardinization</option>
          </select>
        </label>
      </div>
      <label className="mt-2 block text-[10px] font-semibold uppercase tracking-wide text-navy-3">
        What happened (append-only — corrections supersede, never edit)
        <textarea className={`${input} h-16`} value={narrative} onChange={(e) => setNarrative(e.target.value)} />
      </label>
      {isDeboard && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-navy-3">
            Unauthorised days (penalty snapshot)
            <input className={input} inputMode="numeric" value={penaltyDays} onChange={(e) => setPenaltyDays(e.target.value)} />
          </label>
          <label className="text-[10px] font-semibold uppercase tracking-wide text-navy-3">
            Boarding fee / day, GHS (snapshot)
            <input className={input} inputMode="decimal" value={penaltyPerDay} onChange={(e) => setPenaltyPerDay(e.target.value)} />
          </label>
        </div>
      )}
      <p className="mt-2 text-[11px] text-navy-3">
        A pastorally-flagged student is routed to the Dean, not laddered (no infraction written). Warning+
        notifies the parent by SMS (console). Deboardinization opens a draft that needs three co-signs.
      </p>
      {error && <p className="mt-1 text-[11px] text-terra">{error}</p>}
      {note && <p className="mt-1 text-[11px] text-green">{note}</p>}
      <div className="mt-2 flex justify-end">
        <button className={btnPrimary} disabled={pending || !canSubmit} onClick={submit}>
          {pending ? "Saving…" : isDeboard ? "Open deboardinization draft" : "Log infraction"}
        </button>
      </div>
    </div>
  );
}

/** The three independently-flipping bond signature buttons (student + HM witness + Senior HM witness). */
export function BondSignButtons({ bondId, signed }: { bondId: string; signed: { student: boolean; hm: boolean; seniorHm: boolean } }) {
  const { pending, error, run } = useAction();
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-dashed border-gold pt-3">
      {error && <span className="w-full text-[10px] text-terra">{error}</span>}
      <button className={btnPlain} disabled={pending || signed.student} onClick={() => run(() => signBond({ bondId, slot: "student" }))}>
        {signed.student ? "Student ✓" : "Student signs"}
      </button>
      <button className={btnGold} disabled={pending || signed.hm} onClick={() => run(() => signBond({ bondId, slot: "hm" }))}>
        {signed.hm ? "HM witness ✓" : "HM witness"}
      </button>
      <button className={btnGold} disabled={pending || signed.seniorHm} onClick={() => run(() => signBond({ bondId, slot: "seniorHm" }))}>
        {signed.seniorHm ? "Senior HM ✓" : "Senior HM witness"}
      </button>
    </div>
  );
}

/** Deboardinized-card actions — three co-sign slots, the effect gate, board review + reinstate. */
export function DeboardActions({
  recordId,
  status,
  signed,
  canManageBoard,
}: {
  recordId: string;
  status: "DEBOARDINIZED" | "REVIEW" | "DRAFT";
  signed: { hm: boolean; seniorHm: boolean; headmaster: boolean };
  canManageBoard: boolean;
}) {
  const { pending, error, note, run } = useAction();
  const [motion, setMotion] = useState("");
  const [decision, setDecision] = useState("");
  const [showReview, setShowReview] = useState(false);
  const [showReinstate, setShowReinstate] = useState(false);
  const allSigned = signed.hm && signed.seniorHm && signed.headmaster;

  return (
    <div className="mt-3 border-t border-border pt-3">
      {error && <p className="mb-1 text-[10px] text-terra">{error}</p>}
      {note && <p className="mb-1 text-[10px] text-green">{note}</p>}

      {status === "DRAFT" && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-navy-3">Co-sign:</span>
          <button className={btnPlain} disabled={pending || signed.hm} onClick={() => run(() => signDeboard({ recordId, slot: "hm" }))}>
            {signed.hm ? "HM ✓" : "HM"}
          </button>
          <button className={btnPlain} disabled={pending || signed.seniorHm} onClick={() => run(() => signDeboard({ recordId, slot: "seniorHm" }))}>
            {signed.seniorHm ? "Sr HM ✓" : "Sr HM"}
          </button>
          <button className={btnPlain} disabled={pending || signed.headmaster} onClick={() => run(() => signDeboard({ recordId, slot: "headmaster" }))}>
            {signed.headmaster ? "Head ✓" : "Head"}
          </button>
          <button
            className={btnTerra}
            disabled={pending || !allSigned}
            title={allSigned ? "Effect the deboardinization — residency flips, bunk released." : "Needs all three co-signs first."}
            onClick={() => run(() => commitDeboardinization({ recordId }))}
          >
            Effect deboardinization
          </button>
        </div>
      )}

      {status !== "DRAFT" && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button className={btnPlain} disabled={pending} onClick={() => setShowReview((v) => !v)}>
            File board motion
          </button>
          {canManageBoard && (
            <button className={btnGreen} disabled={pending} onClick={() => setShowReinstate((v) => !v)}>
              Reinstate (Board)
            </button>
          )}
        </div>
      )}

      {showReview && status !== "DRAFT" && (
        <div className="mt-2">
          <textarea className={`${input} h-14`} placeholder="Board motion / outcome…" value={motion} onChange={(e) => setMotion(e.target.value)} />
          <div className="mt-1 flex justify-end">
            <button className={btnPrimary} disabled={pending || motion.trim().length < 3} onClick={() => run(() => fileBoardReview({ recordId, motionText: motion.trim() }), () => setShowReview(false))}>
              File motion
            </button>
          </div>
        </div>
      )}

      {showReinstate && canManageBoard && status !== "DRAFT" && (
        <div className="mt-2">
          <textarea className={`${input} h-14`} placeholder="Board decision (required to reinstate)…" value={decision} onChange={(e) => setDecision(e.target.value)} />
          <div className="mt-1 flex justify-end">
            <button className={btnGreen} disabled={pending || decision.trim().length < 3} onClick={() => run(() => reinstate({ recordId, boardDecisionText: decision.trim() }), () => setShowReinstate(false))}>
              Reinstate to boarding
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
