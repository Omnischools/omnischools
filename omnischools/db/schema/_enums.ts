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

// Senior WASSCE cohort spine (SHS module 4.3) — INCR-15 (Kofi rulings 2026-07-19). Migration 0051.
// The programme axis reuses the existing `programmeEnum` above (a fixed GES set shared with
// classes.programme) — NOT a new wassce-specific programme enum — so class→programme cross-module
// joins stay enum-equal and there is one programme vocabulary. BUILD_STACK's redundant
// programme_type_enum is deliberately not added.

// WAEC candidate lifecycle ONLY (Kofi K3 / Decision 5). Fee/NHIS/medical are NEVER a status here
// and never block — they are display flags (wassce_reg_flag) surfaced separately. So this enum is
// the pure registration lifecycle: REGISTERED (with WAEC) → ACTIVE (writing) → COMPLETED, or WITHDRAWN.
export const wassceCandidateStatusEnum = pgEnum("wassce_candidate_status", [
  "REGISTERED",
  "ACTIVE",
  "WITHDRAWN",
  "COMPLETED",
]);
// Subject classification per programme (BUILD_STACK subject_type_enum). Maps to the §1.4 surface tags:
// CORE ↔ "Core" (the 4 shared cores) · ELECTIVE ↔ "Elec" · OPTIONAL ↔ "Alt"/"(or)" (the choose-4-from-N
// / elective-maths-OR alternative). K1: subjects are per-programme rows, no subject-master table.
export const wassceSubjectTypeEnum = pgEnum("wassce_subject_type", [
  "CORE",
  "ELECTIVE",
  "OPTIONAL",
]);
// WAEC paper structure (BUILD_STACK paper_type_enum). ESSAY/OBJECTIVE are the English Lang 1/2 split
// (§1.2 "Essay" + "Objective"); PRACTICAL/ORAL for science/language papers; COMBINED where WAEC merges.
export const wasscePaperTypeEnum = pgEnum("wassce_paper_type", [
  "OBJECTIVE",
  "ESSAY",
  "PRACTICAL",
  "ORAL",
  "COMBINED",
]);
// The §4.5 reg-status DISPLAY pill vocabulary — NOT candidate_status (Kofi K3: fee/NHIS/medical are
// display flags, never a lifecycle status, never a blocker). NULL on wassce_candidates = the happy
// path → rendered "Confirmed" (237 of 240). A set value is the one flag chip to show. Seeded static in
// INCR-15 (live billing/sickbay derivation is a later increment); a candidate can carry at most one
// flag for display. The surface's CSS-only terra "critical" tier appends here when a case first needs it.
export const wassceRegFlagEnum = pgEnum("wassce_reg_flag", [
  "ON_MEDICAL", // Y. Aidoo — inpatient, WAEC SC-12 filed (display only, no sickbay write)
  "NHIS_ISSUE", // S. Asante — NHIS card admin issue (does not affect writing)
  "FEE", // P. Donkor — Free-SHS reconciliation lag (GES cannot-deny; still REGISTERED)
]);

// Senior WASSCE subject-teacher + mock cycle (SHS module 4.3) — INCR-16 (Kofi rulings 2026-07-19).
// Migration 0052. The prediction INPUT: mock grades + the benchmark split.
//
// The WAEC 9-grade band, the SINGLE source of truth for a mock grade (teacher-entered, authoritative)
// and its moderated override. The value ORDER is load-bearing: it MUST match lib/wassce/constants.ts
// WASSCE_GRADING_BANDS (A1 best → F9 fail) so the app's band metadata (points/caption/colour) lines up
// index-for-index and a future ordinal comparison (trajectory ↑/→/↓, credit = ≤ C6) is enum-monotonic.
export const wassceGradeEnum = pgEnum("wassce_grade", [
  "A1",
  "B2",
  "B3",
  "C4",
  "C5",
  "C6",
  "D7",
  "E8",
  "F9",
]);

