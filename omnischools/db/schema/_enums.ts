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

// Senior boarding config (SHS module 4.2) — INCR-8 (Kofi OQ1).
// The day-type axis for daily_schedule_template. SUNDAY and VISITING_SUNDAY are
// distinct rhythms (a visiting Sunday runs a different template — AC C2).
export const boardingDayTypeEnum = pgEnum("boarding_day_type", [
  "WEEKDAY",
  "SATURDAY",
  "SUNDAY",
  "VISITING_SUNDAY",
]);
// boarding_calendar_event stores ONLY boarding-specific events — resumption/vacation
// derive from academic_period and are never rows here (Kofi OQ4).
export const boardingEventTypeEnum = pgEnum("boarding_event_type", [
  "VISITING",
  "EXEAT_WINDOW",
]);

// Senior boarding exeat (SHS module 4.2) — INCR-9 (Kofi OQ1).
// FEE_COLLECTION is a first-class type, NOT a flag: a fee-owing boarder at a scheduled exeat is
// re-typed to FEE_COLLECTION (goes home to collect — GES cannot-detain) rather than blocked (OQ2).
export const exeatTypeEnum = pgEnum("exeat_type", [
  "SCHEDULED",
  "SPECIAL",
  "FEE_COLLECTION",
]);
// The 5-stage lifecycle + terminal DECLINED. Supersedes BUILD_STACK's OVERDUE/CANCELLED:
// overdue is a DERIVED predicate (DEPARTED ∧ now>return_by ∧ returned_at IS NULL), never a stored
// status; cancelled = DECLINED (Kofi OQ1). A scheduled-clean exeat skips SR_HM_SIGNED.
export const exeatStatusEnum = pgEnum("exeat_status", [
  "REQUESTED",
  "HM_APPROVED",
  "SR_HM_SIGNED",
  "DEPARTED",
  "RETURNED",
  "DECLINED",
]);
// The late-return SMS escalation kinds (exeat_notification.kind). One row per (exeat × kind) is the
// idempotency guard for the +5/+30/+60 chain (Kofi OQ5) — resend is blocked by NOT EXISTS(kind).
export const exeatNotificationKindEnum = pgEnum("exeat_notification_kind", [
  "DEPARTURE",
  "REMINDER",
  "OVERDUE_STAGE_1",
  "OVERDUE_STAGE_2",
  "OVERDUE_STAGE_3",
]);

// Senior boarding daily life (SHS module 4.2) — INCR-10 (Kofi OQ1).
// One `inspections` table holds both cadences, discriminated by `type` (BUILD_STACK #8:
// daily = bunks/lockers/attire, weekly = whole-house deep). The 3-state result supersedes
// BUILD_STACK's `pass_fail` bool — surface 04 shows PASS/PARTIAL/FAIL + N/M bunks clean.
export const inspectionTypeEnum = pgEnum("inspection_type", ["DAILY", "WEEKLY"]);
export const inspectionResultEnum = pgEnum("inspection_result", ["PASS", "PARTIAL", "FAIL"]);

// Senior boarding resumption/vacation (SHS module 4.2) — INCR-11 (Kofi OQ1).
// ONE boarding_arrival table holds both chaos days of the year, discriminated by `mode`: the
// staggered RESUMPTION gate-check (F3-first → F1-last) and its VACATION departure inverse (one
// surface, one table, mode flag). `checked_at` is arrived_at (RESUMPTION) / departed_at (VACATION)
// — the mode disambiguates one stamp, so there is deliberately no arrived/departed split.
export const boardingModeEnum = pgEnum("boarding_mode", ["RESUMPTION", "VACATION"]);

// Senior boarding visiting day (SHS module 4.2) — INCR-12 (Kofi OQ1).
// The durable approved-visitor lifecycle: HM adds a name PENDING_REVIEW, HM/Dean approves → APPROVED
// (the state the gate verifies an arriving visitor against). Max-6 is app-enforced in lib/, not the DB.
export const visitorApprovalStatusEnum = pgEnum("visitor_approval_status", [
  "PENDING_REVIEW",
  "APPROVED",
]);
// The visit's two-stamp lifecycle: RSVP (staff-entered pre-arrival) → ARRIVED (in-stamp) → DEPARTED
// (out-stamp). A walk-in inserts directly at ARRIVED. Overstay is DERIVED on-read (ARRIVED ∧ no depart
// ∧ now > hoursEnd+grace), never a stored status.
export const visitStatusEnum = pgEnum("visit_status", ["RSVP", "ARRIVED", "DEPARTED"]);
// The gate list-check outcome (§2 tenet: list-CHECK not list-RECORD). Default FLAGGED is a SAFE default —
// a visit is never silently VERIFIED. APPROVED-list match → VERIFIED; not-on-list/PENDING → FLAGGED;
// admitting a FLAGGED visitor needs an actor-stamped HM override → HM_AUTHORISED (never a hard turn-away).
export const visitVerificationEnum = pgEnum("visit_verification", [
  "VERIFIED",
  "FLAGGED",
  "HM_AUTHORISED",
]);
// boarding_visit_notification kinds (dual-scoped log). Cohort/event-scoped: INVITATION, REMINDER_T3,
// REMINDER_T1 (visit_id NULL). Per-visit-scoped: ARRIVAL_CONFIRM, OVERSTAY. One row per (scope × kind)
// is the idempotency guard — resend blocked by NOT EXISTS(scope, kind).
export const visitNotificationKindEnum = pgEnum("visit_notification_kind", [
  "INVITATION",
  "REMINDER_T3",
  "REMINDER_T1",
  "ARRIVAL_CONFIRM",
  "OVERSTAY",
]);

// Senior boarding discipline & deboardinization (SHS module 4.2) — INCR-13 (Kofi OQ1). The
// disciplinary ladder's real consumer (surface 07, MODULE 4.2 closer). `infraction_severity` ==
// the frozen `DeboardinizationSeverity` 5-value set (getDeboardinizationLadder) — schema-locked
// (BUILD_STACK #4); the enum is the DB mirror of that constant so a rung can never drift. `status`
// is the append-only lifecycle: OPEN → RESOLVED (closed) or OPEN → SUPERSEDED (corrected by a newer
// row via parent_infraction_id) — never delete/edit (Kofi OQ5). `source` discriminates a MANUAL log
// from the four auto-logged module stubs (exeat overdue / inspection daily+weekly FAIL / visit
// overstay / resumption absent); it pairs with source_ref_id as the idempotency key so a repeating
// on-read sweep never double-logs (Kofi OQ4).
export const infractionSeverityEnum = pgEnum("infraction_severity", [
  "NOTE",
  "WARNING",
  "BOND",
  "SUSPENSION",
  "DEBOARDINIZATION",
]);
export const infractionStatusEnum = pgEnum("infraction_status", [
  "OPEN",
  "RESOLVED",
  "SUPERSEDED",
]);
export const infractionSourceEnum = pgEnum("infraction_source", [
  "MANUAL",
  "EXEAT_OVERDUE",
  "INSPECTION_DAILY",
  "INSPECTION_WEEKLY",
  "VISIT_OVERSTAY",
  "RESUMPTION_ABSENT",
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
