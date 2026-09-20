"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { issueInvoice } from "@/lib/actions/fees";

const fieldClass =
  "w-full rounded-md border border-border-2 bg-bg px-3 py-2 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface";
const labelClass = "mb-1.5 block text-xs font-semibold text-navy-2";

type Line = { description: string; amount: string };
export type DiscountScheme = {
  id: string;
  name: string;
  kind: string;
  value: number;
  isTiered: boolean;
};

export function IssueInvoiceForm({
  studentId,
  schemes = [],
}: {
  studentId: string;
  schemes?: DiscountScheme[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([{ description: "Tuition", amount: "" }]);
  const [discount, setDiscount] = useState("0");
  const [discountId, setDiscountId] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const subtotal = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const total = subtotal - (Number(discount) || 0);

  function setLine(i: number, key: keyof Line, v: string) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, [key]: v } : l)));
  }

  // Selecting a scheme attributes the discount and pre-fills a suggested amount
  // (fixed = its value; percent = applied to the current subtotal; tiered varies
  // by sibling rank, so it's left for the bursar to enter).
  function pickScheme(id: string) {
    setDiscountId(id);
    const s = schemes.find((x) => x.id === id);
    if (!s || s.isTiered) return;
    if (s.kind === "PERCENT") setDiscount(((subtotal * s.value) / 100).toFixed(2));
    else setDiscount(s.value.toFixed(2));
  }

  async function submit() {
    setSaving(true);
    setError(null);
    const res = await issueInvoice({
      studentId,
      discountAmount: discount,
      discountId: discountId || "",
      dueAt,
      lineItems: lines
        .filter((l) => l.description && l.amount)
        .map((l) => ({ description: l.description, amount: l.amount })),
    });
    setSaving(false);
    if (res.ok) {
      setOpen(false);
      setLines([{ description: "Tuition", amount: "" }]);
      setDiscount("0");
      setDiscountId("");
      setDueAt("");
      router.refresh();
    } else {
      setError(res.error);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="border-border-2 bg-surface rounded-md border px-4 py-2.5 text-sm font-semibold text-navy transition-colors hover:bg-gold-bg"
      >
        Issue invoice
      </button>
    );
  }

  return (
    <div className="bg-surface rounded-xl border border-border p-5">
      <h3 className="mb-3 font-display text-base font-semibold text-navy">New invoice</h3>
      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="flex gap-2">
            <input
              className={fieldClass}
              placeholder="Description (e.g. Tuition)"
              value={l.description}
              onChange={(e) => setLine(i, "description", e.target.value)}
            />
            <input
              className="border-border-2 bg-bg w-32 rounded-md border px-3 py-2 text-sm text-navy outline-none focus:border-gold"
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={l.amount}
              onChange={(e) => setLine(i, "amount", e.target.value)}
            />
            {lines.length > 1 && (
              <button
                type="button"
                onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
                className="rounded-md px-2 text-navy-3 hover:text-terra"
                aria-label="Remove line"
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setLines((ls) => [...ls, { description: "", amount: "" }])}
        className="mt-2 text-sm font-semibold text-gold hover:underline"
      >
        + Add line
      </button>

      {schemes.length > 0 && (
        <div className="mt-4">
          <label className={labelClass}>
            Discount scheme <span className="font-medium text-navy-3">— optional</span>
          </label>
          <select
            className={fieldClass}
            value={discountId}
            onChange={(e) => pickScheme(e.target.value)}
          >
            <option value="">No scheme — manual discount</option>
            {schemes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.isTiered
                  ? " · tiered"
                  : s.kind === "PERCENT"
                    ? ` · ${s.value}%`
                    : ` · GHS ${s.value.toFixed(2)}`}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-navy-3">
            Attributing the discount to a scheme powers the Discounts report.
          </p>
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass}>Discount (GHS)</label>
          <input
            className={fieldClass}
            type="number"
            step="0.01"
            min="0"
            value={discount}
            onChange={(e) => setDiscount(e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>
            Due date <span className="font-medium text-navy-3">— optional</span>
          </label>
          <input
            className={fieldClass}
            type="date"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
          />
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
        <span className="text-sm text-navy-3">
          Billed total:{" "}
          <span className="font-display text-lg font-semibold text-navy">
            GHS {Math.max(0, total).toFixed(2)}
          </span>
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="hover:bg-bg rounded-md px-3 py-2 text-sm font-semibold text-navy-2"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="text-bg rounded-md bg-navy px-5 py-2 text-sm font-semibold transition-colors hover:bg-navy-deep disabled:opacity-60"
          >
            {saving ? "Issuing…" : "Issue invoice"}
          </button>
        </div>
      </div>
      {error && <p className="mt-3 text-sm text-terra">{error}</p>}
    </div>
  );
}
