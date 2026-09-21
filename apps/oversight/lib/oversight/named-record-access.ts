import { sql } from "drizzle-orm";
import { withJurisdiction } from "@/lib/db/rls";
import type { OfficerSession } from "@/lib/oversight/officer";
import {
  ReadbackUnavailableError,
  isReadbackConfigured,
  withReadbackSchool,
} from "@/lib/db/readback";
import {
  classifyStaffSubjectInTx,
  type Classification,
  type StaffCategory,
} from "@/lib/oversight/classify";
import {
  isConsentGranted,
  ownershipPreflight,
  readConsentInTx,
  type OwnershipType,
} from "@/lib/oversight/consent";
import {
  allowedFields,
  withheldFields,
  FieldScopeError,
  isStaffReasonCode,
  type GatedRecordType,
} from "@/lib/oversight/field-scope";
import {
  assertTargetRefMatchesBasis,
  buildRosterTargetRef,
  buildTargetRef,
  type LegalBasis,
} from "@/lib/oversight/target-ref";
import {
  confirmSchoolIdentity,
  fetchScopedStaffRecord,
  fetchStaffList,
  SOURCELESS_FIELDS,
  UNAVAILABLE_NO_SOURCE,
  type StaffListRow,
} from "@/lib/oversight/staff-projection";

/**
 * THE ORCHESTRATOR — the single choke point for every individual staff drill-down (§6).
 *
 * Every named-record read in this product goes through `requestNamedStaffRecord` or
 * `requestStaffListBrowse`. Nothing else may open the read-back, and nothing else may write an
 * `audit_access_log` row. One choke point is what makes the guarantees below checkable by reading
 * one file rather than auditing every route that will ever be added.
 *
 * ═══ THE ORDER IS THE CONTROL ═══════════════════════════════════════════════════════════════════
 *
 *   1. VALIDATE the gate input (shape, jurisdiction, reason code).
 *   2. CLASSIFY the subject against the GES establishment register — ANALYTICS, jurisdiction-RLS,
 *      no operational connection involved. Decides STATUTORY vs CONSENT.
 *   3. PREFLIGHT ownership (CONSENT branch only): with `E3_NON_PUBLIC_STAFF_DRILLDOWN` off, a
 *      PRIVATE/MISSION school is refused here — before any operational connection is opened.
 *   4. OPEN the read-back transaction, confirm the claimed school, and (CONSENT branch) read the
 *      consent row live. Still no staff column has been named.
 *   5. WRITE THE AUDIT ROW. Outcome, lawful basis, consent ref, fields the reason unlocks.
 *   6. ONLY THEN project the record, inside the SAME read-back transaction.
 *
 * WHY THE AUDIT ROW COMES BEFORE THE FETCH. If the fetch came first, then every failure mode
 * between fetching and logging — a crash, a timeout, a deploy, a deliberate kill — produces an
 * access that happened and was never recorded. The log would then contain only the accesses that
 * completed tidily, which is precisely the set an abuser does not belong to. Writing first inverts
 * the failure mode: a crash after the INSERT leaves a logged access that did not happen, which is
 * an over-count, reviewable and harmless. **If the audit INSERT fails, there is no fetch** — the
 * error propagates and the read-back transaction ends without ever naming a staff column. An
 * unloggable access does not occur.
 *
 * WHY DENIALS ARE WRITTEN ROWS. A refusal is the most audit-relevant event the gate produces: it
 * records an officer attempting an access the boundary stopped. A log containing only successes
 * cannot evidence that the gate ever held. Denials carry `fields_released = []` — nothing left the
 * operational database — and the same `case_reference` verbatim, so a pattern of refused attempts
 * is as visible to a reviewer as a pattern of granted ones.
 *
 * WHY CONSENT IS READ IN THE FETCH TRANSACTION. See lib/oversight/consent.ts: no cache, no window.
 * Note the consequence for step order — the consent READ necessarily precedes the audit write,
 * because the audit row must state the outcome and the consent ref it relied on. "Audit before
 * fetch" means before the RECORD is fetched; the consent row is not the record, and no staff column
 * is selected until step 6.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */

