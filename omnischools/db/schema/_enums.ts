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

// Students & admissions
export const sexEnum = pgEnum("sex", ["MALE", "FEMALE"]);
export const studentStatusEnum = pgEnum("student_status", [
  "ACTIVE",
  "INACTIVE",
  "GRADUATED",
  "WITHDRAWN",
  "TRANSFERRED",
]);
export const guardianRelationEnum = pgEnum("guardian_relation", [
  "MOTHER",
  "FATHER",
  "GUARDIAN",
  "OTHER",
]);
export const admissionStatusEnum = pgEnum("admission_status", [
  "SUBMITTED",
  "UNDER_REVIEW",
  "ACCEPTED",
  "REJECTED",
  "WAITLISTED",
]);

// Fees & payments (schoolup-payment-data-model)
export const invoiceStatusEnum = pgEnum("invoice_status", [
  "DRAFT",
  "ISSUED",
  "PARTIAL",
  "PAID",
  "OVERDUE",
  "EXEMPT",
  "VOIDED",
]);
export const paymentMethodEnum = pgEnum("payment_method", [
  "MTN_MOMO",
  "TELECEL_CASH",
  "AIRTELTIGO_MONEY",
  "BANK_TRANSFER",
  "CASH",
  "CHEQUE",
  "OTHER",
]);
export const settlementStatusEnum = pgEnum("settlement_status", [
  "PENDING",
  "CONFIRMED",
  "SETTLED",
  "RECONCILED",
  "DISPUTED",
]);
export const allocationTypeEnum = pgEnum("allocation_type", [
  "INVOICE",
  "CREDIT",
  "REFUND",
]);
export const allocationMethodEnum = pgEnum("allocation_method", [
  "MANUAL",
  "AUTO_OLDEST_FIRST",
  "AUTO_NEWEST_FIRST",
]);
export const paymentEventTypeEnum = pgEnum("payment_event_type", [
  "CREATED",
  "ALLOCATION_ADDED",
  "ALLOCATION_VOIDED",
  "SETTLED",
  "VOIDED",
  "SMS_SENT",
  "SMS_FAILED",
  "REFUNDED",
  "DISCOUNT_OVERRIDDEN",
]);
export const paymentActorTypeEnum = pgEnum("payment_actor_type", [
  "ADMIN",
  "SYSTEM",
  "WEBHOOK",
  "RECONCILIATION_JOB",
]);
