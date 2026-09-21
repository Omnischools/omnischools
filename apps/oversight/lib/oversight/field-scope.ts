/**
 * FIELD SCOPING — the pure (reason_code, record_type) → allowed-field map (§6 step 3).
 *
 * This module has NO imports, NO I/O and NO branches on anything but its two arguments. That is
 * deliberate: it is the one piece of the gate an auditor should be able to read end-to-end in a
 * minute and check against the policy matrix, and a pure function is also the only thing that can
 * be exhaustively tested across the full reason × record-type matrix.
 *
 * ENFORCED AS A PROJECTION, NOT A REDACTION. The caller (lib/oversight/named-record-access.ts)
 * turns this list into the SELECT column list. Nothing outside the list is ever fetched, so it
 * never reaches the server's memory, a log line, a stack trace, a React server-component payload
 * or a JSON response. Post-fetch redaction would be a strictly weaker guarantee: it protects the
 * screen, not the process, and every redaction bug is a disclosure. The database role is narrower
 * still (docs/PROVISIONING.md §4a grants no SELECT on `staff_compensation` at all) — that grant is
 * the floor this map cannot argue its way below.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * RECONCILIATION WITH LUCY'S C1 MATRIX (docs/design/e3-drilldown-surface-map.md).
 * Kofi's canonical matrix governs where the two differ. The differences, all narrowing:
 *
 *   · Lucy's C1 releases "Payroll status / salary grade & step" and "SSNIT no." under
 *     ESTABLISHMENT_PAYROLL_VERIFICATION and STATUTORY_AUDIT. THEY ARE NOT RELEASED HERE, under any
 *     reason. Compensation is never oversight data: what GES verifies is the ESTABLISHMENT fact
 *     (is this person on an authorised post, from when, at this school), not the amount paid. The
 *     entire staff_compensation cluster and `salary_status` are in NEVER_RELEASE_FIELDS below.
 *     "Payroll verification" in the reason name means verifying a posting against the establishment
 *     register, not reading a payslip.
 *   · Lucy's C1 releases "Safeguarding / disciplinary / misconduct record" under SAFEGUARDING.
 *     Omnischools holds NO operational staff-discipline record, so there is no such field to scope;
 *     it is absent rather than withheld. SAFEGUARDING_MISCONDUCT instead unlocks the welfare-contact
 *     set (emergency_contact, phone) plus DOB and address, which is what a live safeguarding case
 *     actually needs and is the ONLY reason that unlocks emergency_contact or phone.
 *   · Lucy's C1 has no gender row; Kofi's identity spine includes it (it is on every staff reason).
 *
 * The UI still renders every non-released field as a visible "Withheld — not released for this
 * reason" row (Lucy C7) — but it renders that from THIS map's complement, never from a fetched
 * value. Withheld means "not fetched", not "fetched and hidden".
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 */

/** The five staff reason codes (fixed enum — Lucy §"Cross-module references", Kofi's staff set). */
export const STAFF_REASON_CODES = [
  "ESTABLISHMENT_PAYROLL_VERIFICATION",
  "TEACHER_ABSENCE_INVESTIGATION",
  "LICENSURE_QUALIFICATION_VERIFICATION",
  "STATUTORY_AUDIT",
  "SAFEGUARDING_MISCONDUCT",
] as const;

export type StaffReasonCode = (typeof STAFF_REASON_CODES)[number];

/** `record_type` on the audit row. STUDENT is present so this map can REFUSE it explicitly. */
export type GatedRecordType = "TEACHER" | "STAFF" | "STUDENT";

export function isStaffReasonCode(value: string): value is StaffReasonCode {
  return (STAFF_REASON_CODES as readonly string[]).includes(value);
}

/**
 * THE IDENTITY SPINE — released on EVERY staff reason.
 *
 * `is_on_ges_establishment` is SERVER-DERIVED (lib/oversight/classify.ts reads the GES
 * establishment register in the analytics DB); it is not a column on any operational table, and it
 * is deliberately NOT `ref_role.code` or `salary_status`. Those two are what a school typed, and
 * "is this person on the GES establishment" is not a question a school's own data can answer.
 */
export const IDENTITY_SPINE_FIELDS = [
  "full_name",
  "staff_id",
  "post_role_label",
  "assigned_school",
  "is_on_ges_establishment",
  "gender",
] as const;

/**
 * NEVER RELEASED — under any reason code, at any ownership type, to any tier, exported or not.
 *
 * This is not a scope, it is a floor. Two clusters:
 *   · COMPENSATION (staff_compensation.*, and `salary_status` which lives on that table). Salary is
 *     an employment matter between a school and its employee. Oversight's mandate is curriculum,
 *     performance and administration, and no compliance question in the five reason codes is
 *     answered by an amount. The read-back role has no SELECT on the table either.
 *   · STAFF FREE-TEXT NOTES (staff_compensation.notes, and any free-text note column added later).
 *     Free text cannot be field-scoped, because nobody can say in advance what is in it — a note
 *     field is a channel through which every other never-released fact leaks.
 *
 * `assertNoNeverReleasedField` is called on the way into the projection builder, so adding a field
 * to a reason's list that collides with this one fails loudly at the first request rather than
 * quietly widening the gate.
 */
