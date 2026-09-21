import type { SchoolGateRef } from "@/lib/oversight/named-record-access";
import { EMIS } from "./ids";

/**
 * The school reference a caller may hand the gate — the EMIS id, and NOTHING else.
 *
 * The operational tenant uuid used to live here and is GONE: it is a security input, and the gate
 * now reads it (plus ownership and the jurisdiction node) from `ref_emis_school_register` under the
 * officer's own RLS, so a test cannot set up a scenario by having the caller misdescribe a school.
 * Every ownership, ceiling and tenant-mapping case is a real fixture school (analytics-seed.sql).
 */
export const SCHOOL = {
  publicConsented: { emisSchoolId: EMIS.publicConsented },
  publicNoConsent: { emisSchoolId: EMIS.publicNoConsent },
  privateConsented: { emisSchoolId: EMIS.privateConsented },
  publicStale: { emisSchoolId: EMIS.publicStale },
  publicRevoked: { emisSchoolId: EMIS.publicRevoked },
  /** ownership_type is NULL in the register, and consent IS granted. Must still refuse. */
  unknownOwnership: { emisSchoolId: EMIS.unknownOwnership },
  /** PRIVATE with no consent row — refused with the flag off AND with the flag on. */
  privateNoConsent: { emisSchoolId: EMIS.privateNoConsent },
  /** In the other district, with live consent. The ceiling is the only thing that can refuse it. */
  outsideSubtree: { emisSchoolId: EMIS.outsideSubtree },
  /** Registered, in the subtree, but register operational_school_id IS NULL — refused (AC-1.6). */
  unmappedOperational: { emisSchoolId: EMIS.unmappedOperational },
} satisfies Record<string, SchoolGateRef>;
