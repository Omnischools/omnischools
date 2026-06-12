"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { addStaff } from "@/lib/actions/staff";
import { STAFF_ROLES } from "@/lib/staff-roles";

const fieldClass =
  "w-full rounded-md border border-border-2 bg-bg px-3.5 py-2.5 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface";
const labelClass = "mb-1.5 block text-xs font-semibold text-navy-2";

export function AddStaffForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function action(formData: FormData) {
    setSaving(true);
    setError(null);
    const res = await addStaff({
      fullName: formData.get("fullName"),
      phone: formData.get("phone"),
      email: formData.get("email"),
      role: formData.get("role"),
    });
    setSaving(false);
    if (res.ok) {
      setOpen(false);
      router.refresh();
    } else {
      setError(res.error ?? "Could not add staff.");
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-md bg-navy px-4 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep"
      >
        + Add staff
      </button>
    );
  }

  return (
    <form
      action={action}
      className="mb-5 space-y-4 rounded-xl border border-border bg-surface p-6"
    >
      <h2 className="font-display text-lg font-semibold text-navy">Add staff member</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass}>Full name</label>
          <input name="fullName" required className={fieldClass} />
        </div>
        <div>
          <label className={labelClass}>Phone (login)</label>
          <input
            name="phone"
            required
            placeholder="024 000 0000"
            className={fieldClass}
          />
        </div>
        <div>
          <label className={labelClass}>
            Email <span className="font-medium text-navy-3">— optional</span>
          </label>
          <input name="email" type="email" className={fieldClass} />
        </div>
        <div>
          <label className={labelClass}>Role</label>
          <select name="role" required defaultValue="TEACHER" className={fieldClass}>
            {STAFF_ROLES.map((r) => (
              <option key={r.code} value={r.code}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error && <p className="text-sm text-terra">{error}</p>}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-navy px-5 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-60"
        >
          {saving ? "Adding…" : "Add staff"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="rounded-md px-4 py-2.5 text-sm font-semibold text-navy-2 hover:bg-bg"
        >
          Cancel
        </button>
      </div>
      <p className="text-xs text-navy-3">
        They sign in with this phone number via OTP. Phone numbers are normalised to Ghana
        (+233) format.
      </p>
    </form>
  );
}