export const NEVER_RELEASE_FIELDS = [
  // staff_compensation cluster
  "monthly_amount",
  "ssnit_deduction",
  "paye_deduction",
  "pay_method",
  "pay_cadence",
  "effective_from",
  "compensation_notes",
  // employment-status label that lives on the compensation row
  "salary_status",
  // free-text staff notes of any kind
  "staff_notes",
] as const;

export type NeverReleasedField = (typeof NEVER_RELEASE_FIELDS)[number];

export function isNeverReleased(field: string): boolean {
  return (NEVER_RELEASE_FIELDS as readonly string[]).includes(field);
}

/** Establishment facts — the posting itself: which authorised post, from when, at which school. */
const ESTABLISHMENT_FIELDS = [
  "appointment_start_date",
  "appointment_end_date",
  "establishment_post_count",
  "establishment_as_of_date",
] as const;

/** Licensure + qualification — the NTC and N&MC statutory registers, and stated qualifications. */
const LICENSURE_FIELDS = [
  "ntc_licence_number",
  "ntc_licence_expiry",
  "nmc_licence_number",
  "nmc_licence_expiry",
  "qualification_level",
  "highest_qualification",
  "undergraduate",
  "specialisations",
] as const;

/**
 * Attendance / absence facts for the subject, plus the scope of their assignment (which classes or
 * subjects the posting covers) — an absence investigation is meaningless without knowing what the
 * person was supposed to be covering.
 *
 * ⚠ SOURCING GATE: Omnischools has NO operational teacher daily-attendance register today (the same
 * gate documented on `fact_teacher_attendance` in db/schema/fact.ts — apps/web records PLC/PD
 * attendance, not a daily staff register). `staff_attendance_facts` is therefore in the SCOPE but
 * has no source, and the projection returns it as UNAVAILABLE_NO_SOURCE — which is a third state,
 * distinct from both "released" and "withheld". Reporting it as withheld would be a lie about why
 * the officer cannot see it; reporting it as absent would hide that the reason code covers it.
 */
const ABSENCE_FIELDS = [
  "staff_attendance_facts",
  "assignment_scope",
  "appointment_start_date",
  "appointment_end_date",
] as const;

/** DOB + address: identifying, not welfare. Unlocked by STATUTORY_AUDIT and SAFEGUARDING only. */
const DOB_ADDRESS_FIELDS = ["date_of_birth", "address"] as const;

/**
 * Welfare contact. `emergency_contact` and `phone` are unlocked by SAFEGUARDING_MISCONDUCT AND BY
 * NOTHING ELSE — not even STATUTORY_AUDIT, which is otherwise the broadest scope here. An audit
 * verifies records; it never needs to reach the person's next of kin. Keeping this to one reason is
 * what makes the reason code mean something: an officer who wants a phone number must state a
 * safeguarding case, and that statement is what the audit log holds them to.
 */
const WELFARE_CONTACT_FIELDS = ["emergency_contact", "phone"] as const;

function dedupe(fields: readonly string[]): readonly string[] {
  return Array.from(new Set(fields));
}

/**
 * THE MATRIX. Every entry starts from the identity spine and adds exactly what the reason earns.
 * Nothing here may name a NEVER_RELEASE_FIELDS member; `assertScopeIntegrity()` proves it.
 */
const SCOPE_BY_REASON: Record<StaffReasonCode, readonly string[]> = {
  ESTABLISHMENT_PAYROLL_VERIFICATION: dedupe([
    ...IDENTITY_SPINE_FIELDS,
    ...ESTABLISHMENT_FIELDS,
  ]),
  TEACHER_ABSENCE_INVESTIGATION: dedupe([...IDENTITY_SPINE_FIELDS, ...ABSENCE_FIELDS]),
  LICENSURE_QUALIFICATION_VERIFICATION: dedupe([
    ...IDENTITY_SPINE_FIELDS,
    ...LICENSURE_FIELDS,
  ]),
  STATUTORY_AUDIT: dedupe([
    ...IDENTITY_SPINE_FIELDS,
    ...ESTABLISHMENT_FIELDS,
    ...LICENSURE_FIELDS,
    ...DOB_ADDRESS_FIELDS,
  ]),
  SAFEGUARDING_MISCONDUCT: dedupe([
    ...IDENTITY_SPINE_FIELDS,
    ...WELFARE_CONTACT_FIELDS,
    ...DOB_ADDRESS_FIELDS,
  ]),
};

