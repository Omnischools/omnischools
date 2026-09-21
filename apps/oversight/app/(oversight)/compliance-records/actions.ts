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
import { resolveSchool } from "@/lib/oversight/school-ref";
import type { StaffListRow } from "@/lib/oversight/staff-projection";

/**
 * The gate's server actions — the ONLY App-Router code permitted to reach the read-back, and it
 * does so exclusively through `lib/oversight/named-record-access.ts` (see the isolation guard in
 * tests/readback-isolation.test.ts).
 *
 * Two things are done HERE rather than in the orchestrator, because they are session/request
 * concerns rather than gate logic:
 *   · the officer identity comes from `lib/auth` — never from the form. A form-supplied officer id
 *     would let the audit log be written in someone else's name, which is the one thing the log
 *     cannot survive.
 *   · the school is re-resolved from the analytics register under the officer's own jurisdiction
 *     RLS. The form carries an EMIS id; if that school is outside the officer's subtree it does not
 *     resolve, so the jurisdiction ceiling holds at the gate exactly as Lucy §A1.1 requires.
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

/** Resolve the school under the officer's ceiling and pair it with the operational tenant uuid. */
async function gateSchool(
  officer: Awaited<ReturnType<typeof requireOfficerSession>>,
  emisSchoolId: string,
  operationalSchoolId: string,
): Promise<SchoolGateRef | { error: string }> {
  const resolved = await resolveSchool(
    {
      jurisdictionId: officer.jurisdictionId,
      level: officer.level,
      officerId: officer.officerId,
    },
    emisSchoolId,
  );
  if (!resolved) {
    return { error: `No school ${emisSchoolId} inside your jurisdiction.` };
  }
  if (!resolved.jurisdictionId) {
    return {
      error: `School ${emisSchoolId} has no dim_jurisdiction node, so an access to it could not be scoped or logged.`,
    };
  }
  return {
    emisSchoolId: resolved.emisSchoolId,
    operationalSchoolId,
    jurisdictionId: resolved.jurisdictionId,
    ownershipType: resolved.ownershipType,
    name: resolved.name,
  };
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

  const school = await gateSchool(officer, emisSchoolId, operationalSchoolId);
  if ("error" in school) return { status: "error", message: school.error };

  try {
    const result = await requestNamedStaffRecord({
      officer,
      school,
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
        unavailable: raw === "UNAVAILABLE_NO_SOURCE",
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

  const school = await gateSchool(officer, emisSchoolId, operationalSchoolId);
  if ("error" in school) return { status: "error", message: school.error };

  try {
    const result = await requestStaffListBrowse({
      officer,
      school,
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
