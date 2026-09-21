/**
 * Fixture identifiers, fixed so a test can read like a sentence and a failure names a school rather
 * than a uuid. Every id is a v4-shaped constant; nothing here is random, so a failing assertion is
 * reproducible from the message alone.
 */

export const JUR = {
  national: "10000000-0000-4000-8000-000000000001",
  region: "10000000-0000-4000-8000-000000000002",
  district: "10000000-0000-4000-8000-000000000003",
  /** A SECOND district, used to prove the jurisdiction ceiling refuses a school outside it. */
  otherDistrict: "10000000-0000-4000-8000-000000000004",
  schoolPublicConsented: "10000000-0000-4000-8000-000000000011",
  schoolPublicNoConsent: "10000000-0000-4000-8000-000000000012",
  schoolPrivateConsented: "10000000-0000-4000-8000-000000000013",
  schoolPublicStale: "10000000-0000-4000-8000-000000000014",
  schoolPublicRevoked: "10000000-0000-4000-8000-000000000015",
  /** Registered with ownership_type NULL — a real data gap, not a caller lying about one. */
  schoolUnknownOwnership: "10000000-0000-4000-8000-000000000016",
  /** PRIVATE with no consent row — so the flag-ON path still has something to refuse. */
  schoolPrivateNoConsent: "10000000-0000-4000-8000-000000000017",
  /** In the OTHER district: the school a district officer must not be able to reach. */
  schoolOutsideSubtree: "10000000-0000-4000-8000-000000000018",
  /** In the officer's district but with register operational_school_id NULL — refused (AC-1.6). */
  schoolUnmappedOperational: "10000000-0000-4000-8000-000000000019",
} as const;

export const PERIOD_ID = "20000000-0000-4000-8000-000000000001";

/**
 * EMIS ids. Each register row now carries `operational_school_id` mapping the EMIS school to its
 * operational tenant uuid (the OPS_SCHOOL.* below); the gate reads the tenant from the register, not
 * from the request. `unmappedOperational` has a NULL mapping so the drill-down is refused (AC-1.6).
 */
export const EMIS = {
  publicConsented: "EMIS-PUB-001",
  publicNoConsent: "EMIS-PUB-002",
  privateConsented: "EMIS-PRI-003",
  publicStale: "EMIS-PUB-004",
  publicRevoked: "EMIS-PUB-005",
  unknownOwnership: "EMIS-UNK-006",
  privateNoConsent: "EMIS-PRI-007",
  outsideSubtree: "EMIS-OUT-008",
  unmappedOperational: "EMIS-UNM-009",
} as const;

export const OPS_SCHOOL = {
  publicConsented: "30000000-0000-4000-8000-000000000001",
  publicNoConsent: "30000000-0000-4000-8000-000000000002",
  privateConsented: "30000000-0000-4000-8000-000000000003",
  publicStale: "30000000-0000-4000-8000-000000000004",
  publicRevoked: "30000000-0000-4000-8000-000000000005",
  unknownOwnership: "30000000-0000-4000-8000-000000000006",
  privateNoConsent: "30000000-0000-4000-8000-000000000007",
  outsideSubtree: "30000000-0000-4000-8000-000000000008",
} as const;

export const OPS_USER = {
  teacherOnRegister: "40000000-0000-4000-8000-000000000001",
  clerkNotOnRegister: "40000000-0000-4000-8000-000000000002",
  staffNoConsentSchool: "40000000-0000-4000-8000-000000000003",
  staffPrivateSchool: "40000000-0000-4000-8000-000000000004",
  teacherStaleRegister: "40000000-0000-4000-8000-000000000005",
  staffRevokedSchool: "40000000-0000-4000-8000-000000000006",
  staffUnknownOwnership: "40000000-0000-4000-8000-000000000007",
  staffPrivateNoConsent: "40000000-0000-4000-8000-000000000008",
  staffOutsideSubtree: "40000000-0000-4000-8000-000000000009",
  /** PRIVATE-school teacher ON the establishment, GES name matches → statutory (AC-3.10). */
  teacherPrivateOnRegister: "40000000-0000-4000-8000-000000000010",
  /** PRIVATE-school teacher ON the establishment, GES name DISAGREES → demoted to consent. */
  teacherPrivateNameMismatch: "40000000-0000-4000-8000-000000000011",
  /**
   * At EMIS-PUB-005 (which HAS a fresh establishment vintage) with a real, non-null NTC licence that
   * is NOT on that register, holding a school-authored 'TEACHER' role. Register decides, not role or
   * the mere presence of a licence → CONSENT branch, never STATUTORY (AC-3.2 anti-forgery).
   */
  staffSetNtcNotOnRegister: "40000000-0000-4000-8000-000000000012",
} as const;

