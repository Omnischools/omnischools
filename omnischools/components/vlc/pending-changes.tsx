"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveChangeRequest, rejectChangeRequest } from "@/lib/actions/vlc-change-request";
import type { VlcPendingChange } from "@/lib/vlc/change-request-data";

const OP_ACCENT: Record<string, string> = {
  ADD: "text-green",
  REORDER: "text-gold",
  REMOVE: "text-terra",
};

/**
 * The curriculum change queue. Proposed structural changes (add / reorder / remove a value) wait here
 * until the Headmaster decides. `canApprove` (HEADMASTER) shows the approve/reject controls; a Dean or
 * Admin proposer sees the same list read-only (their proposal is pending). Copy is deliberately neutral
 * ("student support" curriculum) — never the internal module code.
 */
export function PendingChanges({
  changes,
  canApprove,
}: {
  changes: VlcPendingChange[];
  canApprove: boolean;
}) {
  if (changes.length === 0) return null;
  return (
    <section id="pending" className="mb-10 scroll-mt-6">
      <div className="rounded-2xl border border-gold bg-gold-bg p-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">
              Curriculum changes · pending approval
            </div>
            <h4 className="mt-0.5 font-display text-lg font-medium text-navy">
              {changes.length} proposed {changes.length === 1 ? "change" : "changes"}{" "}
              <em className="italic text-gold">
                · {canApprove ? "your approval applies them" : "waiting for the Headmaster"}
              </em>
            </h4>
          </div>
          <span className="rounded-pill bg-surface px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-navy-3">
            Approval required
          </span>
        </div>
        <div className="space-y-2.5">
          {changes.map((c) => (
            <ChangeRow key={c.id} change={c} canApprove={canApprove} />
          ))}
        </div>
      </div>
    </section>
  );
}

function ChangeRow({ change, canApprove }: { change: VlcPendingChange; canApprove: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");

  function decide(action: "approve" | "reject") {
    setError(null);
    startTransition(async () => {
      const res =
        action === "approve"
          ? await approveChangeRequest({ id: change.id })
          : await rejectChangeRequest({ id: change.id, note });
      if (!res.ok) return setError(res.error ?? "Could not record the decision.");
      router.refresh();
    });
  }

  return (
    <div className="rounded-[10px] border border-border bg-surface p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-display text-sm font-semibold text-navy">
            <span className={`mr-1.5 font-mono text-[10px] font-bold uppercase ${OP_ACCENT[change.op] ?? "text-navy-3"}`}>
              {change.op}
            </span>
            {change.title}
          </div>
          {change.detail && <div className="mt-0.5 text-[11px] leading-snug text-navy-2">{change.detail}</div>}
          <div className="mt-1 text-[10px] italic text-navy-3">
            Proposed by {change.proposedBy ?? "a member of staff"} · {change.proposedAt}
          </div>
        </div>
        {canApprove && !rejecting && (
          <div className="flex shrink-0 gap-2">
            <button
              onClick={() => decide("approve")}
              disabled={pending}
              className="rounded-md bg-navy px-3 py-1.5 text-[11px] font-semibold text-bg hover:bg-navy-deep disabled:opacity-50"
            >
              {pending ? "Applying…" : "Approve"}
            </button>
            <button
              onClick={() => setRejecting(true)}
              disabled={pending}
              className="rounded-md border border-terra bg-surface px-3 py-1.5 text-[11px] font-semibold text-terra hover:bg-terra-bg disabled:opacity-50"
            >
              Reject
            </button>
          </div>
        )}
      </div>

      {canApprove && rejecting && (
        <div className="mt-2.5 space-y-2 border-t border-dashed border-border pt-2.5">
          <label className="block">
            <span className="mb-0.5 block text-[10px] font-medium text-navy-3">Reason (optional)</span>
            <input
              className="w-full rounded-md border border-border-2 bg-bg px-2.5 py-1.5 text-[12px] text-navy outline-none focus:border-gold focus:bg-surface"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={240}
            />
          </label>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                setRejecting(false);
                setNote("");
              }}
              disabled={pending}
              className="rounded-md border border-border-2 bg-surface px-3 py-1.5 text-[11px] font-semibold text-navy disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={() => decide("reject")}
              disabled={pending}
              className="rounded-md bg-terra px-3 py-1.5 text-[11px] font-semibold text-bg hover:brightness-95 disabled:opacity-50"
            >
              {pending ? "Rejecting…" : "Confirm reject"}
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-1.5 text-[11px] font-semibold text-terra">{error}</p>}
    </div>
  );
}