// Benchmark provenance (R4). SCHOOLUP_DIRECT is the only source used by the tenant benchmark_data_points
// (a school's own computed rate); WAEC_NATIONAL / WAEC_REGIONAL_SUMMARY / INTERPOLATED live on the global
// benchmark_reference. MULTI_SCHOOL_POOL is RESERVED — no pooling logic ships in INCR-16 (no cross-tenant
// reads); the value exists so a later pooled benchmark needs no enum rebuild.
export const benchmarkSourceEnum = pgEnum("benchmark_source", [
  "SCHOOLUP_DIRECT",
  "WAEC_NATIONAL",
  "WAEC_REGIONAL_SUMMARY",
  "INTERPOLATED",
  "MULTI_SCHOOL_POOL",
]);
// Benchmark confidence tier (R4). National WAEC = STRONG; interpolated = MODERATE; the regional summary
// ships DIRECTIONAL (±4–5pp) — the surface renders the "±4–5pp" caption off this + confidence_interval_pp.
export const benchmarkQualityEnum = pgEnum("benchmark_quality", [
  "STRONG",
  "MODERATE",
  "DIRECTIONAL",
]);
// What the benchmark measures. CREDIT_RATE = share at ≤ C6 (WAEC "credit"); DISTINCTION_RATE = share at
// ≤ B3. A pure descriptor of the numeric `value` — no logic keys off it in 0052 (derived on read).
export const benchmarkMetricEnum = pgEnum("benchmark_metric", [
  "CREDIT_RATE",
  "DISTINCTION_RATE",
]);
// The comparison level a benchmark row sits at. SCHOOL = this tenant's own rate; REGION / NATIONAL are the
// global reference points ("my cohort vs region vs national" is DERIVED on read, never a stored join).
export const benchmarkScopeEnum = pgEnum("benchmark_scope", [
  "SCHOOL",
  "REGION",
  "NATIONAL",
]);

// Senior WASSCE projection + readiness + SC-form (SHS module 4.3) — INCR-17 (Kofi rulings 2026-07-19).
// Migration 0053. THREE enums only. Deliberately NOT enums (Kofi Ruling 4): the readiness-statement
// STATE is DERIVED from `parent_acknowledged_at` + `superseded_at` (no status enum); `projected_band`
// is a TEXT label from lib `bandForAggregate()` (no band enum). University enums (`university_type`,
// `target_rank`) are DEFERRED to INCR-17b/0054 — none ship here (AC17 no-leak).

// WAEC Special Consideration form kind (Ruling 3). Values keep WAEC's canonical HYPHENATED codes so they
// stay 1:1 with the SC marker already carried in wassce_candidates.accommodations_json ({scForm:
// SC-3|SC-7|SC-12}) — pgEnum accepts the hyphen as a quoted label, so a later app-side comparison of the
// json marker to this enum needs no remap. SC-3 = pre-exam sensory/physical accommodations; SC-7 =
// chronic-condition extra time; SC-12 = in-window medical disruption / missed papers.
export const scFormEnum = pgEnum("sc_form", ["SC-3", "SC-7", "SC-12"]);
// SC filing workflow lifecycle (Ruling 3, mutable). DRAFT (unfiled) → FILED → ACKNOWLEDGED (WAEC ref in)
// → APPROVED → SCHEDULED (make-up sitting) → COMPLETED; REJECTED is the terminal decline. A refile
// UPDATEs the one (school_id, candidate_id, sc_form) row (the table's UNIQUE), never a second row.
export const scStatusEnum = pgEnum("sc_status", [
  "DRAFT",
  "FILED",
  "ACKNOWLEDGED",
  "APPROVED",
  "SCHEDULED",
  "COMPLETED",
  "REJECTED",
]);
// How a parent's readiness-statement acknowledgement was captured (Ruling 4). PHONE_OTP = SMS one-time
// code (OWNER-gated Hubtel — console-degrades in dev, no creds); IN_PERSON = HoA records a face-to-face
// ack; PDF_UPLOAD = a signed sheet scanned back (parent_signature_pdf_file_id placeholder). The
// parent-facing signing UI is INCR-19; in INCR-17 the ack is SCHOOL-CAPTURED by the HoA.
export const parentAckMethodEnum = pgEnum("parent_ack_method", [
  "PHONE_OTP",
  "IN_PERSON",
  "PDF_UPLOAD",
]);

