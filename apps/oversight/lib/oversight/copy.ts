import type { StaffReasonCode } from "@/lib/oversight/field-scope";

/**
 * Authored copy, verbatim from Lucy's design map (docs/design/e3-drilldown-surface-map.md C1/C2/C3).
 * Kept in one pure module so the wording is reviewable in one place and cannot drift between the
 * gate, the record screen and the audit log.
 */

export const STAFF_REASON_COPY: Record<
  StaffReasonCode,
  { title: string; desc: string; caseRestricted?: boolean }
> = {
  ESTABLISHMENT_PAYROLL_VERIFICATION: {
    title: "Establishment & payroll verification",
    desc: "Confirm a posting, rank or payroll entry against the GES establishment register.",
  },
  TEACHER_ABSENCE_INVESTIGATION: {
    title: "Teacher-absence investigation",
    desc: "Investigate a flagged attendance or absence irregularity for a posted teacher.",
  },
  LICENSURE_QUALIFICATION_VERIFICATION: {
    title: "Licensure & qualification verification",
    desc: "Verify NTC licence status or a stated qualification.",
  },
  STATUTORY_AUDIT: {
    title: "Statutory audit",
    desc: "Staff records requested under a formal GES or national audit.",
  },
  SAFEGUARDING_MISCONDUCT: {
    title: "Safeguarding / misconduct casework",
    desc: "A safeguarding or professional-misconduct case requiring the staff record.",
    caseRestricted: true,
  },
};

/** Field id → the label shown on the record grid, released or withheld. */
export const FIELD_LABELS: Record<string, string> = {
  full_name: "Staff name",
  staff_id: "Operational staff ID",
  post_role_label: "Current post / role",
  assigned_school: "Assigned school",
  is_on_ges_establishment: "On GES establishment",
  gender: "Gender",
  appointment_start_date: "Appointment start",
  appointment_end_date: "Appointment end",
  establishment_post_count: "Established teaching posts",
  establishment_as_of_date: "Establishment register vintage",
  assignment_scope: "Assignment scope",
  staff_attendance_facts: "Attendance / absence record",
  ntc_licence_number: "NTC licence no.",
  ntc_licence_expiry: "NTC licence expiry",
  nmc_licence_number: "N&MC licence no.",
  nmc_licence_expiry: "N&MC licence expiry",
  qualification_level: "Qualification level",
  highest_qualification: "Highest qualification",
  undergraduate: "Undergraduate institution",
  specialisations: "Specialisations",
  date_of_birth: "Date of birth",
  address: "Address",
  emergency_contact: "Emergency contact",
  phone: "Phone",
};

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

/** Lucy C3 — the helper text beside the basis pill. */
export const BASIS_HELPER = {
  STATUTORY:
    "This teacher is on the GES establishment register. GES accesses the record under statutory authority — no school consent is required. The access is still logged and reviewable.",
  CONSENT:
    "This school has recorded DPO consent for individual staff oversight. The record is released on that basis; the access is logged and the consent basis is recorded.",
} as const;

/** Lucy §A1.1 — the gate banner. */
export const GATE_BANNER = {
  title: "You are about to leave aggregate view.",
  body: "This will reveal data about a named individual. GES holds the authority to do this for genuine compliance work — but every access is recorded against your name and reviewable by your regional director, the national tier, and GES internal audit. Use this only when an aggregate view cannot answer the question.",
} as const;

export const CONSENT_LINE =
  "I confirm this access is for the stated compliance purpose only, that an aggregate view cannot answer it, and that I understand this access will be permanently logged against my name and is subject to GES audit review.";

/** Which reason would unlock a withheld field — the second half of Lucy's scope line. */
export function unlockingReasonFor(field: string): string | null {
  if (field === "emergency_contact" || field === "phone") {
    return "Safeguarding / misconduct casework";
  }
  if (field === "date_of_birth" || field === "address") {
    return "Statutory audit, or safeguarding / misconduct casework";
  }
  if (
    field.startsWith("ntc_") ||
    field.startsWith("nmc_") ||
    field === "specialisations"
  ) {
    return "Licensure & qualification verification, or statutory audit";
  }
  if (field.startsWith("appointment_") || field.startsWith("establishment_")) {
    return "Establishment & payroll verification, or statutory audit";
  }
  if (field === "staff_attendance_facts" || field === "assignment_scope") {
    return "Teacher-absence investigation";
  }
  return null;
}
