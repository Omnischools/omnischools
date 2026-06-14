"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteStaff, deleteStaffBulk } from "@/lib/actions/staff";
import { StaffRow } from "@/components/staff/staff-row";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { BulkBar, HeaderCheckbox, useSelection } from "@/components/ui/selection";

type Member = {
  userId: string;
  name: string | null;
  phone: string;
  email: string | null;
  roles: { assignmentId: string; code: string }[];
};

export function StaffTable({ staff }: { staff: Member[] }) {
  const router = useRouter();
  const ids = staff.map((m) => m.userId);
  const { selected, toggle, setAll, clear, count } = useSelection();
  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
  const someSelected = count > 0 && !allSelected;

  const [toDelete, setToDelete] = useState<Member | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [delBusy, setDelBusy] = useState(false);
  const [delError, setDelError] = useState<string | null>(null);

  async function confirmSingle() {
    if (!toDelete) return;
    setDelBusy(true);
    setDelError(null);
    const res = await deleteStaff({ userId: toDelete.userId });
    setDelBusy(false);
    if (res.ok) {
      setToDelete(null);
      router.refresh();
    } else setDelError(res.error ?? "Could not remove.");
  }

  async function confirmBulk() {
    setDelBusy(true);
    setDelError(null);
    const res = await deleteStaffBulk({ userIds: Array.from(selected) });
    setDelBusy(false);
    if (res.ok) {
      setBulkOpen(false);
      clear();
      router.refresh();
    } else setDelError(res.error ?? "Could not remove.");
  }

  return (
    <>
      <BulkBar
        count={count}
        singular="person"
        plural="people"
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
              <th className="px-4 py-3 font-semibold">Name</th>
              <th className="px-4 py-3 font-semibold">Phone</th>
              <th className="px-4 py-3 font-semibold">Email</th>
              <th className="px-4 py-3 font-semibold">Roles</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {staff.map((m) => (
              <StaffRow
                key={m.userId}
                member={m}
                selected={selected.has(m.userId)}
                onToggle={() => toggle(m.userId)}
                onRequestDelete={() => {
                  setDelError(null);
                  setToDelete(m);
                }}
              />
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={!!toDelete}
        title="Remove staff?"
        busy={delBusy}
        error={delError}
        confirmLabel="Remove"
        onClose={() => setToDelete(null)}
        onConfirm={confirmSingle}
        message={
          toDelete ? (
            <>
              Remove{" "}
              <strong className="text-navy">{toDelete.name ?? "this person"}</strong> from
              your school? They lose all roles and access here. Their login isn&apos;t
              deleted (they may belong to other schools). This can&apos;t be undone.
            </>
          ) : null
        }
      />

      <ConfirmDialog
        open={bulkOpen}
        title="Remove staff?"
        busy={delBusy}
        error={delError}
        confirmLabel={`Remove ${count}`}
        onClose={() => setBulkOpen(false)}
        onConfirm={confirmBulk}
        message={
          <>
            Remove <strong className="text-navy">{count}</strong>{" "}
            {count === 1 ? "person" : "people"} from your school? They lose all roles and
            access here. Their logins aren&apos;t deleted. This can&apos;t be undone.
          </>
        }
      />
    </>
  );
}
