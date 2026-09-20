"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClass, setStudentClass } from "@/lib/actions/attendance";

/** Create a new class/form. */
export function NewClassForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-bg rounded-md bg-navy px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-navy-deep"
      >
        + New class
      </button>
    );
  }
  async function action(formData: FormData) {
    setBusy(true);
    setError(null);
    const res = await createClass({
      name: formData.get("name"),
      level: formData.get("level"),
    });
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      router.refresh();
    } else setError(res.error);
  }
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input
        name="name"
        required
        placeholder="Class name (JHS 1A)"
        className="border-border-2 bg-bg rounded-md border px-3 py-2 text-sm text-navy outline-none focus:border-gold"
      />
      <input
        name="level"
        placeholder="Level (JHS 1)"
        className="border-border-2 bg-bg rounded-md border px-3 py-2 text-sm text-navy outline-none focus:border-gold"
      />
      <button
        type="submit"
        disabled={busy}
        className="text-bg rounded-md bg-navy px-4 py-2 text-sm font-semibold hover:bg-navy-deep disabled:opacity-60"
      >
        {busy ? "Adding…" : "Add"}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="px-2 text-sm text-navy-3"
      >
        cancel
      </button>
      {error && <span className="w-full text-sm text-terra">{error}</span>}
    </form>
  );
}

/** Assign a single student to a class (inline select). */
export function AssignStudent({
  studentId,
  classOptions,
}: {
  studentId: string;
  classOptions: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <select
      defaultValue=""
      disabled={pending}
      onChange={(e) => {
        const classId = e.target.value;
        if (!classId) return;
        startTransition(async () => {
          await setStudentClass({ studentId, classId });
          router.refresh();
        });
      }}
      className="border-border-2 bg-bg rounded-md border px-2 py-1.5 text-sm text-navy outline-none focus:border-gold disabled:opacity-50"
    >
      <option value="">Assign to class…</option>
      {classOptions.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}
