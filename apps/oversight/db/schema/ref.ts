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
  unique,
} from "drizzle-orm/pg-core";
import { dimJurisdiction, dimStage, dimSubject } from "./dim";
import {
  schoolTypeEnum,
  ownershipTypeEnum,
  sourceEnum,
  anomalySeverityEnum,
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
  // The operational tenant uuid this EMIS school maps to (apps/web schools.id), when on Schoolup.
  // Nullable by design: NULL = not (yet) mapped. Lets the §6 gate / ETL resolve an operational
  // school directly instead of round-tripping ref_school.ges_code (AC-1.1). No FK — it references a
  // row in the SEPARATE operational database, which Postgres cannot enforce across.
  operationalSchoolId: uuid("operational_school_id"),
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
 * establishment teacher list that makes teacher named-record lookup possible (§5.4). Supplies
 * teaching_posts_established to fact_staffing.
 *
 * NTC-BASED (AC-2.x): the teacher lookup key is now the **NTC licence number** (Ghana's teacher
 * licensure identifier, present on operational `staff_profile.ntc_licence_number`), not an opaque
 * GES staff id. `establishment_teachers` is a JSON array of
 *   { ntc_licence_number: string, name?: string }
 * so the statutory branch tests membership by a containment/existence query over
 * `establishment_teachers[].ntc_licence_number` and binds to the operational row on the SAME
 * licence number. `name` is an optional GES-supplied display aid, never authoritative.
 *
 * UNIQUE (emis_school_id, as_of_date): one establishment vintage per school per as-of date. The
 * current vintage is the row with MAX(as_of_date) for the school (AC-2.3), and the constraint stops
 * a duplicate same-date load from creating two "current" rows.
 */
export const refGesTeacherEstablishment = pgTable(
  "ref_ges_teacher_establishment",
  {
    establishmentId: uuid("establishment_id").primaryKey().defaultRandom(),
    emisSchoolId: text("emis_school_id")
      .notNull()
      .references(() => refEmisSchoolRegister.emisSchoolId),
    teachingPostsEstablished: integer("teaching_posts_established").notNull(),
    // JSON array of { ntc_licence_number: string, name?: string } — the establishment roster at this
    // school as of `as_of_date`. Membership-by-NTC is the whole statutory test (§6). No per-person
    // row, no contact detail: reference data about POSTS, not a person record.
    establishmentTeachers: jsonb("establishment_teachers"),
    source: sourceEnum("source").notNull().default("GES_ESTABLISHMENT"),
    asOfDate: date("as_of_date").notNull(),
  },
  (t) => [unique("uniq_establishment_vintage").on(t.emisSchoolId, t.asOfDate)],
);

// NOTE: there is deliberately NO school-consent / data-sharing-agreement table. GES and the MoE
// are statutory regulators with mandatory oversight of curriculum, academic performance, and
// administration, so every EMIS-registered school's data is in scope by law — there is no opt-in to
// gate on. The ETL inclusion set is simply the registered schools that are live on Omnischools
// (ref_emis_school_register.on_schoolup / dim_jurisdiction.is_reporting), and coverage stays
// register-based (on_schoolup ÷ register). This replaces the earlier consent-gate design.

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
