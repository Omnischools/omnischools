"use client";

import { useActionState } from "react";
import { Banner, Panel, Pill } from "@/components/oversight/primitives";
import { mintApprovalCodeAction, type AdminActionState } from "../actions";
import type { JurisdictionOption } from "@/lib/provisioning/officers";

/**
 * G8.d — mint an approval code (the approver's form).
 *
 * The code is generated SERVER-SIDE from the approver's own authenticated session, so the approver
 * identity it carries is not something this form can choose. The only inputs are WHICH grant is
 * being approved; the WHO comes from the session.
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
            Officer identity being granted (Supabase auth uid)
            <input
              name="officerId"
              required
              placeholder="00000000-0000-0000-0000-000000000000"
              className="mt-1 w-full rounded-md border border-border-2 bg-surface px-3 py-2 font-mono text-sm text-navy"
            />
          </label>

          <label className="block text-xs text-navy-2">
            Jurisdiction being granted
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
              <Banner tone="green" glyph="✓" title="Approval code generated.">
                Give this to the proposing administrator. It authorises that one grant and expires
                in {state.expiresInMinutes} minutes. It will not work for any other officer or
                jurisdiction, and it will not work if the proposer is you.
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
