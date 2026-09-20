"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { canManageTarget } from "@/lib/access";
import { roleLabel } from "@/lib/staff-roles";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { blockUser, activateUser, initiatePasswordReset } from "@/lib/actions/users";

/**
 * INCR-35 (L2b) — the `/settings/users` table (Kofi R266/R268). One row per school member with role(s),
 * status (Active/Blocked), and per-row Reset / Block / Activate. Every control is gated by the SAME pure
 * `canManageTarget` as the server action — a target the actor doesn't strictly outrank renders no controls
 * (the server refusal is the real boundary; the disabled UI is only UX). Block collects an optional reason
 * (stored on user_school_block, never the audit feed).
 */
type Row = { id: string; name: string | null; phone: string; roles: string[]; blocked: boolean };
type Actor = { id: string; roles: string[] };
type Dialog = { kind: "block" | "activate" | "reset"; row: Row } | null;

export function UserManagementTable({ users, actor }: { users: Row[]; actor: Actor }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    setDialog(null);
    setReason("");
    setError(null);
  };

  async function confirm() {
    if (!dialog) return;
    setBusy(true);
    setError(null);
    const res =
      dialog.kind === "block"
        ? await blockUser({ targetUserId: dialog.row.id, reason })
        : dialog.kind === "activate"
          ? await activateUser({ targetUserId: dialog.row.id })
          : await initiatePasswordReset({ targetUserId: dialog.row.id });
    setBusy(false);
    if (res.ok) {
      setDialog(null);
      setReason("");
      router.refresh();
    } else {
      setError(res.error ?? "Something went wrong.");
    }
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-navy-3">
            <th className="px-4 py-3">Name</th>
            <th className="px-4 py-3">Phone</th>
            <th className="px-4 py-3">Roles</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const canManage = canManageTarget(actor.roles, u.roles, actor.id, u.id);
            return (
              <tr key={u.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 font-medium text-navy">{u.name ?? "—"}</td>
                <td className="px-4 py-3 font-mono text-[13px] text-navy-2">{u.phone}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {u.roles.map((r) => (
                      <span
                        key={r}
                        className="rounded bg-bg px-1.5 py-0.5 text-[11px] font-medium text-navy-2"
                      >
                        {roleLabel(r)}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3">
                  {u.blocked ? (
                    <span className="rounded-full bg-terra-bg px-2 py-0.5 text-[11px] font-semibold text-terra">
                      Blocked
                    </span>
                  ) : (
                    <span className="rounded-full bg-green-bg px-2 py-0.5 text-[11px] font-semibold text-green">
                      Active
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {canManage ? (
                    <div className="flex items-center justify-end gap-3">
                      <button
                        onClick={() => setDialog({ kind: "reset", row: u })}
                        className="text-[13px] font-semibold text-navy-2 hover:text-gold"
                      >
                        Reset password
                      </button>
                      {u.blocked ? (
                        <button
                          onClick={() => setDialog({ kind: "activate", row: u })}
                          className="text-[13px] font-semibold text-green hover:opacity-80"
                        >
                          Activate
                        </button>
                      ) : (
                        <button
                          onClick={() => setDialog({ kind: "block", row: u })}
                          className="text-[13px] font-semibold text-terra hover:opacity-80"
                        >
                          Block
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="text-right text-[12px] text-navy-3">—</div>
                  )}
                </td>
              </tr>
            );
          })}
          {users.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-8 text-center text-sm text-navy-3">
                No users to manage yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <ConfirmDialog
        open={dialog?.kind === "block"}
        title={`Block ${dialog?.row.name ?? "this user"}?`}
        confirmLabel="Block account"
        busyLabel="Blocking…"
        busy={busy}
        error={error}
        tone="danger"
        onConfirm={confirm}
        onClose={close}
        message={
          <div className="space-y-3">
            <p>
              They will be signed out of this school on their next action and cannot sign in here until
              reactivated. Their roles are kept — activating restores them.
            </p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (optional, kept private to managers)"
              className="w-full rounded-md border border-border-2 bg-bg px-3 py-2 text-sm text-navy outline-none focus:border-gold"
              rows={2}
            />
          </div>
        }
      />
      <ConfirmDialog
        open={dialog?.kind === "activate"}
        title={`Activate ${dialog?.row.name ?? "this user"}?`}
        confirmLabel="Activate account"
        busyLabel="Activating…"
        busy={busy}
        error={error}
        tone="gold"
        onConfirm={confirm}
        onClose={close}
        message="They will regain access to this school with their original roles on their next request."
      />
      <ConfirmDialog
        open={dialog?.kind === "reset"}
        title={`Reset ${dialog?.row.name ?? "this user"}'s password?`}
        confirmLabel="Send reset code"
        busyLabel="Sending…"
        busy={busy}
        error={error}
        tone="gold"
        onConfirm={confirm}
        onClose={close}
        message="A one-time sign-in code is sent to their own phone; they set a new password themselves. You never see or set their password."
      />
    </div>
  );
}
