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

// Attendance
export const attendanceStatusEnum = pgEnum("attendance_status", [
  "PRESENT",
  "ABSENT",
  "LATE",
  "EXCUSED",
  "MEDICAL",
]);
export const correctionStatusEnum = pgEnum("correction_status", [
  "PENDING",
  "APPROVED",
  "REJECTED",
]);

// Communications
export const audienceEnum = pgEnum("audience", ["WHOLE_SCHOOL", "CLASS"]);
export const notifStatusEnum = pgEnum("notif_status", ["QUEUED", "SENT", "FAILED"]);

// Billing (fee setup)
export const discountKindEnum = pgEnum("discount_kind", ["PERCENT", "FIXED"]);

// Books (bookkeeping / school accounts)
export const bookEntryKindEnum = pgEnum("book_entry_kind", ["INCOME", "EXPENSE"]);

// Inbox (two-way messaging)
export const conversationStatusEnum = pgEnum("conversation_status", ["OPEN", "CLOSED"]);
export const messageDirectionEnum = pgEnum("message_direction", ["INBOUND", "OUTBOUND"]);

// Invites
export const inviteStatusEnum = pgEnum("invite_status", [
  "PENDING",
  "ACCEPTED",
  "REVOKED",
  "EXPIRED",
]);

// Senior (SHS) tier — Phase 4 foundations
// The four Asankrangwa programmes lead; the fuller GES SHS set follows so the enum
// never needs a type rebuild when a school adds a programme (values can only be appended).
export const programmeEnum = pgEnum("programme", [
  "GENERAL_ARTS",
  "GENERAL_SCIENCE",
  "BUSINESS",
  "AGRICULTURE",
  "VISUAL_ARTS",
  "HOME_ECONOMICS",
  "TECHNICAL",
]);
export const residencyEnum = pgEnum("residency", ["BOARDER", "DAY", "DEBOARDINIZED"]);

// Senior boarding (SHS module 4.2) — House→Dormitory→Bunk spine (INCR-7).
// One unified gender list on the House (BUILD_STACK #3): a COED house admits either sex.
// Gender-vs-student-sex is enforced at the app reassign/placement action, not the DB
// (a cross-table check would need a forbidden trigger — Kofi trap J3).
export const houseGenderEnum = pgEnum("house_gender", ["BOYS", "GIRLS", "COED"]);
// The five prefect designations. Nullable on a bunk: a set value marks that bunk's
// occupant a prefect (display-only in F0; appointment workflow deferred — Kofi OQ4).
export const prefectRoleEnum = pgEnum("prefect_role", [
  "HEAD",
  "DINING",
  "SANITATION",
  "PREP",
  "SICKBAY",
]);

// Senior score ledger (SHS) — five-category model. Portfolio has NO assessment event
// (it is a one-shot manual entry, spec §2/§4.1), so it is deliberately not a category here.
export const assessmentCategoryEnum = pgEnum("assessment_category", [
  "ASSIGNMENT",
  "MID_SEM_EXAM",
  "END_SEM_EXAM",
  "PROJECT",
]);
export const ledgerStatusEnum = pgEnum("ledger_status", [
  "DRAFT", // some category still null, or portfolio not yet entered
  "COMPLETE", // all five categories present, weighted total computed
  "STPSHS_READY", // COMPLETE and signed off for export (explicit teacher action)
]);

// The three medium-agnostic capture paths (spec §4). Chosen per (class × subject × period).
// AUTO_COMPILE = Path A (from recorded events), SCAN_EXTRACT = Path B (OCR, Item 4),
// DIRECT_ENTRY = Path C (type category scores straight onto the grid, Item 2).
export const capturePathEnum = pgEnum("capture_path", [
  "AUTO_COMPILE",
  "SCAN_EXTRACT",
  "DIRECT_ENTRY",
]);

// Score-ledger correction reason (Path B scan diff — Item 4/INCR-2). This is the
// authoritative DOMAIN of allowed reason codes; it is deliberately NOT a table column.
// The chosen code persists as the free-text `reason` on auditLog (lib/db/audit.ts) when a
// teacher accepts a score-down or a Case-D "keep blank" — no new ledger column (Kofi Q1/Q4).
// Exposed as a pgEnum (matching the codebase's enum-heavy style) so the app + any future
// Item 7 version-chain column share one typed source of truth. Free text is mandatory on OTHER.
export const ledgerCorrectionReasonEnum = pgEnum("ledger_correction_reason", [
  "RE_GRADED",
  "TRANSCRIPTION_ERROR",
  "OTHER",
]);
