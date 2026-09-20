"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { assignStaffRole, removeStaffRole } from "@/lib/actions/staff";
import { STAFF_ROLES, roleLabel } from "@/lib/staff-roles";

export function RoleEditor({
  userId,
  assignments,
}: {
  userId: string;
  assignments: { assignmentId: string; code: string; label: string | null }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");

  const listId = `roles-${userId}`;
  const heldLabels = new Set(
    assignments.map((a) => roleLabel(a.code, a.label).toLowerCase()),
  );
  const suggestions = STAFF_ROLES.filter((r) => !heldLabels.has(r.label.toLowerCase()));

  async function remove(assignmentId: string) {
    setBusy(true);
    setError(null);
    const res = await removeStaffRole({ assignmentId });
    setBusy(false);
    if (res.ok) router.refresh();
    else setError(res.error ?? "Could not remove.");
  }

  async function add(role: string) {
    const v = role.trim();
    if (!v) return;
    setBusy(true);
    setError(null);
    const res = await assignStaffRole({ userId, role: v });
    setBusy(false);
    if (res.ok) {
      setValue("");
      setAdding(false);
      router.refresh();
    } else setError(res.error ?? "Could not add.");
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {assignments.map((a) => (
        <span
          key={a.assignmentId}
          className="inline-flex items-center gap-1 rounded-pill bg-gold-bg py-0.5 pl-2.5 pr-1 text-xs font-medium text-navy"
        >
          {roleLabel(a.code, a.label)}
          <button
            type="button"
            disabled={busy}
            onClick={() => remove(a.assignmentId)}
            aria-label={`Remove ${roleLabel(a.code, a.label)}`}
            className="flex h-4 w-4 items-center justify-center rounded-full text-navy-3 transition-colors hover:text-terra disabled:opacity-50"
          >
            ×
          </button>
        </span>
      ))}

      {adding ? (
        <span className="inline-flex items-center gap-1">
          <input
            list={listId}
            value={value}
            autoFocus
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add(value);
              } else if (e.key === "Escape") {
                setAdding(false);
                setValue("");
              }
            }}
            placeholder="Pick or type…"
            className="w-32 rounded-pill border border-border-2 bg-bg px-2.5 py-0.5 text-xs text-navy outline-none focus:border-gold"
          />
          <datalist id={listId}>
            {suggestions.map((r) => (
              <option key={r.code} value={r.label} />
            ))}
          </datalist>
          <button
            type="button"
            disabled={busy}
            onClick={() => add(value)}
            className="text-xs font-semibold text-gold disabled:opacity-50"
          >
            Add
          </button>
        </span>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => setAdding(true)}
          className="rounded-pill border border-border-2 bg-bg px-2 py-0.5 text-xs text-navy-3 transition-colors hover:border-gold hover:text-navy disabled:opacity-50"
        >
          + role
        </button>
      )}
      {error && <span className="text-xs text-terra">{error}</span>}
    </div>
  );
}