export type { OfficerSession } from "@/lib/oversight/officer";

export interface SchoolGateRef {
  /** The analytics-side key (`ref_emis_school_register.emis_school_id`). */
  emisSchoolId: string;
  /**
   * The OPERATIONAL tenant uuid (`ref_school.id`).
   *
   * ⚠ Supplied with the request because the analytics DB holds no operational school uuid — there
   * is no such column on `ref_emis_school_register` or `dim_jurisdiction`. A request-supplied
   * tenant key is never trusted: step 4 sets it as `app.current_school` and then reads
   * `ref_school.ges_code` back and requires it to equal `emisSchoolId`, which the officer's
   * jurisdiction RLS already constrained. (ESCALATED: the ETL should carry the operational uuid
   * onto the register so this hand-off disappears.)
   */
  operationalSchoolId: string;
  /** The SCHOOL-level `dim_jurisdiction` node — written to the audit row. */
  jurisdictionId: string;
  ownershipType: OwnershipType | null;
  name?: string | null;
}

export interface GateSubject {
  /** `staff_profile.id`. Required: it is the only key that reaches an operational staff row. */
  operationalStaffId: string;
  /**
   * The GES establishment number the officer typed. Its presence does NOT confer the statutory
   * basis — membership of the register does (classify.ts). Absent ⇒ OTHER_STAFF by construction.
   */
  gesStaffId?: string | null;
}

export interface NamedStaffRecordRequest {
  officer: OfficerSession;
  school: SchoolGateRef;
  reasonCode: string;
  /** Stored VERBATIM in `audit_access_log.case_reference`. Never trimmed of meaning, never parsed. */
  caseReference: string;
  subject: GateSubject;
  /** True when this record was reached by browsing the school's staff list first (Lucy C4). */
  rosterBrowsed?: boolean;
  /** Presence ⇒ `exported = true`. Leaving the platform is the same logged event as viewing. */
  exportFormat?: string | null;
  /** Injectable clock for the staleness boundary. */
  now?: Date;
}

export type DeniedOutcome =
  "DENIED_NO_CONSENT" | "DENIED_STALE_ESTABLISHMENT" | "DENIED_FIELD_SCOPE";

export type AccessOutcome = "GRANTED" | DeniedOutcome;

/** Ordered breadcrumb of what happened, in the order it happened. Asserted on in tests. */
export type AccessTrace = readonly string[];

export interface GrantedResult {
  outcome: "GRANTED";
  accessId: string;
  legalBasis: LegalBasis;
  consentRef: string | null;
  staffCategory: StaffCategory;
  recordType: GatedRecordType;
  targetRef: string;
  fieldsReleased: readonly string[];
  withheld: readonly string[];
  record: Record<string, unknown>;
  classification: Classification;
  trace: AccessTrace;
}

export interface DeniedResult {
  outcome: DeniedOutcome;
  accessId: string;
  legalBasis: LegalBasis;
  consentRef: null;
  staffCategory: StaffCategory;
  recordType: GatedRecordType;
  targetRef: string;
  fieldsReleased: readonly [];
  /** Why, in the officer-facing vocabulary. Rendered as Lucy's C2 state — never as an error. */
  denialReason: DenialReason;
  classification: Classification;
  trace: AccessTrace;
}

export type NamedStaffRecordResult = GrantedResult | DeniedResult;

export type DenialReason =
  | "NO_CONSENT_ON_RECORD"
  | "CONSENT_REVOKED"
  | "CONSENT_UNREADABLE"
  | "NON_PUBLIC_FLAG_OFF"
  | "UNKNOWN_OWNERSHIP"
  | "ESTABLISHMENT_STALE"
  | "CLASSIFICATION_INDETERMINATE"
  | "REASON_UNLOCKS_NOTHING"
  | "SUBJECT_NOT_FOUND";

