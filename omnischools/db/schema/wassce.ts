import {
  pgTable,
  uuid,
  text,
  smallint,
  integer,
  boolean,
  numeric,
  jsonb,
  date,
  timestamp,
  unique,
  uniqueIndex,
  index,
  foreignKey,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { schools } from "./tenancy";
import { users } from "./identity";
import { students } from "./students";
import {
  programmeEnum,
  wassceCandidateStatusEnum,
  wassceSubjectTypeEnum,
  wasscePaperTypeEnum,
  wassceRegFlagEnum,
  wassceGradeEnum,
  benchmarkSourceEnum,
  benchmarkQualityEnum,
  benchmarkMetricEnum,
  benchmarkScopeEnum,
  scFormEnum,
  scStatusEnum,
  parentAckMethodEnum,
} from "./_enums";

/**
 * WASSCE cohort spine (SHS module 4.3 / INCR-15) — the ROOT of the WASSCE module. Seven tenant
 * tables model the frozen setup/registration surface (`wassce-setup` §1 programmes/subjects, §4 the
 * 240-candidate roster, §5 policy anchors): a per-cohort freeze anchor → school-level programme &
 * subject reference → the cohort's candidates → their chosen subjects (normalized join) → the WAEC
 * paper timetable → per-candidate sittings. See docs/senior-build-plan.md INCR-15 (Kofi rulings
 * 2026-07-19) and docs/senior/wassce-spine-surface-map.md (Lucy).
 *
 * INCR-15 is READ-ONLY: the WASSCE-2026 F3 cohort is seeded already-frozen; NO server action mutates
 * any spine row (there are none to build). The freeze/unfreeze co-sign action + the post-freeze
 * typo-fix write-flow are DEFERRED to a later increment — this file builds the model + display only.
 *
 * TENANCY (uniform across all 7, Kofi rulings 1 & 4): every table carries `school_id`; every
 * intra-tenant FK is composite `(school_id, …)` so a cross-tenant reference is structurally
 * impossible; a table that is REFERENCED carries a `*_tenant_uk UNIQUE(school_id, id)`; all 7 get
 * FORCE RLS `tenant_isolation` (db:policies dev + prod-paste-0051-wassce-spine.sql prod). Actor
 * stamps and other global-table links use single-column SET NULL FKs (the boarding/score-ledger
 * idiom). No DB triggers — every derivation (aggregates, freeze enforcement, billing/sickbay reads)
 * is app-layer, later (portability discipline).
 *
 * COHORT SCOPING: `wassce_programmes`/`wassce_subjects` are DURABLE school-level reference (NOT
 * cohort-scoped — edits affect future registrations only; soft-deleted via `active_flag`, K5).
 * Everything else (candidates, candidate_subject, papers, sittings) resolves to exactly one cohort
 * and inherits its freeze state.
 */

/**
 * The freeze anchor — one cohort per (school × exam_year) (Kofi Ruling 1). Freeze is PER-COHORT, not
 * a per-school scalar: the surface shows F3-2026 frozen while F2-2027 stays editable in the same
 * school, which a scalar cannot express. `setup_frozen_at` NULL = in-flight/editable, non-NULL =
 * frozen (drives the whole surface's read-only state + the §5.4 save-bar).
 *
 * CO-SIGN: freezing requires BOTH co-signs present — one HEADMASTER + one VICE_HEADMASTER_ACADEMIC
 * (= Head of Academics in this codebase's appRoleEnum; there is no separate HOA role). Modelled as
 * two discrete {actor id, timestamp} pairs (the deboardinization 3-sign idiom), each a single-column
 * SET NULL users FK. Two same-row CHECKs make the invariants structural and portable (no trigger):
 *   • freeze_needs_both_cosigns — `setup_frozen_at` can only be set when BOTH cosign timestamps are
 *     present (a one-stamp fixture ⇒ frozen_at stays NULL — AC A);
 *   • distinct_cosigners — the two signer ids must differ (self-cosign rejected — AC A).
 * The role of each signer is app-enforced when the (deferred) write-flow is built; the CHECKs enforce
 * presence + distinctness now, so a seeded already-frozen cohort is only expressible with two distinct
 * co-signs — exactly what the AC fixture asserts.
 *
 * REFERENCED by wassce_candidates + wassce_papers → carries the composite tenant UK.
 */
export const wassceCohort = pgTable(
  "wassce_cohort",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    examYear: integer("exam_year").notNull(), // e.g. 2026 — the WAEC exam year (display "WASSCE 2026")
    setupFrozenAt: timestamp("setup_frozen_at", { withTimezone: true }), // NULL = in-flight; set = frozen
    // --- the two co-sign stamps (both required to freeze; must be distinct actors) ---
    headmasterCosignUserId: uuid("headmaster_cosign_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    headmasterCosignAt: timestamp("headmaster_cosign_at", { withTimezone: true }),
    academicCosignUserId: uuid("academic_cosign_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    academicCosignAt: timestamp("academic_cosign_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One cohort per exam year per school — the natural key + seed conflict target.
    uniqYear: unique("uniq_wassce_cohort_per_year").on(t.schoolId, t.examYear),
    // Composite-FK target for wassce_candidates + wassce_papers (school_id, id). Emitted INLINE.
    tenantUk: unique("wassce_cohort_tenant_uk").on(t.schoolId, t.id),
    // A cohort can only be frozen once BOTH co-signs are stamped (one-stamp ⇒ frozen_at NULL — AC A).
    freezeNeedsBothCosigns: check(
      "wassce_cohort_freeze_needs_both_cosigns",
      sql`${t.setupFrozenAt} IS NULL OR (${t.headmasterCosignAt} IS NOT NULL AND ${t.academicCosignAt} IS NOT NULL)`,
    ),
    // The two co-signers must be different people — self-cosign rejected (AC A). Portable same-row CHECK.
    distinctCosigners: check(
      "wassce_cohort_distinct_cosigners",
      sql`${t.headmasterCosignUserId} IS NULL OR ${t.academicCosignUserId} IS NULL OR ${t.headmasterCosignUserId} <> ${t.academicCosignUserId}`,
    ),
  }),
);

/**
 * A WASSCE programme (track) offered by the school — DURABLE school-level reference, NOT cohort-scoped
 * (Kofi Ruling 1). The four Asankrangwa tracks: General Science (60), Business (60), General Arts (80),
 * Home Economics (40). `programme` reuses the fixed GES `programmeEnum` (shared with classes.programme)
 * so the §1.6 class→programme cross-module join stays enum-equal; `name` is the per-school canonical
 * display label (the §4 short label "Gen. Arts"/"Home Ec." is a display formatter, not a second field —
 * surface Open Q9). Track colour is a lib/wassce constant keyed by the fixed `programme` enum (Science→
 * terra, Business→gold, Home Ec→green, General Arts→bespoke #7B4A8A) — NOT a column, unlike per-school
 * House colours, because the programme set is fixed (surface Open Q8).
 *
 * `active_flag` soft-delete (K5): a programme is deactivated, never hard-deleted, so a frozen cohort's
 * candidate.programme_id never dangles. REFERENCED by wassce_subjects + wassce_candidates → tenant UK.
 */
export const wassceProgrammes = pgTable(
  "wassce_programmes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    programme: programmeEnum("programme").notNull(), // GES track (reused enum; bridges to classes.programme)
    name: text("name").notNull(), // canonical display, e.g. "General Science"
    activeFlag: boolean("active_flag").notNull().default(true), // K5 soft-delete
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One row per GES track per school — natural key + seed conflict target.
    uniqProgramme: unique("uniq_wassce_programme_per_school").on(t.schoolId, t.programme),
    // Composite-FK target for wassce_subjects + wassce_candidates (school_id, id). Emitted INLINE.
    tenantUk: unique("wassce_programmes_tenant_uk").on(t.schoolId, t.id),
  }),
);

