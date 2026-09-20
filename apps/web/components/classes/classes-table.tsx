"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { updateClass, deleteClass, deleteClasses } from "@/lib/actions/classes";
import { ClassTeacherSelect } from "@/components/classes/class-teacher-select";
import { YEAR_GROUPS } from "@/lib/field-options";
import type { StaffOption } from "@/lib/data/staff-options";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  BulkBar,
  HeaderCheckbox,
  RowCheckbox,
  useSelection,
} from "@/components/ui/selection";

const inputClass =
  "w-full rounded-md border border-border-2 bg-bg px-2.5 py-1.5 text-sm text-navy outline-none focus:border-gold focus:bg-surface";

type ClassRow = {
  id: string;
  name: string;
  level: string | null;
  teacherId: string | null;
  size: number;
};

export function ClassesTable({
  rows,
  staff,
  readOnly = false,
}: {
  rows: ClassRow[];
  staff: StaffOption[];
  readOnly?: boolean;
}) {
  const router = useRouter();
  const ids = rows.map((r) => r.id);
  const teacherName = new Map(staff.map((s) => [s.id, s.name]));
  const { selected, toggle, setAll, clear, count } = useSelection();
  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
  const someSelected = count > 0 && !allSelected;

  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [level, setLevel] = useState("");
  const [rowBusy, setRowBusy] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  const [toDelete, setToDelete] = useState<ClassRow | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [delBusy, setDelBusy] = useState(false);
  const [delError, setDelError] = useState<string | null>(null);

  function startEdit(c: ClassRow) {
    setEditId(c.id);
    setName(c.name);
    setLevel(c.level ?? "");
    setRowError(null);
  }

  async function saveEdit() {
    if (!editId) return;
    setRowBusy(true);
    setRowError(null);
    const res = await updateClass({ classId: editId, name, level: level || null });
    setRowBusy(false);
    if (res.ok) {
      setEditId(null);
      router.refresh();
    } else setRowError(res.error ?? "Could not save.");
  }

  async function confirmSingle() {
    if (!toDelete) return;
    setDelBusy(true);
    setDelError(null);
    const res = await deleteClass({ classId: toDelete.id });
    setDelBusy(false);
    if (res.ok) {
      setToDelete(null);
      router.refresh();
    } else setDelError(res.error ?? "Could not delete.");
  }

  async function confirmBulk() {
    setDelBusy(true);
    setDelError(null);
    const res = await deleteClasses({ classIds: Array.from(selected) });
    setDelBusy(false);
    if (res.ok) {
      setBulkOpen(false);
      clear();
      router.refresh();
    } else setDelError(res.error ?? "Could not delete.");
  }

  return (
    <>
      {!readOnly && (
        <BulkBar
          count={count}
          singular="class"
          plural="classes"
          onClear={clear}
          onDelete={() => {
            setDelError(null);
            setBulkOpen(true);
          }}
        />
      )}
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-bg text-left text-xs uppercase tracking-wide text-navy-3">
            <tr>
              {!readOnly && (
                <th className="w-10 px-4 py-3">
                  <HeaderCheckbox
                    checked={allSelected}
                    indeterminate={someSelected}
                    onChange={() => setAll(ids, !allSelected)}
                  />
                </th>
              )}
              <th className="px-4 py-3 font-semibold">Class</th>
              <th className="px-4 py-3 font-semibold">Level</th>
              <th className="px-4 py-3 font-semibold">Class teacher</th>
              <th className="px-4 py-3 font-semibold">Students</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((c) => {
              const editing = editId === c.id;
              return (
                <tr key={c.id} className="align-top transition-colors hover:bg-bg">
                  {!readOnly && (
                    <td className="px-4 py-3">
                      <RowCheckbox
                        checked={selected.has(c.id)}
                        onChange={() => toggle(c.id)}
                        label={`Select ${c.name}`}
                      />
                    </td>
                  )}
                  <td className="px-4 py-3 font-medium text-navy">
                    {editing ? (
                      <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className={inputClass}
                      />
                    ) : (
                      <Link href={`/classes/${c.id}`} className="hover:text-gold">
                        {c.name}
                      </Link>
                    )}
                  </td>
                  <td className="px-4 py-3 text-navy-2">
                    {editing ? (
                      <select
                        value={level}
                        onChange={(e) => setLevel(e.target.value)}
                        className={inputClass}
                      >
                        <option value="">— none —</option>
                        {YEAR_GROUPS.map((yg) => (
                          <option key={yg} value={yg}>
                            {yg}
                          </option>
                        ))}
                      </select>
                    ) : (
                      (c.level ?? "—")
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {readOnly ? (
                      <span className="text-navy-2">
                        {c.teacherId ? (teacherName.get(c.teacherId) ?? "—") : "—"}
                      </span>
                    ) : (
                      <ClassTeacherSelect
                        classId={c.id}
                        current={c.teacherId}
                        staff={staff}
                      />
                    )}
                  </td>
                  <td className="px-4 py-3 text-navy-2">{c.size}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    {editing ? (
                      <>
                        <button
                          onClick={saveEdit}
                          disabled={rowBusy}
                          className="mr-3 text-xs font-semibold text-green disabled:opacity-50"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => {
                            setEditId(null);
                            setRowError(null);
                          }}
                          className="text-xs font-semibold text-navy-3 hover:text-navy"
                        >
                          Cancel
                        </button>
                        {rowError && (
                          <div className="mt-1 text-xs text-terra">{rowError}</div>
                        )}
                      </>
                    ) : (
                      <>
                        {!readOnly && (
                          <button
                            onClick={() => startEdit(c)}
                            className="mr-3 text-xs font-semibold text-navy-3 transition-colors hover:text-gold"
                          >
                            Edit
                          </button>
                        )}
                        <Link
                          href={`/classes/${c.id}`}
                          className={
                            readOnly
                              ? "text-xs font-semibold text-gold hover:underline"
                              : "mr-3 text-xs font-semibold text-gold hover:underline"
                          }
                        >
                          Open
                        </Link>
                        {!readOnly && (
                          <button
                            onClick={() => {
                              setDelError(null);
                              setToDelete(c);
                            }}
                            className="text-xs font-semibold text-navy-3 transition-colors hover:text-terra"
                          >
                            Delete
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={!!toDelete}
        title="Delete class?"
        busy={delBusy}
        error={delError}
        confirmLabel="Delete class"
        onClose={() => setToDelete(null)}
        onConfirm={confirmSingle}
        message={
          toDelete ? (
            <>
              Delete <strong className="text-navy">{toDelete.name}</strong>?{" "}
              {toDelete.size > 0 ? (
                <>
                  Its {toDelete.size} student{toDelete.size === 1 ? "" : "s"} will be
                  unassigned (not deleted).{" "}
                </>
              ) : null}
              Its timetable and attendance records will be removed. This can&apos;t be
              undone.
            </>
          ) : null
        }
      />

      <ConfirmDialog
        open={bulkOpen}
        title="Delete classes?"
        busy={delBusy}
        error={delError}
        confirmLabel={`Delete ${count} ${count === 1 ? "class" : "classes"}`}
        onClose={() => setBulkOpen(false)}
        onConfirm={confirmBulk}
        message={
          <>
            Delete <strong className="text-navy">{count}</strong> selected{" "}
            {count === 1 ? "class" : "classes"}? Students in them will be unassigned (not
            deleted); their timetables and attendance records will be removed. This
            can&apos;t be undone.
          </>
        }
      />
    </>
  );
}