/**
 * Can the individual-record surface open at all? A surface-level capability probe, exposed HERE so
 * that a page can render the "individual drill-down unavailable" state (PROVISIONING §4a-4) without
 * importing the read-back client itself — the isolation guard keeps that import list to four
 * modules, and a read-only availability check is not a reason to widen it.
 */
export function isIndividualDrilldownAvailable(): boolean {
  return isReadbackConfigured();
}

/** Raised for input that is malformed or self-contradicting — not an access outcome. */
export class GateInputError extends Error {
  readonly code: "INVALID_INPUT" | "SCHOOL_MISMATCH";
  constructor(code: GateInputError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "GateInputError";
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuid(value: string, label: string): string {
  if (!UUID_RE.test(value ?? "")) {
    throw new GateInputError("INVALID_INPUT", `${label} must be a uuid.`);
  }
  return value;
}

/**
 * Lucy C2 — the officer-facing copy for a denial. VERBATIM from the design map. It is an
 * informational state on gold, not an error: the officer did nothing wrong, the school simply has
 * not granted consent, and the aggregate view is still there.
 */
export const CONSENT_DENIED_COPY = {
  title: "Individual record not available.",
  body: "This school has not granted DPO consent for individual staff oversight. The aggregate view remains available. Individual staff records at non-GES schools are released only where the school has recorded DPO consent; GES-establishment staff are covered by statute and do not require it.",
  primaryAction: "Return to aggregate view →",
  secondary:
    "No record was opened, and nothing was logged as an access — this attempt is recorded only as a consent-denied event in the access & audit log.",
} as const;

interface AuditRowInput {
  officer: OfficerSession;
  jurisdictionId: string;
  reasonCode: string;
  caseReference: string;
  recordType: GatedRecordType;
  targetRef: string;
  fieldsReleased: readonly string[];
  legalBasis: LegalBasis;
  consentRef: string | null;
  outcome: AccessOutcome;
  staffCategory: StaffCategory | null;
  rosterBrowsed: boolean;
  exported: boolean;
  exportFormat: string | null;
}

/**
 * The ONE audit INSERT in the codebase.
 *
 * Runs in its own analytics transaction with `app.current_officer` set, which is what the
 * `audit_insert` RLS policy checks (`officer_id = ov_current_officer()`) — an officer cannot write
 * a row in someone else's name. It does not catch: a failure here must reach the caller, because
 * the caller's next move is to NOT fetch.
 */
async function writeAuditRow(input: AuditRowInput): Promise<string> {
  assertTargetRefMatchesBasisUnlessRoster(input.targetRef, input.legalBasis);
  const scope = {
    jurisdictionId: input.officer.jurisdictionId,
    level: input.officer.level,
    officerId: input.officer.officerId,
  };
  return withJurisdiction(scope, async (tx) => {
    const result = await tx.execute(sql`
      insert into audit_access_log (
        officer_id, officer_role, jurisdiction_id, reason_code, case_reference,
        record_type, target_ref, fields_released, legal_basis, consent_ref, outcome,
        staff_category, roster_browsed, exported, export_format
      ) values (
        ${input.officer.officerId}::uuid,
        ${input.officer.officerRole},
        ${input.jurisdictionId}::uuid,
        ${input.reasonCode},
        ${input.caseReference},
        ${input.recordType}::record_type,
        ${input.targetRef},
        ${JSON.stringify(input.fieldsReleased)}::jsonb,
        ${input.legalBasis}::access_legal_basis,
        ${input.consentRef}::uuid,
        ${input.outcome}::access_outcome,
        ${input.staffCategory},
        ${input.rosterBrowsed},
        ${input.exported},
        ${input.exportFormat}
      )
      returning access_id::text as access_id
    `);
    const rows = (
      Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])
    ) as { access_id: string }[];
    const accessId = rows[0]?.access_id;
    if (!accessId) {
      throw new Error(
        "audit_access_log INSERT returned no access_id — refusing to fetch.",
      );
    }
    return accessId;
  });
}