/**
 * A subject offered under a programme — DURABLE school-level reference, per-programme rows (Kofi K1:
 * no subject-master/join table; the "23 subjects · 4 core · 19 elec" figure is a distinct-display
 * count). The four cores (English Language, Mathematics (Core), Integrated Science, Social Studies)
 * repeat as CORE rows under every programme; electives/alternatives are per-programme. `subject_type`
 * maps to the §1.4 tags (CORE/ELECTIVE/OPTIONAL ↔ Core/Elec/Alt).
 *
 * TENANCY (Kofi Ruling 4): carries `school_id` + a COMPOSITE FK to wassce_programmes(school_id, id)
 * — closes the through-join RLS escape (a subject can never point at another tenant's programme). Its
 * own tenant UK is REFERENCED by wassce_candidate_subject + wassce_papers. `active_flag` soft-delete (K5).
 */
export const wassceSubjects = pgTable(
  "wassce_subjects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    programmeId: uuid("programme_id").notNull(),
    name: text("name").notNull(), // "Chemistry", "English Language"
    subjectType: wassceSubjectTypeEnum("subject_type").notNull(),
    activeFlag: boolean("active_flag").notNull().default(true), // K5 soft-delete
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // No duplicate subject name within a programme — natural key + seed conflict target.
    uniqSubject: unique("uniq_wassce_subject_per_programme").on(
      t.schoolId,
      t.programmeId,
      t.name,
    ),
    // Composite-FK target for wassce_candidate_subject + wassce_papers (school_id, id). Emitted INLINE.
    tenantUk: unique("wassce_subjects_tenant_uk").on(t.schoolId, t.id),
    // Per-programme subject-list read (§1.4 cards).
    byProgramme: index("wassce_subjects_programme_idx").on(t.schoolId, t.programmeId),
    // Composite intra-tenant FK — a cross-tenant programme reference is structurally impossible (Ruling 4).
    programmeFk: foreignKey({
      columns: [t.schoolId, t.programmeId],
      foreignColumns: [wassceProgrammes.schoolId, wassceProgrammes.id],
    }).onDelete("cascade"),
  }),
);

