"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createFeeStructure } from "@/lib/actions/billing";
import { DataList, fieldClass, labelClass } from "@/components/ui/fields";
import { DEFAULT_FEE_ITEMS, YEAR_GROUPS } from "@/lib/field-options";

const lineInput =
  "rounded-md border border-border-2 bg-bg px-3 py-2 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface";

type Item = { description: string; amount: string };

export function CreateFeeStructureForm({
  defaultYear,
  feeItemOptions = [],
  levelOptions = [],
  yearOptions = [],
}: {
  defaultYear: string;
  feeItemOptions?: string[];
  levelOptions?: string[];
  yearOptions?: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([{ description: "Tuition", amount: "" }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const itemOptions = Array.from(new Set([...DEFAULT_FEE_ITEMS, ...feeItemOptions]));
  const levels = levelOptions.length > 0 ? levelOptions : [...YEAR_GROUPS];
  const years = Array.from(new Set([defaultYear, ...yearOptions]));

  function setItem(i: number, patch: Partial<Item>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }

  async function action(formData: FormData) {
    setSaving(true);
    setError(null);
    const res = await createFeeStructure({
      name: formData.get("name"),
      level: formData.get("level"),
      academicYear: formData.get("academicYear"),
      items: items
        .filter((it) => it.description.trim() && it.amount)
        .map((it) => ({ description: it.description, amount: it.amount })),
    });
    setSaving(false);
    if (res.ok) {
      setOpen(false);
      setItems([{ description: "Tuition", amount: "" }]);
      router.refresh();
    } else setError(res.error ?? "Could not create.");
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-md bg-navy px-4 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep"
      >
        + New fee structure
      </button>
    );
  }

  return (
    <form
      action={action}
      className="w-full space-y-4 rounded-xl border border-border bg-surface p-6"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className={labelClass}>Name</label>
          <input name="name" required placeholder="JHS 1 fees" className={fieldClass} />
        </div>
        <div>
          <label className={labelClass}>Level</label>
          <select name="level" defaultValue="" className={fieldClass}>
            <option value="">— choose —</option>
            {levels.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Academic year</label>
          <select name="academicYear" defaultValue={defaultYear} className={fieldClass}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className={labelClass}>Line items</label>
        <DataList id="fee-items" options={itemOptions} />
        <div className="space-y-2">
          {items.map((it, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                list="fee-items"
                value={it.description}
                onChange={(e) => setItem(i, { description: e.target.value })}
                placeholder="Item — pick or type (e.g. Tuition)"
                className={`${lineInput} min-w-0 flex-1`}
              />
              <input
                value={it.amount}
                onChange={(e) => setItem(i, { amount: e.target.value })}
                type="number"
                min={0}
                step="0.01"
                placeholder="0.00"
                className={`${lineInput} w-28 shrink-0`}
              />
              {items.length > 1 && (
                <button
                  type="button"
                  onClick={() => setItems((prev) => prev.filter((_, idx) => idx !== i))}
                  className="shrink-0 px-1 text-navy-3 hover:text-terra"
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
          onClick={() => setItems((prev) => [...prev, { description: "", amount: "" }])}
          className="mt-2 text-xs font-semibold text-gold hover:underline"
        >
          + Add line
        </button>
      </div>

      {error && <p className="text-sm text-terra">{error}</p>}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-navy px-5 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-60"
        >
          {saving ? "Saving…" : "Create structure"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="px-3 py-2.5 text-sm font-semibold text-navy-2 hover:text-navy"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
