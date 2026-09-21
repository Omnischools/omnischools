"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { submitStaffGate, type GateState } from "../actions";
import {
  BASIS_HELPER,
  CONSENT_LINE,
  GATE_BANNER,
  STAFF_REASON_COPY,
  fieldLabel,
  unlockingReasonFor,
} from "@/lib/oversight/copy";
import { STAFF_REASON_CODES } from "@/lib/oversight/field-scope";
import {
  Banner,
  BasisPill,
  Panel,
  Pill,
  Provenance,
  RecField,
  ScopeLine,
} from "@/components/oversight/primitives";
import { cn } from "@/lib/utils";
import type { ResolvedSchool } from "@/lib/oversight/school-ref";

/**
 * The staff branch of the §6 gate (Lucy §A1.1 + C1), and the record/denial it resolves to.
 *
 * The record is rendered from the SUBMIT RESULT rather than from a `/records/<id>` route. That is
 * not a shortcut — it is the only shape consistent with the audit log. A route that re-fetched the
 * record on every page load would either write a second audit row per refresh (inflating the log
 * with accesses nobody made) or fetch without logging (the exact thing §6 forbids). One access, one
 * row, one render. `/compliance-records/<accessId>` therefore shows the AUDIT ENTRY, not the record.
 */
export function GateForm({ schools }: { schools: ResolvedSchool[] }) {
  const [state, action, pending] = useActionState<GateState, FormData>(submitStaffGate, {
    status: "idle",
  });
  const [reason, setReason] = useState<string>("");
  const [confirmed, setConfirmed] = useState(false);

  return (
    <div className="space-y-6">
      <Banner
        tone="warn"
        glyph="!"
        title={
          <>
            You are about to leave <em className="accent-italic">aggregate view.</em>
          </>
        }
      >
        {GATE_BANNER.body}
      </Banner>

      <form action={action}>
        <Panel title="Access justification" meta="All fields required">
          <div className="space-y-6">
            {/* 1 — reason */}
            <fieldset>
              <legend className="text-xs font-semibold uppercase tracking-wide text-navy">
                Reason for access
                <span className="ml-2 rounded-pill bg-terra-bg px-2 py-0.5 text-[9px] uppercase text-terra">
                  Required
                </span>
              </legend>
              <p className="mt-1 text-xs text-navy-3">
                Pick the compliance ground. Each reason limits which fields of the record
                are revealed — establishment verification does not unlock welfare contact
                data.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {STAFF_REASON_CODES.map((code) => {
                  const copy = STAFF_REASON_COPY[code];
                  const selected = reason === code;
                  return (
                    <label
                      key={code}
                      className={cn(
                        "flex cursor-pointer gap-3 rounded-lg border p-3 transition",
                        selected
                          ? "border-gold bg-gold-bg"
                          : "border-border-1 bg-surface hover:bg-bg",
                      )}
                    >
                      <input
                        type="radio"
                        name="reasonCode"
                        value={code}
                        checked={selected}
                        onChange={() => setReason(code)}
                        className="mt-1 accent-[color:var(--gold)]"
                      />
                      <span>
                        <span className="block text-sm font-semibold text-navy">
                          {copy.title}
                        </span>
                        <span className="mt-0.5 block text-xs text-navy-3">
                          {copy.desc}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            {/* 2 — school (jurisdiction-scoped) */}
            <div>
              <label
                htmlFor="emisSchoolId"
                className="text-xs font-semibold uppercase tracking-wide text-navy"
              >
                School
              </label>
              <p className="mt-1 text-xs text-navy-3">
                The record&apos;s school — within your own jurisdiction only. This scopes
                the lookup below.
              </p>
              <select
                id="emisSchoolId"
                name="emisSchoolId"
                required
                className="mt-2 w-full rounded-md border border-border-2 bg-surface px-3 py-2 text-sm text-navy"
              >
                <option value="">Select a school…</option>
                {schools.map((s) => (
                  <option key={s.emisSchoolId} value={s.emisSchoolId}>
                    {s.name} · {s.emisSchoolId} · {s.ownershipType ?? "ownership unknown"}
                  </option>
                ))}
              </select>
            </div>

            {/* 3 — subject lookup */}
            <fieldset className="rounded-lg border border-border-1 p-4">
              <legend className="px-1">
                <Pill tone="navy">Staff lookup</Pill>
              </legend>
              <p className="text-xs text-navy-3">
                Find the staff member by browsing the school&apos;s staff list, then open
                their record by its operational id. You supply nothing that decides the
                lawful basis: the record&apos;s own NTC licence is checked against the GES
                establishment register inside the read-back — an establishment teacher is
                covered by statute, everyone else by the school&apos;s DPO consent. The role
                a school typed does not decide it.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="block text-xs text-navy-2 sm:col-span-2">
                  Operational staff record (uuid, from the staff list)
                  <input
                    name="operationalStaffId"
                    required
                    placeholder="00000000-0000-0000-0000-000000000000"
                    className="mt-1 w-full rounded-md border border-border-2 bg-surface px-3 py-2 font-mono text-sm text-navy"
                  />
                </label>
              </div>
            </fieldset>

            {/* 4 — case reference */}
            <div>
              <label
                htmlFor="caseReference"
                className="text-xs font-semibold uppercase tracking-wide text-navy"
              >
                Case reference &amp; explanation
              </label>
              <p className="mt-1 text-xs text-navy-3">
                A case number where one exists, and one line on why the aggregate data
                cannot answer this. This text is stored in the audit log verbatim.
              </p>
              <textarea
                id="caseReference"
                name="caseReference"
                required
                rows={3}
                className="mt-2 w-full rounded-md border border-border-2 bg-surface px-3 py-2 text-sm text-navy"
              />
            </div>

            <label className="flex items-start gap-2 text-xs text-navy-2">
              <input
                type="checkbox"
                name="confirm"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-0.5 accent-[color:var(--gold)]"
              />
              <span>{CONSENT_LINE}</span>
            </label>

            <div className="flex items-center justify-between border-t border-border-1 pt-4">
              <Link href="/compliance-records" className="text-xs text-navy-3 underline">
                Cancel
              </Link>
              <button
                type="submit"
                disabled={pending || !confirmed || reason === ""}
                className="rounded-md bg-warn px-4 py-2 text-sm font-semibold text-bg disabled:opacity-40"
              >
                {pending ? "Logging access…" : "Log access & open record →"}
              </button>
            </div>
          </div>
        </Panel>
      </form>

      <GateResult state={state} />
    </div>
  );
}

function GateResult({ state }: { state: GateState }) {
  if (state.status === "idle") return null;

  if (state.status === "error") {
    return (
      <Banner tone="warn" glyph="!" title="Check the justification">
        {state.message}
      </Banner>
    );
  }

  if (state.status === "unavailable") {
    return (
      <Banner tone="gold" glyph="⊘" title="Individual drill-down unavailable.">
        {state.message}
      </Banner>
    );
  }

  // Lucy C2 — the pivotal state. Gold, informational, never terra, never blank.
  if (state.status === "denied") {
    return (
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
        <p className="font-mono text-[11px] text-navy-3">
          {state.outcome} · basis {state.legalBasis} · entry {state.accessId} ·{" "}
          {state.targetRef}
        </p>
      </div>
    );
  }

  if (state.status === "roster") {
    return (
      <Panel title="Staff list" meta={`Access ${state.accessId} logged · list browsed`}>
        <ul className="divide-y divide-border-1 text-sm">
          {state.rows.map((row) => (
            <li
              key={row.operational_staff_id}
              className="flex justify-between gap-4 py-2"
            >
              <span className="text-navy">{row.full_name ?? "—"}</span>
              <span className="font-mono text-xs text-navy-3">
                {row.operational_staff_id}
              </span>
              <span className="text-xs text-navy-3">{row.post_role_label ?? "—"}</span>
              <Pill tone="warn">Not linked to register</Pill>
            </li>
          ))}
        </ul>
      </Panel>
    );
  }

  const withheldUnlocks = Array.from(
    new Set(state.withheld.map(unlockingReasonFor).filter(Boolean) as string[]),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-t-lg bg-navy-deep px-5 py-4 text-bg">
        <div>
          <div className="font-display text-lg">{state.staffName}</div>
          <div className="text-bg/60 font-mono text-xs">{state.targetRef}</div>
        </div>
        <div className="flex items-center gap-2">
          <BasisPill basis={state.legalBasis} />
          <Pill tone="gold">Named staff record</Pill>
        </div>
      </div>
      <div className="-mt-4 rounded-b-lg bg-terra-bg px-5 py-2 text-xs text-terra">
        This access is <strong>logged</strong> as {state.accessId} · reason{" "}
        {state.reasonCode} · visible to GES regional, national &amp; audit review
      </div>

      <p className="text-xs text-navy-2">{BASIS_HELPER[state.legalBasis]}</p>

      <Panel title="Fields released for this reason" meta={state.reasonCode}>
        <div className="grid gap-3 sm:grid-cols-2">
          {state.released.map((f) => (
            <RecField
              key={f.field}
              label={fieldLabel(f.field)}
              value={f.value}
              unavailable={f.unavailable}
            />
          ))}
          {state.withheld.map((f) => (
            <RecField key={f} label={fieldLabel(f)} withheld />
          ))}
        </div>
        <ScopeLine>
          {state.withheld.length} field{state.withheld.length === 1 ? " is" : "s are"}{" "}
          withheld.{" "}
          {withheldUnlocks.length > 0
            ? `They require: ${withheldUnlocks.join("; ")}.`
            : "No other reason releases them."}{" "}
          Compensation, salary status and free-text staff notes are never released, under
          any reason.
        </ScopeLine>
        <Provenance
          items={[
            ["Field scope", "reason determines which fields release"],
            ["Logged", `${state.accessId} · officer, reason, fields, timestamp`],
            ["Source", "operational record · read-only via the gated read-back"],
          ]}
        />
      </Panel>
    </div>
  );
}