/**
 * A registered WASSCE candidate — one per (student × cohort), the §4 roster row (the "240"). Composite
 * FKs to cohort, student and programme keep all three intra-tenant. `index_number` is TENANT-scoped
 * unique (Kofi Ruling 3): centre code is 1:1 with the school (index `0184-0817` = centre `SU-0184` +
 * candidate serial), so within-school uniqueness already preserves national uniqueness — a GLOBAL unique
 * would leak cross-tenant row existence below RLS and was declined (no owner escalation).
 *
 * `candidate_status` is the WAEC lifecycle ONLY (Kofi K3): REGISTERED/ACTIVE/WITHDRAWN/COMPLETED — NEVER
 * fee/NHIS/medical (those are display flags, never a blocker). `reg_flag` is the separate §4.5 display
 * pill (NULL = "Confirmed"; a set value is the one flag chip) — seeded static in INCR-15; live
 * billing/sickbay derivation is later. So P. Donkor stays REGISTERED with reg_flag=FEE (GES cannot-deny),
 * and Y. Aidoo is REGISTERED with reg_flag=ON_MEDICAL (display only, no sickbay/SC write).
 *
 * `accommodations_json` stays jsonb (Kofi Ruling 2 — unstructured SC display): holds the structured
 * accommodation {type: chronic|sight|hearing, scForm: SC-3|SC-7|SC-12, detail} for the 4 accommodation
 * candidates (drives the §4.3 tile-3 "2 chronic · 1 sight · 1 hearing" count + the index `.sub` SC marker,
 * app-side over the seeded rows). `note` is the general §4.5 col-5 prose (for all rows, flagged or not).
 * `mock_2_aggregate` renders seeded/display-only (K4); `projected_aggregate` stays NULL in INCR-15
 * (INCR-17 projection) — NO aggregate is ever computed here (no best-3/mock/compile import — AC G).
 *
 * COHORT-SCOPED → REFERENCED by wassce_candidate_subject + wassce_paper_sittings → tenant UK.
 */
export const wassceCandidates = pgTable(
  "wassce_candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    cohortId: uuid("cohort_id").notNull(),
    studentId: uuid("student_id").notNull(),
    programmeId: uuid("programme_id").notNull(),
    indexNumber: text("index_number").notNull(), // e.g. "0184-0817" — tenant-scoped unique (Ruling 3)
    centreCode: text("centre_code").notNull(), // e.g. "SU-0184" (1:1 with the school)
    candidateStatus: wassceCandidateStatusEnum("candidate_status").notNull().default("REGISTERED"),
    regFlag: wassceRegFlagEnum("reg_flag"), // NULL = "Confirmed"; display flag only, never a blocker (K3)
    accommodationsJson: jsonb("accommodations_json"), // structured SC accommodation, Ruling 2 keeps json
    note: text("note"), // §4.5 col-5 display prose (nullable)
    mock2Aggregate: smallint("mock_2_aggregate"), // seeded display-only (K4); 6..54
    projectedAggregate: smallint("projected_aggregate"), // stays NULL in INCR-15 (INCR-17)
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Tenant-scoped index-number uniqueness (Kofi Ruling 3) — NOT global.
    uniqIndex: unique("uniq_wassce_index_number").on(t.schoolId, t.indexNumber),
    // One candidate row per student per cohort — natural key + seed conflict target.
    uniqStudentCohort: unique("uniq_wassce_candidate_student_cohort").on(
      t.schoolId,
      t.cohortId,
      t.studentId,
    ),
    // Composite-FK target for wassce_candidate_subject + wassce_paper_sittings (school_id, id). INLINE.
    tenantUk: unique("wassce_candidates_tenant_uk").on(t.schoolId, t.id),
    // The §4 roster read — all candidates for a cohort.
    byCohort: index("wassce_candidates_cohort_idx").on(t.schoolId, t.cohortId),
    // §1.4 per-programme counts (ph-count) + §4.4 programme filter.
    byProgramme: index("wassce_candidates_programme_idx").on(t.schoolId, t.programmeId),
    // Composite intra-tenant FKs — cross-tenant cohort/student/programme structurally impossible.
    cohortFk: foreignKey({
      columns: [t.schoolId, t.cohortId],
      foreignColumns: [wassceCohort.schoolId, wassceCohort.id],
    }).onDelete("cascade"),
    studentFk: foreignKey({
      columns: [t.schoolId, t.studentId],
      foreignColumns: [students.schoolId, students.id],
    }).onDelete("cascade"),
    programmeFk: foreignKey({
      columns: [t.schoolId, t.programmeId],
      foreignColumns: [wassceProgrammes.schoolId, wassceProgrammes.id],
    }).onDelete("cascade"),
  }),
);

/**
 * The normalized candidate→subject join (Kofi Ruling 2, orchestrator-RATIFIED — replaces BUILD_STACK's
 * `wassce_candidates.subjects_sitting_json`). One row per subject a candidate sits (4 cores + chosen
 * electives/alternatives). Buys FK integrity to wassce_subjects, RLS, and the INCR-18 subject-readiness
 * heatmap `GROUP BY subject_id`. LEAF (nothing references it) → FORCE RLS but NO tenant UK.
 *
 * Composite FKs to candidates + subjects keep both intra-tenant (cross-tenant impossible, CASCADE with
 * either). UNIQUE(school_id, candidate_id, subject_id) is the no-double-registration guard + seed target.
 */
