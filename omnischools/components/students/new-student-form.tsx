"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createStudent } from "@/lib/actions/students";

const fieldClass =
  "w-full rounded-md border border-border-2 bg-bg px-3.5 py-2.5 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface";
const labelClass = "mb-1.5 block text-xs font-semibold text-navy-2";

export function NewStudentForm({ classes }: { classes: { id: string; name: string }[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function action(formData: FormData) {
    setSaving(true);
    setError(null);
    const res = await createStudent({
      firstName: formData.get("firstName"),
      lastName: formData.get("lastName"),
      otherNames: formData.get("otherNames"),
      sex: formData.get("sex"),
      dateOfBirth: formData.get("dateOfBirth"),
      classId: formData.get("classId"),
      guardianName: formData.get("guardianName"),
      guardianPhone: formData.get("guardianPhone"),
      guardianRelation: formData.get("guardianRelation"),
    });
    setSaving(false);
    if (res.ok) router.push(`/students/${res.studentId}`);
    else setError(res.error);
  }

  return (
    <form
      action={action}
      className="space-y-5 rounded-xl border border-border bg-surface p-6"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label className={labelClass}>First name</label>
          <input name="firstName" required className={fieldClass} />
        </div>
        <div>
          <label className={labelClass}>Last name</label>
          <input name="lastName" required className={fieldClass} />
        </div>
        <div>
          <label className={labelClass}>
            Other names <span className="font-medium text-navy-3">— optional</span>
          </label>
          <input name="otherNames" className={fieldClass} />
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
            Class <span className="font-medium text-navy-3">— optional</span>
          </label>
          <select name="classId" defaultValue="" className={fieldClass}>
            <option value="">— unassigned —</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="border-t border-border pt-5">
        <h3 className="mb-3 font-display text-base font-semibold text-navy">
          Primary guardian{" "}
          <span className="text-sm font-normal text-navy-3">— optional</span>
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className={labelClass}>Name</label>
            <input name="guardianName" className={fieldClass} />
          </div>
          <div>
            <label className={labelClass}>Phone</label>
            <input
              name="guardianPhone"
              placeholder="024 000 0000"
              className={fieldClass}
            />
          </div>
          <div>
            <label className={labelClass}>Relationship</label>
            <select
              name="guardianRelation"
              defaultValue="GUARDIAN"
              className={fieldClass}
            >
              <option value="MOTHER">Mother</option>
              <option value="FATHER">Father</option>
              <option value="GUARDIAN">Guardian</option>
              <option value="OTHER">Other</option>
            </select>
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-terra">{error}</p>}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-navy px-5 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-60"
        >
          {saving ? "Saving…" : "Create student"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/students")}
          className="rounded-md px-4 py-2.5 text-sm font-semibold text-navy-2 hover:bg-bg"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