/** Every field any reason can ever release — the domain the UI renders "Withheld" rows from. */
export const ALL_SCOPEABLE_FIELDS: readonly string[] = dedupe([
  ...IDENTITY_SPINE_FIELDS,
  ...ESTABLISHMENT_FIELDS,
  ...LICENSURE_FIELDS,
  ...ABSENCE_FIELDS,
  ...DOB_ADDRESS_FIELDS,
  ...WELFARE_CONTACT_FIELDS,
]);

/** Thrown when the gate is handed a reason code or record type it does not serve. Fail closed. */
export class FieldScopeError extends Error {
  readonly code: "UNKNOWN_REASON" | "STUDENT_NOT_REACHABLE" | "SCOPE_INTEGRITY";
  constructor(code: FieldScopeError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "FieldScopeError";
  }
}

/**
 * The map. `recordType` is a parameter because the audit row distinguishes TEACHER (a
 * GES-establishment teacher, statutory) from STAFF (everyone else, consent) — but the field scope
 * is INTENTIONALLY IDENTICAL for the two. A non-GES staff member does not get a wider record than a
 * teacher because their school consented, and a teacher does not get a wider one because the law
 * allows the access: the LAWFUL BASIS decides WHETHER the record opens, the REASON CODE decides
 * WHAT is in it. Collapsing those two questions is how scope creep starts.
 *
 * STUDENT is refused outright — students are not individually reachable through this path at all
 * (see `lib/oversight/named-record-access.ts` and the §6 student branch, which is not built here).
 */
export function allowedFields(
  reasonCode: string,
  recordType: GatedRecordType,
): readonly string[] {
  if (recordType === "STUDENT") {
    throw new FieldScopeError(
      "STUDENT_NOT_REACHABLE",
      "Students are not individually reachable through the staff drill-down path. There is no student field scope here, and no individual-grain student table exists in the analytics DB.",
    );
  }
  if (!isStaffReasonCode(reasonCode)) {
    throw new FieldScopeError(
      "UNKNOWN_REASON",
      `Unknown staff reason code "${reasonCode}". The reason set is a fixed enum; an unrecognised code releases NOTHING.`,
    );
  }
  return SCOPE_BY_REASON[reasonCode];
}

/**
 * WHICH REASONS RELEASE THIS FIELD — DERIVED from the matrix above, never restated.
 *
 * This exists because the answer was previously written out a second time, by hand, in
 * `lib/oversight/copy.ts` as a set of string-prefix heuristics (`field.startsWith("ntc_")` …) for
 * the record screen's scope line. A duplicated policy matrix does not stay duplicated: that copy
 * had already drifted — `qualification_level`, `highest_qualification` and `undergraduate` are all
 * in LICENSURE_FIELDS but matched no prefix branch, so the screen told the officer nothing about
 * which reason would unlock them. The scope line is the one sentence that explains WHY a field is
 * greyed out; computing it from anything but the map that actually greyed it is how an officer ends
 * up believing a field is unreachable when it is not.
 *
 * Returns the codes, not display copy: this module is pure policy and has no opinion about wording.
 * `lib/oversight/copy.ts` maps codes to `STAFF_REASON_COPY[code].title`.
 *
 * An empty array means no reason releases it — which is true of every NEVER_RELEASE_FIELDS member,
 * and is a meaningfully different statement from "some other reason would".
 */
export function reasonsReleasing(field: string): StaffReasonCode[] {
  return STAFF_REASON_CODES.filter((reason) => SCOPE_BY_REASON[reason].includes(field));
}

/** The complement of `allowedFields` — what the record screen renders as Withheld (Lucy C7). */
export function withheldFields(
  reasonCode: string,
  recordType: GatedRecordType,
): readonly string[] {
  const allowed = new Set(allowedFields(reasonCode, recordType));
  return ALL_SCOPEABLE_FIELDS.filter((f) => !allowed.has(f));
}

/**
 * Structural self-check: no reason may release a never-released field, and no scopeable field may
 * be a never-released one. Called at module load (below) so a bad edit fails the process, the
 * build and every test — not the first production request.
 */
export function assertScopeIntegrity(): void {
  for (const reason of STAFF_REASON_CODES) {
    for (const field of SCOPE_BY_REASON[reason]) {
      if (isNeverReleased(field)) {
        throw new FieldScopeError(
          "SCOPE_INTEGRITY",
          `Field scope for ${reason} names never-released field "${field}".`,
        );
      }
    }
  }
  for (const field of ALL_SCOPEABLE_FIELDS) {
    if (isNeverReleased(field)) {
      throw new FieldScopeError(
        "SCOPE_INTEGRITY",
        `"${field}" is both scopeable and never-released.`,
      );
    }
  }
}

assertScopeIntegrity();
