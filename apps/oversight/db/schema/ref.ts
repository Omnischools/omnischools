import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  date,
  bigserial,
  numeric,
  jsonb,
  primaryKey,
} from "drizzle-orm/pg-core";
import { dimJurisdiction, dimStage, dimSubject } from "./dim";
import {
  schoolTypeEnum,
  ownershipTypeEnum,
  sourceEnum,
  anomalySeverityEnum,
  dsaStatusEnum,
} from "./_enums";

/**
 * Reference tables — data Omnischools does NOT generate (OVERSIGHT_ANALYTICS_SPEC §5).
 * Loaded from GES / GES data agreements, kept distinct from school-generated facts. Every row
 * carries `source` + `as_of_date` so the UI can state vintage.
 */

/**
 * ref_emis_school_register — the authoritative list of every recognised school: the **Y** in every
 * "X of Y schools" coverage figure (§5.1). Independent of who synced, so coverage stays honest.
 */
export const refEmisSchoolRegister = pgTable("ref_emis_school_register", {
  emisSchoolId: text("emis_school_id").primaryKey(),
  name: text("name").notNull(),
  districtId: uuid("district_id").references(() => dimJurisdiction.jurisdictionId),
  regionId: uuid("region_id").references(() => dimJurisdiction.jurisdictionId),
  schoolType: schoolTypeEnum("school_type"),
  ownershipType: ownershipTypeEnum("ownership_type"),
  // Does this registered school have a live Omnischools tenant.
  onSchoolup: boolean("on_schoolup").notNull().default(false),
  source: sourceEnum("source").notNull().default("EMIS_EXTRACT"),
  asOfDate: date("as_of_date").notNull(),
});

/**
 * ref_gss_population — Ghana Statistical Service census population, bucketed by the SAME stage
 * bands as dim_stage (§5.2). The denominator of the enrolment-vs-population analysis.
 */
export const refGssPopulation = pgTable(
  "ref_gss_population",
  {
    districtId: uuid("district_id")
      .notNull()
      .references(() => dimJurisdiction.jurisdictionId),
    stage: text("stage")
      .notNull()
      .references(() => dimStage.stage),
    population: integer("population").notNull(),
    source: sourceEnum("source").notNull().default("GSS_CENSUS"),
    asOfDate: date("as_of_date").notNull(), // e.g. "2021 Census"
  },
  (t) => [primaryKey({ columns: [t.districtId, t.stage, t.asOfDate] })],
);

/**
 * ref_waec_results_extract — official WAEC school-level results supplied under a GES–WAEC
 * arrangement (§5.3). Feeds fact_performance_exam rows with source = WAEC_EXTRACT.
 */
export const refWaecResultsExtract = pgTable("ref_waec_results_extract", {
  extractId: uuid("extract_id").primaryKey().defaultRandom(),
  emisSchoolId: text("emis_school_id")
    .notNull()
    .references(() => refEmisSchoolRegister.emisSchoolId),
  academicYear: text("academic_year").notNull(),
  exam: text("exam").notNull(), // BECE | WASSCE
  subject: text("subject").references(() => dimSubject.subject),
  candidates: integer("candidates").notNull(),
  qualified: integer("qualified").notNull(),
  source: sourceEnum("source").notNull().default("WAEC_EXTRACT"),
  asOfDate: date("as_of_date").notNull(),
});

/**
 * ref_ges_teacher_establishment — GES payroll/HR authorised teaching posts per school, and the
 * staff IDs that make teacher named-record lookup possible (§5.4). Supplies
 * teaching_posts_established to fact_staffing.
 */
export const refGesTeacherEstablishment = pgTable("ref_ges_teacher_establishment", {
  establishmentId: uuid("establishment_id").primaryKey().defaultRandom(),
  emisSchoolId: text("emis_school_id")
    .notNull()
    .references(() => refEmisSchoolRegister.emisSchoolId),
  teachingPostsEstablished: integer("teaching_posts_established").notNull(),
  // Comma-free JSON array of GES staff IDs on establishment at this school (teacher lookup key, §6).
  staffIds: jsonb("staff_ids"),
  source: sourceEnum("source").notNull().default("GES_ESTABLISHMENT"),
  asOfDate: date("as_of_date").notNull(),
});

/**
 * ref_ges_data_sharing_agreements — the SCHOOL↔GES data-sharing agreement (§5.5). ONE ROW PER
 * SCHOOL recording that the school has consented to feed its data up to GES/Oversight. This is
 * NOT the EMIS/WAEC/GSS upstream feeds (those are the ref_* extract tables above) — it is each
 * school's own consent, and it is the ETL's inclusion gate: a school's facts are written to
 * analytics only when `status = LIVE`. Public schools are LIVE by default (GES is the regulator);
 * private schools require an explicit signed agreement. Mirrors the operational
 * `ges_data_sharing_agreements` table so the DSA-management surface can run at the national tier.
 */
export const refGesDataSharingAgreements = pgTable("ref_ges_data_sharing_agreements", {
  schoolId: uuid("school_id")
    .primaryKey()
    .references(() => dimJurisdiction.jurisdictionId),
  agreementVersion: text("agreement_version"), // v2.1, v1.4 …
  status: dsaStatusEnum("status").notNull().default("NONE"), // the funnel's three stages
  agreedAt: date("agreed_at"),
  // which categories aggregate, which are gated — the scope table.
  scopeJson: jsonb("scope_json"),
  signedBy: text("signed_by"), // e.g. the Headmaster
  source: sourceEnum("source").notNull().default("OPERATIONAL_AGG"),
  asOfDate: date("as_of_date").notNull(),
});

/**
 * ref_anomaly_rule — rules as CONFIG, not code (§4.9), so a rule is inspectable and tunable
 * without a deploy. The ETL evaluates enabled rules against the night's facts.
 */
export const refAnomalyRule = pgTable("ref_anomaly_rule", {
  ruleCode: text("rule_code").primaryKey(), // PTR-ESC-30, PERF-DROP-15, COV-GAP …
  description: text("description").notNull(),
  predicateJson: jsonb("predicate_json").notNull(),
  severity: anomalySeverityEnum("severity").notNull(),
  enabled: boolean("enabled").notNull().default(true),
});

/**
 * ref_assessment_weights — the SHS five-category weighting config that produced a weighted total
 * (referenced by fact_performance_internal.weights_config_id). Kept as reference data so the
 * weighting a figure used is auditable.
 */
export const refAssessmentWeights = pgTable("ref_assessment_weights", {
  weightsConfigId: bigserial("weights_config_id", { mode: "number" }).primaryKey(),
  label: text("label").notNull(),
  assignmentsWeight: numeric("assignments_weight", { precision: 5, scale: 2 }).notNull(),
  midSemWeight: numeric("mid_sem_weight", { precision: 5, scale: 2 }).notNull(),
  endSemWeight: numeric("end_sem_weight", { precision: 5, scale: 2 }).notNull(),
  projectWeight: numeric("project_weight", { precision: 5, scale: 2 }).notNull(),
  portfolioWeight: numeric("portfolio_weight", { precision: 5, scale: 2 }).notNull(),
  effectiveFrom: date("effective_from").notNull(),
});
