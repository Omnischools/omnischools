import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  date,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import {
  jurisdictionLevelEnum,
  schoolTypeEnum,
  ownershipTypeEnum,
  periodTypeEnum,
} from "./_enums";

/**
 * Dimension tables — small, slow-changing, shared by every fact table (OVERSIGHT_ANALYTICS_SPEC §3).
 */

/**
 * dim_jurisdiction — the school→district→region→national spine (§3.1).
 * One self-referencing table so every roll-up is a recursive walk up `parent_id`, and the
 * jurisdiction RLS predicate is expressed once (see db/sql/policies.sql).
 */
export const dimJurisdiction = pgTable("dim_jurisdiction", {
  jurisdictionId: uuid("jurisdiction_id").primaryKey().defaultRandom(),
  level: jurisdictionLevelEnum("level").notNull(),
  // district for a school, region for a district, national for a region, null for national.
  parentId: uuid("parent_id").references((): AnyPgColumn => dimJurisdiction.jurisdictionId),
  name: text("name").notNull(),
  gesCode: text("ges_code"),
  // Only populated on SCHOOL rows.
  schoolType: schoolTypeEnum("school_type"),
  ownershipType: ownershipTypeEnum("ownership_type"),
  foundedYear: integer("founded_year"),
  // SCHOOL rows: currently live on Omnischools and feeding the ETL.
  isReporting: boolean("is_reporting").notNull().default(false),
});

/**
 * dim_period — academic time is year + term, not calendar months (§3.2).
 */
export const dimPeriod = pgTable("dim_period", {
  periodId: uuid("period_id").primaryKey().defaultRandom(),
  academicYear: text("academic_year").notNull(), // "2025/26"
  term: integer("term"), // 1,2,3 — null for ANNUAL / EXAM_COHORT
  periodType: periodTypeEnum("period_type").notNull(),
  startsOn: date("starts_on"),
  endsOn: date("ends_on"),
  isCurrent: boolean("is_current").notNull().default(false),
});

/**
 * dim_stage — the age-matching key (§3.3). Configuration, so a curriculum reform is a one-row edit.
 * fact_enrolment and ref_gss_population both bucket by `stage`, making the enrolment-vs-population
 * rate a join on stage with numerator and denominator describing the same children by construction.
 */
export const dimStage = pgTable("dim_stage", {
  stage: text("stage").primaryKey(), // KG, PRIMARY, JHS, SHS
  officialAgeLow: integer("official_age_low").notNull(),
  officialAgeHigh: integer("official_age_high").notNull(),
  displayOrder: integer("display_order").notNull(),
});

/**
 * dim_subject — the WASSCE/BECE + internal-performance subject vocabulary (§3.4).
 */
export const dimSubject = pgTable("dim_subject", {
  subject: text("subject").primaryKey(), // CORE_MATHS, CORE_ENGLISH, INT_SCIENCE, …
  displayName: text("display_name").notNull(),
  isCore: boolean("is_core").notNull().default(false),
  displayOrder: integer("display_order").notNull().default(0),
});
