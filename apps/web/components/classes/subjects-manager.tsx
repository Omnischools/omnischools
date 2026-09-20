"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { addSubject, renameSubject, setSubjectActive } from "@/lib/actions/classes";
import { Combobox, DataList } from "@/components/ui/fields";
import { COMMON_SUBJECTS } from "@/lib/field-options";

type Subject = { id: string; name: string };

export function SubjectsManager({ subjects }: { subjects: Subject[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function add(formData: FormData) {
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    const res = await addSubject({ name });
    setBusy(false);
    if (res.ok) {
      (document.getElementById("subj-add") as HTMLFormElement | null)?.reset();
      router.refresh();
    } else setError(res.error ?? "Could not add subject.");
  }

  async function saveRename(id: string) {
    if (!editName.trim()) return;
    setBusy(true);
    setError(null);
    const res = await renameSubject({ id, name: editName });
    setBusy(false);
    if (res.ok) {
      setEditingId(null);
      router.refresh();
    } else setError(res.error ?? "Could not rename.");
  }

  async function deactivate(id: string) {
    setBusy(true);
    await setSubjectActive({ id, active: false });
    setBusy(false);
    router.refresh();
  }

  return (
    <div>
      <h2 className="mb-3 font-display text-lg font-semibold text-navy">Subjects</h2>
      <div className="rounded-xl border border-border bg-surface p-4">
        <form id="subj-add" action={add} className="flex items-center gap-2">
          <Combobox
            listId="subj-suggest"
            name="name"
            placeholder="Add a subject (e.g. Twi, Ga, Dagbani)"
            className="flex-1"
          />
          <DataList id="subj-suggest" options={COMMON_SUBJECTS} />
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-60"
          >
            + Add
          </button>
        </form>
        {error && <p className="mt-2 text-sm text-terra">{error}</p>}

        <div className="mt-3 flex flex-wrap gap-1.5">
          {subjects.length === 0 && (
            <span className="text-sm text-navy-3">No subjects yet.</span>
          )}
          {subjects.map((s) =>
            editingId === s.id ? (
              <span
                key={s.id}
                className="inline-flex items-center gap-1 rounded-pill border border-gold bg-gold-bg py-0.5 pl-2 pr-1"
              >
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-28 bg-transparent text-xs text-navy outline-none"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => saveRename(s.id)}
                  disabled={busy}
                  className="text-xs font-semibold text-green"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setEditingId(null)}
                  className="px-1 text-navy-3"
                >
                  ×
                </button>
              </span>
            ) : (
              <span
                key={s.id}
                className="inline-flex items-center gap-1.5 rounded-pill bg-bg py-0.5 pl-2.5 pr-1 text-xs font-medium text-navy"
              >
                {s.name}
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(s.id);
                    setEditName(s.name);
                  }}
                  aria-label={`Rename ${s.name}`}
                  className="text-navy-3 hover:text-gold"
                >
                  ✎
                </button>
                <button
                  type="button"
                  onClick={() => deactivate(s.id)}
                  disabled={busy}
                  aria-label={`Remove ${s.name}`}
                  className="flex h-4 w-4 items-center justify-center rounded-full text-navy-3 hover:text-terra disabled:opacity-50"
                >
                  ×
                </button>
              </span>
            ),
          )}
        </div>
      </div>
    </div>
  );
}
