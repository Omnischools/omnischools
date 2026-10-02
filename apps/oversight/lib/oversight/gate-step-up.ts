import { canOpenNamedRecord } from "@/lib/auth/roles";
import type { OfficerSession } from "@/lib/oversight/officer";
import {
  requestNamedStaffRecord,
  requestStaffListBrowse,
  type NamedStaffRecordRequest,
  type NamedStaffRecordResult,
  type StaffListBrowseRequest,
  type StaffListBrowseResult,
} from "@/lib/oversight/named-record-access";

/**
 * THE §6 STEP-UP CHOKE POINT (Kofi R6 · Lucy G7).
 *
 * ── WHY THIS MODULE EXISTS AT ALL ────────────────────────────────────────────────────────────────
 * The requirement is an ORDERING one: a fresh MFA assertion must be proven BEFORE the gate writes
 * its `audit_access_log` row and before any operational read-back happens. Putting that `if` at the
 * top of the server action would satisfy it today and prove nothing tomorrow — the next caller of
 * `requestNamedStaffRecord()` would simply not have it, and no test could tell. So the two gate
 * entry points are re-exported HERE behind the assertion, the server actions import only these, and
 * tests/gate-step-up.test.ts drives this module directly to prove that a refused step-up leaves the
 * audit table byte-identical. tests/step-up-choke-point.test.ts asserts textually that the actions
 * file does not import the raw gate functions.
 *
 * ── WHAT IT DOES NOT CHANGE ──────────────────────────────────────────────────────────────────────
 * The §6 audit contract is untouched: ONE access, ONE row, written by
 * `lib/oversight/named-record-access.ts`. The step-up is an AAL2 assertion in FRONT of the grant,
 * not a second log. A failed or cancelled step-up is therefore NOT written as a denial row either —
 * unlike a consent refusal, which is a real boundary decision about a real subject, nothing was
 * attempted against an operational record here. (Lucy R9 asks whether a cancelled step-up should be
 * recorded as auth telemetry; the recommendation — an auth-side event, never an `audit_access_log`
 * row — is unimplemented and flagged, not quietly resolved in either direction.)
 */

export class StepUpRequiredError extends Error {
  readonly code = "STEP_UP_REQUIRED";
  constructor() {
    super(
      "A fresh authenticator assertion is required before a named record can be opened (§6 step-up).",
    );
    this.name = "StepUpRequiredError";
  }
}

export class TierCannotOpenNamedRecordError extends Error {
  readonly code = "TIER_CANNOT_OPEN_NAMED_RECORD";
  constructor(level: string) {
    super(
      `Tier ${level} cannot open a named record. There is no SCHOOL-tier oversight officer (Kofi R1), and the §6 gate is reachable only at DISTRICT, REGION and NATIONAL.`,
    );
    this.name = "TierCannotOpenNamedRecordError";
  }
}

/**
 * What the caller must prove. `fresh` comes from `getAuthContext().stepUpFresh`, which is computed
 * from the LAST MFA `amr` timestamp in the server-verified token against the configured 5-minute
 * window (lib/auth/session-policy.ts `stepUpFresh`). It is deliberately a boolean rather than a
 * token this module could be handed: there is nothing here to verify, because the freshness is a
 * property of the session Supabase signed, not of a value the browser sent.
 */
export interface StepUpAssertion {
  fresh: boolean;
}

/**
 * The guard. Throws BEFORE any argument is used for anything.
 *
 * Order: tier first, then freshness. A SCHOOL-tier session must be refused even if it has a perfect
 * step-up — "proved it's you" is not "allowed to do this", and conflating the two is how a step-up
 * becomes an authorisation.
 */
export function assertMayOpenNamedRecord(
  officer: OfficerSession,
  assertion: StepUpAssertion,
): void {
  if (!canOpenNamedRecord(officer.level)) {
    throw new TierCannotOpenNamedRecordError(officer.level);
  }
  if (!assertion.fresh) throw new StepUpRequiredError();
}

/**
 * The §6 named-record path, behind the step-up. The ONLY form the server actions may call.
 *
 * The guard runs before `requestNamedStaffRecord` is entered, so on refusal: no audit row (the gate
 * writes it as its step 2), no operational connection (the read-back is opened inside the gate), and
 * no consent read. "Fetches nothing" is a consequence of never calling the function, which is the
 * only way to make that claim testable rather than assertable.
 */
export async function openNamedStaffRecord(
  request: NamedStaffRecordRequest,
  assertion: StepUpAssertion,
): Promise<NamedStaffRecordResult> {
  assertMayOpenNamedRecord(request.officer, assertion);
  return requestNamedStaffRecord(request);
}

/**
 * The staff-list browse, behind the same step-up.
 *
 * Browsing a roster IS a named-record access — it returns a list of people's names, and the gate
 * logs it with `roster_browsed = true`. Exempting it "because it is only a list" would make the
 * step-up skippable by taking the longer route to the same names, so the browse is gated on exactly
 * the same assertion. The 5-minute reuse window is what keeps that from being a second challenge in
 * the middle of one task: browse → pick → view → export is one assertion (Kofi R6).
 */
export async function browseStaffListGated(
  request: StaffListBrowseRequest,
  assertion: StepUpAssertion,
): Promise<StaffListBrowseResult> {
  assertMayOpenNamedRecord(request.officer, assertion);
  return requestStaffListBrowse(request);
}
