"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSubject } from "@/lib/actions/gradebook";

export function NewSubjectForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="border-border-2 bg-surface rounded-md border px-4 py-2.5 text-sm font-semibold text-navy hover:bg-gold-bg"
      >
        + New subject
      </button>
    );
  }
  async function action(formData: FormData) {
    setBusy(true);
    setError(null);
    const res = await createSubject({
      name: formData.get("name"),
      code: formData.get("code"),
    });
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      router.refresh();
    } else setError(res.error ?? "Error");
  }
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input
        name="name"
        required
        placeholder="Subject (e.g. Mathematics)"
        className="border-border-2 bg-bg rounded-md border px-3 py-2 text-sm text-navy outline-none focus:border-gold"
      />
      <input
        name="code"
        placeholder="Code"
        className="border-border-2 bg-bg w-24 rounded-md border px-3 py-2 text-sm text-navy outline-none focus:border-gold"
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
