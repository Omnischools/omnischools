"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { deleteStudent, deleteStudents } from "@/lib/actions/students";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  BulkBar,
  HeaderCheckbox,
  RowCheckbox,
  useSelection,
} from "@/components/ui/selection";

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "bg-green-bg text-green",
  INACTIVE: "bg-bg text-navy-3",
  GRADUATED: "bg-gold-bg text-navy",
  WITHDRAWN: "bg-terra-bg text-terra",
  TRANSFERRED: "bg-warn-bg text-warn",
};

type StudentRow = {
  id: string;
  studentCode: string;
  firstName: string;
  lastName: string;
  otherNames: string | null;
  sex: string;
  currentClassLabel: string | null;
  status: string;
};

const cap = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

export function StudentsTable({ rows }: { rows: StudentRow[] }) {
  const router = useRouter();
  const ids = rows.map((r) => r.id);
  const { selected, toggle, setAll, clear, count } = useSelection();
  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
  const someSelected = count > 0 && !allSelected;

  const [toDelete, setToDelete] = useState<StudentRow | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [delBusy, setDelBusy] = useState(false);
  const [delError, setDelError] = useState<string | null>(null);

  async function confirmSingle() {
    if (!toDelete) return;
    setDelBusy(true);
    setDelError(null);
    const res = await deleteStudent({ id: toDelete.id });
    setDelBusy(false);
    if (res.ok) {
      setToDelete(null);
      router.refresh();
    } else setDelError(res.error ?? "Could not delete.");
  }

  async function confirmBulk() {
    setDelBusy(true);
    setDelError(null);
    const res = await deleteStudents({ ids: Array.from(selected) });
    setDelBusy(false);
    if (!res.ok) {
      setDelError(res.error ?? "Could not delete.");
      return;
    }
    router.refresh();
    if (res.blocked && res.blocked.length) {
      const lines = res.blocked
        .map((b) => `${b.name} (${b.reasons.join(", ")})`)
        .join("; ");
      setDelError(
        `Deleted ${res.deleted ?? 0}. Couldn't delete ${res.blocked.length}: ${lines}. Set their status to Withdrawn or Transferred instead.`,
      );
      clear();
    } else {
      setBulkOpen(false);
      clear();
    }
  }

  return (
    <>
      <BulkBar
        count={count}
        singular="student"
        plural="students"
        onClear={clear}
        onDelete={() => {
          setDelError(null);
          setBulkOpen(true);
        }}
      />
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-bg text-left text-xs uppercase tracking-wide text-navy-3">
            <tr>
              <th className="w-10 px-4 py-3">
                <HeaderCheckbox
                  checked={allSelected}
                  indeterminate={someSelected}
                  onChange={() => setAll(ids, !allSelected)}
                />
              </th>
              <th className="px-4 py-3 font-semibold">Code</th>
              <th className="px-4 py-3 font-semibold">Name</th>
              <th className="px-4 py-3 font-semibold">Gender</th>
              <th className="px-4 py-3 font-semibold">Class</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((s) => (
              <tr key={s.id} className="transition-colors hover:bg-bg">
                <td className="px-4 py-3">
                  <RowCheckbox
                    checked={selected.has(s.id)}
                    onChange={() => toggle(s.id)}
                    label={`Select ${s.firstName} ${s.lastName}`}
                  />
                </td>
                <td className="px-4 py-3 font-mono text-xs text-navy-2">
                  <Link href={`/students/${s.id}`} className="hover:text-gold">
                    {s.studentCode}
                  </Link>
                </td>
                <td className="px-4 py-3 font-medium text-navy">
                  <Link href={`/students/${s.id}`} className="hover:text-gold">
                    {s.lastName}, {s.firstName} {s.otherNames ?? ""}
                  </Link>
                </td>
                <td className="px-4 py-3 text-navy-2">{cap(s.sex)}</td>
                <td className="px-4 py-3 text-navy-2">{s.currentClassLabel ?? "—"}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-pill px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[s.status]}`}
                  >
                    {cap(s.status)}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  <button
                    onClick={() => {
                      setDelError(null);
                      setToDelete(s);
                    }}
                    className="text-xs font-semibold text-navy-3 transition-colors hover:text-terra"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={!!toDelete}
        title="Delete student?"
        busy={delBusy}
        error={delError}
        confirmLabel="Delete student"
        onClose={() => setToDelete(null)}
        onConfirm={confirmSingle}
        message={
          toDelete ? (
            <>
              Permanently delete{" "}
              <strong className="text-navy">
                {toDelete.firstName} {toDelete.lastName}
              </strong>
              ? If they have any fee, attendance or grade history, deletion will be
              blocked — set their status to Withdrawn or Transferred instead.
            </>
          ) : null
        }
      />

      <ConfirmDialog
        open={bulkOpen}
        title="Delete students?"
        busy={delBusy}
        error={delError}
        confirmLabel={`Delete ${count} ${count === 1 ? "student" : "students"}`}
        onClose={() => setBulkOpen(false)}
        onConfirm={confirmBulk}
        message={
          <>
            Permanently delete <strong className="text-navy">{count}</strong> selected{" "}
            {count === 1 ? "student" : "students"}? Any with fee, attendance or grade
            history will be skipped and listed here. This can&apos;t be undone.
          </>
        }
      />
    </>
  );
}
