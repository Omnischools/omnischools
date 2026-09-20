"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClass } from "@/lib/actions/classes";
import { YEAR_GROUPS } from "@/lib/field-options";

const fieldClass =
  "rounded-md border border-border-2 bg-bg px-3.5 py-2.5 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface";

export function CreateClassForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function action(formData: FormData) {
    setSaving(true);
    setError(null);
    const res = await createClass({
      name: formData.get("name"),
      level: formData.get("level"),
    });
    setSaving(false);
    if (res.ok) {
      setOpen(false);
      router.refresh();
    } else setError(res.error ?? "Could not create class.");
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-md bg-navy px-4 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep"
      >
        + Add class
      </button>
    );
  }

  return (
    <form
      action={action}
      className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-4"
    >
      <div>
        <label className="mb-1.5 block text-xs font-semibold text-navy-2">
          Class name
        </label>
        <input name="name" required placeholder="JHS 1A" className={fieldClass} />
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-semibold text-navy-2">
          Level <span className="font-medium text-navy-3">— optional</span>
        </label>
        <select name="level" defaultValue="" className={fieldClass}>
          <option value="">— choose —</option>
          {YEAR_GROUPS.map((yg) => (
            <option key={yg} value={yg}>
              {yg}
            </option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        disabled={saving}
        className="rounded-md bg-navy px-5 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-60"
      >
        {saving ? "Adding…" : "Create"}
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
      {error && <p className="w-full text-sm text-terra">{error}</p>}
    </form>
  );
}
