"use client";

import { useActionState, useState } from "react";
import { Banner, Panel, Pill } from "@/components/oversight/primitives";
import { provisionOfficerAction, type AdminActionState } from "../actions";
import type { JurisdictionOption } from "@/lib/provisioning/officers";

/**
 * G8.b — the provision form.
 *
 * THE NODE PICKER IS THE CENTRAL CONTROL, and the two things it does NOT have are the design:
 *   · there is no tier input — selecting *Wassa Amenfi West* yields District, selecting *Western
 *     Region* yields Region. The derived tier and role are shown read-only beside the picker the
 *     instant a node is chosen, so the administrator provisions against the same facts the officer
 *     will later be shown;
 *   · there are no SCHOOL nodes to select. They are filtered out of the query, not disabled here —
 *     showing them greyed would imply a coming option, and there is no such plan (Kofi R1).
 *
 * The derivation shown here is a MIRROR of the server's, never the source of it: the tier the write
 * uses is re-derived from `dim_jurisdiction` server-side, and the database refuses a row whose role
 * contradicts its node. If this component were wrong, the write would be refused, not accepted.
 */
export function ProvisionForm({
  options,
  adminId,
}: {
  options: JurisdictionOption[];
  adminId: string;
}) {
  const [state, action, pending] = useActionState<AdminActionState, FormData>(
    provisionOfficerAction,
    { status: "idle" },
  );
  const [nodeId, setNodeId] = useState("");
  const [search, setSearch] = useState("");

  const node = options.find((o) => o.jurisdictionId === nodeId) ?? null;
  const needsApproval = node?.level === "REGION" || node?.level === "NATIONAL";
  /** The tier to NAME in the two-person banner: the picked node's, or the server's own verdict. */
  const approvalTier =
    node?.level ?? (state.status === "approval_required" ? state.tier : "REGION");
  const filtered = search
    ? options.filter((o) => o.name.toLowerCase().includes(search.toLowerCase()))
    : options;

  return (
    <form action={action}>
      <Panel
        title="Provision an officer"
        meta={needsApproval ? "Two administrators required" : "Single administrator"}
      >
        <div className="space-y-5">
          <div>
            <label
              htmlFor="officerId"
              className="text-xs font-semibold uppercase tracking-wide text-navy"
            >
              Officer identity (Supabase auth uid)
            </label>
            <p className="mt-1 text-xs text-navy-3">
              This is the identity the officer will sign in with. It must match their GES
              appointment record, and the auth user must already exist — an account is never
              created here, only authorised.
            </p>
            <input
              id="officerId"
              name="officerId"
              required
              defaultValue={
                state.status === "approval_required" ? state.fields.officerId : undefined
              }
              placeholder="00000000-0000-0000-0000-000000000000"
              className="mt-2 w-full rounded-md border border-border-2 bg-surface px-3 py-2 font-mono text-sm text-navy"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-navy-2">
              Full name (for the directory, not the session)
              <input
                name="fullName"
                defaultValue={
                  state.status === "approval_required" ? state.fields.fullName : undefined
                }
                className="mt-1 w-full rounded-md border border-border-2 bg-surface px-3 py-2 text-sm text-navy"
              />
            </label>
            <label className="block text-xs text-navy-2">
              GES work email
              <input
                name="workEmail"
                type="email"
                defaultValue={
                  state.status === "approval_required" ? state.fields.workEmail : undefined
                }
                className="mt-1 w-full rounded-md border border-border-2 bg-surface px-3 py-2 text-sm text-navy"
              />
            </label>
          </div>

          <div>
            <label
              htmlFor="jurisdictionId"
              className="text-xs font-semibold uppercase tracking-wide text-navy"
            >
              Jurisdiction node
            </label>
            <p className="mt-1 text-xs text-navy-3">
              The node this officer oversees — and the ceiling of everything they can read. Schools
              aren&apos;t an officer tier: officers are provisioned at District, Region, or National.
            </p>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter nodes…"
              className="mt-2 w-full rounded-md border border-border-2 bg-bg px-3 py-2 text-sm text-navy"
            />
            <select
              id="jurisdictionId"
              name="jurisdictionId"
              required
              value={nodeId}
              onChange={(e) => setNodeId(e.target.value)}
              className="mt-2 w-full rounded-md border border-border-2 bg-surface px-3 py-2 text-sm text-navy"
            >
              <option value="">Select a jurisdiction…</option>
              {filtered.map((o) => (
                <option key={o.jurisdictionId} value={o.jurisdictionId}>
                  {o.name}
                  {o.parentName ? ` · ${o.parentName}` : ""} ({o.level})
                </option>
              ))}
            </select>

            {node ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-border-1 bg-bg px-3 py-2">
                <span className="text-[10px] uppercase tracking-wide text-navy-3">
                  Derived
                </span>
                <Pill tone="gold">{node.level}</Pill>
                <Pill tone="navy">{node.derivedRole}</Pill>
                <span className="text-[11px] text-navy-3">
                  read-only — set by the node, not by this form
                </span>
              </div>
            ) : null}
          </div>

          <div>
            <label
              htmlFor="reason"
              className="text-xs font-semibold uppercase tracking-wide text-navy"
            >
              Reason
            </label>
            <p className="mt-1 text-xs text-navy-3">
              The posting letter, directive or decision this grant rests on. Stored verbatim on the
              append-only provisioning log; there is no default.
            </p>
            <textarea
              id="reason"
              name="reason"
              required
              rows={2}
              defaultValue={
                state.status === "approval_required" ? state.fields.reason : undefined
              }
              className="mt-2 w-full rounded-md border border-border-2 bg-surface px-3 py-2 text-sm text-navy"
            />
          </div>

          {needsApproval || state.status === "approval_required" ? (
            <div className="space-y-2">
              <Banner
                tone="warn"
                glyph="!"
                title={`This provision affects a ${approvalTier} tier — the broadest access.`}
              >
                It needs a second administrator to approve before it takes effect. Ask another
                Omnischools administrator to generate an approval code for this officer and node
                from <span className="font-mono">Approve a grant</span>, then paste it here. You
                cannot approve your own proposal.
              </Banner>
              <label className="block text-xs text-navy-2">
                Approval code from a second administrator
                <input
                  name="approvalCode"
                  className="mt-1 w-full rounded-md border border-border-2 bg-surface px-3 py-2 font-mono text-sm text-navy"
                />
              </label>
            </div>
          ) : null}

          {state.status === "error" ? (
            <Banner tone="gold" glyph="⊘" title="Not provisioned.">
              {state.message}
            </Banner>
          ) : null}
          {state.status === "success" ? (
            <Banner tone="green" glyph="✓" title="Provisioned.">
              {state.message}
            </Banner>
          ) : null}

          <div className="flex items-center justify-between border-t border-border-1 pt-4">
            <span className="font-mono text-[10px] text-navy-3">
              proposer {adminId.slice(0, 8)}
            </span>
            <button
              type="submit"
              disabled={pending || nodeId === ""}
              className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-bg disabled:opacity-40"
            >
              {pending
                ? "Provisioning…"
                : needsApproval
                  ? "Submit with approval"
                  : "Provision officer"}
            </button>
          </div>
        </div>
      </Panel>
    </form>
  );
}
