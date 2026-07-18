"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  requestExeat,
  hmApproveExeat,
  signSpecialExeat,
  departExeat,
  returnExeat,
  declineExeat,
  bulkApproveClean,
  runLateReturnChecks,
} from "@/lib/actions/boarding-exeat";
import type { ExeatRow, ExeatBoarderOption } from "@/lib/boarding/exeat-data";

type Result = { ok: boolean; error?: string; message?: string; refCode?: string };

/** Stages at which a card is printable (a card-worthy exeat has passed HM review). */
const CARD_STATES = new Set(["HM_APPROVED", "SR_HM_SIGNED", "DEPARTED", "RETURNED"]);

function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<Result>, confirm?: string) => {
    if (confirm && !window.confirm(confirm)) return;
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong.");
      else router.refresh();
    });
  };
  return { pending, error, run };
}

const btn = "rounded-md border px-2.5 py-1 text-[11px] font-semibold disabled:opacity-50";
const btnPlain = `${btn} border-border-2 bg-surface text-navy hover:bg-bg`;
const btnPrimary = `${btn} border-navy bg-navy text-bg`;
const btnGold = `${btn} border-gold bg-gold text-navy`;
const btnTerra = `${btn} border-terra bg-terra text-bg`;

/** The per-exeat action buttons (used in the in-flight card and every queue row). */
export function ActionBar({ exeat, canSign }: { exeat: ExeatRow; canSign: boolean }) {
  const { pending, error, run } = useAction();
  const cardHref = `/api/senior/exeat-card?exeatId=${exeat.id}`;
  const showCard = CARD_STATES.has(exeat.status);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {exeat.status === "REQUESTED" && (
        <button className={btnPrimary} disabled={pending} onClick={() => run(() => hmApproveExeat(exeat.id))}>
          Approve
        </button>
      )}
      {exeat.status === "HM_APPROVED" && exeat.type === "SPECIAL" && (
        <button
          className={btnGold}
          disabled={pending || !canSign}
          title={canSign ? "" : "Only the Senior Housemaster (Dean) can sign a special exeat"}
          onClick={() => run(() => signSpecialExeat(exeat.id))}
        >
          Sign · Sr HM
        </button>
      )}
      {(exeat.status === "HM_APPROVED" && exeat.type !== "SPECIAL") ||
      exeat.status === "SR_HM_SIGNED" ? (
        <button className={btnPrimary} disabled={pending} onClick={() => run(() => departExeat(exeat.id))}>
          Sign out (depart)
        </button>
      ) : null}
      {exeat.status === "DEPARTED" && (
        <button className={btnGold} disabled={pending} onClick={() => run(() => returnExeat(exeat.id))}>
          Sign in (return)
        </button>
      )}
      {showCard && (
        <a className={btnPlain} href={cardHref} target="_blank" rel="noreferrer">
          Print card
        </a>
      )}
      {exeat.status !== "RETURNED" && exeat.status !== "DECLINED" && exeat.status !== "DEPARTED" && (
        <button
          className={btnPlain}
          disabled={pending}
          onClick={() => {
            const reason = window.prompt("Reason for declining this exeat?");
            if (reason && reason.trim()) run(() => declineExeat({ exeatId: exeat.id, reason }));
          }}
        >
          Decline
        </button>
      )}
      {error && <span className="text-[11px] text-terra">{error}</span>}
    </div>
  );
}

export function BulkApprove({ count }: { count: number }) {
  const { pending, error, run } = useAction();
  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-[11px] text-terra">{error}</span>}
      <button
        className={btnPrimary}
        disabled={pending || count === 0}
        onClick={() => run(() => bulkApproveClean())}
      >
        Approve all clean ({count})
      </button>
    </div>
  );
}

