import type { SchoolGateRef } from "@/lib/oversight/named-record-access";
import { EMIS, OPS_SCHOOL } from "./ids";

/**
 * The school references a caller may hand the gate — TWO IDS EACH, and nothing else.
 *
 * There is deliberately no `ownershipType` or `jurisdictionId` here any more. Those are security
 * inputs and the gate now reads them from `ref_emis_school_register` under the officer's own RLS,
 * so a test cannot set up a scenario by having the caller misdescribe a school. Every ownership and
 * ceiling case is a real fixture school instead (see tests/fixtures/analytics-seed.sql).
 */
export const SCHOOL = {
  publicConsented: {
    emisSchoolId: EMIS.publicConsented,
    operationalSchoolId: OPS_SCHOOL.publicConsented,
  },
  publicNoConsent: {
    emisSchoolId: EMIS.publicNoConsent,
    operationalSchoolId: OPS_SCHOOL.publicNoConsent,
  },
  privateConsented: {
    emisSchoolId: EMIS.privateConsented,
    operationalSchoolId: OPS_SCHOOL.privateConsented,
  },
  publicStale: {
    emisSchoolId: EMIS.publicStale,
    operationalSchoolId: OPS_SCHOOL.publicStale,
  },
  publicRevoked: {
    emisSchoolId: EMIS.publicRevoked,
    operationalSchoolId: OPS_SCHOOL.publicRevoked,
  },
  /** ownership_type is NULL in the register, and consent IS granted. Must still refuse. */
  unknownOwnership: {
    emisSchoolId: EMIS.unknownOwnership,
    operationalSchoolId: OPS_SCHOOL.unknownOwnership,
  },
  /** PRIVATE with no consent row — refused with the flag off AND with the flag on. */
  privateNoConsent: {
    emisSchoolId: EMIS.privateNoConsent,
    operationalSchoolId: OPS_SCHOOL.privateNoConsent,
  },
  /** In the other district, with live consent. The ceiling is the only thing that can refuse it. */
  outsideSubtree: {
    emisSchoolId: EMIS.outsideSubtree,
    operationalSchoolId: OPS_SCHOOL.outsideSubtree,
  },
} satisfies Record<string, SchoolGateRef>;
