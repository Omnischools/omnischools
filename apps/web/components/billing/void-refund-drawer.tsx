"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { voidPayment } from "@/lib/actions/fees";

/**
 * The void-or-refund decision drawer (schoolup-void-refund Screen 02).
 *
 * Two paths share one irreversible action:
 *  • VOID (terra) — the record was wrong (wrong amount/student/duplicate). The
 *    receipt is voided. No money moved.
 *  • REFUND (gold) — the money is being returned. The original receipt stays
 *    valid; the invoice balance is restored.
 *
 * `voidPayment` takes only a reason, so for a refund the "how was it issued"
 * method text is appended to the reason (`"{reason} · via {method}"`). Partial
 * refunds aren't supported — a refund always returns the full payment amount.
 */

const ghs = (n: number) =>
  `GHS ${n.toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const PRESETS = [
  "Parent disputed charge",
  "Student withdrew",
  "Overpayment",
  "School policy adjustment",
];

type Decision = "void" | "refund" | null;

export function VoidRefundDrawer({
  paymentId,
  amount,
  payer,
  studentName,
  receiptNumber,
}: {
  paymentId: string;
  amount: number;
  payer: string;
  studentName: string;
  receiptNumber: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState<Decision>(null);
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRefund = decision === "refund";

  function reset() {
    setDecision(null);
    setReason("");
    setMethod("");
    setConfirm(false);
    setError(null);
  }

  function close() {
    if (pending) return;
    setOpen(false);
    reset();
  }

  const ready = decision !== null && reason.trim().length >= 3 && confirm;

  function submit() {
    if (!ready || decision === null) return;
    setError(null);
    const composed =
      isRefund && method.trim()
        ? `${reason.trim()} · via ${method.trim()}`
        : reason.trim();
    startTransition(async () => {
      const res = await voidPayment({ paymentId, reason: composed, isRefund });
      if (res.ok) {
        setOpen(false);
        reset();
        router.refresh();
      } else {
        setError(res.error ?? "Could not complete the request.");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          reset();
          setOpen(true);
        }}
        className="rounded-md border border-terra px-3.5 py-2 text-sm font-semibold text-terra transition-colors hover:bg-terra-bg"
      >
        Void or refund…
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Void or refund payment"
          className="fixed inset-0 z-50 flex justify-end"
        >
          <div
            onClick={close}
            style={{ backgroundColor: "rgba(26, 43, 71, 0.5)" }}
            className="absolute inset-0 backdrop-blur-sm duration-150 animate-in fade-in"
          />
          <div className="relative z-10 flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-border bg-surface shadow-xl duration-200 animate-in slide-in-from-right">
            <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-gold">
                  Decision
                </div>
                <h2 className="font-display text-lg font-semibold text-navy">
                  Void or refund
                </h2>
              </div>
              <button
                onClick={close}
                aria-label="Close"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-navy-3 transition-colors hover:bg-bg hover:text-navy"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 space-y-5 px-6 py-5">
              {/* Payment context */}
              <div className="rounded-lg border border-border bg-bg p-4">
                <div className="font-display text-2xl font-semibold text-green">
                  {ghs(amount)}
                </div>
                <dl className="mt-2 space-y-1 text-xs text-navy-3">
                  <div className="flex gap-2">
                    <dt className="w-16 shrink-0">From</dt>
                    <dd className="font-medium text-navy-2">{payer}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-16 shrink-0">For</dt>
                    <dd className="font-medium text-navy-2">{studentName}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-16 shrink-0">Receipt</dt>
                    <dd className="font-mono text-navy-2">{receiptNumber}</dd>
                  </div>
                </dl>
              </div>

              {/* Decision tiles */}
              <fieldset>
                <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-navy-3">
                  What are you doing?
                </legend>
                <div className="space-y-3">
                  <DecisionTile
                    label="Void"
                    tone="terra"
                    selected={decision === "void"}
                    onSelect={() => setDecision("void")}
                    description="This payment record is wrong — wrong amount, wrong student, or a duplicate. The receipt is voided."
                  />
                  <DecisionTile
                    label="Refund"
                    tone="gold"
                    selected={decision === "refund"}
                    onSelect={() => setDecision("refund")}
                    description="The school is returning this money. The original receipt stays valid and the invoice balance is restored."
                  />
                </div>
              </fieldset>

              {/* Reason */}
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-navy-3">
                  Reason <span className="text-terra">·</span> audited
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  maxLength={300}
                  placeholder="Why is this being voided or refunded?"
                  className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-navy outline-none focus:border-gold"
                />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {PRESETS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setReason(p)}
                      className="rounded-pill border border-border-2 px-2.5 py-1 text-[11px] font-medium text-navy-2 transition-colors hover:border-gold hover:text-navy"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Refund-only: amount + method */}
              {isRefund && (
                <div className="space-y-3 rounded-lg border border-gold-soft bg-gold-bg p-4">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wide text-navy-3">
                      Refund amount
                    </div>
                    <div className="font-display text-lg font-semibold text-navy">
                      {ghs(amount)}
                    </div>
                    <p className="mt-0.5 text-[11px] text-navy-3">
                      Full refund; partial refunds aren&apos;t supported yet.
                    </p>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-navy-3">
                      Method
                    </label>
                    <input
                      value={method}
                      onChange={(e) => setMethod(e.target.value)}
                      placeholder="How was the refund issued? e.g. MTN MoMo reversal · ref"
                      className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-navy outline-none focus:border-gold"
                    />
                  </div>
                </div>
              )}

              {/* Consequences */}
              {decision && (
                <div className="rounded-r-lg border-l-2 border-terra bg-terra-bg px-4 py-3">
                  <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-terra">
                    On confirm
                  </div>
                  <ul className="space-y-1 text-xs text-navy-2">
                    <li>The invoice balance for this payment is restored.</li>
                    <li>
                      {isRefund
                        ? "The original receipt stays valid (the money was returned)."
                        : "The receipt is voided (the record was wrong)."}
                    </li>
                    <li>A permanent entry is written to the audit trail.</li>
                  </ul>
                </div>
              )}

              {/* Confirm checkbox */}
              <label className="flex items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={confirm}
                  onChange={(e) => setConfirm(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-border accent-terra"
                />
                <span className="text-navy-2">
                  I understand this cannot be undone from this screen.
                </span>
              </label>

              {error && (
                <p className="rounded-md bg-terra-bg px-3 py-2 text-sm text-terra">
                  {error}
                </p>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-4">
              <button
                type="button"
                onClick={close}
                disabled={pending}
                className="text-sm font-semibold text-navy-2 transition-colors hover:text-navy disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={!ready || pending}
                className="text-bg rounded-md bg-terra px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {pending
                  ? "Working…"
                  : `Confirm ${decision ?? "void"} of ${ghs(amount)} →`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function DecisionTile({
  label,
  tone,
  description,
  selected,
  onSelect,
}: {
  label: string;
  tone: "terra" | "gold";
  description: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const ring =
    selected && tone === "terra"
      ? "border-terra bg-terra-bg"
      : selected && tone === "gold"
        ? "border-gold bg-gold-bg"
        : "border-border-2 bg-surface hover:border-border";
  const dot = tone === "terra" ? "text-terra" : "text-gold";
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`block w-full rounded-lg border p-4 text-left transition-colors ${ring}`}
    >
      <div className="flex items-center gap-2">
        <span className={`text-sm ${dot}`} aria-hidden>
          ●
        </span>
        <span className="font-display text-base font-semibold text-navy">{label}</span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-navy-2">{description}</p>
    </button>
  );
}
