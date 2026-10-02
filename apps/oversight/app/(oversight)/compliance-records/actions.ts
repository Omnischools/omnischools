"use server";

import { requireOfficerSession } from "@/lib/auth";
import { ReadbackUnavailableError } from "@/lib/db/readback";
import { resolveStepUpAssertion, type StepUpResolution } from "@/lib/auth/step-up";
import {
  CONSENT_DENIED_COPY,
  GateInputError,
  type DenialReason,
  type SchoolGateRef,
} from "@/lib/oversight/named-record-access";
import {
  browseStaffListGated,
  openNamedStaffRecord,
  StepUpRequiredError,
  TierCannotOpenNamedRecordError,
} from "@/lib/oversight/gate-step-up";
import { STAFF_REASON_CODES, withheldFields } from "@/lib/oversight/field-scope";
import {
  UNAVAILABLE_NO_SOURCE,
  type StaffListRow,
} from "@/lib/oversight/staff-projection";

/**
 * The gate's server actions — the ONLY App-Router code permitted to reach the read-back, and it
 * does so exclusively through `lib/oversight/named-record-access.ts` (see the isolation guard in
 * tests/readback-isolation.test.ts).
 *
 * ONE thing is done HERE rather than in the orchestrator, because it is a session concern rather
 * than gate logic: the officer identity comes from `lib/auth`, never from the form. A form-supplied
 * officer id would let the audit log be written in someone else's name, which is the one thing the
 * log cannot survive.
 *
 * The JURISDICTION CEILING used to be enforced here too, by re-resolving the school before calling.
 * It has moved INTO the orchestrator (`resolveGateSchoolInTx`): an authorization check that only
 * works because the single current caller remembers to make it is not a check, and this file is not
 * going to stay the only caller. This action now passes two ids and lets the gate decide.
 *
 * ── INCREMENT G: THE §6 STEP-UP (Kofi R6 · Lucy G7) ─────────────────────────────────────────────
 * This file imports the gate ONLY through `lib/oversight/gate-step-up.ts`, never
 * `requestNamedStaffRecord` / `requestStaffListBrowse` directly. The step-up is an ORDERING
 * requirement — a fresh AAL2 assertion before the audit row and before any read-back — and an
 * ordering enforced by "the action remembers to check first" is not enforced at all. The choke-point
 * module runs the assertion before the gate function is entered; tests/auth-boundaries.test.ts fails
 * if this file ever reaches past it — and, since Dex B1, the assertion itself is branded, so this
 * file cannot describe a step-up it did not resolve.
 *
 * The freshness itself is read from the SESSION (`getAuthContext().stepUpFresh`), i.e. from the
 * last MFA `amr` timestamp in the server-verified token — not from a form field, a cookie or a
 * client claim. Submitting a code re-asserts it through `lib/auth/mfa.ts`; a cancelled or failed
 * step-up writes nothing and fetches nothing.
 */

export interface ReleasedField {
  field: string;
  value: string | null;
  unavailable: boolean;
}

export type GateState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "unavailable"; message: string }
  | {
      status: "granted";
      accessId: string;
      legalBasis: "STATUTORY" | "CONSENT";
      recordType: string;
      targetRef: string;
      staffName: string;
      released: ReleasedField[];
      withheld: string[];
      reasonCode: string;
    }
  | {
      status: "denied";
      accessId: string;
      outcome: string;
      denialReason: DenialReason;
      legalBasis: "STATUTORY" | "CONSENT";
      targetRef: string;
      copy: typeof CONSENT_DENIED_COPY;
    }
  | {
      status: "roster";
      accessId: string;
      rows: StaffListRow[];
      emisSchoolId: string;
    }
  /**
   * Lucy G7 — the step-up interstitial. NOTHING has been logged and nothing fetched at this point;
   * the officer's own inputs are echoed back so the modal can resubmit them with a code (and so a
   * cancel returns them to a filled-in form rather than an empty one). `factorId` is the officer's
   * enrolled TOTP factor, read server-side; the form never supplies it.
   */
  | {
      status: "step_up";
      factorId: string | null;
      error?: string;
      /** Echoed verbatim, never re-derived — the audit row must reflect what they actually typed. */
      fields: StepUpFields;
    };

