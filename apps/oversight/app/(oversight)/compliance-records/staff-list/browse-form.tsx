"use client";

import Link from "next/link";
import { useActionState } from "react";
import { browseStaffListAction, type GateState } from "../actions";
import { STAFF_REASON_COPY } from "@/lib/oversight/copy";
import { STAFF_REASON_CODES } from "@/lib/oversight/field-scope";
import { Banner, Panel, Pill } from "@/components/oversight/primitives";
import type { ResolvedSchool } from "@/lib/oversight/school-ref";

/**
 * Lucy C4 — the staff-list browse.
 *
 * The list opens ONLY after the justification is logged, and the log records that a staff list was
 * browsed — not only the record finally chosen. That ordering is the whole design: an officer who
 * browsed a school's entire staff list and opened nothing has still looked at named data, and the
 * log has to be able to say so.
 *
 * The list is consent-gated on the same terms as a record, because a list of names IS individual
 * data. A school that refused consent gets the C2 state here too, not a shorter list.
 */
export function BrowseForm({ schools }: { schools: ResolvedSchool[] }) {
  const [state, action, pending] = useActionState<GateState, FormData>(
    browseStaffListAction,
    {
      status: "idle",
    },
  );

  return (
    <div className="space-y-6">
      <form action={action}>
        <Panel title="Browse a school's staff list" meta="Logged as a staff-list browse">
          <div className="space-y-4">
            <label className="block text-xs text-navy-2">
              School
              <select
                name="emisSchoolId"
                required
                className="mt-1 w-full rounded-md border border-border-2 bg-surface px-3 py-2 text-sm text-navy"
              >
                <option value="">Select a school…</option>
                {schools.map((s) => (
                  <option key={s.emisSchoolId} value={s.emisSchoolId}>
                    {s.name} · {s.emisSchoolId}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-xs text-navy-2">
              Operational school id (uuid)
              <input
                name="operationalSchoolId"
                required
                className="mt-1 w-full rounded-md border border-border-2 bg-surface px-3 py-2 font-mono text-sm text-navy"
              />
            </label>

            <label className="block text-xs text-navy-2">
              Reason for access
              <select
                name="reasonCode"
                required
                className="mt-1 w-full rounded-md border border-border-2 bg-surface px-3 py-2 text-sm text-navy"
              >
                <option value="">Select a reason…</option>
                {STAFF_REASON_CODES.map((code) => (
                  <option key={code} value={code}>
                    {STAFF_REASON_COPY[code].title}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-xs text-navy-2">
              Case reference &amp; explanation (stored verbatim)
              <textarea
                name="caseReference"
                required
                rows={3}
                className="mt-1 w-full rounded-md border border-border-2 bg-surface px-3 py-2 text-sm text-navy"
              />
            </label>

            <div className="flex items-center justify-between border-t border-border-1 pt-4">
              <Link href="/compliance-records" className="text-xs text-navy-3 underline">
                Cancel
              </Link>
              <button
                type="submit"
                disabled={pending}
                className="rounded-md bg-warn px-4 py-2 text-sm font-semibold text-bg disabled:opacity-40"
              >
                {pending ? "Logging browse…" : "Log access & open staff list →"}
              </button>
            </div>
          </div>
        </Panel>
      </form>

      {state.status === "error" ? (
        <Banner tone="warn" glyph="!" title="Check the justification">
          {state.message}
        </Banner>
      ) : null}

      {state.status === "unavailable" ? (
        <Banner tone="gold" glyph="⊘" title="Individual drill-down unavailable.">
          {state.message}
        </Banner>
      ) : null}

      {state.status === "denied" ? (
        <div className="space-y-3">
          <Banner
            tone="gold"
            glyph="⊘"
            title={state.copy.title}
            action={
              <Link
                href="/"
                className="inline-block rounded-md bg-navy px-4 py-2 text-sm font-semibold text-bg"
              >
                {state.copy.primaryAction}
              </Link>
            }
          >
            {state.copy.body}
          </Banner>
          <p className="text-xs text-navy-3">{state.copy.secondary}</p>
        </div>
      ) : null}

      {state.status === "roster" ? (
        <>
          <Banner tone="gold" glyph="▸" title="Step 1 of 2 · staff list browsed">
            Access {state.accessId} is already logged. Pick the staff member whose record
            the case concerns — copy their operational id into the gate.
          </Banner>
          <Panel
            title="Staff list"
            meta={`${state.rows.length} staff · ${state.emisSchoolId}`}
          >
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border-1 text-[10px] uppercase text-navy-3">
                <tr>
                  <th className="py-2 font-semibold">Staff</th>
                  <th className="py-2 font-semibold">Operational staff id</th>
                  <th className="py-2 font-semibold">Role</th>
                  <th className="py-2 font-semibold">Register status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-1">
                {state.rows.map((row) => (
                  <tr key={row.operational_staff_id} className="hover:bg-bg">
                    <td className="py-2 font-semibold text-navy">
                      {row.full_name ?? "—"}
                    </td>
                    <td className="py-2 font-mono text-[11px] text-navy-2">
                      {row.operational_staff_id}
                    </td>
                    <td className="py-2 text-xs text-navy-2">
                      {row.post_role_label ?? "—"}
                    </td>
                    <td className="py-2">
                      <Pill tone="warn">Not linked to register</Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-navy-3">
              Register status cannot be computed per row: the operational staff record
              carries no GES establishment id, so there is no key to match the register
              on. Every row therefore routes to the consent branch — the fail-closed
              direction. Restoring the GES establishment / Not-on-register signal needs a{" "}
              <code>ges_staff_id</code> column on the operational staff record.
            </p>
          </Panel>
        </>
      ) : null}
    </div>
  );
}
