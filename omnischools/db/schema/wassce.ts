import {
  pgTable,
  uuid,
  text,
  smallint,
  integer,
  boolean,
  jsonb,
  date,
  timestamp,
  unique,
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
