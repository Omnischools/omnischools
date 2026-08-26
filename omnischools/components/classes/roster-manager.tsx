"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  assignStudentsToClass,
  removeStudentFromClass,
  assignStudentHouse,
} from "@/lib/actions/classes";

type Student = { id: string; name: string; code: string };
type RosterStudent = Student & {
  houseId?: string | null;
  houseColour?: string | null;
  houseName?: string | null;
};
type SportsHouse = { id: string; name: string; colour: string | null };

export function RosterManager({
  classId,
  inClass,
  unassigned,
  sportsHouses = [],
}: {
  classId: string;
  inClass: RosterStudent[];
  unassigned: Student[];
  sportsHouses?: SportsHouse[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Show the House column when there is a sports house to assign, or any pupil already has a House
  // to display (honest empty otherwise — no column, no placeholder).
  const canPick = sportsHouses.length > 0;
  const showHouse = canPick || inClass.some((s) => s.houseColour);

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

  async function setHouse(studentId: string, houseId: string | null) {
    setBusy(true);
    setError(null);
    const res = await assignStudentHouse({ studentId, houseId });
    setBusy(false);
    if (res.ok) router.refresh();
    else setError(res.error ?? "Could not update the house.");
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
                  {showHouse && (
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        {s.houseColour ? (
                          // House dot — colour is USER DATA, inline style only (no-alpha-token rule
                          // doesn't apply). Null house → no dot, no placeholder.
                          <span
                            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-border-2"
                            style={{ backgroundColor: s.houseColour }}
                            title={s.houseName ?? undefined}
                            aria-label={s.houseName ?? undefined}
                          />
                        ) : null}
                        {canPick ? (
                          <select
                            value={s.houseId ?? ""}
                            disabled={busy}
                            onChange={(e) => setHouse(s.id, e.target.value || null)}
                            aria-label="House"
                            className="rounded-md border border-border-2 bg-surface px-2 py-1 text-xs font-medium text-navy disabled:opacity-50"
                          >
                            <option value="">None</option>
                            {sportsHouses.map((h) => (
                              <option key={h.id} value={h.id}>
                                {h.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-xs text-navy-3">{s.houseName ?? "—"}</span>
                        )}
                      </div>
                    </td>
                  )}
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
