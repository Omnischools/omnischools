import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Analytics-DB enums for Omnischools Oversight.
 *
 * These belong to the SEPARATE analytics database (`omnischools-analytics-prod`), read by this
 * app only. They are intentionally distinct from the operational app's enums — the analytics
 * vocabulary follows OVERSIGHT_ANALYTICS_SPEC.md, not the operational schema. In particular the
 * jurisdiction/stage vocabulary (KG/PRIMARY/JHS/SHS) is the GES age-for-stage spine, not the
 * operational BASIC/SENIOR product split.
 */

// The school→district→region→national spine (dim_jurisdiction.level).
export const jurisdictionLevelEnum = pgEnum("jurisdiction_level", [
  "SCHOOL",
  "DISTRICT",
  "REGION",
  "NATIONAL",
]);

// School classification on SCHOOL-level jurisdiction rows and the EMIS register.
export const schoolTypeEnum = pgEnum("ov_school_type", [
  "KG",
  "PRIMARY",
  "JHS",
  "SHS",
  "COMBINED",
]);

export const ownershipTypeEnum = pgEnum("ov_ownership_type", [
  "PUBLIC",
  "PRIVATE",
  "MISSION",
]);

// Academic time. TERM/ANNUAL for internal facts; EXAM_COHORT for WASSCE/BECE cohorts.
export const periodTypeEnum = pgEnum("period_type", ["TERM", "ANNUAL", "EXAM_COHORT"]);

// The ALL row is stored beside the split so a single-figure read needs no aggregation.
export const sexEnum = pgEnum("ov_sex", ["MALE", "FEMALE", "ALL"]);

export const examEnum = pgEnum("exam", ["BECE", "WASSCE"]);

// Provenance. Every fact/reference row states where it came from (Principle 3).
export const sourceEnum = pgEnum("ov_source", [
  "OPERATIONAL_AGG", // computed by the nightly ETL from operational Postgres
  "SCHOOL_ENTERED", // school keyed its own exam results
  "SCHOOL_GRADEBOOK", // internal/continuous assessment from the school's gradebook
  "WAEC_EXTRACT", // official WAEC school-level extract
  "EMIS_EXTRACT", // GES EMIS school register
  "GSS_CENSUS", // Ghana Statistical Service census population
  "GES_ESTABLISHMENT", // GES payroll/HR authorised-post establishment
]);

export const assessmentTypeEnum = pgEnum("assessment_type", ["TERMLY", "ANNUAL", "MOCK"]);

// Controls which score columns on fact_performance_internal are meaningful (SHS = five-category).
export const schoolLevelEnum = pgEnum("ov_school_level", ["BASIC", "JHS", "SHS"]);

export const feeCategoryEnum = pgEnum("ov_fee_category", [
  "TUITION",
  "BOARDING",
  "FEEDING",
  "EXAM",
  "PTA_DUES",
  "OTHER",
]);

export const anomalySeverityEnum = pgEnum("ov_anomaly_severity", [
  "HIGH",
  "MEDIUM",
  "LOW",
]);

export const anomalyStatusEnum = pgEnum("ov_anomaly_status", [
  "NEW",
  "IN_REVIEW",
  "ASSIGNED",
  "RESOLVED",
  "DISMISSED",
]);

// Named-record audit path (§6).
//
// TEACHER is reserved for a GES-ESTABLISHMENT teacher — the statutory-basis subject. STAFF is any
// other school employee (non-teaching staff, or a teacher absent from the GES establishment
// register, including private/mission staff), whose individual record needs school-DPO consent.
// Splitting the two makes an audit row self-describing: record_type alone tells a reviewer which
// lawful basis the access SHOULD have claimed, without re-deriving it from the subject.
//
// ⚠ Adding a value to a live enum: Postgres refuses to USE a value added by `ALTER TYPE ... ADD
// VALUE` inside the transaction that added it ("unsafe use of new value"). So a migration that adds
// STAFF must not also reference 'STAFF' (e.g. as a column default or in a data backfill). Keep
// value-adds and value-uses in separate migrations.
export const recordTypeEnum = pgEnum("record_type", ["STUDENT", "TEACHER", "STAFF"]);
export const reviewStatusEnum = pgEnum("access_review_status", [
  "CLEARED",
  "QUERIED",
  "PENDING",
]);

// The lawful basis relied on for an individual drill-down (§6).
//   STATUTORY — the subject is a GES-establishment teacher; GES oversight is mandatory by law and
//               no per-school consent exists to gate on (mirrors §5.5: no school-level ETL consent).
//   CONSENT   — the subject is non-GES / non-teaching staff; access rests on a live school-DPO
//               consent artefact in the OPERATIONAL database, referenced by consent_ref.
export const accessLegalBasisEnum = pgEnum("access_legal_basis", [
  "STATUTORY",
  "CONSENT",
]);

// The outcome of the gated request. DENIALS ARE WRITTEN ROWS, not silent drops: a refusal is the
// most audit-relevant event there is (it records an officer attempting an access the boundary
// stopped), and a log that only contains successes cannot evidence that the gate ever held. A denial
// row carries fields_released = [] — nothing left the operational DB.
export const accessOutcomeEnum = pgEnum("access_outcome", [
  "GRANTED",
  "DENIED_NO_CONSENT", // no GRANTED, unrevoked consent row for (school, NON_GES_STAFF)
  "DENIED_STALE_ESTABLISHMENT", // claimed STATUTORY but the establishment extract is missing/stale
  "DENIED_FIELD_SCOPE", // the stated reason code unlocks none of the requested fields
]);

export const etlStatusEnum = pgEnum("etl_status", ["RUNNING", "SUCCESS", "FAILED"]);

// ---- officer auth (increment G) ---------------------------------------------
//
// The oversight officer's post, as held in the officer DIRECTORY (ref_oversight_officer).
//
// THREE VALUES, AND DELIBERATELY NO SCHOOL ONE (Kofi R1). There is no school-tier oversight
// officer: a head teacher is an operational user of apps/web, not a GES supervisor of their own
// school, and giving the school tier an oversight post would make "oversight of X" and "running X"
// the same credential. SCHOOL remains a perfectly valid `jurisdiction_level` — the spine, the RLS
// predicate and every fact table still key on school nodes — it is only ineligible as an officer's
// OWN node. That is enforced at write time by the ov_officer_node_valid() trigger
// (db/sql/policies.sql), not by this enum, because the ineligible thing is the JURISDICTION ROW's
// level, which lives in another table and so is beyond the reach of any CHECK.
//
// WHY AN ENUM HERE BUT TEXT ON THE AUDIT TABLES. This is the live authority record: the set of
// legal postings is closed, small, and a typo'd role must fail the INSERT rather than create an
// officer nobody's code recognises. `audit_access_log.officer_role` and
// `audit_officer_provisioning.role_before/role_after` stay TEXT (Kofi R2) for the opposite reason:
// they are frozen historical claims that must still be writable/readable when the vocabulary has
// moved on — an audit row recording a post that has since been retired must not become
// unrepresentable, and widening an enum on an audit write path costs two migrations (see the
// `record_type` note above).
//
// This type is CREATED by migration 0004, so 0004 may use it immediately (column type, CHECK,
// default). The "unsafe use of new value" restriction applies only to `ALTER TYPE ... ADD VALUE` on
// a PRE-EXISTING type. Adding a fourth post later DOES hit that restriction — keep the value-add and
// its first use in separate migrations.
export const officerRoleEnum = pgEnum("ov_officer_role", [
  "DISTRICT_OVERSIGHT",
  "REGIONAL_OVERSIGHT",
  "NATIONAL_OVERSIGHT",
]);
