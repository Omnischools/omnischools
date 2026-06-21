"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { recordPayment } from "@/lib/actions/fees";

const fieldClass =
  "w-full rounded-md border border-border-2 bg-bg px-3.5 py-2.5 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface";
const labelClass = "mb-1.5 block text-xs font-semibold text-navy-2";

const METHODS = [
  ["MTN_MOMO", "MTN MoMo"],
  ["TELECEL_CASH", "Telecel Cash"],
  ["AIRTELTIGO_MONEY", "AirtelTigo Money"],
  ["CASH", "Cash"],
  ["BANK_TRANSFER", "Bank transfer"],
  ["CHEQUE", "Cheque"],
  ["OTHER", "Other"],
] as const;

type Outstanding = { id: string; invoiceNumber: string; balance: number };

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const ghs = (n: number) => `GHS ${round2(n).toFixed(2)}`;
const parse = (v: string | undefined) => {
  const n = Number.parseFloat(v ?? "");
  return Number.isFinite(n) ? n : 0;
};

/** Spread `amount` across outstanding invoices, oldest first, capped at each balance. */
function autoFill(amount: number, outstanding: Outstanding[]): Record<string, string> {
  let rem = round2(amount);
  const next: Record<string, string> = {};
  for (const inv of outstanding) {
    const give = Math.max(0, Math.min(inv.balance, rem));
    next[inv.id] = give > 0 ? round2(give).toFixed(2) : "";
    rem = round2(rem - give);
  }
  return next;
}

export function RecordPaymentForm({
  studentId,
  outstanding,
}: {
  studentId: string;
  outstanding: Outstanding[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const [gross, setGross] = useState("");
  const [method, setMethod] = useState("");
  const [reference, setReference] = useState("");
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState(false);

  const grossNum = round2(parse(gross));
  const hasInvoices = outstanding.length > 0;

  const { allocatedTotal, credit, overInvoice, overGross } = useMemo(() => {
    let total = 0;
    let over = false;
    for (const inv of outstanding) {
      const v = round2(parse(alloc[inv.id]));
      total += v;
      if (v > inv.balance + 0.001) over = true;
    }
    total = round2(total);
    return {
      allocatedTotal: total,
      credit: round2(Math.max(0, grossNum - total)),
      overInvoice: over,
      overGross: total > grossNum + 0.001,
    };
  }, [alloc, outstanding, grossNum]);

  function changeGross(v: string) {
    setGross(v);
    if (!touched && hasInvoices) setAlloc(autoFill(round2(parse(v)), outstanding));
  }
  function changeAlloc(id: string, v: string) {
    setTouched(true);
    setAlloc((prev) => ({ ...prev, [id]: v }));
  }
  function reAuto() {
    setTouched(false);
    setAlloc(autoFill(grossNum, outstanding));
  }
  function clearAlloc() {
    setTouched(true);
    setAlloc({});
  }

  function reset() {
    setGross("");
    setMethod("");
    setReference("");
    setAlloc({});
    setTouched(false);
    setError(null);
  }

  const blocked = grossNum <= 0 || !method || overInvoice || overGross;

  async function submit() {
    if (blocked) return;
    setSaving(true);
    setError(null);
    const res = await recordPayment({
      studentId,
      method,
      grossAmount: grossNum,
      methodReference: reference,
      allocations: hasInvoices
        ? outstanding.map((inv) => ({ invoiceId: inv.id, amount: parse(alloc[inv.id]) }))
        : undefined,
    });
    setSaving(false);
    if (res.ok) {
      setDone(res.receiptNumber);
      reset();
      router.refresh();
    } else {
      setError(res.error);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => {
          setOpen(true);
          setDone(null);
        }}
        className="rounded-md bg-green px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
      >
        Record payment
      </button>
    );
  }

  return (
    <div className="bg-surface w-full max-w-xl rounded-xl border border-border p-5">
      {done ? (
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-navy">
            ✓ Payment recorded · receipt <span className="font-mono">{done}</span> ·
            guardian notified by SMS.
          </p>
          <button
            onClick={() => setOpen(false)}
            className="hover:bg-bg rounded-md px-3 py-1.5 text-sm font-semibold text-navy-2"
          >
            Close
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className={labelClass}>Amount (GHS)</label>
              <input
                value={gross}
                onChange={(e) => changeGross(e.target.value)}
                type="number"
                step="0.01"
                min="0"
                required
                className={fieldClass}
              />
            </div>
            <div>
              <label className={labelClass}>Method</label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                required
                className={fieldClass}
              >
                <option value="" disabled>
                  Choose
                </option>
                {METHODS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>
                Reference <span className="font-medium text-navy-3">— optional</span>
              </label>
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="MoMo txn id"
                className={fieldClass}
              />
            </div>
          </div>

          {hasInvoices ? (
            <div className="rounded-lg border border-border-2 bg-bg p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-navy-3">
                  Allocate across invoices
                </span>
                <div className="flex items-center gap-3 text-xs font-semibold">
                  <button
                    type="button"
                    onClick={reAuto}
                    className="text-gold hover:underline"
                  >
                    Auto (oldest first)
                  </button>
                  <button
                    type="button"
                    onClick={clearAlloc}
                    className="text-navy-3 hover:text-navy"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                {outstanding.map((inv) => {
                  const v = round2(parse(alloc[inv.id]));
                  const bad = v > inv.balance + 0.001;
                  return (
                    <div key={inv.id} className="flex items-center gap-3 text-sm">
                      <span className="w-28 shrink-0 font-mono text-xs text-navy-2">
                        {inv.invoiceNumber}
                      </span>
                      <span className="flex-1 text-xs text-navy-3">
                        bal {ghs(inv.balance)}
                        <button
                          type="button"
                          onClick={() => changeAlloc(inv.id, inv.balance.toFixed(2))}
                          className="ml-2 text-gold hover:underline"
                        >
                          full
                        </button>
                      </span>
                      <input
                        value={alloc[inv.id] ?? ""}
                        onChange={(e) => changeAlloc(inv.id, e.target.value)}
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        className={`w-28 rounded-md border bg-surface px-2.5 py-1.5 text-right text-sm text-navy outline-none focus:border-gold ${
                          bad ? "border-terra" : "border-border-2"
                        }`}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex flex-wrap justify-between gap-x-6 gap-y-1 border-t border-border-2 pt-2 text-xs">
                <span className={overGross ? "font-semibold text-terra" : "text-navy-3"}>
                  Allocated <b className="text-navy">{ghs(allocatedTotal)}</b>
                  {overGross && " — exceeds payment"}
                </span>
                <span className="text-navy-3">
                  Held as credit <b className="text-navy">{ghs(credit)}</b>
                </span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-navy-3">
              No outstanding invoices — the full amount is held as credit.
            </p>
          )}

          {error && <p className="text-sm text-terra">{error}</p>}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={submit}
              disabled={saving || blocked}
              className="text-bg rounded-md bg-navy px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-navy-deep disabled:opacity-60"
            >
              {saving ? "Recording…" : "Record & receipt"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="hover:bg-bg rounded-md px-3 py-2.5 text-sm font-semibold text-navy-2"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