export function RunLateChecks() {
  const { pending, error, run } = useAction();
  const [note, setNote] = useState<string | null>(null);
  const router = useRouter();
  return (
    <div className="flex items-center gap-2">
      {note && <span className="text-[11px] text-navy-3">{note}</span>}
      {error && <span className="text-[11px] text-terra">{error}</span>}
      <button
        className={btnTerra}
        disabled={pending}
        onClick={() => {
          setNote(null);
          run(async () => {
            const res = await runLateReturnChecks();
            if (res.ok) {
              setNote(res.message ?? "Checked.");
              router.refresh();
            }
            return res;
          });
        }}
      >
        Run late-return checks
      </button>
    </div>
  );
}

/** The "New exeat" request form — a toggled panel with native inputs (staff-facing). */
export function NewExeatButton({ boarders }: { boarders: ExeatBoarderOption[] }) {
  const { pending, error, run } = useAction();
  const [open, setOpen] = useState(false);
  const [studentId, setStudentId] = useState("");
  const [type, setType] = useState<"SCHEDULED" | "SPECIAL">("SCHEDULED");
  const [reason, setReason] = useState("");
  const [departAt, setDepartAt] = useState("");
  const [returnBy, setReturnBy] = useState("");

  function submit() {
    run(async () => {
      const res = await requestExeat({
        studentId,
        requestedType: type,
        reason: reason || undefined,
        departAt: departAt || undefined,
        returnBy: returnBy || undefined,
      });
      if (res.ok) {
        setOpen(false);
        setStudentId("");
        setReason("");
        setDepartAt("");
        setReturnBy("");
      }
      return res;
    });
  }

  if (!open) {
    return (
      <button className={btnPrimary} onClick={() => setOpen(true)}>
        New exeat
      </button>
    );
  }

  const input = "w-full rounded-md border border-border-2 bg-surface px-2.5 py-1.5 text-[13px]";
  return (
    <div className="w-full rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="font-display text-base font-semibold text-navy">New exeat request</h4>
        <button className={btnPlain} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-[11px] font-semibold uppercase tracking-wide text-navy-3">
          Boarder
          <select className={input} value={studentId} onChange={(e) => setStudentId(e.target.value)}>
            <option value="">Select a boarder…</option>
            {boarders.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} · {b.house}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[11px] font-semibold uppercase tracking-wide text-navy-3">
          Type
          <select
            className={input}
            value={type}
            onChange={(e) => setType(e.target.value as "SCHEDULED" | "SPECIAL")}
          >
            <option value="SCHEDULED">Scheduled (auto-approve if clean)</option>
            <option value="SPECIAL">Special (Senior HM signs)</option>
          </select>
        </label>
        <label className="text-[11px] font-semibold uppercase tracking-wide text-navy-3">
          Depart
          <input
            type="datetime-local"
            className={input}
            value={departAt}
            onChange={(e) => setDepartAt(e.target.value)}
          />
        </label>
        <label className="text-[11px] font-semibold uppercase tracking-wide text-navy-3">
          Return by
          <input
            type="datetime-local"
            className={input}
            value={returnBy}
            onChange={(e) => setReturnBy(e.target.value)}
          />
        </label>
        <label className="text-[11px] font-semibold uppercase tracking-wide text-navy-3 sm:col-span-2">
          Reason {type === "SPECIAL" && <span className="text-terra">· required</span>}
          <textarea
            className={input}
            rows={2}
            value={reason}
            placeholder={
              type === "SPECIAL"
                ? "Funeral · illness in the family · church engagement…"
                : "Optional — routine home visit"
            }
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      </div>
      {error && <p className="mt-2 text-[12px] text-terra">{error}</p>}
      <p className="mt-2 text-[11px] text-navy-3">
        A fee-owing boarder is auto-routed to a <b>fee-collection</b> exeat (the school cannot detain
        them — GES rule); the outstanding amount is read live and frozen on the card.
      </p>
      <div className="mt-3 flex justify-end">
        <button className={btnPrimary} disabled={pending || !studentId} onClick={submit}>
          {pending ? "Creating…" : "Create exeat"}
        </button>
      </div>
    </div>
  );
}
