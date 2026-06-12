"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { assignStudentsToClass, removeStudentFromClass } from "@/lib/actions/classes";

type Student = { id: string; name: string; code: string };

export function RosterManager({
  classId,
  inClass,
  unassigned,
}: {
  classId: string;
  inClass: Student[];
  unassigned: Student[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function addSelected() {
    if (selected.size === 0) return;
    setBusy(true);
    setError(null);
    const res = await assignStudentsToClass({
      classId,
      studentIds: Array.from(selected),
    });
    setBusy(false);
    if (res.ok) {
      setSelected(new Set());
      setPicking(false);
      router.refresh();
    } else setError(res.error ?? "Could not add students.");
  }

  async function remove(studentId: string) {
    setBusy(true);
    setError(null);
    const res = await removeStudentFromClass({ studentId });
    setBusy(false);
    if (res.ok) router.refresh();
    else setError(res.error ?? "Could not remove.");
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-navy">
          Roster{" "}
          <span className="text-sm font-normal text-navy-3">· {inClass.length}</span>
        </h2>
        <button
          onClick={() => setPicking((v) => !v)}
          disabled={unassigned.length === 0}
          className="rounded-md border border-border-2 px-3 py-1.5 text-sm font-semibold text-navy-2 transition-colors hover:bg-bg disabled:opacity-50"
        >
          {picking ? "Close" : "+ Add students"}
        </button>
      </div>

      {picking && (
        <div className="mb-4 rounded-xl border border-border bg-surface p-4">
          {unassigned.length === 0 ? (
            <p className="text-sm text-navy-3">No unassigned students.</p>
          ) : (
            <>
              <div className="max-h-56 space-y-1 overflow-y-auto">
                {unassigned.map((s) => (
                  <label
                    key={s.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-bg"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(s.id)}
                      onChange={() => toggle(s.id)}
                    />
                    <span className="font-medium text-navy">{s.name}</span>
                    <span className="font-mono text-xs text-navy-3">{s.code}</span>
                  </label>
                ))}
              </div>
              <button
                onClick={addSelected}
                disabled={busy || selected.size === 0}
                className="mt-3 rounded-md bg-navy px-4 py-2 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-50"
              >
                Add {selected.size > 0 ? `${selected.size} ` : ""}selected
              </button>
            </>
          )}
        </div>
      )}

      {error && <p className="mb-2 text-sm text-terra">{error}</p>}

      {inClass.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border-2 bg-surface p-6 text-center text-sm text-navy-3">
          No students in this class yet.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border">
              {inClass.map((s) => (
                <tr key={s.id} className="hover:bg-bg">
                  <td className="px-4 py-2.5 font-medium text-navy">{s.name}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-navy-3">{s.code}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => remove(s.id)}
                      disabled={busy}
                      className="text-xs font-semibold text-navy-3 transition-colors hover:text-terra disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
