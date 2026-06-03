import { pgEnum } from "drizzle-orm/pg-core";

/** Shared Postgres enums (defined once, referenced across domain schema files). */

// Tenancy
export const schoolTypeEnum = pgEnum("school_type", ["BASIC", "SENIOR", "COMBINED"]);
export const ownershipEnum = pgEnum("ownership_type", [
  "PUBLIC",
  "PRIVATE",
  "MISSION",
  "INTERNATIONAL",
]);
export const shsCategoryEnum = pgEnum("shs_category", ["A", "B", "C", "D", "E", "F"]);
export const productEnum = pgEnum("product", ["BASIC", "SENIOR", "OVERSIGHT"]);

// Identity / RBAC — mirrors lib/auth AppRole.
export const appRoleEnum = pgEnum("app_role", [
  "ADMIN",
  "HEADMASTER",
  "VICE_HEADMASTER_ACADEMIC",
  "TEACHER",
  "FORM_MASTER",
  "HOUSEMASTER",
  "STUDENT",
  "PARENT",
  "BURSAR",
  "DEAN_OF_BOARDING",
  "MATRON",
]);

// Academic periods
export const periodTypeEnum = pgEnum("period_type", ["TERM", "SEMESTER"]);
export const periodSourceEnum = pgEnum("period_source", [
  "GES_DEFAULT",
  "SCHOOL_OVERRIDE",
]);

// Anomaly engine
export const anomalySeverityEnum = pgEnum("anomaly_severity", ["LOW", "MEDIUM", "HIGH"]);