export const wassceCandidateSubject = pgTable(
  "wassce_candidate_subject",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    candidateId: uuid("candidate_id").notNull(),
    subjectId: uuid("subject_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One row per (candidate × subject) — Ruling 2. Also the per-candidate subject-list read (prefix).
    uniqPair: unique("uniq_wassce_candidate_subject").on(
      t.schoolId,
      t.candidateId,
      t.subjectId,
    ),
    // INCR-18 subject-readiness heatmap GROUP BY subject_id (Ruling 2).
    bySubject: index("wassce_candidate_subject_subject_idx").on(t.schoolId, t.subjectId),
    // Composite intra-tenant FKs — cross-tenant candidate/subject structurally impossible.
    candidateFk: foreignKey({
      columns: [t.schoolId, t.candidateId],
      foreignColumns: [wassceCandidates.schoolId, wassceCandidates.id],
    }).onDelete("cascade"),
    subjectFk: foreignKey({
      columns: [t.schoolId, t.subjectId],
      foreignColumns: [wassceSubjects.schoolId, wassceSubjects.id],
    }).onDelete("cascade"),
  }),
);

/**
 * A WAEC paper on the cohort's exam timetable — COHORT-scoped (Kofi K2). Composite FKs to cohort +
 * subject. `paper_type` is the WAEC structure (OBJECTIVE/ESSAY/PRACTICAL/ORAL/COMBINED — e.g. English
 * Language 1 Objective + English Language 2 Essay). Schedule columns render the §1.2 timetable
 * ("English Language 2 (Essay) 09:30–12:00", "21 Apr → 19 Jun"): `scheduled_time` is a text clock
 * ("09:30", the boarding-config idiom) and `duration_minutes` gives the end — no live status is stored
 * (Day-N is derived on read). REFERENCED by wassce_paper_sittings → tenant UK.
 */
export const wasscePapers = pgTable(
  "wassce_papers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    cohortId: uuid("cohort_id").notNull(),
    subjectId: uuid("subject_id").notNull(),
    name: text("name").notNull(), // "English Language 2 (Essay)"
    paperNumber: smallint("paper_number"), // 1, 2, … (nullable)
    paperType: wasscePaperTypeEnum("paper_type").notNull(),
    waecPaperCode: text("waec_paper_code"), // WAEC's paper code (nullable)
    scheduledDate: date("scheduled_date"), // exam date (nullable)
    scheduledTime: text("scheduled_time"), // start clock "09:30" (text, boarding-config idiom)
    durationMinutes: smallint("duration_minutes"), // end derives from start + duration
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // No duplicate paper label per subject per cohort — natural key + seed conflict target.
    uniqPaper: unique("uniq_wassce_paper").on(t.schoolId, t.cohortId, t.subjectId, t.name),
    // Composite-FK target for wassce_paper_sittings (school_id, id). Emitted INLINE.
    tenantUk: unique("wassce_papers_tenant_uk").on(t.schoolId, t.id),
    // Cohort timetable read (§1.2), scannable by subject.
    byCohortSubject: index("wassce_papers_cohort_subject_idx").on(
      t.schoolId,
      t.cohortId,
      t.subjectId,
    ),
    // Composite intra-tenant FKs — cross-tenant cohort/subject structurally impossible.
    cohortFk: foreignKey({
      columns: [t.schoolId, t.cohortId],
      foreignColumns: [wassceCohort.schoolId, wassceCohort.id],
    }).onDelete("cascade"),
    subjectFk: foreignKey({
      columns: [t.schoolId, t.subjectId],
      foreignColumns: [wassceSubjects.schoolId, wassceSubjects.id],
    }).onDelete("cascade"),
  }),
);

/**
 * One sitting per (candidate × paper) — the exam-day leaf (Kofi K2/D). UNIQUE(school_id, candidate_id,
 * paper_id). `sat_at` = when written; the exemption/make-up fields carry Y. Aidoo's missed papers
 * (medical exemption) with a reason and any rescheduled centre — no derivation, all seeded. LEAF →
 * FORCE RLS but NO tenant UK. Composite FKs to candidates + papers keep both intra-tenant (CASCADE).
 */
