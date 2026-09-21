import { sql } from "drizzle-orm";
import { withJurisdiction } from "@/lib/db/rls";
import type { Tx } from "@/lib/db";
import type { OfficerSession } from "@/lib/oversight/officer";
import { isReadbackConfigured, withReadbackSchool } from "@/lib/db/readback";
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
  isRosterTargetRef,
  type LegalBasis,
} from "@/lib/oversight/target-ref";
import {
  bindEstablishmentId,
  confirmSchoolIdentity,
  fetchScopedStaffRecord,
  fetchStaffList,
  staffRecordExists,
  SOURCELESS_FIELDS,
  UNAVAILABLE_NO_SOURCE,
  UNVERIFIABLE_NO_LINK_KEY,
  type EstablishmentBinding,
  type StaffListRow,
} from "@/lib/oversight/staff-projection";
import { resolveSchoolInTx, type ResolvedSchool } from "@/lib/oversight/school-ref";

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
 *   1. VALIDATE the gate input (shape, reason code).
 *   2. RESOLVE THE SCHOOL under the OFFICER's own jurisdiction RLS, and refuse outright if it is
 *      outside their subtree; then CLASSIFY the subject against the GES establishment register in
 *      the same transaction. ANALYTICS only — no operational connection exists yet. The school's
 *      jurisdiction node and ownership type come from the register, NOT from the caller.
 *   3. PREFLIGHT ownership: with `E3_NON_PUBLIC_STAFF_DRILLDOWN` off, a PRIVATE/MISSION school is
 *      refused — before any operational connection is opened, unless the request claims an
 *      establishment number (see step 3 in the body for why the claim moves it later).
 *   4. OPEN the read-back transaction, confirm the claimed school, BIND any claimed establishment
 *      number to the row about to be fetched, read the consent row live unless that binding
 *      established the statutory basis, and ask whether the subject exists. Still no staff COLUMN
 *      has been named.
 *   5. WRITE THE AUDIT ROW. Outcome, lawful basis, consent ref, fields the reason unlocks.
 *   6. ONLY THEN project the record, inside the SAME read-back transaction.
 *
 * THE STATUTORY BASIS NEEDS A BOUND SUBJECT, NOT A CLAIMED ID. The GES establishment number and the
 * operational staff uuid arrive separately in the request, and an establishment number is not a
 * secret — so "this number is on the register" says nothing about the row being fetched. Both must
 * be bound to the same person (step 4) or the basis stays CONSENT and the consent + ownership gates
 * apply. Today nothing in operational Postgres can bind them, so every direct record fetch resolves
 * to CONSENT. See `bindEstablishmentId` for the full argument and the intended consequence.
 *
 * THE CEILING IS ENFORCED HERE, NOT BY THE CALLER. Step 2 is an authorization check, and it lives
 * in the choke point precisely so that it cannot be omitted by the next caller — a route handler, a
 * job, a script. See `resolveGateSchoolInTx`. The database backstops it independently: the
 * `audit_insert` RLS policy requires `ov_in_subtree(jurisdiction_id)`, so even a gate bug cannot log
 * — and therefore cannot perform — an access outside the officer's subtree.
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

/**
 * What a caller may say about the school — and it is deliberately the SHORTEST possible list.
 *
 * `jurisdictionId` and `ownershipType` used to be here and have been REMOVED. Both are security
 * decisions (which subtree the access is logged against, and whether the non-public flag applies),
 * and a caller that supplies them is a caller that can forge them: passing the officer's own
 * district node would have slipped the audit row past a subtree check, and claiming `PUBLIC` for a
 * private school would have dodged `E3_NON_PUBLIC_STAFF_DRILLDOWN` entirely. The orchestrator now
 * derives both from `ref_emis_school_register` under the OFFICER's own RLS — see `resolveGateSchool`.
 */
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
  /** Display only — never used in a decision. */
  name?: string | null;
}

