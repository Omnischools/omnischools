"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createDiscount, deleteDiscount } from "@/lib/actions/billing";
import { DataList } from "@/components/ui/fields";
import { DEFAULT_DISCOUNTS } from "@/lib/field-options";

const ghs = (n: number) => `GH₵ ${n.toFixed(2)}`;
const fieldClass =
  "rounded-md border border-border-2 bg-bg px-3 py-2 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface";

type DiscountOpt = { id: string; name: string; kind: string; value: number };

export function DiscountManager({ discounts }: { discounts: DiscountOpt[] }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(formData: FormData) {
    setSaving(true);
    setError(null);
    const res = await createDiscount({
      name: formData.get("name"),
      kind: formData.get("kind"),
      value: formData.get("value"),
    });
    setSaving(false);
    if (res.ok) {
      (document.getElementById("discount-form") as HTMLFormElement | null)?.reset();
      router.refresh();
    } else setError(res.error ?? "Could not create.");
  }

  async function remove(id: string) {
    setSaving(true);
    await deleteDiscount({ id });
    setSaving(false);
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <form id="discount-form" action={add} className="flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs font-semibold text-navy-2">Name</label>
          <input
            name="name"
            list="discount-names"
            required
            placeholder="Pick or type"
            className={fieldClass}
          />
          <DataList id="discount-names" options={DEFAULT_DISCOUNTS} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-navy-2">Type</label>
          <select name="kind" defaultValue="FIXED" className={fieldClass}>
            <option value="FIXED">Fixed (GH₵)</option>
            <option value="PERCENT">Percent (%)</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-navy-2">Value</label>
          <input
            name="value"
            required
            type="number"
            min={0}
            step="0.01"
            placeholder="50"
            className={`${fieldClass} w-24`}
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-60"
        >
          Add discount
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-terra">{error}</p>}

      {discounts.length > 0 && (
        <div className="mt-4 divide-y divide-border border-t border-border">
          {discounts.map((d) => (
            <div key={d.id} className="flex items-center justify-between py-2.5 text-sm">
              <span className="font-medium text-navy">{d.name}</span>
              <div className="flex items-center gap-4">
                <span className="text-navy-2">
                  {d.kind === "PERCENT" ? `${d.value}%` : ghs(d.value)}
                </span>
                <button
                  onClick={() => remove(d.id)}
                  disabled={saving}
                  className="text-xs font-semibold text-navy-3 transition-colors hover:text-terra disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