// Senior WASSCE university targets + match (SHS module 4.3) — INCR-17b (Kofi rulings 2026-07-19).
// Migration 0054. TWO enums only. Deliberately NOT an enum (Kofi): the 5-tier match band
// (SAFETY/COMFORTABLE/MATCH/STRETCH + the TARGET primary overlay) is a DERIVED lib label
// (lib/wassce/university-match.ts, derived-on-read) — storing it too would be two sources of truth.

// The institution category on the GLOBAL `universities` reference (Kofi R1). Ghana's tertiary
// landscape: public/private universities, technical universities & polytechnics, plus the
// nursing/education colleges. Values append-only (a new category never rebuilds the type).
export const universityTypeEnum = pgEnum("university_type", [
  "PUBLIC_UNIVERSITY",
  "PRIVATE_UNIVERSITY",
  "TECHNICAL_UNIVERSITY",
  "POLYTECHNIC",
  "NURSING_COLLEGE",
  "EDUCATION_COLLEGE",
]);
// A candidate's ranked choice on a `university_targets` row (Kofi R1, AMENDED). Stores the CHOICE
// ORDER only — the stretch/match/safety words are the DERIVED computed band, not stored here (two
// sources of truth). NULLABLE: an untagged target carries no rank; a FIRST_CHOICE drives the §6
// "TARGET" overlay. The partial UNIQUE(school_id, candidate_id, target_rank) allows only one of each.
export const targetRankEnum = pgEnum("target_rank", [
  "FIRST_CHOICE",
  "SECOND_CHOICE",
  "THIRD_CHOICE",
]);

// Sickbay F0 spine (SHS module 4.4) — INCR-21 (Kofi rulings 2026-07-21). Migration 0056.
// TWO enums only. Deliberately NOT enums: `capabilities` is DERIVED from the mode by a pure
// lib function (never stored — R24); `staffing` on a slot is FREE TEXT, not a role/FK (R13).

// What clinical capability the school declares (R3/R4). The mode is an AFFORDANCE filter, never a
// data filter — one schema serves all three, no row is deleted/hidden/migrated on switch, and B→C→B
// returns identical rows (R6). FULL and FIRST_AID are capability-IDENTICAL (they differ in editorial
// copy only — never gate logic on A-vs-B). REFERRAL_ONLY disables beds/admissions/rounds/visiting
// doctor and keeps visits, chronic register, referrals, notifications, prefects. DEFAULT is
// REFERRAL_ONLY: a missing config row coalesces to it (R25) — ~49% of public SHS have no sickbay, so
// it is both the safe and the statistically likely default; defaulting to FULL would assert clinical
// capacity a school never declared.
export const sickbayModeEnum = pgEnum("sickbay_mode", ["FULL", "FIRST_AID", "REFERRAL_ONLY"]);
// What kind of thing a schedule slot is (R15) — so INCR-24 finds medication rounds by KIND rather
// than string-matching labels. MEDICATION_ROUND = the 06:30/12:30/21:00 drug rounds (the anchor is
// always one of these); CLINIC = open consulting hours; DOCTOR_VISIT = the visiting doctor's session
// (an external clinician, NOT a system user — R21); ON_CALL = overnight/holiday cover (the 22:00→06:00
// window that wraps midnight).
export const sickbaySlotKindEnum = pgEnum("sickbay_slot_kind", [
  "MEDICATION_ROUND",
  "CLINIC",
  "DOCTOR_VISIT",
  "ON_CALL",
]);