/** Roster refs (`OPS:<emis>:ROSTER`) are not individual refs; everything else must match its basis. */
function assertTargetRefMatchesBasisUnlessRoster(ref: string, basis: LegalBasis): void {
  if (ref.endsWith(":ROSTER")) return;
  assertTargetRefMatchesBasis(ref, basis);
}

function basisFor(classification: Classification): LegalBasis {
  return classification.category === "GES_TEACHER" ? "STATUTORY" : "CONSENT";
}

function categoryFor(classification: Classification): StaffCategory {
  // INDETERMINATE is recorded as OTHER_STAFF: we could not establish the statutory branch, and the
  // audit row must not read as though we had.
  return classification.category === "GES_TEACHER" ? "GES_TEACHER" : "OTHER_STAFF";
}

function recordTypeFor(classification: Classification): GatedRecordType {
  return classification.category === "GES_TEACHER" ? "TEACHER" : "STAFF";
}

/**
 * THE GATE.
 *
 * Returns a result for every reachable state — GRANTED or a DENIED_* with its audit row already
 * written. It throws only for input that never constituted a request (malformed uuids, a forged
 * tenant key) and for `ReadbackUnavailableError` on the statutory branch, which is a capability
 * state, not a refusal: PROVISIONING §4a-4 requires the individual surface to present as closed
 * when `OPERATIONAL_READBACK_URL` is unset.
 */
