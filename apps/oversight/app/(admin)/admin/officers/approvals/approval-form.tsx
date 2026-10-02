"use client";

import { useActionState } from "react";
import { Banner, Panel, Pill } from "@/components/oversight/primitives";
import { mintApprovalCodeAction, type AdminActionState } from "../actions";
import type { JurisdictionOption } from "@/lib/provisioning/officers";

/**
 * G8.d — mint an approval code (the approver's form).
 *
 * The code is generated SERVER-SIDE from the approver's own authenticated session, so the approver
 * identity it carries is not something this form can choose. The only inputs are WHAT is being
 * approved — the action, the officer and the node; the WHO comes from the session.
 *
 * The action selector has NO pre-selected value on purpose (security finding S2a). Approving a grant
 * and approving a withdrawal are opposite decisions, the code is signed for exactly one of them, and
 * a default would mean an approver who did not read this field still signed for something. Submit it
 * unset and the server mints nothing.
 */
export function ApprovalForm({
  options,
  adminId,
}: {
  options: JurisdictionOption[];
  adminId: string;
}) {
  const [state, action, pending] = useActionState<AdminActionState, FormData>(
    mintApprovalCodeAction,
    { status: "idle" },
  );

  return (
    <form action={action}>
      <Panel title="Generate an approval code" meta="Region & national only">
        <div className="space-y-5">
          <label className="block text-xs text-navy-2">
            What are you approving?
            <select
              name="action"
              required
              defaultValue=""
              className="mt-1 w-full rounded-md border border-border-2 bg-surface px-3 py-2 text-sm text-navy"
            >
              <option value="">Select the action you are approving…</option>
              <option value="PROVISION">Provision — grant this officer access</option>
              <option value="DEACTIVATE">Withdraw — remove this officer&apos;s access</option>
            </select>
            <span className="mt-1 block text-[11px] text-navy-3">
              A code approves one action. The one you generate for a provision will not authorise a
              withdrawal, and the reverse.
            </span>
          </label>

          <label className="block text-xs text-navy-2">
            Officer identity this code authorises (Supabase auth uid)
            <input
              name="officerId"
              required
              placeholder="00000000-0000-0000-0000-000000000000"
              className="mt-1 w-full rounded-md border border-border-2 bg-surface px-3 py-2 font-mono text-sm text-navy"
            />
          </label>

          <label className="block text-xs text-navy-2">
            Jurisdiction — the node being granted, or the officer&apos;s current node for a
            withdrawal
            <select
              name="jurisdictionId"
              required
              className="mt-1 w-full rounded-md border border-border-2 bg-surface px-3 py-2 text-sm text-navy"
            >
              <option value="">Select a region or the national node…</option>
              {options.map((o) => (
                <option key={o.jurisdictionId} value={o.jurisdictionId}>
                  {o.name} ({o.level})
                </option>
              ))}
            </select>
          </label>

          {state.status === "code" ? (
            <div className="space-y-2">
              <Banner
                tone="green"
                glyph="✓"
                title={
                  state.action === "PROVISION"
                    ? "Approval code generated — for a PROVISION."
                    : "Approval code generated — for a WITHDRAWAL."
                }
              >
                Give this to the proposing administrator. It authorises that one{" "}
                {state.action === "PROVISION" ? "grant" : "withdrawal"} and expires in{" "}
                {state.expiresInMinutes} minutes. It will not work for the opposite action, for any
                other officer or jurisdiction, and it will not work if the proposer is you.
              </Banner>
              <textarea
                readOnly
                value={state.code}
                rows={3}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full rounded-md border border-border-2 bg-bg px-3 py-2 font-mono text-[11px] text-navy"
              />
            </div>
          ) : null}

          {state.status === "error" ? (
            <Banner tone="gold" glyph="⊘" title="No code generated.">
              {state.message}
            </Banner>
          ) : null}

          <div className="flex items-center justify-between border-t border-border-1 pt-4">
            <span className="flex items-center gap-2 font-mono text-[10px] text-navy-3">
              <Pill tone="muted">approver</Pill> {adminId.slice(0, 8)}
            </span>
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-green px-4 py-2 text-sm font-semibold text-bg disabled:opacity-40"
            >
              {pending ? "Generating…" : "Approve & generate code"}
            </button>
          </div>
        </div>
      </Panel>
    </form>
  );
}
