"use client";
import { useState } from "react";
import { submitApplication } from "@/lib/actions/admissions";

const fieldClass =
  "w-full rounded-md border border-border-2 bg-bg px-3.5 py-2.5 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface";
const labelClass = "mb-1.5 block text-xs font-semibold text-navy-2";

export function ApplyForm({ schoolCode }: { schoolCode: string }) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function action(formData: FormData) {
    setSaving(true);
    setError(null);
    const res = await submitApplication({
      schoolCode,
      applicantFirstName: formData.get("applicantFirstName"),
      applicantLastName: formData.get("applicantLastName"),
      applicantOtherNames: formData.get("applicantOtherNames"),
      sex: formData.get("sex"),
      dateOfBirth: formData.get("dateOfBirth"),
      desiredClassLabel: formData.get("desiredClassLabel"),
      guardianName: formData.get("guardianName"),
      guardianPhone: formData.get("guardianPhone"),
      guardianEmail: formData.get("guardianEmail"),
    });
    setSaving(false);
    if (res.ok) setDone(true);
    else setError(res.error);
  }

  if (done) {
    return (
      <div className="bg-surface rounded-2xl border border-border p-9 text-center shadow-md">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-bg font-display text-xl text-green">
          ✓
        </div>
        <h2 className="mb-2 font-display text-2xl font-semibold text-navy">
          Application received.
        </h2>
        <p className="mx-auto max-w-[360px] text-sm text-navy-2">
          The school will review and contact the guardian by SMS. Thank you.
        </p>
      </div>
    );
  }

  return (
    <form
      action={action}
      className="bg-surface space-y-5 rounded-2xl border border-border p-6 shadow-md"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label className={labelClass}>Applicant first name</label>
          <input name="applicantFirstName" required className={fieldClass} />
        </div>
        <div>
          <label className={labelClass}>Last name</label>
          <input name="applicantLastName" required className={fieldClass} />
        </div>
        <div>
          <label className={labelClass}>
            Other names <span className="font-medium text-navy-3">— optional</span>
          </label>
          <input name="applicantOtherNames" className={fieldClass} />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label className={labelClass}>Sex</label>
          <select name="sex" required defaultValue="" className={fieldClass}>
            <option value="" disabled>
              Choose
            </option>
            <option value="MALE">Male</option>
            <option value="FEMALE">Female</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>
            Date of birth <span className="font-medium text-navy-3">— optional</span>
          </label>
          <input name="dateOfBirth" type="date" className={fieldClass} />
        </div>
        <div>
          <label className={labelClass}>
            Class applying for <span className="font-medium text-navy-3">— optional</span>
          </label>
          <input
            name="desiredClassLabel"
            placeholder="e.g. JHS 1"
            className={fieldClass}
          />
        </div>
      </div>
      <div className="border-t border-border pt-5">
        <h3 className="mb-3 font-display text-base font-semibold text-navy">Guardian</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className={labelClass}>Name</label>
            <input name="guardianName" required className={fieldClass} />
          </div>
          <div>
            <label className={labelClass}>Phone</label>
            <input
              name="guardianPhone"
              required
              placeholder="024 000 0000"
              className={fieldClass}
            />
          </div>
          <div>
            <label className={labelClass}>
              Email <span className="font-medium text-navy-3">— optional</span>
            </label>
            <input name="guardianEmail" type="email" className={fieldClass} />
          </div>
        </div>
      </div>
      {error && <p className="text-sm text-terra">{error}</p>}
      <button
        type="submit"
        disabled={saving}
        className="text-bg rounded-md bg-navy px-6 py-3 text-sm font-semibold transition-colors hover:bg-navy-deep disabled:opacity-60"
      >
        {saving ? "Submitting…" : "Submit application"}
      </button>
    </form>
  );
}