/** `staff_profile.id` — the only key that reaches an operational staff row. */
export const OPS_STAFF = {
  teacherOnRegister: "50000000-0000-4000-8000-000000000001",
  clerkNotOnRegister: "50000000-0000-4000-8000-000000000002",
  staffNoConsentSchool: "50000000-0000-4000-8000-000000000003",
  staffPrivateSchool: "50000000-0000-4000-8000-000000000004",
  teacherStaleRegister: "50000000-0000-4000-8000-000000000005",
  staffRevokedSchool: "50000000-0000-4000-8000-000000000006",
  staffUnknownOwnership: "50000000-0000-4000-8000-000000000007",
  staffPrivateNoConsent: "50000000-0000-4000-8000-000000000008",
  staffOutsideSubtree: "50000000-0000-4000-8000-000000000009",
  teacherPrivateOnRegister: "50000000-0000-4000-8000-000000000010",
  teacherPrivateNameMismatch: "50000000-0000-4000-8000-000000000011",
  /** Set-but-unregistered NTC at a register-bearing school → CONSENT, never STATUTORY (AC-3.2). */
  staffSetNtcNotOnRegister: "50000000-0000-4000-8000-000000000012",
  /** A uuid that is a valid shape but no staff_profile row — the SUBJECT_NOT_FOUND probe. */
  absent: "5fffffff-0000-4000-8000-0000000000ff",
} as const;

/**
 * NTC teacher-licence numbers — the statutory-basis key. These MATCH the operational
 * `staff_profile.ntc_licence_number` values in operational-seed.sql; membership over the
 * establishment register's `establishment_teachers[].ntc_licence_number` is the whole test.
 */
export const NTC_LICENCE = {
  /** teacherOnRegister's licence, on EMIS-PUB-001's FRESH establishment (name matches → statutory). */
  onRegister: "NTC-2019-004417",
  /** teacherStaleRegister's licence, on the STALE EMIS-PUB-004 vintage (breaches the 6-month ceiling). */
  onStaleRegister: "NTC-2015-000981",
  /** Syntactically fine, on no register anywhere — "a licence not on the register". */
  notOnAnyRegister: "NTC-9999-000000",
  /** teacherPrivateOnRegister's licence, on EMIS-PRI-003 with a MATCHING GES name. */
  privateStatutory: "NTC-PRI-003-STAT",
  /** teacherPrivateNameMismatch's licence, on EMIS-PRI-003 with a DISAGREEING GES name. */
  privateNameMismatch: "NTC-PRI-003-MISMATCH",
} as const;

export const OFFICER = {
  /** District director — the ordinary case, ceiling = `JUR.district`. */
  districtId: "60000000-0000-4000-8000-000000000001",
  role: "DISTRICT_DIRECTOR",
  /** National tier — no jurisdiction filter. */
  nationalId: "60000000-0000-4000-8000-000000000002",
  nationalRole: "NATIONAL_OVERSIGHT",
} as const;

export const CONSENT_ID = {
  publicConsented: "70000000-0000-4000-8000-000000000001",
  privateConsented: "70000000-0000-4000-8000-000000000003",
  publicRevoked: "70000000-0000-4000-8000-000000000005",
  unknownOwnership: "70000000-0000-4000-8000-000000000006",
  outsideSubtree: "70000000-0000-4000-8000-000000000008",
} as const;
