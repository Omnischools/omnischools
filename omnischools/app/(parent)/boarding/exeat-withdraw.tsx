"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { withdrawParentExeat } from "@/lib/actions/parent-exeat";

/**
 * EXEAT PHASE 3-B · the parent's "Withdraw request" control — offered only on a still-REQUESTED portal row
 * (canWithdraw, computed server-side). Calls the withdrawParentExeat action ONLY (no server-only import). A
 * two-step inline confirm (matches the parent-portal styling — no window.confirm); on success router.refresh()
 * re-reads the row as "Withdrawn — you cancelled this request." and the button disappears (canWithdraw→false).
 * The fn is authoritative — a stale/ineligible click just returns a neutral error shown inline.
 */
export function ExeatWithdrawButton({ exeatId }: { exeatId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function withdraw() {
    setError(null);
    start(async () => {
      const res = await withdrawParentExeat(exeatId);
      if (res.ok) {
        setConfirming(false);
        router.refresh();
      } else {
        setError(res.error ?? "Couldn't withdraw your request. Please try again.");
      }
    });
  }

  if (!confirming) {
    return (
      <div className="mt-2.5">
        <button
          type="button"
          onClick={() => {
            setError(null);
            setConfirming(true);
          }}
          className="text-xs font-bold text-terra hover:opacity-80"
        >
          Withdraw request
        </button>
        {error && <p className="mt-1.5 text-[12px] text-terra">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mt-2.5">
      <p className="text-[12px] text-navy-2">Cancel this leave request? This can&apos;t be undone.</p>
      <div className="mt-1.5 flex items-center gap-2">
        <button
          type="button"
          onClick={withdraw}
          disabled={pending}
          className="rounded-md bg-terra px-3.5 py-1.5 text-[12px] font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Withdrawing…" : "Yes, withdraw"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={pending}
          className="rounded-md border border-border-2 bg-surface px-3.5 py-1.5 text-[12px] font-semibold text-navy transition-opacity hover:bg-bg disabled:opacity-60"
        >
          Keep request
        </button>
      </div>
      {error && <p className="mt-1.5 text-[12px] text-terra">{error}</p>}
    </div>
  );
}
