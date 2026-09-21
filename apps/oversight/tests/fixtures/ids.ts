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
} as const;

export const PERIOD_ID = "20000000-0000-4000-8000-000000000001";

/** EMIS ids double as operational `ref_school.ges_code` — that equality is what the gate checks. */
export const EMIS = {
  publicConsented: "EMIS-PUB-001",
  publicNoConsent: "EMIS-PUB-002",
  privateConsented: "EMIS-PRI-003",
  publicStale: "EMIS-PUB-004",
  publicRevoked: "EMIS-PUB-005",
} as const;

export const OPS_SCHOOL = {
  publicConsented: "30000000-0000-4000-8000-000000000001",
  publicNoConsent: "30000000-0000-4000-8000-000000000002",
  privateConsented: "30000000-0000-4000-8000-000000000003",
  publicStale: "30000000-0000-4000-8000-000000000004",
  publicRevoked: "30000000-0000-4000-8000-000000000005",
} as const;

export const OPS_USER = {
  teacherOnRegister: "40000000-0000-4000-8000-000000000001",
  clerkNotOnRegister: "40000000-0000-4000-8000-000000000002",
  staffNoConsentSchool: "40000000-0000-4000-8000-000000000003",
  staffPrivateSchool: "40000000-0000-4000-8000-000000000004",
  teacherStaleRegister: "40000000-0000-4000-8000-000000000005",
  staffRevokedSchool: "40000000-0000-4000-8000-000000000006",
} as const;

/** `staff_profile.id` — the only key that reaches an operational staff row. */
export const OPS_STAFF = {
  teacherOnRegister: "50000000-0000-4000-8000-000000000001",
  clerkNotOnRegister: "50000000-0000-4000-8000-000000000002",
  staffNoConsentSchool: "50000000-0000-4000-8000-000000000003",
  staffPrivateSchool: "50000000-0000-4000-8000-000000000004",
  teacherStaleRegister: "50000000-0000-4000-8000-000000000005",
  staffRevokedSchool: "50000000-0000-4000-8000-000000000006",
} as const;

export const GES_STAFF_ID = {
  /** On the consented public school's FRESH establishment row. */
  onRegister: "GES/WR/00001",
  /** On the stale school's establishment row — named, but the extract breaches the 6-month ceiling. */
  onStaleRegister: "GES/WR/00004",
  /** Syntactically fine, on no register anywhere — "a staff member not on the register". */
  notOnAnyRegister: "GES/WR/09999",
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
} as const;
