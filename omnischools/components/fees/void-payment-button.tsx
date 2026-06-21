"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { voidPayment } from "@/lib/actions/fees";
import { Modal } from "@/components/ui/modal";

/**
 * Voiding a payment is irreversible and reverses every invoice allocation, so it
 * demands an explicit reason (audited) and a choice: was cash actually returned to
 * the payer (refund) or is this a data-entry correction (no money moved)?
 */
export function VoidPaymentButton({ paymentId }: { paymentId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [isRefund, setIsRefund] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setReason("");
    setIsRefund(false);
    setError(null);
  }

  function submit() {
    if (reason.trim().length < 3) {
      setError("Give a reason for voiding (at least 3 characters).");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await voidPayment({ paymentId, reason: reason.trim(), isRefund });
      if (res.ok) {
        setOpen(false);
        reset();
        router.refresh();
      } else {
        setError(res.error ?? "Could not void the payment.");
      }
    });
  }

  return (
    <>
      <button
        onClick={() => {
          reset();
          setOpen(true);
        }}
        className="text-xs font-semibold text-navy-3 hover:text-terra"
      >
        Void
      </button>

      <Modal
        open={open}
        onClose={pending ? () => {} : () => setOpen(false)}
        title="Void payment"
      >
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-navy-2">
            This reverses every invoice allocation for this payment and can&apos;t be
            undone. The reason is recorded in the audit trail.
          </p>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-navy-3">
              Reason
            </span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={300}
              placeholder="e.g. Duplicate entry, wrong student, payment reversed by bank…"
              className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-navy outline-none focus:border-gold"
            />
          </label>

          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={isRefund}
              onChange={(e) => setIsRefund(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-border accent-terra"
            />
            <span className="text-navy-2">
              Money was refunded to the payer
              <span className="mt-0.5 block text-xs text-navy-3">
                Leave unchecked for a data-entry correction (no cash returned).
              </span>
            </span>
          </label>

          {error && (
            <p className="rounded-md bg-terra-bg px-3 py-2 text-sm text-terra">{error}</p>
          )}

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={pending}
              className="text-sm font-semibold text-navy-2 transition-colors hover:text-navy disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={pending}
              className="rounded-md bg-terra px-4 py-2 text-sm font-semibold text-bg transition-colors hover:opacity-90 disabled:opacity-60"
            >
              {pending ? "Voiding…" : isRefund ? "Void & refund" : "Void payment"}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