export const wasscePaperSittings = pgTable(
  "wassce_paper_sittings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    candidateId: uuid("candidate_id").notNull(),
    paperId: uuid("paper_id").notNull(),
    satAt: timestamp("sat_at", { withTimezone: true }), // when written (nullable)
    exemptedAt: timestamp("exempted_at", { withTimezone: true }), // set = exempted (e.g. medical)
    exemptionReasonText: text("exemption_reason_text"),
    makeUpAt: timestamp("make_up_at", { withTimezone: true }), // rescheduled sitting (nullable)
    makeUpCentre: text("make_up_centre"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One sitting per candidate per paper (Kofi K2/D) — natural key + seed conflict target.
    uniqSitting: unique("uniq_wassce_paper_sitting").on(t.schoolId, t.candidateId, t.paperId),
    // "Who is sitting this paper" read (§1.2 live tracker leaf).
    byPaper: index("wassce_paper_sittings_paper_idx").on(t.schoolId, t.paperId),
    // Composite intra-tenant FKs — cross-tenant candidate/paper structurally impossible.
    candidateFk: foreignKey({
      columns: [t.schoolId, t.candidateId],
      foreignColumns: [wassceCandidates.schoolId, wassceCandidates.id],
    }).onDelete("cascade"),
    paperFk: foreignKey({
      columns: [t.schoolId, t.paperId],
      foreignColumns: [wasscePapers.schoolId, wasscePapers.id],
    }).onDelete("cascade"),
  }),
);

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * INCR-16 · Subject-teacher + mock cycle (SHS module 4.3, migration 0052) — Kofi rulings 2026-07-19.
 *
 * The prediction INPUT built ON the INCR-15 spine: mock grades make the per-subject predicted grade
 * (= the Mock-2/predictor grade) real; whole-candidate best-3 aggregate stays INCR-17. Four tables —
 * three TENANT (FORCE RLS, prod-paste) + one deliberately GLOBAL benchmark reference (bare ENABLE RLS,
 * no FORCE, no tenant_isolation — the module's first global table, the ref_region idiom).
 *
 * NO TRIGGERS (portability): the predicted grade is a DERIVED-ON-READ `COALESCE(moderated_grade, grade)`
 * of the predictor mock (no stored predicted_grade column — R2); moderation-supersede is the same
 * app-layer COALESCE; raw→band mapping is the existing per-school `grade_scale` lib read (no invented
 * ladder). The only structural invariant is the same-row moderation-trail CHECK (INCR-15 idiom).
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * A mock exam sitting for a cohort — cohort-WIDE, cohort-scoped (R1). Asankrangwa runs two (Mock 1 Nov
 * calibration + Mock 2 Mar predictor) but `mock_number` carries NO CHECK ceiling (">2 allowed, not
 * seeded" — the surface's "Mark Mock 3" button must be expressible). RATIFIED DEVIATION from BUILD_STACK:
 * the cohort link is a COMPOSITE FK `(school_id, cohort_id)` → wassce_cohort(school_id, id), NOT a loose
 * `cohort_year` scalar — keeps the ref intra-tenant and structurally correct.
 *
 * PREDICTOR is an EXPLICIT flag, not "highest mock_number" (R1): `is_predictor` + a partial
 * UNIQUE(school_id, cohort_id) WHERE is_predictor enforces exactly one predictor per cohort, so the
 * per-subject predicted grade always resolves to a single mock even after a "Mark Mock 3" re-point.
 *
 * MARKING LOCK is INDEPENDENT of the registration freeze (R3b key ruling): `marking_complete_at` locks
 * MARK-ENTRY/config-edit for this mock; wassce_cohort.setup_frozen_at locks the ROSTER. Mock 2 is marked
 * in March, after Feb reg close — the two locks are orthogonal (resolves Decision-1's apparent conflict).
 *
 * REFERENCED by mock_results → carries the composite tenant UK.
 */
export const mockExams = pgTable(
  "mock_exams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    cohortId: uuid("cohort_id").notNull(),
    name: text("name").notNull(), // "Mock 1", "Mock 2 (Predictor)"
    mockNumber: smallint("mock_number").notNull(), // NO CHECK ceiling — >2 allowed (R1)
    isPredictor: boolean("is_predictor").notNull().default(false), // explicit predictor (R1), not max(mock_number)
    scheduledStart: date("scheduled_start"),
    scheduledEnd: date("scheduled_end"),
    // NULL = marking open (mark-entry + config editable); set = marking closed (both locked). Orthogonal
    // to the registration freeze (R3b) — locks MARKING only, never gated by setup_frozen_at.
    markingCompleteAt: timestamp("marking_complete_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One mock per (cohort × mock_number) — natural key + seed conflict target. Its (school_id, cohort_id)
    // prefix also serves the "all mocks for a cohort" read, so no separate cohort index is needed.
    uniqNumber: unique("uniq_mock_exam_number").on(t.schoolId, t.cohortId, t.mockNumber),
    // Exactly ONE predictor per cohort (R1) — partial unique index. Emitted with the other indexes.
    onePredictor: uniqueIndex("uniq_mock_exam_predictor")
      .on(t.schoolId, t.cohortId)
      .where(sql`${t.isPredictor}`),
    // Composite-FK target for mock_results (school_id, id). Emitted INLINE in CREATE TABLE.
    tenantUk: unique("mock_exams_tenant_uk").on(t.schoolId, t.id),
    // Composite intra-tenant FK — a cross-tenant cohort reference is structurally impossible.
    cohortFk: foreignKey({
      columns: [t.schoolId, t.cohortId],
      foreignColumns: [wassceCohort.schoolId, wassceCohort.id],
    }).onDelete("cascade"),
  }),
);

/**
 * One mock grade per (candidate × subject × mock) — the LEAF the teacher mark-entry surface writes (R2).
 * The teacher enters a WAEC `grade` A1–F9 DIRECTLY and it is AUTHORITATIVE (`wassce_grade NOT NULL`); the
 * per-school `grade_scale` table already maps score→letter, so NO raw→band ladder is invented here.
 * `raw_score`/`max_score` are nullable DIAGNOSTIC only (the surface's optional raw column).
 *
 * MODERATION (R3, Decision 10): store BOTH — `grade` (teacher, immutable) + a nullable `moderated_grade`
 * with its actor/timestamp/reason. Effective grade = COALESCE(moderated_grade, grade) DERIVED ON READ (no
 * stored effective column). The moderation WRITE UI is INCR-18; the columns + the trail CHECK are authored
 * now so the derived read already COALESCEs. Same-row CHECK `moderated_grade IS NULL OR (moderator_user_id
 * IS NOT NULL AND moderated_at IS NOT NULL)` makes the audit trail structural + portable (no trigger) —
 * a half-populated moderation is rejected. Moderator role (VICE_HEADMASTER_ACADEMIC) is app-enforced.
 *
 * LEAF (nothing references it) → FORCE RLS but NO tenant UK. Composite FKs to mock, candidate and subject
 * keep all three intra-tenant (a cross-tenant/cross-cohort mark is structurally impossible — the R5 seam).
 * Actor stamps (marked_by / moderator) are single-column SET NULL users FKs (the boarding/ledger idiom).
 */
export const mockResults = pgTable(
  "mock_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    mockId: uuid("mock_id").notNull(),
    candidateId: uuid("candidate_id").notNull(),
    subjectId: uuid("subject_id").notNull(),
    grade: wassceGradeEnum("grade").notNull(), // teacher-entered, authoritative, immutable (R2)
    rawScore: numeric("raw_score", { precision: 5, scale: 2 }), // diagnostic only, nullable
    maxScore: numeric("max_score", { precision: 5, scale: 2 }), // diagnostic only, nullable
    markedByUserId: uuid("marked_by_user_id").references(() => users.id, { onDelete: "set null" }),
    markedAt: timestamp("marked_at", { withTimezone: true }),
    // --- moderation trail (columns now; write UI is INCR-18; read already COALESCEs) ---
    moderatedGrade: wassceGradeEnum("moderated_grade"), // NULL = un-moderated → effective = grade
    moderatorUserId: uuid("moderator_user_id").references(() => users.id, { onDelete: "set null" }),
    moderatedAt: timestamp("moderated_at", { withTimezone: true }),
    moderationReason: text("moderation_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One grade per (candidate × subject) within a mock — natural key + seed/upsert conflict target.
    uniqResult: unique("uniq_mock_result").on(
      t.schoolId,
      t.mockId,
      t.candidateId,
      t.subjectId,
    ),
    // The mark-entry grid read: a mock's results for one subject (Mr Asiedu → Chemistry F3).
    byMockSubject: index("mock_results_mock_subject_idx").on(t.schoolId, t.mockId, t.subjectId),
    // Trajectory read: a candidate's grades across mocks (Mock1→Mock2 ↑/→/↓).
    byCandidate: index("mock_results_candidate_idx").on(t.schoolId, t.candidateId),
    // Same-row moderation-trail CHECK (R3) — a set moderated_grade needs both actor + timestamp.
    moderationTrail: check(
      "mock_results_moderation_trail",
      sql`${t.moderatedGrade} IS NULL OR (${t.moderatorUserId} IS NOT NULL AND ${t.moderatedAt} IS NOT NULL)`,
    ),
    // Composite intra-tenant FKs — cross-tenant mock/candidate/subject structurally impossible (R5 seam).
    mockFk: foreignKey({
      columns: [t.schoolId, t.mockId],
      foreignColumns: [mockExams.schoolId, mockExams.id],
    }).onDelete("cascade"),
    candidateFk: foreignKey({
      columns: [t.schoolId, t.candidateId],
      foreignColumns: [wassceCandidates.schoolId, wassceCandidates.id],
    }).onDelete("cascade"),
    subjectFk: foreignKey({
      columns: [t.schoolId, t.subjectId],
      foreignColumns: [wassceSubjects.schoolId, wassceSubjects.id],
    }).onDelete("cascade"),
  }),
);

/**
 * A TENANT benchmark data point — this school's OWN computed rate (SCHOOLUP_DIRECT), the school side of
 * the R4 benchmark split. FORCE RLS + prod-paste. `subject_id` is NULLABLE: a non-null row is a
 * per-subject rate (composite FK `(school_id, subject_id)` → wassce_subjects, MATCH SIMPLE skips the NULL
 * row); a NULL row is a school-wide rate. `metric` (credit/distinction) × `scope` describes the numeric
 * `value`; `quality` + `confidence_interval_pp` carry the confidence tier. "My cohort vs region/national"
 * is DERIVED on read against benchmark_reference — never a stored cross-tenant join (no pooling logic).
 */
export const benchmarkDataPoints = pgTable(
  "benchmark_data_points",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    subjectId: uuid("subject_id"), // NULL = school-wide; set = per-subject (composite FK below)
    metric: benchmarkMetricEnum("metric").notNull(),
    scope: benchmarkScopeEnum("scope").notNull(),
    value: numeric("value", { precision: 5, scale: 2 }).notNull(), // e.g. 68.50 (a percentage rate)
    source: benchmarkSourceEnum("source").notNull(),
    quality: benchmarkQualityEnum("quality").notNull(),
    confidenceIntervalPp: numeric("confidence_interval_pp", { precision: 5, scale: 2 }), // ±pp, nullable
    referenceYear: smallint("reference_year").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Composite intra-tenant FK, only enforced when subject_id is set (MATCH SIMPLE skips the NULL
    // school-wide row) — the ref_assessment_weights idiom. Cross-tenant subject structurally impossible.
    subjectFk: foreignKey({
      columns: [t.schoolId, t.subjectId],
      foreignColumns: [wassceSubjects.schoolId, wassceSubjects.id],
    }).onDelete("cascade"),
  }),
);