export interface StepUpFields {
  intent: "record" | "roster";
  reasonCode: string;
  caseReference: string;
  emisSchoolId: string;
  operationalStaffId: string;
  rosterBrowsed: boolean;
  exportFormat: string;
}

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

/**
 * The school reference handed to the gate: the EMIS id and nothing else.
 *
 * The jurisdiction node, ownership type AND the operational tenant uuid are all resolved by the
 * orchestrator from the GES register under the officer's own RLS — the caller supplies none of them,
 * so it cannot get the ceiling or the tenant wrong, and neither can any future caller.
 */
function gateSchool(emisSchoolId: string): SchoolGateRef {
  return { emisSchoolId };
}

/**
 * Resolve the §6 step-up for THIS submit (Kofi R6 · Lucy G7).
 *
 * ⚠ THIS FUNCTION DECIDES NOTHING. It unpacks the two form fields and hands them to
 * `resolveStepUpAssertion()` in `lib/auth/step-up.ts` — the single mint, which reads the session's
 * own token and, if a code was submitted, verifies it. Previously this file computed freshness
 * itself and then passed a LITERAL `{ fresh: true }` to the choke point, so the guard at the one
 * irreversible surface in the product was checking a value this file had typed (Dex B1). The
 * assertion is now branded and unforgeable; all that is left here is reading `FormData`.
 */
async function resolveStepUp(formData: FormData): Promise<StepUpResolution> {
  return resolveStepUpAssertion({
    code: field(formData, "stepUpCode"),
    // The factor id is NOT trusted from the form for authorisation — the mint challenges that factor
    // against the officer's OWN session, so a borrowed id verifies nothing. It travels in the form
    // only to spare a round trip listing factors.
    factorId: field(formData, "stepUpFactorId") || null,
  });
}

function stepUpFields(formData: FormData, intent: "record" | "roster"): StepUpFields {
  return {
    intent,
    reasonCode: field(formData, "reasonCode"),
    caseReference: field(formData, "caseReference"),
    emisSchoolId: field(formData, "emisSchoolId"),
    operationalStaffId: field(formData, "operationalStaffId"),
    rosterBrowsed: formData.get("rosterBrowsed") === "true",
    exportFormat: field(formData, "exportFormat"),
  };
}

const TIER_REFUSAL =
  "Your tier cannot open a named individual record. The §6 gate is reachable at district, regional and national tier only.";

