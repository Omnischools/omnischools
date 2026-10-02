"use client";

import { useActionState, useState } from "react";
import { deactivateOfficerAction, type AdminActionState } from "./actions";

/**
 * G8.c — withdraw an officer's access.
 *
 * This is THE ONE PLACE in increment G where terra/destructive styling is correct: it is a
 * deliberate withdrawal taken by an administrator, not a message to a blameless officer. Everywhere
 * an officer is told something has not been set up or has ended, the idiom is calm gold.
 *
 * The confirmation is inline rather than a modal because the row it concerns must stay visible —
 * "withdraw access for WHICH of these twelve people" is exactly the question a modal hides.
 *
 * NOTE: this form posts the officer uid and NO jurisdiction (security finding S2b). It used to post
 * a hidden `jurisdictionId`, which the server then used both to decide whether the two-person rule
 * applied and to check what the approver had signed for — while the withdrawal itself acts on the
 * node from the officer's directory row. The server now reads that node itself
 * (`resolveOfficerNode()`), so the field had no legitimate reader left, and a hidden field that
 * looks security-relevant is how it gets wired back in. `tier` below is for DISPLAY only: it decides
 * whether to offer the approval-code box, and the server re-derives it regardless.
 */
export function DeactivateForm({
  officerId,
  officerName,
  jurisdictionName,
  tier,
}: {
  officerId: string;
  officerName: string;
  /** Display only — the node the server proved is echoed alongside it when an approval is needed. */
  jurisdictionName: string;
  tier: string;
}) {
  const [state, action, pending] = useActionState<AdminActionState, FormData>(
    deactivateOfficerAction,
    { status: "idle" },
  );
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[11px] text-terra underline"
      >
        Deactivate
      </button>
    );
  }

  return (
    <form action={action} className="space-y-2 text-left">
      <input type="hidden" name="officerId" value={officerId} />

      <p className="text-xs font-semibold text-navy">Withdraw this officer&apos;s access?</p>
      <p className="text-[11px] text-navy-2">
        {officerName} will no longer be able to use Oversight. Their audit history is preserved
        and is never deleted. This can be reversed by re-provisioning.
      </p>

      <textarea
        name="reason"
        required
        rows={2}
        placeholder="Internal reason (not shown to the officer)"
        className="w-full rounded-md border border-border-2 bg-surface px-2 py-1 text-[11px] text-navy"
      />

      {tier === "REGION" || tier === "NATIONAL" ? (
        <input
          name="approvalCode"
          placeholder="Approval code from a second administrator"
          className="w-full rounded-md border border-border-2 bg-surface px-2 py-1 font-mono text-[11px] text-navy"
        />
      ) : null}

      {state.status === "error" || state.status === "approval_required" ? (
        <p className="text-[11px] text-terra">{state.message}</p>
      ) : null}
      {/*
        The node the SERVER proved, so the proposer asks for a code for the right one. The approver's
        form mints against one specific node, and a code for any other is refused at this end — so
        "which node" is the one thing the proposer has to get right, and guessing it from the table is
        exactly the guess finding S2b was about.
      */}
      {state.status === "approval_required" ? (
        <p className="text-[11px] text-navy-2">
          Ask a second administrator for a <strong>Withdraw</strong> code for{" "}
          <strong className="text-navy">{jurisdictionName || "this officer's node"}</strong> —{" "}
          <span className="font-mono">{state.fields.jurisdictionId}</span>. That is the node this
          officer holds on the directory; a code for any other node will be refused.
        </p>
      ) : null}
      {state.status === "success" ? (
        <p className="text-[11px] text-green">{state.message}</p>
      ) : null}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[11px] text-navy-3 underline"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-terra px-3 py-1 text-[11px] font-semibold text-bg disabled:opacity-40"
        >
          {pending ? "Withdrawing…" : "Withdraw access"}
        </button>
      </div>
    </form>
  );
}
