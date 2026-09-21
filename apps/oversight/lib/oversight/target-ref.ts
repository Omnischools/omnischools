/**
 * `audit_access_log.target_ref` — how the log names the subject of an access.
 *
 * THE REF IS AN IDENTIFIER, NEVER A NAME. The audit log is read by regional directors, the national
 * tier and GES internal audit — a wider readership than the officer who made the access. Writing
 * "A. Boateng · Asankrangwa SHS" into it would mean every reviewer of every entry learns the
 * identity of every subject, which turns the accountability record into a second, unscoped
 * disclosure surface. An id is resolvable by someone who has the standing to resolve it, and inert
 * to everyone else. (This is also why the safeguarding tier withholds even the ref — Lucy C7.)
 *
 * THE PREFIX MUST MATCH THE LAWFUL BASIS. Two forms, and they are not interchangeable:
 *
 *   STATUTORY → `GES:<ges_staff_id>`
 *       The subject is identified by their GES establishment number, because that is what makes the
 *       basis true: the access was lawful precisely because this id is on the register.
 *
 *   CONSENT   → `OPS:<emis_school_id>:<operational_staff_uuid>`
 *       There is no GES-side identifier for a non-establishment staff member, so the subject is
 *       named by (school, operational row). The school is part of the ref because consent is a
 *       SCHOOL-level artefact: a reviewer checking the basis needs to know which school's consent
 *       was relied on, and that must be readable from the ref itself.
 *
 * A `GES:` ref on a CONSENT row would assert the subject was on the establishment register while
 * claiming the basis that only applies when they are not — a self-contradicting audit entry, and
 * exactly the shape a mis-classification would leave behind. `assertTargetRefMatchesBasis` makes
 * that combination impossible to write, so the invariant can be relied on when reading the log.
 */

export type LegalBasis = "STATUTORY" | "CONSENT";

/** GES establishment numbers are alphanumeric with separators (e.g. `GES/WR/08841`). No spaces. */
const GES_STAFF_ID_RE = /^[A-Za-z0-9][A-Za-z0-9/_.-]*$/;
/** EMIS school ids are likewise id-shaped, and must not contain the `:` we use as a separator. */
const EMIS_SCHOOL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9/_.-]*$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class TargetRefError extends Error {
  readonly code = "TARGET_REF_INVALID";
  constructor(message: string) {
    super(message);
    this.name = "TargetRefError";
  }
}

export interface TargetRefInput {
  emisSchoolId: string;
  /** Required for STATUTORY (it IS the basis), ignored for CONSENT. */
  gesStaffId?: string | null;
  /** Required for CONSENT. The operational `staff_profile.id`. */
  operationalStaffId?: string | null;
}

export function buildTargetRef(basis: LegalBasis, input: TargetRefInput): string {
  if (basis === "STATUTORY") {
    const id = input.gesStaffId?.trim();
    if (!id || !GES_STAFF_ID_RE.test(id)) {
      throw new TargetRefError(
        "A STATUTORY access must name the subject by GES establishment id; none was supplied (or it is not id-shaped — a name is never a target_ref).",
      );
    }
    return `GES:${id}`;
  }
  const emis = input.emisSchoolId?.trim();
  const opsId = input.operationalStaffId?.trim();
  if (!emis || !EMIS_SCHOOL_ID_RE.test(emis)) {
    throw new TargetRefError(`"${input.emisSchoolId}" is not an EMIS school id.`);
  }
  if (!opsId || !UUID_RE.test(opsId)) {
    throw new TargetRefError(
      "A CONSENT access must name the subject by operational staff uuid; none was supplied (or it is not a uuid — a name is never a target_ref).",
    );
  }
  return `OPS:${emis}:${opsId}`;
}

export function isValidTargetRefForBasis(ref: string, basis: LegalBasis): boolean {
  if (basis === "STATUTORY") {
    if (!ref.startsWith("GES:")) return false;
    return GES_STAFF_ID_RE.test(ref.slice(4));
  }
  if (!ref.startsWith("OPS:")) return false;
  const parts = ref.split(":");
  if (parts.length !== 3) return false;
  return EMIS_SCHOOL_ID_RE.test(parts[1]!) && UUID_RE.test(parts[2]!);
}

/** Last line of defence, called on the way into the audit INSERT. Throws rather than writes. */
export function assertTargetRefMatchesBasis(ref: string, basis: LegalBasis): void {
  if (!isValidTargetRefForBasis(ref, basis)) {
    throw new TargetRefError(
      `target_ref "${ref}" does not match legal_basis ${basis}. STATUTORY takes GES:<ges_staff_id>; CONSENT takes OPS:<emis_school_id>:<uuid>.`,
    );
  }
}

/**
 * The ref for a staff-LIST browse (Lucy C4). The subject is the school's staff list, not a person,
 * so the person slot is the literal `ROSTER`. It is deliberately NOT a uuid: a browse row must be
 * visibly distinguishable from an individual-record row when scanning the log, and an auditor must
 * never mistake one for the other. Browse rows carry `roster_browsed = true` and
 * `fields_released = []`.
 */
export function buildRosterTargetRef(emisSchoolId: string): string {
  const emis = emisSchoolId?.trim();
  if (!emis || !EMIS_SCHOOL_ID_RE.test(emis)) {
    throw new TargetRefError(`"${emisSchoolId}" is not an EMIS school id.`);
  }
  return `OPS:${emis}:ROSTER`;
}

/**
 * A RECOGNISER MUST NOT BE LAXER THAN ITS CONSTRUCTOR.
 *
 * `buildRosterTargetRef` validates the school slot against `EMIS_SCHOOL_ID_RE`, so this must too —
 * it is the predicate that EXEMPTS a ref from the basis assertion
 * (`assertTargetRefMatchesBasisUnlessRoster`), i.e. the narrowest escape hatch in the audit writer.
 * A recogniser that accepts strings its own producer would refuse is a hole shaped exactly like the
 * check it is meant to be an exception to: `OPS::ROSTER` and `OPS:not an id:ROSTER` are not refs
 * this codebase can produce, so they must not be refs it will wave through either.
 */
export function isRosterTargetRef(ref: string): boolean {
  if (!ref.startsWith("OPS:") || !ref.endsWith(":ROSTER")) return false;
  const parts = ref.split(":");
  if (parts.length !== 3) return false;
  return EMIS_SCHOOL_ID_RE.test(parts[1]!);
}
