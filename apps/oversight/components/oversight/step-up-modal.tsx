"use client";

import { OtpInput } from "@/components/oversight/otp-input";
import { Pill } from "@/components/oversight/primitives";
import type { StepUpFields } from "@/app/(oversight)/compliance-records/actions";

/**
 * G7 — the §6 step-up interstitial.
 *
 * Fires at the SUBMIT of the justification, before the record is opened and before the access is
 * granted. The copy has to make the stake legible, because this is the one irreversible,
 * permanently-logged, individually-identifying action in Oversight: the officer is about to put
 * their own name on an audit row that GES audit will read.
 *
 * ── WHAT THE MODAL DOES, MECHANICALLY ────────────────────────────────────────────────────────────
 * It re-posts the SAME form fields the officer already filled in (echoed from the server, not
 * reconstructed) plus a TOTP code, to the SAME server action. The action verifies the code first and
 * only then enters the gate, so:
 *   · CANCEL writes nothing — it is a `<button type="button">` that re-renders the filled-in form.
 *     No audit row, because the action was never called.
 *   · A WRONG CODE writes nothing — the verification fails before the gate is entered.
 *   · SUCCESS produces exactly one audit row, from the existing choke point. The step-up is an
 *     assertion in front of the grant, not a second log.
 *
 * Within the 5-minute reuse window the server never returns this state at all, so the modal is
 * simply not rendered — browse → pick → view → export is one assertion (Kofi R6).
 */
export function StepUpModal({
  fields,
  factorId,
  error,
  schoolLabel,
  reasonLabel,
  pending,
  onCancel,
}: {
  fields: StepUpFields;
  factorId: string | null;
  error?: string;
  schoolLabel: string;
  reasonLabel: string;
  pending: boolean;
  onCancel: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="step-up-title"
      className="bg-navy-deep/70 fixed inset-0 z-50 flex items-center justify-center px-5 py-10"
    >
      <div className="w-full max-w-[460px] overflow-hidden rounded-[14px] border border-border-1 bg-surface shadow-xl">
        {/* The deep-navy header strip is the audited-tier signal, same as the §6 record head. */}
        <div className="flex items-center justify-between gap-3 bg-navy-deep px-5 py-4 text-bg">
          <h2 id="step-up-title" className="font-display text-lg">
            Confirm it&apos;s you.
          </h2>
          <Pill tone="gold">§6 · named-record access</Pill>
        </div>

        <div className="p-5">
          <p className="text-sm text-navy-2">
            {fields.intent === "roster" ? (
              <>
                You&apos;re about to open a{" "}
                <strong>school&apos;s full staff list — named individuals</strong>. This
                access is logged against your name and reviewed by GES audit. Re-enter
                your authenticator code to confirm it&apos;s you before the list opens.
              </>
            ) : (
              <>
                You&apos;re about to open a{" "}
                <strong>named individual&apos;s record</strong>. This access is logged
                against your name and reviewed by GES audit. Re-enter your authenticator
                code to confirm it&apos;s you before the record opens.
              </>
            )}
          </p>

          {/* Echo the stake in the officer's own words — the reason and school they chose. */}
          <p className="mt-3 rounded-md border border-border-1 bg-bg px-3 py-2 text-[11px] text-navy-3">
            Reason: {reasonLabel} · {schoolLabel} · this will be logged as a{" "}
            {fields.intent === "roster" ? "staff-list browse" : "named-record access"}.
          </p>

          <div className="mt-4">
            {/* Every field travels back verbatim: the audit row must record what the officer
                actually typed, not a re-derived approximation of it. */}
            <input type="hidden" name="reasonCode" value={fields.reasonCode} />
            <input type="hidden" name="caseReference" value={fields.caseReference} />
            <input type="hidden" name="emisSchoolId" value={fields.emisSchoolId} />
            <input
              type="hidden"
              name="operationalStaffId"
              value={fields.operationalStaffId}
            />
            <input type="hidden" name="confirm" value="on" />
            <input
              type="hidden"
              name="rosterBrowsed"
              value={fields.rosterBrowsed ? "true" : "false"}
            />
            <input type="hidden" name="exportFormat" value={fields.exportFormat} />
            <input type="hidden" name="stepUpFactorId" value={factorId ?? ""} />

            <label className="text-[10px] uppercase tracking-[0.14em] text-navy-3">
              Authenticator code
            </label>
            <OtpInput name="stepUpCode" disabled={pending} autoFocus />
          </div>

          {error ? <p className="mt-2 text-xs text-terra">{error}</p> : null}

          <div className="mt-5 flex items-center justify-between border-t border-border-1 pt-4">
            <button
              type="button"
              onClick={onCancel}
              className="text-xs text-navy-3 underline"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-warn px-4 py-2 text-sm font-semibold text-bg disabled:opacity-40"
            >
              {pending
                ? "Confirming…"
                : fields.intent === "roster"
                  ? "Confirm & open staff list →"
                  : "Confirm & open record →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