/**
 * A GLOBAL benchmark reference — WAEC national + directional regional summaries (R4), the reference side
 * of the split. DELIBERATELY GLOBAL: there is NO `school_id` (a benchmark exists for every tenant), so it
 * gets a BARE `ENABLE ROW LEVEL SECURITY` — NO FORCE, NO tenant_isolation policy — the ref_region idiom
 * (owner stays exempt; the Data API is denied by having no permissive policy). Added to the GLOBAL block
 * of policies.sql + prod-paste, NOT the tenant block.
 *
 * Keyed by `subject_name` TEXT (not an FK) so it is tenant-agnostic — a national Chemistry rate is not tied
 * to any one school's wassce_subjects row. `region` is set for a REGION-scope row (e.g. "Western Region"),
 * NULL for NATIONAL. Region ships DIRECTIONAL (±4–5pp via confidence_interval_pp). No composite FK (global).
 */
export const benchmarkReference = pgTable("benchmark_reference", {
  id: uuid("id").primaryKey().defaultRandom(),
  subjectName: text("subject_name").notNull(), // tenant-agnostic key, e.g. "Chemistry"
  region: text("region"), // set for REGION scope (e.g. "Western Region"); NULL for NATIONAL
  metric: benchmarkMetricEnum("metric").notNull(),
  scope: benchmarkScopeEnum("scope").notNull(),
  value: numeric("value", { precision: 5, scale: 2 }).notNull(),
  source: benchmarkSourceEnum("source").notNull(),
  quality: benchmarkQualityEnum("quality").notNull(),
  confidenceIntervalPp: numeric("confidence_interval_pp", { precision: 5, scale: 2 }), // ±pp (directional)
  referenceYear: smallint("reference_year").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * INCR-17 · Projection engine + readiness statement + SC-form (SHS module 4.3, migration 0053) — Kofi
 * rulings 2026-07-19. The analytical spine's two PERSISTED artifacts. The projection ITSELF is a PURE
 * LIB (lib/wassce/projection.ts) — DERIVED on read, NO trigger, NO stored live aggregate; the live
 * `wassce_candidates.projected_aggregate` stays NULL and this is the only stored copy (the frozen
 * snapshot on readiness_statements). Two TENANT tables, both LEAF (nothing references them in 0053) →
 * FORCE RLS + tenant_isolation, NO tenant UK.
 *
 * SPLIT to INCR-17b/0054: the university match (universities / university_programmes / university_targets
 * + per-target ack) — `target_universities_json` stays NULL here and NO university enum/table/column ships
 * (AC17 no-leak). `wassce_results` (post-release actuals) is DEFERRED entirely.
 *
 * NO TRIGGERS (portability): projectAggregate is a pure lib; the frozen snapshot is written ONCE by the
 * generation server action, then immutable — never by a trigger. Composite (school_id, …) FKs keep every
 * intra-tenant ref structurally in-tenant; actor stamps are single-column SET NULL users FKs. The
 * *_file_id columns are nullable placeholders — there is NO files table, so they carry NO FK, stay NULL.
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * A WAEC Special Consideration filing — one MUTABLE workflow row per (candidate × SC form), the §5 write
 * artifact (Ruling 3). SC-3 pre-exam accommodations · SC-7 chronic-condition extra time · SC-12 in-window
 * medical disruption. MANUAL filing (Sickbay→SC-12 auto-suggest is DEFERRED to 4.4); gated to
 * WASSCE_SETUP_ROLES app-side (no new exams-officer/matron role). Setup §5's SC list stays a lib/wassce
 * policy-display constant — THIS is the real filing artifact (on the student-readiness surface).
 *
 * REFILE = UPDATE: UNIQUE(school_id, candidate_id, sc_form) means a re-filed/re-opened form reuses the one
 * row (also the seed conflict target). The (school_id, candidate_id) prefix of that UNIQUE already serves
 * the per-candidate SC read, so NO separate candidate index is added (the mock_exams uniq-prefix idiom).
 *
 * The *_file_id columns (medical_cert / clinician_letter) are nullable id placeholders with NO FK — no
 * files table exists yet, they stay NULL. `filed_at` is NULL while DRAFT. LEAF → FORCE RLS, NO tenant UK.
 * Composite FK (school_id, candidate_id) → wassce_candidates keeps it intra-tenant; `filed_by_user_id` is
 * a single-column SET NULL users FK (the boarding/ledger actor idiom).
 */
export const waecSpecialConsideration = pgTable(
  "waec_special_consideration",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    candidateId: uuid("candidate_id").notNull(),
    scForm: scFormEnum("sc_form").notNull(),
    status: scStatusEnum("status").notNull(),
    filedAt: timestamp("filed_at", { withTimezone: true }), // NULL while DRAFT
    filedByUserId: uuid("filed_by_user_id").references(() => users.id, { onDelete: "set null" }),
    // File placeholders — NO files table yet → NO FK, stay NULL (no file-storage layer).
    medicalCertFileId: uuid("medical_cert_file_id"),
    clinicianLetterFileId: uuid("clinician_letter_file_id"),
    // WAEC workflow stamps (all nullable; advance as the filing progresses through sc_status).
    waecAcknowledgedAt: timestamp("waec_acknowledged_at", { withTimezone: true }),
    waecRef: text("waec_ref"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    makeUpScheduledAt: timestamp("make_up_scheduled_at", { withTimezone: true }),
    makeUpCentre: text("make_up_centre"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One filing per (candidate × SC form) — refile UPDATEs this row (Ruling 3, AC10). Its (school_id,
    // candidate_id) prefix also serves the per-candidate SC read → no separate candidate index.
    uniqForm: unique("uniq_waec_sc_candidate_form").on(t.schoolId, t.candidateId, t.scForm),
    // Composite intra-tenant FK — a cross-tenant candidate reference is structurally impossible (AC11).
    candidateFk: foreignKey({
      columns: [t.schoolId, t.candidateId],
      foreignColumns: [wassceCandidates.schoolId, wassceCandidates.id],
    }).onDelete("cascade"),
  }),
);

/**
 * A frozen readiness statement — the immutable projection artifact (Ruling 4). Generated MANUALLY by
 * WASSCE_SETUP_ROLES, gated on the predictor mock's `marking_complete_at IS NOT NULL` AND a computable
 * best-3 aggregate; lib/wassce/projection.ts runs ONCE and its output is frozen here. The live aggregate
 * is DERIVED on read (no drift, no trigger) and `wassce_candidates.projected_aggregate` stays NULL in the
 * live path — this row is the ONLY stored copy (AC9/AC12).
 *
 * REGENERATION SUPERSEDES: a new statement is a NEW ROW; the prior row's `superseded_at` is stamped. The
 * "current vs historical" state is DERIVED from `superseded_at` (+ `parent_acknowledged_at`) — NO status
 * enum (Ruling 4, AC14). The partial index below serves the "current statement" read (superseded_at IS
 * NULL); the single-current invariant is enforced by the generation action (supersede-then-insert), NOT a
 * unique constraint, so the app owns its write order (index is non-unique deliberately — see report flag).
 *
 * `projection_snapshot_json` (jsonb, NOT NULL) freezes the §5 visualizer + Mock1→Mock2 trajectory:
 * {mock1Aggregate, mock2Aggregate, projectedAggregate, band, subjects:[{name,type,grade,points,counted}]}.
 * `target_universities_json` stays NULL (17b). `projected_aggregate` is the frozen 6–54 best-3 sum (same-
 * row range CHECK: six A1 = 6 … six F9 = 54); `projected_band` is the frozen text label (lib
 * bandForAggregate()). Parent-ack is SCHOOL-CAPTURED in INCR-17 (parent-facing signing UI is INCR-19).
 *
 * LEAF → FORCE RLS, NO tenant UK. Composite FKs (school_id, candidate_id) → wassce_candidates and
 * (school_id, mock_2_id) → mock_exams keep both intra-tenant; `generated_by_user_id` is single-col SET
 * NULL → users. `parent_signature_pdf_file_id` is a nullable placeholder with NO FK (no files table).
 */
export const readinessStatements = pgTable(
  "readiness_statements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    candidateId: uuid("candidate_id").notNull(),
    mock2Id: uuid("mock_2_id").notNull(), // the predictor mock this projection froze (AC13)
    projectedAggregate: smallint("projected_aggregate"), // frozen best-3 sum, 6..54 (CHECK); NULL guard-only
    projectedBand: text("projected_band"), // frozen text label (lib bandForAggregate())
    projectionSnapshotJson: jsonb("projection_snapshot_json").notNull(), // §5 visualizer + trajectory, frozen
    targetUniversitiesJson: jsonb("target_universities_json"), // NULL until 17b (no university leak, AC17)
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
    generatedByUserId: uuid("generated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    supersededAt: timestamp("superseded_at", { withTimezone: true }), // set when a newer statement replaces it
    // --- parent acknowledgement (SCHOOL-CAPTURED in INCR-17; parent-facing signing UI is INCR-19) ---
    parentAcknowledgedAt: timestamp("parent_acknowledged_at", { withTimezone: true }),
    parentAcknowledgedSignatureMethod: parentAckMethodEnum("parent_acknowledged_signature_method"),
    parentAcknowledgedPhone: text("parent_acknowledged_phone"),
    parentConcernsText: text("parent_concerns_text"),
    parentSignaturePdfFileId: uuid("parent_signature_pdf_file_id"), // placeholder, NO FK (no files table)
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Per-candidate statement history read (§7) — includes superseded rows (no UNIQUE: many over time).
    byCandidate: index("readiness_statements_candidate_idx").on(t.schoolId, t.candidateId),
    // The "current statement" hot read — the single non-superseded row per candidate (partial index).
    currentByCandidate: index("readiness_statements_current_idx")
      .on(t.schoolId, t.candidateId)
      .where(sql`${t.supersededAt} IS NULL`),
    // Frozen best-3 aggregate stays in the WAEC 6 (six A1) … 54 (six F9) range — same-row guard (portable).
    aggregateRange: check(
      "readiness_statements_projected_aggregate_range",
      sql`${t.projectedAggregate} IS NULL OR (${t.projectedAggregate} BETWEEN 6 AND 54)`,
    ),
    // Composite intra-tenant FKs — cross-tenant candidate/mock structurally impossible.
    candidateFk: foreignKey({
      columns: [t.schoolId, t.candidateId],
      foreignColumns: [wassceCandidates.schoolId, wassceCandidates.id],
    }).onDelete("cascade"),
    mock2Fk: foreignKey({
      columns: [t.schoolId, t.mock2Id],
      foreignColumns: [mockExams.schoolId, mockExams.id],
    }).onDelete("cascade"),
  }),
);