export async function requestNamedStaffRecord(
  request: NamedStaffRecordRequest,
): Promise<NamedStaffRecordResult> {
  const trace: string[] = [];
  const now = request.now ?? new Date();

  // ── 1. validate ────────────────────────────────────────────────────────────────────────────
  requireUuid(request.officer.officerId, "officer.officerId");
  requireUuid(request.school.operationalSchoolId, "school.operationalSchoolId");
  requireUuid(request.school.jurisdictionId, "school.jurisdictionId");
  requireUuid(request.subject.operationalStaffId, "subject.operationalStaffId");
  if (!request.caseReference || request.caseReference.trim().length === 0) {
    throw new GateInputError(
      "INVALID_INPUT",
      "A case reference & explanation is required.",
    );
  }
  trace.push("validated");

  // ── 2. classify (ANALYTICS, jurisdiction RLS — no operational connection yet) ───────────────
  const classification = await withJurisdiction(
    {
      jurisdictionId: request.officer.jurisdictionId,
      level: request.officer.level,
      officerId: request.officer.officerId,
    },
    (tx) =>
      classifyStaffSubjectInTx(tx, {
        emisSchoolId: request.school.emisSchoolId,
        gesStaffId: request.subject.gesStaffId ?? null,
        now,
      }),
  );
  trace.push(`classified:${classification.category}`);

  const legalBasis = basisFor(classification);
  const staffCategory = categoryFor(classification);
  const recordType = recordTypeFor(classification);

  const targetRef = buildTargetRef(legalBasis, {
    emisSchoolId: request.school.emisSchoolId,
    gesStaffId: request.subject.gesStaffId ?? null,
    operationalStaffId: request.subject.operationalStaffId,
  });

  const deny = async (
    outcome: DeniedOutcome,
    denialReason: DenialReason,
  ): Promise<DeniedResult> => {
    const accessId = await writeAuditRow({
      officer: request.officer,
      jurisdictionId: request.school.jurisdictionId,
      reasonCode: request.reasonCode,
      caseReference: request.caseReference,
      recordType,
      targetRef,
      fieldsReleased: [],
      legalBasis,
      consentRef: null,
      outcome,
      staffCategory,
      rosterBrowsed: request.rosterBrowsed === true,
      exported: false,
      exportFormat: null,
    });
    trace.push(`audit:${outcome}`);
    return {
      outcome,
      accessId,
      legalBasis,
      consentRef: null,
      staffCategory,
      recordType,
      targetRef,
      fieldsReleased: [],
      denialReason,
      classification,
      trace,
    };
  };

  // ── 2b. the reason code must unlock something, and must not be a student reason ─────────────
  let scopedFields: readonly string[];
  try {
    if (!isStaffReasonCode(request.reasonCode)) {
      throw new FieldScopeError(
        "UNKNOWN_REASON",
        `Unknown staff reason "${request.reasonCode}".`,
      );
    }
    scopedFields = allowedFields(request.reasonCode, recordType);
  } catch {
    return deny("DENIED_FIELD_SCOPE", "REASON_UNLOCKS_NOTHING");
  }

  // ── 2c. indeterminate classification fails closed ──────────────────────────────────────────
  if (classification.category === "INDETERMINATE") {
    return deny("DENIED_STALE_ESTABLISHMENT", "CLASSIFICATION_INDETERMINATE");
  }

  // ── 3. ownership preflight (CONSENT branch only) — BEFORE any operational connection ────────
  if (legalBasis === "CONSENT") {
    const preflight = ownershipPreflight(request.school.ownershipType);
    if (!preflight.allowed) {
      trace.push(`preflight:${preflight.reason}`);
      return deny(
        "DENIED_NO_CONSENT",
        preflight.reason === "FLAG_OFF_NON_PUBLIC"
          ? "NON_PUBLIC_FLAG_OFF"
          : "UNKNOWN_OWNERSHIP",
      );
    }
    trace.push("preflight:ok");

    // Read-back unavailable ⇒ consent cannot be established ⇒ denial (logged).
    if (!isReadbackConfigured()) {
      trace.push("readback:unconfigured");
      return deny("DENIED_NO_CONSENT", "CONSENT_UNREADABLE");
    }
  } else if (!isReadbackConfigured()) {
    // Statutory branch: nothing to refuse, the capability is simply absent. The surface renders
    // "individual drill-down unavailable" (PROVISIONING §4a-4).
    throw new ReadbackUnavailableError();
  }

  // ── 4-6. one read-back transaction: confirm school → read consent → AUDIT → project ─────────
  return withReadbackSchool(request.school.operationalSchoolId, async (tx) => {
    const identity = await confirmSchoolIdentity(
      tx,
      request.school.operationalSchoolId,
      request.school.emisSchoolId,
    );
    if (!identity.ok) {
      throw new GateInputError(
        "SCHOOL_MISMATCH",
        `The supplied operational school uuid does not belong to EMIS school ${request.school.emisSchoolId}.`,
      );
    }
    trace.push("school:confirmed");

    let consentRef: string | null = null;
    if (legalBasis === "CONSENT") {
      const consent = await readConsentInTx(tx, request.school.operationalSchoolId);
      trace.push(`consent:${consent.outcome}`);
      if (!isConsentGranted(consent)) {
        const staleFallThrough =
          classification.category === "OTHER_STAFF" &&
          classification.reason === "STALE_ESTABLISHMENT";
        return deny(
          staleFallThrough ? "DENIED_STALE_ESTABLISHMENT" : "DENIED_NO_CONSENT",
          staleFallThrough
            ? "ESTABLISHMENT_STALE"
            : consent.outcome === "REVOKED"
              ? "CONSENT_REVOKED"
              : consent.outcome === "TABLE_UNREACHABLE"
                ? "CONSENT_UNREADABLE"
                : "NO_CONSENT_ON_RECORD",
        );
      }
      consentRef = consent.consentRef;
    }

    // ── 5. AUDIT FIRST. Nothing below runs if this throws. ────────────────────────────────────
    const exported = Boolean(request.exportFormat);
    const accessId = await writeAuditRow({
      officer: request.officer,
      jurisdictionId: request.school.jurisdictionId,
      reasonCode: request.reasonCode,
      caseReference: request.caseReference,
      recordType,
      targetRef,
      fieldsReleased: scopedFields,
      legalBasis,
      consentRef,
      outcome: "GRANTED",
      staffCategory,
      rosterBrowsed: request.rosterBrowsed === true,
      exported,
      exportFormat: request.exportFormat ?? null,
    });
    trace.push("audit:GRANTED");

    // ── 6. and only now, the record ───────────────────────────────────────────────────────────
    const row = await fetchScopedStaffRecord(
      tx,
      request.school.operationalSchoolId,
      request.subject.operationalStaffId,
      scopedFields,
    );
    trace.push("fetched");
    if (!row) {
      // The audit row stands: the access was authorised and attempted. The subject simply is not
      // there. We do NOT rewrite the outcome — the log is append-only and records what was done.
      return {
        outcome: "DENIED_FIELD_SCOPE" as const,
        accessId,
        legalBasis,
        consentRef: null,
        staffCategory,
        recordType,
        targetRef,
        fieldsReleased: [] as const,
        denialReason: "SUBJECT_NOT_FOUND" as const,
        classification,
        trace,
      };
    }

    // Server-derived and sourceless members of the scope, filled after the projection.
    const record: Record<string, unknown> = { ...row };
    if (scopedFields.includes("is_on_ges_establishment")) {
      record.is_on_ges_establishment = classification.category === "GES_TEACHER";
    }
    if (scopedFields.includes("establishment_as_of_date")) {
      // INDETERMINATE was refused above, so the classification here always carries a vintage field
      // (null on an OTHER_STAFF subject with no register row).
      record.establishment_as_of_date = classification.establishmentAsOfDate;
    }
    if (scopedFields.includes("establishment_post_count")) {
      record.establishment_post_count =
        classification.category === "GES_TEACHER"
          ? classification.teachingPostsEstablished
          : null;
    }
    for (const field of SOURCELESS_FIELDS) {
      if (scopedFields.includes(field)) record[field] = UNAVAILABLE_NO_SOURCE;
    }

    return {
      outcome: "GRANTED" as const,
      accessId,
      legalBasis,
      consentRef,
      staffCategory,
      recordType,
      targetRef,
      fieldsReleased: scopedFields,
      withheld: withheldFields(request.reasonCode, recordType),
      record,
      classification,
      trace,
    };
  });
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// STAFF-LIST BROWSE (Lucy C4)
// ════════════════════════════════════════════════════════════════════════════════════════════════

export interface StaffListBrowseRequest {
  officer: OfficerSession;
  school: SchoolGateRef;
  reasonCode: string;
  caseReference: string;
  limit?: number;
}

export interface StaffListBrowseResult {
  accessId: string;
  outcome: AccessOutcome;
  legalBasis: LegalBasis;
  targetRef: string;
  rows: StaffListRow[];
  /** Present when the list could not open; rendered as the C2 informational state. */
  denialReason?: DenialReason;
}

/**
 * Browsing a school's staff list is itself a named-data access, so it is gated and LOGGED exactly
 * like opening a record: one append-only row with `roster_browsed = true` and
 * `fields_released = []` (a list is navigation, not a record — it releases no scoped field).
 *
 * Picking a row afterwards writes a SECOND row for the individual. Two rows, not one updated row:
 * the log is append-only, so "the officer browsed, then opened X" is two events and must be two
 * entries. They are tied together by the verbatim case reference.
 *
 * THE LIST IS CONSENT-GATED TOO. A list of names IS individual data. The browse runs the same
 * ownership preflight and the same live consent read, and refuses on the same terms — otherwise
 * the list would be a way to learn every employee's name at a school that refused consent, which
 * is most of what the gate exists to prevent.
 */
export async function requestStaffListBrowse(
  request: StaffListBrowseRequest,
): Promise<StaffListBrowseResult> {
  requireUuid(request.officer.officerId, "officer.officerId");
  requireUuid(request.school.operationalSchoolId, "school.operationalSchoolId");
  requireUuid(request.school.jurisdictionId, "school.jurisdictionId");
  if (!request.caseReference || request.caseReference.trim().length === 0) {
    throw new GateInputError(
      "INVALID_INPUT",
      "A case reference & explanation is required.",
    );
  }

  const targetRef = buildRosterTargetRef(request.school.emisSchoolId);
  const legalBasis: LegalBasis = "CONSENT";

  const denyBrowse = async (
    outcome: DeniedOutcome,
    denialReason: DenialReason,
  ): Promise<StaffListBrowseResult> => {
    const accessId = await writeAuditRow({
      officer: request.officer,
      jurisdictionId: request.school.jurisdictionId,
      reasonCode: request.reasonCode,
      caseReference: request.caseReference,
      recordType: "STAFF",
      targetRef,
      fieldsReleased: [],
      legalBasis,
      consentRef: null,
      outcome,
      staffCategory: "OTHER_STAFF",
      rosterBrowsed: true,
      exported: false,
      exportFormat: null,
    });
    return { accessId, outcome, legalBasis, targetRef, rows: [], denialReason };
  };

  const preflight = ownershipPreflight(request.school.ownershipType);
  if (!preflight.allowed) {
    return denyBrowse(
      "DENIED_NO_CONSENT",
      preflight.reason === "FLAG_OFF_NON_PUBLIC"
        ? "NON_PUBLIC_FLAG_OFF"
        : "UNKNOWN_OWNERSHIP",
    );
  }
  if (!isReadbackConfigured()) {
    return denyBrowse("DENIED_NO_CONSENT", "CONSENT_UNREADABLE");
  }

  return withReadbackSchool(request.school.operationalSchoolId, async (tx) => {
    const identity = await confirmSchoolIdentity(
      tx,
      request.school.operationalSchoolId,
      request.school.emisSchoolId,
    );
    if (!identity.ok) {
      throw new GateInputError(
        "SCHOOL_MISMATCH",
        `The supplied operational school uuid does not belong to EMIS school ${request.school.emisSchoolId}.`,
      );
    }

    const consent = await readConsentInTx(tx, request.school.operationalSchoolId);
    if (!isConsentGranted(consent)) {
      return denyBrowse(
        "DENIED_NO_CONSENT",
        consent.outcome === "REVOKED"
          ? "CONSENT_REVOKED"
          : consent.outcome === "TABLE_UNREACHABLE"
            ? "CONSENT_UNREADABLE"
            : "NO_CONSENT_ON_RECORD",
      );
    }

    // AUDIT FIRST, then the list.
    const accessId = await writeAuditRow({
      officer: request.officer,
      jurisdictionId: request.school.jurisdictionId,
      reasonCode: request.reasonCode,
      caseReference: request.caseReference,
      recordType: "STAFF",
      targetRef,
      fieldsReleased: [],
      legalBasis,
      consentRef: consent.consentRef,
      outcome: "GRANTED",
      staffCategory: "OTHER_STAFF",
      rosterBrowsed: true,
      exported: false,
      exportFormat: null,
    });

    const rows = await fetchStaffList(
      tx,
      request.school.operationalSchoolId,
      request.limit ?? 50,
    );
    return { accessId, outcome: "GRANTED" as const, legalBasis, targetRef, rows };
  });
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// STUDENTS
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Students are NOT individually reachable through this subsystem, and the assertion is executable
 * rather than a comment. There is no student branch here, no student reason set, no student field
 * scope (field-scope.ts throws on `STUDENT`), and — the structural part — no individual-grain
 * student table is introduced anywhere in the analytics schema. The §6 student roster path is a
 * separate piece of work; nothing in this module can be pointed at a pupil.
 */
export function assertStudentsNotIndividuallyReachable(): void {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _staffOnly: GatedRecordType[] = ["TEACHER", "STAFF"];
  try {
    allowedFields("STATUTORY_AUDIT", "STUDENT");
  } catch (err) {
    if (err instanceof FieldScopeError && err.code === "STUDENT_NOT_REACHABLE") return;
    throw err;
  }
  throw new Error(
    "Students must not be reachable through the staff drill-down field scope.",
  );
}