export async function submitStaffGate(
  _prev: GateState,
  formData: FormData,
): Promise<GateState> {
  const officer = await requireOfficerSession();

  const reasonCode = field(formData, "reasonCode");
  const caseReference = field(formData, "caseReference");
  const emisSchoolId = field(formData, "emisSchoolId");
  const operationalStaffId = field(formData, "operationalStaffId");
  const confirmed = formData.get("confirm") === "on";
  const rosterBrowsed = formData.get("rosterBrowsed") === "true";
  const exportFormat = field(formData, "exportFormat");

  if (!confirmed) {
    return {
      status: "error",
      message:
        "Confirm the compliance-purpose statement before submitting — the access is logged against your name.",
    };
  }
  if (!(STAFF_REASON_CODES as readonly string[]).includes(reasonCode)) {
    return { status: "error", message: "Pick a compliance reason." };
  }

  // ── the step-up, BEFORE anything is logged or fetched ───────────────────────────────────────
  const stepUp = await resolveStepUp(formData);
  if (!stepUp.fresh) {
    return {
      status: "step_up",
      factorId: stepUp.factorId,
      error: stepUp.error,
      fields: stepUpFields(formData, "record"),
    };
  }

  try {
    const result = await openNamedStaffRecord(
      {
        officer,
        school: gateSchool(emisSchoolId),
        reasonCode,
        caseReference,
        subject: { operationalStaffId },
        rosterBrowsed,
        exportFormat: exportFormat || null,
      },
      // The assertion MINTED above, not a literal — it carries the derived freshness, so the choke
      // point re-reads a resolved value rather than this file's opinion of one.
      stepUp.assertion,
    );

    if (result.outcome !== "GRANTED") {
      return {
        status: "denied",
        accessId: result.accessId,
        outcome: result.outcome,
        denialReason: result.denialReason,
        legalBasis: result.legalBasis,
        targetRef: result.targetRef,
        copy: CONSENT_DENIED_COPY,
      };
    }

    const released: ReleasedField[] = result.fieldsReleased.map((f) => {
      const raw = result.record[f];
      return {
        field: f,
        value:
          raw === null || raw === undefined
            ? null
            : typeof raw === "boolean"
              ? raw
                ? "Yes"
                : "No"
              : String(raw),
        // The marker renders as the muted "no value to give you, and here is why" state rather than
        // as a value: Omnischools has no source at all for the field. Not a fact about the person.
        unavailable: raw === UNAVAILABLE_NO_SOURCE,
      };
    });

    return {
      status: "granted",
      accessId: result.accessId,
      legalBasis: result.legalBasis,
      recordType: result.recordType,
      targetRef: result.targetRef,
      staffName: String(result.record.full_name ?? "—"),
      released,
      withheld: [...withheldFields(reasonCode, result.recordType)],
      reasonCode,
    };
  } catch (err) {
    if (err instanceof ReadbackUnavailableError) {
      return {
        status: "unavailable",
        message:
          "Individual drill-down is unavailable — the operational read-back is not configured. The aggregate view remains available.",
      };
    }
    if (err instanceof StepUpRequiredError) {
      // Belt to the braces of the explicit check above: if the choke point refuses, the officer
      // gets the interstitial, never a stack trace and never a silent grant.
      return {
        status: "step_up",
        factorId: null,
        fields: stepUpFields(formData, "record"),
      };
    }
    if (err instanceof TierCannotOpenNamedRecordError) {
      return { status: "error", message: TIER_REFUSAL };
    }
    if (err instanceof GateInputError) return { status: "error", message: err.message };
    throw err;
  }
}

export async function browseStaffListAction(
  _prev: GateState,
  formData: FormData,
): Promise<GateState> {
  const officer = await requireOfficerSession();
  const reasonCode = field(formData, "reasonCode");
  const caseReference = field(formData, "caseReference");
  const emisSchoolId = field(formData, "emisSchoolId");

  if (!(STAFF_REASON_CODES as readonly string[]).includes(reasonCode)) {
    return { status: "error", message: "Pick a compliance reason." };
  }

  // A roster IS a list of names, and the gate logs it as an access (`roster_browsed`). It therefore
  // takes the same step-up as a single record — otherwise the longer route to the same names would
  // be the unguarded one.
  const stepUp = await resolveStepUp(formData);
  if (!stepUp.fresh) {
    return {
      status: "step_up",
      factorId: stepUp.factorId,
      error: stepUp.error,
      fields: stepUpFields(formData, "roster"),
    };
  }

  try {
    const result = await browseStaffListGated(
      {
        officer,
        school: gateSchool(emisSchoolId),
        reasonCode,
        caseReference,
      },
      stepUp.assertion,
    );
    if (result.outcome !== "GRANTED") {
      return {
        status: "denied",
        accessId: result.accessId,
        outcome: result.outcome,
        denialReason: result.denialReason ?? "NO_CONSENT_ON_RECORD",
        legalBasis: result.legalBasis,
        targetRef: result.targetRef,
        copy: CONSENT_DENIED_COPY,
      };
    }
    return {
      status: "roster",
      accessId: result.accessId,
      rows: result.rows,
      emisSchoolId,
    };
  } catch (err) {
    if (err instanceof ReadbackUnavailableError) {
      return {
        status: "unavailable",
        message:
          "Individual drill-down is unavailable — the operational read-back is not configured. The aggregate view remains available.",
      };
    }
    if (err instanceof StepUpRequiredError) {
      return {
        status: "step_up",
        factorId: null,
        fields: stepUpFields(formData, "roster"),
      };
    }
    if (err instanceof TierCannotOpenNamedRecordError) {
      return { status: "error", message: TIER_REFUSAL };
    }
    if (err instanceof GateInputError) return { status: "error", message: err.message };
    throw err;
  }
}
