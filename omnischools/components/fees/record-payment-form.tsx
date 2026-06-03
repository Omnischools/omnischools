"use client";
import { useState } from "react";
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

export function RecordPaymentForm({ studentId }: { studentId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  async function action(formData: FormData) {
    setSaving(true);
    setError(null);
    const res = await recordPayment({
      studentId,
      method: formData.get("method"),
      grossAmount: formData.get("grossAmount"),
      methodReference: formData.get("methodReference"),
    });
    setSaving(false);
    if (res.ok) {
      setDone(res.receiptNumber);
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
    <div className="bg-surface rounded-xl border border-border p-5">
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
        <form action={action} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className={labelClass}>Amount (GHS)</label>
              <input
                name="grossAmount"
                type="number"
                step="0.01"
                min="0"
                required
                className={fieldClass}
              />
            </div>
            <div>
              <label className={labelClass}>Method</label>
              <select name="method" required defaultValue="" className={fieldClass}>
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
                name="methodReference"
                placeholder="MoMo txn id"
                className={fieldClass}
              />
            </div>
          </div>
          <p className="text-xs text-navy-3">
            Auto-allocated oldest invoice first; any excess is held as credit.
          </p>
          {error && <p className="text-sm text-terra">{error}</p>}
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
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
        </form>
      )}
    </div>
  );
}
