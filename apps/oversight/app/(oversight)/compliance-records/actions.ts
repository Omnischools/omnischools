"use server";

import { requireOfficerSession } from "@/lib/auth";
import { ReadbackUnavailableError } from "@/lib/db/readback";
import {
  CONSENT_DENIED_COPY,
  GateInputError,
  requestNamedStaffRecord,
  requestStaffListBrowse,
  type DenialReason,
  type SchoolGateRef,
} from "@/lib/oversight/named-record-access";
import { STAFF_REASON_CODES, withheldFields } from "@/lib/oversight/field-scope";
import {
  UNAVAILABLE_NO_SOURCE,
  UNVERIFIABLE_NO_LINK_KEY,
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
      operationalSchoolId: string;
    };

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

/**
 * The school reference handed to the gate: two ids and nothing else.
 *
 * The jurisdiction node and the ownership type are DELIBERATELY not passed. The orchestrator
 * resolves both from the GES register under the officer's own RLS and refuses an out-of-subtree
 * school itself — so this action cannot get the ceiling wrong, and neither can any future caller.
 */
function gateSchool(emisSchoolId: string, operationalSchoolId: string): SchoolGateRef {
  return { emisSchoolId, operationalSchoolId };
}

export async function submitStaffGate(
  _prev: GateState,
  formData: FormData,
): Promise<GateState> {
  const officer = await requireOfficerSession();

  const reasonCode = field(formData, "reasonCode");
  const caseReference = field(formData, "caseReference");
  const emisSchoolId = field(formData, "emisSchoolId");
  const operationalSchoolId = field(formData, "operationalSchoolId");
  const operationalStaffId = field(formData, "operationalStaffId");
  const gesStaffId = field(formData, "gesStaffId");
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

  try {
    const result = await requestNamedStaffRecord({
      officer,
      school: gateSchool(emisSchoolId, operationalSchoolId),
      reasonCode,
      caseReference,
      subject: { operationalStaffId, gesStaffId: gesStaffId || null },
      rosterBrowsed,
      exportFormat: exportFormat || null,
    });

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
        // Both markers render as the muted "no value to give you, and here is why" state rather
        // than as a value: one means Omnischools has no source at all, the other that this subject
        // cannot be bound to the establishment register. Neither is a fact about the person.
        unavailable: raw === UNAVAILABLE_NO_SOURCE || raw === UNVERIFIABLE_NO_LINK_KEY,
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
  const operationalSchoolId = field(formData, "operationalSchoolId");

  if (!(STAFF_REASON_CODES as readonly string[]).includes(reasonCode)) {
    return { status: "error", message: "Pick a compliance reason." };
  }

  try {
    const result = await requestStaffListBrowse({
      officer,
      school: gateSchool(emisSchoolId, operationalSchoolId),
      reasonCode,
      caseReference,
    });
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
      operationalSchoolId,
    };
  } catch (err) {
    if (err instanceof ReadbackUnavailableError) {
      return {
        status: "unavailable",
        message:
          "Individual drill-down is unavailable — the operational read-back is not configured. The aggregate view remains available.",
      };
    }
    if (err instanceof GateInputError) return { status: "error", message: err.message };
    throw err;
  }
}
