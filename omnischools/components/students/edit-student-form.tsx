"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateStudent } from "@/lib/actions/students";

const fieldClass =
  "w-full rounded-md border border-border-2 bg-bg px-3.5 py-2.5 text-sm text-navy outline-none transition-colors focus:border-gold focus:bg-surface";
const labelClass = "mb-1.5 block text-xs font-semibold text-navy-2";

const STATUSES = ["ACTIVE", "INACTIVE", "GRADUATED", "WITHDRAWN", "TRANSFERRED"] as const;
const title = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

type Student = {
  id: string;
  firstName: string;
  lastName: string;
  otherNames: string | null;
  sex: "MALE" | "FEMALE";
  dateOfBirth: string | null;
  classId: string | null;
  status: string;
};
type Guardian = { name: string; phone: string; relationship: string } | null;

export function EditStudentForm({
  student,
  classes,
  guardian,
}: {
  student: Student;
  classes: { id: string; name: string }[];
  guardian: Guardian;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function action(formData: FormData) {
    setSaving(true);
    setError(null);
    const res = await updateStudent({
      id: student.id,
      firstName: formData.get("firstName"),
      lastName: formData.get("lastName"),
      otherNames: formData.get("otherNames"),
      sex: formData.get("sex"),
      dateOfBirth: formData.get("dateOfBirth"),
      classId: formData.get("classId"),
      status: formData.get("status"),
      guardianName: formData.get("guardianName"),
      guardianPhone: formData.get("guardianPhone"),
      guardianRelation: formData.get("guardianRelation"),
    });
    setSaving(false);
    if (res.ok) router.push(`/students/${student.id}`);
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
          <input
            name="firstName"
            required
            defaultValue={student.firstName}
            className={fieldClass}
          />
        </div>
        <div>
          <label className={labelClass}>Last name</label>
          <input
            name="lastName"
            required
            defaultValue={student.lastName}
            className={fieldClass}
          />
        </div>
        <div>
          <label className={labelClass}>
            Other names <span className="font-medium text-navy-3">— optional</span>
          </label>
          <input
            name="otherNames"
            defaultValue={student.otherNames ?? ""}
            className={fieldClass}
          />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <div>
          <label className={labelClass}>Sex</label>
          <select name="sex" defaultValue={student.sex} className={fieldClass}>
            <option value="MALE">Male</option>
            <option value="FEMALE">Female</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>Date of birth</label>
          <input
            name="dateOfBirth"
            type="date"
            defaultValue={student.dateOfBirth ?? ""}
            className={fieldClass}
          />
        </div>
        <div>
          <label className={labelClass}>Class</label>
          <select
            name="classId"
            defaultValue={student.classId ?? ""}
            className={fieldClass}
          >
            <option value="">— unassigned —</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Status</label>
          <select name="status" defaultValue={student.status} className={fieldClass}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {title(s)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="border-t border-border pt-5">
        <h3 className="mb-3 font-display text-base font-semibold text-navy">
          Primary guardian
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className={labelClass}>Name</label>
            <input
              name="guardianName"
              defaultValue={guardian?.name ?? ""}
              className={fieldClass}
            />
          </div>
          <div>
            <label className={labelClass}>Phone</label>
            <input
              name="guardianPhone"
              defaultValue={guardian?.phone ?? ""}
              placeholder="024 000 0000"
              className={fieldClass}
            />
          </div>
          <div>
            <label className={labelClass}>Relationship</label>
            <select
              name="guardianRelation"
              defaultValue={guardian?.relationship ?? "GUARDIAN"}
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
          {saving ? "Saving…" : "Save changes"}
        </button>
        <button
          type="button"
          onClick={() => router.push(`/students/${student.id}`)}
          className="rounded-md px-4 py-2.5 text-sm font-semibold text-navy-2 hover:bg-bg"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
