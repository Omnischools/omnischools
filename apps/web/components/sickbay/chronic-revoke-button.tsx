"use client";

/**
 * §04 `Revoke` (SHS module 4.4 / INCR-23b · R135). Client component, SCALARS only (R120). Confirms,
 * then calls the MATRON-only `revokeAccess` action — which STAMPS `revoked_at` (append-only, R110),
 * never deletes. The row stays in the table with a neutral `Revoked` pill after the refresh.
 */
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { revokeAccess } from "@/lib/actions/sickbay-chronic";
import { grantRevokeConfirm } from "@/lib/sickbay/chronic-copy";

export function ChronicRevokeButton({
  grantId,
  granteeName,
  studentName,
}: {
  grantId: string;
  granteeName: string;
  studentName: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function onClick() {
    if (!window.confirm(grantRevokeConfirm(granteeName, studentName))) return;
    start(async () => {
      // Surface a refused revoke (Dex LOW-2) — without this, a rejected action (non-matron replay,
      // already-revoked, unresolved session) was a silent no-op and the row reappeared un-revoked.
      const res = await revokeAccess({ grantId });
      if (!res.ok) {
        window.alert(res.error ?? "Could not revoke this grant.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="rounded-md border border-border-2 bg-surface px-[10px] py-[5px] text-[10px] font-semibold text-terra disabled:opacity-50"
    >
      {pending ? "Revoking…" : "Revoke"}
    </button>
  );
}
