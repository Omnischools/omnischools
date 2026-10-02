import type { JurisdictionLevel } from "@/lib/db/rls";

/**
 * Officer authorisation — PURE (no db, no env, no next/*), so every security property below is
 * unit-testable without a live session. Mirrors the shape of `apps/web/lib/auth/roles.ts` (separate
 * lockfiles, no shared import — see the pointer note in lib/supabase/server.ts).
 *
 * THE DIVISION OF LABOUR, because it is easy to put a check in the wrong half:
 *   · WHAT AN OFFICER CAN SEE (which schools, which rows) is the DATABASE's answer — the jurisdiction
 *     GUCs and the RLS policies in db/sql/policies.sql. Nothing in this file filters data.
 *   · WHAT A SURFACE WILL OFFER (is the §6 gate reachable at this tier, may this picker compare
 *     across districts) is this file's answer. These are capability predicates, and they exist in
 *     pure form because the alternative — inlining `officer.level !== "SCHOOL"` at each call site —
 *     is a rule that cannot be tested and drifts the moment there are two call sites.
 */

/**
 * The officer-role vocabulary, matching the `ov_officer_role` enum (db/schema/_enums.ts) exactly.
 *
 * ⚠ THESE ARE NOT INTERCHANGEABLE WITH TIERS and must not be used to decide scope. The tier is
 * `dim_jurisdiction.level` of the officer's node, derived on every resolve (Kofi R2/AC10); the role
 * is a DESCRIPTION of the post that the directory's write trigger keeps consistent with the node.
 * Deciding reach from the role would reintroduce the second, writable source of truth that the
 * missing `level` column exists to prevent.
 */
export const OFFICER_ROLES = [
  "DISTRICT_OVERSIGHT",
  "REGIONAL_OVERSIGHT",
  "NATIONAL_OVERSIGHT",
] as const;

export type OfficerRole = (typeof OFFICER_ROLES)[number];

export function isOfficerRole(value: string): value is OfficerRole {
  return (OFFICER_ROLES as readonly string[]).includes(value);
}

/** The role the directory's guard requires for a node at this tier (policies.sql, same mapping). */
export const ROLE_FOR_TIER: Record<"DISTRICT" | "REGION" | "NATIONAL", OfficerRole> = {
  DISTRICT: "DISTRICT_OVERSIGHT",
  REGION: "REGIONAL_OVERSIGHT",
  NATIONAL: "NATIONAL_OVERSIGHT",
};

/**
 * The tiers an officer may hold. SCHOOL is absent — Kofi R1: a head teacher is an operational user
 * of apps/web, and one credential must not both run a school and oversee it. SCHOOL remains a
 * perfectly valid `jurisdiction_level` everywhere else (the spine, the subtree walk, every fact
 * table keys on school nodes); it is not an OFFICER tier.
 */
export const OFFICER_TIERS = ["DISTRICT", "REGION", "NATIONAL"] as const;
export type OfficerTier = (typeof OFFICER_TIERS)[number];

export function isOfficerTier(level: JurisdictionLevel | string): level is OfficerTier {
  return (OFFICER_TIERS as readonly string[]).includes(level);
}

/**
 * May this tier open a NAMED individual record at the §6 gate? (Kofi R1 / Lucy G7.)
 *
 * DISTRICT or wider. The SCHOOL case is not a theoretical one: if a SCHOOL-tier row were ever
 * planted in the directory and a session built from it, this predicate is what keeps the gate shut —
 * which is why it is expressed as "the tier is an officer tier" rather than as `level !== "SCHOOL"`.
 * The two are equivalent today; only the first stays correct when a new level is added to the enum.
 */
export function canOpenNamedRecord(level: JurisdictionLevel | string): boolean {
  return isOfficerTier(level);
}

/** Tier ordering, narrowest first. Used only by the ceiling predicate below. */
const TIER_RANK: Record<JurisdictionLevel, number> = {
  SCHOOL: 0,
  DISTRICT: 1,
  REGION: 2,
  NATIONAL: 3,
};

/**
 * THE TIER CEILING for the comparison picker (Lucy's comparison surfaces).
 *
 * `true` ⇒ an officer at `officerLevel` may select a peer unit at `targetLevel` for comparison. A
 * district director may compare districts (their own tier) and nothing above it; a regional officer
 * may compare districts and regions; national may compare anything.
 *
 * ⚠ THIS IS A UI AFFORDANCE, NOT THE BOUNDARY. The boundary is `ov_in_subtree()` in the database:
 * even a tier this predicate allows yields zero rows outside the officer's own subtree. The picker
 * needs the predicate so it does not offer a choice that would come back empty (which reads as a
 * data bug, and invites someone to "fix" it by widening a query). Never the other way round — do not
 * let a passing check here stand in for a scoped read.
 */
export function withinTierCeiling(
  officerLevel: JurisdictionLevel | string,
  targetLevel: JurisdictionLevel | string,
): boolean {
  const officer = TIER_RANK[officerLevel as JurisdictionLevel];
  const target = TIER_RANK[targetLevel as JurisdictionLevel];
  // An unknown tier on either side is refused rather than ranked — fail closed on a value the
  // enum has grown and this table has not.
  if (officer === undefined || target === undefined) return false;
  if (!isOfficerTier(officerLevel)) return false;
  return target <= officer;
}

// ---- display labels (Lucy G2; R6 — exact GES nouns are owner-ratify) -------------------------
//
// Chrome only. Never written to an audit row: the audit row carries `officer_role` verbatim from the
// directory, because a label that drifts would silently rewrite what the log says about a post.

/** The tier noun shown in the identity strip. Lucy G2. */
export const TIER_LABEL: Record<OfficerTier, string> = {
  DISTRICT: "District",
  REGION: "Region",
  NATIONAL: "National · Ministry of Education",
};

/** The human role label. Lucy R6 flags the exact nouns for owner ratification. */
export const ROLE_LABEL: Record<OfficerRole, string> = {
  DISTRICT_OVERSIGHT: "District Director",
  REGIONAL_OVERSIGHT: "Regional Director",
  NATIONAL_OVERSIGHT: "National Oversight · MoE",
};

export function roleLabel(role: string): string {
  return isOfficerRole(role) ? ROLE_LABEL[role] : role;
}

export function tierLabel(level: JurisdictionLevel | string): string {
  return isOfficerTier(level) ? TIER_LABEL[level] : String(level);
}

/**
 * The crest sub-line's institution (Lucy G2 / e3 §0): the Ministry at national tier, GES below it.
 */
export function institutionLabel(level: JurisdictionLevel | string): string {
  return level === "NATIONAL" ? "Ministry of Education" : "Ghana Education Service";
}

/**
 * The role-specific salutation (Lucy A.1 / R6). "Welcome, Director." is the mock's district copy;
 * the regional and national nouns are flagged for owner ratification, so the safe default keeps the
 * mock's word for district/region and names the post at national.
 */
export function salutationNoun(level: JurisdictionLevel | string): string {
  if (level === "NATIONAL") return "Officer";
  return "Director";
}