/** The school as the GATE resolved it: register-sourced, RLS-filtered, jurisdiction-confirmed. */
interface GateSchool {
  emisSchoolId: string;
  operationalSchoolId: string;
  /** The SCHOOL-level `dim_jurisdiction` node — written to the audit row. */
  jurisdictionId: string;
  ownershipType: OwnershipType | null;
  name: string;
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
  /** The fetched row does not carry the claimed GES establishment number — the forgery shape. */
  | "ESTABLISHMENT_ID_MISMATCH"
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

/**
 * Raised for a request that never constituted a lawful request at all — malformed input, a tenant
 * key that belongs to another school, or a school outside the officer's jurisdiction.
 *
 * These are NOT access outcomes and do not write an audit row. The distinction is between "you
 * asked for something the gate refused" (a DENIED_* row, because a refusal of a well-formed request
 * is exactly what the log exists to evidence) and "that was not a request this officer could make"
 * — where writing a row would mean the log records a jurisdiction, subject or school that the
 * officer had no standing to name in the first place.
 */
export class GateInputError extends Error {
  readonly code: "INVALID_INPUT" | "SCHOOL_MISMATCH" | "OUT_OF_JURISDICTION";
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
 * THE JURISDICTION CEILING, ENFORCED IN THE CHOKE POINT.
 *
 * `ref_emis_school_register` is RLS-scoped by `ov_in_subtree(district_id)`, so reading the school
 * under the OFFICER's own scope answers two questions at once: what the school actually is
 * (jurisdiction node, ownership), and whether this officer may touch it at all. A school outside
 * the subtree simply does not come back.
 *
 * This used to be done only by the caller (`app/(oversight)/…/actions.ts` re-resolved the school
 * before calling). That held in practice and not in principle: a second caller — a route handler, a
 * background job, a test — could hand the gate any school in Ghana and receive a full safeguarding
 * record, because nothing in the gate itself looked. An authorization check that depends on every
 * future caller remembering it is not a check. It lives here now, on the same read the gate was
 * already making, so it costs nothing and cannot be skipped.
 *
 * Refusal is a THROW, not a logged denial (see `GateInputError`): the officer had no standing to
 * name this school, so there is nothing about it that belongs in their audit trail.
 */
async function resolveGateSchoolInTx(tx: Tx, ref: SchoolGateRef): Promise<GateSchool> {
  requireUuid(ref.operationalSchoolId, "school.operationalSchoolId");

  let resolved: ResolvedSchool | null;
  try {
    resolved = await resolveSchoolInTx(tx, ref.emisSchoolId);
  } catch (err) {
    // The register could not be read. We do not know whether this school is in scope, so we do not
    // proceed — an unreadable ceiling is not an absent one.
    throw new GateInputError(
      "OUT_OF_JURISDICTION",
      `Could not confirm that ${ref.emisSchoolId} is inside your jurisdiction: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  if (!resolved) {
    throw new GateInputError(
      "OUT_OF_JURISDICTION",
      `No school ${ref.emisSchoolId} inside your jurisdiction.`,
    );
  }
  if (!resolved.jurisdictionId) {
    // No dim_jurisdiction node ⇒ the access could be neither scoped nor logged against a subtree.
    // Refusing beats logging it against nothing.
    throw new GateInputError(
      "OUT_OF_JURISDICTION",
      `School ${ref.emisSchoolId} has no dim_jurisdiction node, so an access to it could not be scoped or logged.`,
    );
  }

  return {
    emisSchoolId: resolved.emisSchoolId,
    operationalSchoolId: ref.operationalSchoolId,
    jurisdictionId: resolved.jurisdictionId,
    // From the GES REGISTER, never from the caller and never from the school's own operational row:
    // ownership decides whether the consent branch is offered at all, and neither a caller nor a
    // school should be able to move that line.
    ownershipType: resolved.ownershipType,
    name: resolved.name,
  };
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

/**
 * Roster refs (`OPS:<emis>:ROSTER`) are not individual refs; everything else must match its basis.
 *
 * The exemption keys on `isRosterTargetRef`, which requires the full `OPS:<emis>:ROSTER` shape —
 * NOT on `endsWith(":ROSTER")`. A suffix test would let `GES:ROSTER` through, so an officer who
 * typed `ROSTER` as a GES staff id would have produced a STATUTORY row whose ref was never checked
 * against its basis. Narrow escape hatches have to be spelled out in full.
 */
export function assertTargetRefMatchesBasisUnlessRoster(
  ref: string,
  basis: LegalBasis,
): void {
  if (isRosterTargetRef(ref)) return;
  assertTargetRefMatchesBasis(ref, basis);
}

/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE STATUTORY BASIS REQUIRES *TWO* FACTS, AND ONLY ONE OF THEM COMES FROM THE REGISTER.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 *
 *   (1) the claimed GES establishment number is on this school's current register — `classify.ts`;
 *   (2) the operational row we are about to FETCH is the person that number belongs to —
 *       `bindEstablishmentId` in staff-projection.ts.
 *
 * Fact (1) alone was previously enough to set `legal_basis = STATUTORY`, which is what made the
 * basis forgeable: the two ids arrive separately in the request, and an establishment number is not
 * a secret. Both facts are now required, and fact (2) is UNVERIFIABLE until operational
 * `staff_profile` carries a `ges_staff_id` — so today every direct record fetch resolves to CONSENT.
 *
 * `staff_category` and `record_type` follow the BASIS, not the claim. A subject whose establishment
 * membership could not be bound is recorded as OTHER_STAFF / STAFF, because that is how the access
 * was actually treated — the audit row must describe the basis the gate applied, and a reviewer
 * reading TEACHER must be able to rely on it meaning "verified establishment teacher". The
 * unverified claim is deliberately NOT recorded as a fact anywhere on the row: it is not in
 * `target_ref` (which names the operational uuid actually fetched) and it is not in
 * `is_on_ges_establishment` (which reports UNVERIFIABLE_NO_LINK_KEY).
 */
function statutoryEstablished(
  classification: Classification,
  binding: EstablishmentBinding,
): boolean {
  return classification.category === "GES_TEACHER" && binding.state === "VERIFIED";
}

/**
 * THE GATE.
 *
 * Returns a result for every reachable state — GRANTED, or a DENIED_* whose audit row is already
 * written. It throws ONLY for input that never constituted a request: a malformed uuid, a tenant key
 * belonging to another school, a school outside the officer's jurisdiction. An unconfigured
 * read-back is a logged denial rather than a throw, because without it neither consent nor the
 * establishment binding can be established and the request is therefore refused, not merely
 * unserviceable. The page-level "individual drill-down unavailable" state (PROVISIONING §4a-4) is
 * driven by `isIndividualDrilldownAvailable()`, which needs no request.
 */
export async function requestNamedStaffRecord(
  request: NamedStaffRecordRequest,
): Promise<NamedStaffRecordResult> {
  const trace: string[] = [];
  const now = request.now ?? new Date();

  // ── 1. validate ────────────────────────────────────────────────────────────────────────────
  requireUuid(request.officer.officerId, "officer.officerId");
  requireUuid(request.school.operationalSchoolId, "school.operationalSchoolId");
  requireUuid(request.subject.operationalStaffId, "subject.operationalStaffId");
  if (!request.caseReference || request.caseReference.trim().length === 0) {
    throw new GateInputError(
      "INVALID_INPUT",
      "A case reference & explanation is required.",
    );
  }
  trace.push("validated");

  // ── 2. ceiling + classify, in ONE analytics transaction under the OFFICER's own RLS ─────────
  //
  // The school is resolved FIRST and the whole request is refused if it is outside the officer's
  // subtree — before the establishment register is consulted, before any operational connection
  // exists, and therefore before anything could be disclosed. Note that classification alone would
  // NOT have caught this: an out-of-subtree school's register row is filtered away by RLS, which
  // reads as NO_ESTABLISHMENT_ROW and DOWNGRADES the subject to OTHER_STAFF — i.e. the ceiling
  // failure would have been silently converted into a consent-branch request, not a refusal.
  const { school, classification } = await withJurisdiction(
    {
      jurisdictionId: request.officer.jurisdictionId,
      level: request.officer.level,
      officerId: request.officer.officerId,
    },
    async (tx) => {
      const resolvedSchool = await resolveGateSchoolInTx(tx, request.school);
      return {
        school: resolvedSchool,
        classification: await classifyStaffSubjectInTx(tx, {
          emisSchoolId: resolvedSchool.emisSchoolId,
          gesStaffId: request.subject.gesStaffId ?? null,
          now,
        }),
      };
    },
  );
  trace.push("school:in-jurisdiction");
  trace.push(`classified:${classification.category}`);

  const claimedGesStaffId = request.subject.gesStaffId?.trim() || null;

  /**
   * THE PESSIMISTIC BASIS, and the only one any DENIAL is ever written under.
   *
   * A direct record fetch starts as CONSENT and is upgraded to STATUTORY only once the binding is
   * verified INSIDE the read-back transaction (see `statutoryEstablished`). Every refusal therefore
   * happens while the request is still a consent-branch request, which is why `deny()` can close
   * over these constants: the only state that can flip them is the granted path, which computes its
   * own basis and ref at audit-write time. A denial logged as STATUTORY would assert an
   * establishment membership the gate had, by definition, failed to establish.
   */
  const legalBasis: LegalBasis = "CONSENT";
  const staffCategory: StaffCategory = "OTHER_STAFF";
  const recordType: GatedRecordType = "STAFF";

  // Names the operational row that will actually be read — never the claimed establishment number.
  const targetRef = buildTargetRef(legalBasis, {
    emisSchoolId: school.emisSchoolId,
    operationalStaffId: request.subject.operationalStaffId,
  });

  /**
   * A denial that has been WRITTEN. Held outside the read-back transaction on purpose.
   *
   * A denial decided inside the transaction has already had its audit row committed to the
   * ANALYTICS database — a different connection, unaffected by anything happening operationally.
   * If the operational transaction then fails to unwind cleanly (which is the normal case when the
   * consent table is missing: the SELECT aborts the transaction and COMMIT fails), the rejection
   * would otherwise discard a refusal that has already been decided AND recorded. The refusal is
   * the real outcome; the transaction unwind is bookkeeping. See the catch at the end.
   */
  let settledDenial: DeniedResult | null = null;

  const deny = async (
    outcome: DeniedOutcome,
    denialReason: DenialReason,
  ): Promise<DeniedResult> => {
    const accessId = await writeAuditRow({
      officer: request.officer,
      jurisdictionId: school.jurisdictionId,
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
    const result: DeniedResult = {
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
    settledDenial = result;
    return result;
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

  // ── 3. ownership preflight ──────────────────────────────────────────────────────────────────
  //
  // WHEN it runs depends on whether the request claims an establishment number, and that is not
  // fussiness — it is the only way to keep two properties that pull in opposite directions:
  //
  //   · NO claim ⇒ the basis is certainly CONSENT, so the flag can be applied WITHOUT opening any
  //     operational connection at all. This is the common path, and refusing before touching
  //     operational data is worth keeping.
  //   · A claim ⇒ the basis is only decidable inside the read-back transaction (the binding probe
  //     lives there), and statute is meant to hold at private and mission schools too. Applying the
  //     non-public flag before knowing the basis would refuse a verified GES teacher at a private
  //     school, which the flag was never meant to touch. So the preflight moves inside, to run only
  //     if the binding did NOT confer the statutory basis.
  //
  // Today no claim can ever be bound, so the second path always reaches the preflight anyway — it
  // just reaches it a few statements later, having read no staff column on the way.
  const preflightBeforeReadback = claimedGesStaffId === null;

  const runOwnershipPreflight = async (): Promise<DeniedResult | null> => {
    const preflight = ownershipPreflight(school.ownershipType);
    if (preflight.allowed) {
      trace.push("preflight:ok");
      return null;
    }
    trace.push(`preflight:${preflight.reason}`);
    return deny(
      "DENIED_NO_CONSENT",
      preflight.reason === "FLAG_OFF_NON_PUBLIC"
        ? "NON_PUBLIC_FLAG_OFF"
        : "UNKNOWN_OWNERSHIP",
    );
  };

  if (preflightBeforeReadback) {
    const denied = await runOwnershipPreflight();
    if (denied) return denied;
  }

  // Read-back unavailable ⇒ neither consent NOR the establishment binding can be established ⇒
  // denial (logged). There is no branch here that proceeds without the read-back: the statutory
  // basis needs the binding probe just as much as the consent basis needs the consent row. The
  // page-level "individual drill-down unavailable" state (PROVISIONING §4a-4) is driven separately
  // by `isIndividualDrilldownAvailable()`, which needs no request at all.
  if (!isReadbackConfigured()) {
    trace.push("readback:unconfigured");
    return deny("DENIED_NO_CONSENT", "CONSENT_UNREADABLE");
  }

  // ── 4-6. one read-back transaction: confirm school → read consent → AUDIT → project ─────────
  try {
    return await withReadbackSchool(school.operationalSchoolId, async (tx) => {
      const identity = await confirmSchoolIdentity(
        tx,
        school.operationalSchoolId,
        school.emisSchoolId,
      );
      if (!identity.ok) {
        throw new GateInputError(
          "SCHOOL_MISMATCH",
          `The supplied operational school uuid does not belong to EMIS school ${school.emisSchoolId}.`,
        );
      }
      trace.push("school:confirmed");

      // ── 4a. BIND the claimed establishment number to the row we are about to fetch ───────────
      // Selects a boolean, no staff column. Today this always returns UNVERIFIABLE (there is no
      // `staff_profile.ges_staff_id`), so the statutory basis is unreachable and every direct fetch
      // stays on the consent branch. See `bindEstablishmentId` for why that is the fix rather than
      // a stricter check.
      const binding = await bindEstablishmentId(
        tx,
        school.operationalSchoolId,
        request.subject.operationalStaffId,
        claimedGesStaffId,
      );
      trace.push(`binding:${binding.state}`);

      if (binding.state === "MISMATCH") {
        // The column exists and this row does NOT carry the claimed number. That is not a near
        // miss — it is the forgery shape — so it is refused outright rather than quietly demoted
        // to the consent branch, and the attempt is logged.
        return deny("DENIED_STALE_ESTABLISHMENT", "ESTABLISHMENT_ID_MISMATCH");
      }

      const statutory = statutoryEstablished(classification, binding);

      let consentRef: string | null = null;
      if (!statutory) {
        // The claim (if any) could not be bound, so the request is a consent-branch request — and
        // the non-public flag applies to it. For a claim-carrying request this is where the
        // ownership preflight happens (see step 3 for why it waits until the basis is known).
        if (!preflightBeforeReadback) {
          const deniedByOwnership = await runOwnershipPreflight();
          if (deniedByOwnership) return deniedByOwnership;
        }

        const consent = await readConsentInTx(tx, school.operationalSchoolId);
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

      // The basis, settled. From here only the GRANTED path runs, so these may differ from the
      // pessimistic constants `deny()` closes over — which is correct: a grant states the basis it
      // was actually made under, and `target_ref` names the subject that basis was verified against.
      const grantedBasis: LegalBasis = statutory ? "STATUTORY" : "CONSENT";
      const grantedRecordType: GatedRecordType = statutory ? "TEACHER" : "STAFF";
      const grantedStaffCategory: StaffCategory = statutory
        ? "GES_TEACHER"
        : "OTHER_STAFF";
      const grantedTargetRef = statutory
        ? buildTargetRef("STATUTORY", {
            emisSchoolId: school.emisSchoolId,
            // The id VERIFIED against the fetched row — never the id as claimed.
            gesStaffId: (binding as { state: "VERIFIED"; gesStaffId: string }).gesStaffId,
          })
        : targetRef;

      // ── 4b. does the subject exist? NO staff column is selected — see `staffRecordExists`. ───
      // Asked before the audit INSERT so the append-only row can state a truthful
      // `fields_released`: a missing subject must not leave a permanent entry claiming that a DOB
      // and an address were released when nothing was.
      if (
        !(await staffRecordExists(
          tx,
          school.operationalSchoolId,
          request.subject.operationalStaffId,
        ))
      ) {
        trace.push("subject:absent");
        return deny("DENIED_FIELD_SCOPE", "SUBJECT_NOT_FOUND");
      }

      // ── 5. AUDIT FIRST. Nothing below runs if this throws. ────────────────────────────────────
      const exported = Boolean(request.exportFormat);
      const accessId = await writeAuditRow({
        officer: request.officer,
        jurisdictionId: school.jurisdictionId,
        reasonCode: request.reasonCode,
        caseReference: request.caseReference,
        recordType: grantedRecordType,
        targetRef: grantedTargetRef,
        fieldsReleased: scopedFields,
        legalBasis: grantedBasis,
        consentRef,
        outcome: "GRANTED",
        staffCategory: grantedStaffCategory,
        rosterBrowsed: request.rosterBrowsed === true,
        exported,
        exportFormat: request.exportFormat ?? null,
      });
      trace.push("audit:GRANTED");

      // ── 6. and only now, the record ───────────────────────────────────────────────────────────
      const row = await fetchScopedStaffRecord(
        tx,
        school.operationalSchoolId,
        request.subject.operationalStaffId,
        scopedFields,
      );
      trace.push("fetched");
      if (!row) {
        // The existence probe said yes a moment ago, so this is a concurrent delete, not a typo.
        // The audit row stands — the access was authorised and attempted — and the log is
        // append-only, so the outcome is not rewritten.
        return {
          outcome: "DENIED_FIELD_SCOPE" as const,
          accessId,
          legalBasis: grantedBasis,
          consentRef: null,
          staffCategory: grantedStaffCategory,
          recordType: grantedRecordType,
          targetRef: grantedTargetRef,
          fieldsReleased: [] as const,
          denialReason: "SUBJECT_NOT_FOUND" as const,
          classification,
          trace,
        };
      }

      // Server-derived and sourceless members of the scope, filled after the projection.
      const record: Record<string, unknown> = { ...row };
      if (scopedFields.includes("is_on_ges_establishment")) {
        // Reports the VERIFIED binding, not the claim. With no link key the honest answer is
        // neither true nor false — asserting `false` would deny an establishment membership we
        // cannot rule out, exactly as `true` would assert one we cannot confirm.
        record.is_on_ges_establishment = statutory
          ? true
          : binding.state === "UNVERIFIABLE" || binding.state === "NOT_CLAIMED"
            ? UNVERIFIABLE_NO_LINK_KEY
            : false;
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
        legalBasis: grantedBasis,
        consentRef,
        staffCategory: grantedStaffCategory,
        recordType: grantedRecordType,
        targetRef: grantedTargetRef,
        fieldsReleased: scopedFields,
        withheld: withheldFields(request.reasonCode, grantedRecordType),
        record,
        classification,
        trace,
      };
    });
  } catch (err) {
    // A denial that has ALREADY been decided and logged outranks a failure to unwind the
    // operational transaction it was decided in. The commonest case by far: the consent table does
    // not exist yet, the SELECT aborts the transaction, the refusal is written to analytics, and
    // then COMMIT fails. Rethrowing here would throw away a completed refusal and hand the officer
    // a driver error instead of Lucy's C2 state. Nothing was fetched either way.
    if (settledDenial) {
      (settledDenial as DeniedResult).trace = [
        ...trace,
        "readback-tx:unwound-after-denial",
      ];
      return settledDenial;
    }
    throw err;
  }
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
 * THE LIST IS GATED ON THE SAME TERMS AS A RECORD — jurisdiction ceiling, reason code, ownership
 * preflight, live consent read. A list of names IS individual data, so every check the record path
 * makes is made here; otherwise the list becomes the cheap way to learn every employee's name at a
 * school that refused consent, or under a compliance ground nobody recognises, which is most of
 * what the gate exists to prevent.
 */
export async function requestStaffListBrowse(
  request: StaffListBrowseRequest,
): Promise<StaffListBrowseResult> {
  requireUuid(request.officer.officerId, "officer.officerId");
  requireUuid(request.school.operationalSchoolId, "school.operationalSchoolId");
  if (!request.caseReference || request.caseReference.trim().length === 0) {
    throw new GateInputError(
      "INVALID_INPUT",
      "A case reference & explanation is required.",
    );
  }

  // Same ceiling as the record path: the school is resolved under the OFFICER's own RLS, and a
  // school outside their subtree is refused before anything else happens. A staff list is a list of
  // names, so browsing one outside your jurisdiction is the same wrong as opening a record there.
  const school = await withJurisdiction(
    {
      jurisdictionId: request.officer.jurisdictionId,
      level: request.officer.level,
      officerId: request.officer.officerId,
    },
    (tx) => resolveGateSchoolInTx(tx, request.school),
  );

  const targetRef = buildRosterTargetRef(school.emisSchoolId);
  const legalBasis: LegalBasis = "CONSENT";

  let settledDenial: StaffListBrowseResult | null = null;

  const denyBrowse = async (
    outcome: DeniedOutcome,
    denialReason: DenialReason,
  ): Promise<StaffListBrowseResult> => {
    const accessId = await writeAuditRow({
      officer: request.officer,
      jurisdictionId: school.jurisdictionId,
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
    const result: StaffListBrowseResult = {
      accessId,
      outcome,
      legalBasis,
      targetRef,
      rows: [],
      denialReason,
    };
    settledDenial = result;
    return result;
  };

  // The SAME reason-code gate the record path applies. A browse releases no scoped FIELD, which is
  // why it was tempting to leave this to the caller — but the reason code is the compliance ground
  // the officer is held to, and it is written verbatim into the audit log as the justification for
  // seeing every name at the school. An unrecognised ground is not a ground: `reason_code =
  // "banana"` must not buy a staff list, and it must not be this file's assumption that some caller
  // checked. (Same argument as `resolveGateSchoolInTx` — see the ceiling note in the header.)
  if (!isStaffReasonCode(request.reasonCode)) {
    return denyBrowse("DENIED_FIELD_SCOPE", "REASON_UNLOCKS_NOTHING");
  }

  const preflight = ownershipPreflight(school.ownershipType);
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

  try {
    return await withReadbackSchool(school.operationalSchoolId, async (tx) => {
      const identity = await confirmSchoolIdentity(
        tx,
        school.operationalSchoolId,
        school.emisSchoolId,
      );
      if (!identity.ok) {
        throw new GateInputError(
          "SCHOOL_MISMATCH",
          `The supplied operational school uuid does not belong to EMIS school ${school.emisSchoolId}.`,
        );
      }

      const consent = await readConsentInTx(tx, school.operationalSchoolId);
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
        jurisdictionId: school.jurisdictionId,
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
        school.operationalSchoolId,
        request.limit ?? 50,
      );
      return { accessId, outcome: "GRANTED" as const, legalBasis, targetRef, rows };
    });
  } catch (err) {
    // Same reasoning as the record path: a refusal already decided and logged outranks a failure to
    // unwind the operational transaction it was decided in.
    if (settledDenial) return settledDenial;
    throw err;
  }
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
