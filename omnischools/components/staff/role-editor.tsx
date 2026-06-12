"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { assignStaffRole, removeStaffRole } from "@/lib/actions/staff";
import { STAFF_ROLES, STAFF_ROLE_LABEL } from "@/lib/staff-roles";

export function RoleEditor({
  userId,
  assignments,
}: {
  userId: string;
  assignments: { assignmentId: string; code: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const held = new Set(assignments.map((a) => a.code));
  const available = STAFF_ROLES.filter((r) => !held.has(r.code));

  async function remove(assignmentId: string) {
    setBusy(true);
    setError(null);
    const res = await removeStaffRole({ assignmentId });
    setBusy(false);
    if (res.ok) router.refresh();
    else setError(res.error ?? "Could not remove.");
  }

  async function add(role: string) {
    if (!role) return;
    setBusy(true);
    setError(null);
    const res = await assignStaffRole({ userId, role });
    setBusy(false);
    if (res.ok) router.refresh();
    else setError(res.error ?? "Could not add.");
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {assignments.map((a) => (
        <span
          key={a.assignmentId}
          className="inline-flex items-center gap-1 rounded-pill bg-gold-bg py-0.5 pl-2.5 pr-1 text-xs font-medium text-navy"
        >
          {STAFF_ROLE_LABEL[a.code] ?? a.code}
          <button
            type="button"
            disabled={busy}
            onClick={() => remove(a.assignmentId)}
            aria-label={`Remove ${a.code}`}
            className="flex h-4 w-4 items-center justify-center rounded-full text-navy-3 transition-colors hover:text-terra disabled:opacity-50"
          >
            ×
          </button>
        </span>
      ))}
      {available.length > 0 && (
        <select
          value=""
          disabled={busy}
          onChange={(e) => add(e.target.value)}
          className="rounded-pill border border-border-2 bg-bg px-2 py-0.5 text-xs text-navy-3 outline-none focus:border-gold"
        >
          <option value="">+ role</option>
          {available.map((r) => (
            <option key={r.code} value={r.code}>
              {r.label}
            </option>
          ))}
        </select>
      )}
      {error && <span className="text-xs text-terra">{error}</span>}
    </div>
  );
}
