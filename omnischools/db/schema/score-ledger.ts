import {
  pgTable,
  uuid,
  text,
  smallint,
  integer,
  boolean,
  numeric,
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
import { students, classes } from "./students";
import { subjects } from "./gradebook";
import { academicPeriod } from "./periods";
import { assessmentCategoryEnum, ledgerStatusEnum, capturePathEnum } from "./_enums";

/**
 * Senior (SHS) score ledger — Score Ledger Item 1 (five-category model + Path A auto-compile).
 * The five categories per (student × subject × period): assignments/class exercises,
 * mid-semester exam, end-of-semester exam, project work, portfolio. The first four are
 * auto-compiled from `senior_assessment` events (Path A); portfolio is a manual entry.
 * Compilation lives in lib/score-ledger/compile.ts (a lib function, never a DB trigger —
 * portability discipline). See docs/senior/f0-ledger-schema.md and SHS_SCORE_LEDGER_SPEC.md.
 */

// Same numeric helper the Basic gradebook uses (file-local in gradebook.ts, not exported).
const score = (name: string) => numeric(name, { precision: 5, scale: 2 });

/**
 * Per-(school × subject) five-category weights. Resolution order in lib/score-ledger:
 * exact (school, subject) row → school-default row (subject_id NULL) → system constant
 * 15/15/40/15/15. The five must sum to exactly 100 (CHECK). Asankrangwa default is
 * 15/15/40/15/15 — end-of-semester exam carries the dominant 40% (spec §2).
 */
export const assessmentWeights = pgTable(
  "ref_assessment_weights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    subjectId: uuid("subject_id"), // NULL = school-wide default; set = per-subject override
    asgnWeight: smallint("asgn_weight").notNull().default(15),
    midSemWeight: smallint("mid_sem_weight").notNull().default(15),
    endSemWeight: smallint("end_sem_weight").notNull().default(40),
    projectWeight: smallint("project_weight").notNull().default(15),
    portfolioWeight: smallint("portfolio_weight").notNull().default(15),
    // Per-category scan denominator (Path B / Item 4). A raw number the extractor read is
    // interpreted against its category's denominator: raw 8 under /10 → 80/100. Same grain
    // and resolution as the weights above (subject row → school-default row → system 100).
    // System default 100 = identity (never inflates a mark). Scaling is a pure lib function
    // (compute.ts:percent) — never a DB trigger. Asankrangwa seeds portfolio /10 (rest /100).
    asgnDenominator: smallint("asgn_denominator").notNull().default(100),
    midSemDenominator: smallint("mid_sem_denominator").notNull().default(100),
    endSemDenominator: smallint("end_sem_denominator").notNull().default(100),
    projectDenominator: smallint("project_denominator").notNull().default(100),
    portfolioDenominator: smallint("portfolio_denominator").notNull().default(100),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One override row per (school, subject). NULLs are distinct in a UNIQUE, so the
    // school-default row is constrained separately by the partial index below.
    uniqPerSubject: unique("uniq_weights_per_school_subject").on(t.schoolId, t.subjectId),
    // Exactly one school-wide default row (subject_id NULL) per school.
    oneDefault: uniqueIndex("uniq_school_default_weights")
      .on(t.schoolId)
      .where(sql`${t.subjectId} IS NULL`),
    // The five category weights must sum to exactly 100. First CHECK in the repo —
    // standard SQL, portable (no Supabase dependency).
    sumTo100: check(
      "assessment_weights_sum_100",
      sql`${t.asgnWeight} + ${t.midSemWeight} + ${t.endSemWeight} + ${t.projectWeight} + ${t.portfolioWeight} = 100`,
    ),
    // Every per-category denominator must be strictly positive — guards the scan-scale
    // divide (a /0 denominator would corrupt every mark). One combined CHECK mirrors the
    // single-constraint style of sumTo100 above.
    denomPositive: check(
      "assessment_denominators_positive",
      sql`${t.asgnDenominator} > 0 AND ${t.midSemDenominator} > 0 AND ${t.endSemDenominator} > 0 AND ${t.projectDenominator} > 0 AND ${t.portfolioDenominator} > 0`,
    ),
    // Composite school-scoped FK — only enforced when subject_id is set (MATCH SIMPLE
    // skips rows with any NULL key column, which is exactly the school-default row).
    subjectFk: foreignKey({
      columns: [t.schoolId, t.subjectId],
      foreignColumns: [subjects.schoolId, subjects.id],
    }).onDelete("cascade"),
  }),
);

/**
 * A Path A gradebook event — the SHS analogue of gradebook_column, keyed to the
 * five-category model via `category`. Assignments are many per context; mid-sem,
 * end-sem and project are each normally a single event (single mid/end enforced by
 * the partial unique indexes below). Composite-FK target for senior_assessment_score.
 */
export const seniorAssessments = pgTable(
  "senior_assessment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    classId: uuid("class_id").notNull(),
    subjectId: uuid("subject_id").notNull(),
    periodId: uuid("period_id").notNull(),
    category: assessmentCategoryEnum("category").notNull(),
    title: text("title").notNull(), // "Assignment 1", "Mid-Sem Exam"
    maxMark: score("max_mark").notNull(),
    assessedOn: date("assessed_on"), // when the assessment happened (nullable until set)
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqTitle: unique("uniq_assessment_per_context").on(
      t.schoolId,
      t.classId,
      t.subjectId,
      t.periodId,
      t.category,
      t.title,
    ),
    // At most one mid-semester and one end-semester exam per (class × subject × period).
    // Assignments and projects are unrestricted. Enforces the single-event assumption the
    // Path A compile rule relies on (Kofi ruling Q1).
    oneMidSem: uniqueIndex("uniq_one_mid_sem_per_context")
      .on(t.schoolId, t.classId, t.subjectId, t.periodId)
      .where(sql`${t.category} = 'MID_SEM_EXAM'`),
    oneEndSem: uniqueIndex("uniq_one_end_sem_per_context")
      .on(t.schoolId, t.classId, t.subjectId, t.periodId)
      .where(sql`${t.category} = 'END_SEM_EXAM'`),
    byContext: index("senior_assessment_context_idx").on(
      t.periodId,
      t.subjectId,
      t.classId,
    ),
    // Composite-FK target for senior_assessment_score (school_id, id).
    tenantUk: unique("senior_assessment_tenant_uk").on(t.schoolId, t.id),
    classFk: foreignKey({
      columns: [t.schoolId, t.classId],
      foreignColumns: [classes.schoolId, classes.id],
    }).onDelete("cascade"),
    subjectFk: foreignKey({
      columns: [t.schoolId, t.subjectId],
      foreignColumns: [subjects.schoolId, subjects.id],
    }).onDelete("cascade"),
    periodFk: foreignKey({
      columns: [t.schoolId, t.periodId],
      foreignColumns: [academicPeriod.schoolId, academicPeriod.periodId],
    }).onDelete("cascade"),
  }),
);

/**
 * One raw mark per (event × student). SHS analogue of gradebook_column_score. Leaf —
 * nothing references it, so no tenant_uk. `raw_mark` nullable: a blank cell is a missing
 * entry, distinct from a zero (Kofi ruling Q2 — blanks are excluded from the assignment
 * mean; a non-submission is an explicit 0). `raw_mark ≤ max_mark` is a soft warn in the
 * lib/UI layer, not a DB check (a cross-row check would need a forbidden trigger — Q3).
 */
export const seniorAssessmentScores = pgTable(
  "senior_assessment_score",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    assessmentId: uuid("assessment_id").notNull(),
    studentId: uuid("student_id").notNull(),
    rawMark: score("raw_mark"), // nullable — blank until entered
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: unique("uniq_assessment_score_per_student").on(
      t.schoolId,
      t.assessmentId,
      t.studentId,
    ),
    byAssessment: index("senior_assessment_score_assessment_idx").on(t.assessmentId),
    assessmentFk: foreignKey({
      columns: [t.schoolId, t.assessmentId],
      foreignColumns: [seniorAssessments.schoolId, seniorAssessments.id],
    }).onDelete("cascade"),
    studentFk: foreignKey({
      columns: [t.schoolId, t.studentId],
      foreignColumns: [students.schoolId, students.id],
    }).onDelete("cascade"),
  }),
);

/**
 * The compiled ledger record at grain (school × student × subject × period) — the
 * five compiled category values, the computed weighted total, the portfolio-manual flag,
 * the status, and a frozen snapshot of the five weights used at compile time (so a later
 * weight change never alters a historical total, and every report can show how a final
 * score was computed — Kofi ruling Q4). Mirrors the Basic gradebook_score shape exactly.
 */
export const seniorScoreLedger = pgTable(
  "senior_score_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    studentId: uuid("student_id").notNull(),
    subjectId: uuid("subject_id").notNull(),
    periodId: uuid("period_id").notNull(),
    // The five category values, reduced to a 0–100 scale from the raw events.
    asgnScore: score("asgn_score"),
    midSemScore: score("mid_sem_score"),
    endSemScore: score("end_sem_score"),
    projectScore: score("project_score"),
    portfolioScore: score("portfolio_score"), // manual entry (spec §4.1)
    // The computed weighted total, using the resolved ref_assessment_weights.
    weightedTotal: score("weighted_total"),
    // Snapshot of the weights used at compile time (frozen — Q4).
    asgnWeightUsed: smallint("asgn_weight_used"),
    midSemWeightUsed: smallint("mid_sem_weight_used"),
    endSemWeightUsed: smallint("end_sem_weight_used"),
    projectWeightUsed: smallint("project_weight_used"),
    portfolioWeightUsed: smallint("portfolio_weight_used"),
    portfolioManual: boolean("portfolio_manual").notNull().default(false),
    status: ledgerStatusEnum("status").notNull().default("DRAFT"),
    compiledByUserId: uuid("compiled_by_user_id").references(() => users.id),
    compiledAt: timestamp("compiled_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: unique("uniq_ledger_student_subject_period").on(
      t.schoolId,
      t.studentId,
      t.subjectId,
      t.periodId,
    ),
    byPeriodSubject: index("senior_ledger_period_subject_idx").on(
      t.periodId,
      t.subjectId,
    ),
    studentFk: foreignKey({
      columns: [t.schoolId, t.studentId],
      foreignColumns: [students.schoolId, students.id],
    }).onDelete("cascade"),
    subjectFk: foreignKey({
      columns: [t.schoolId, t.subjectId],
      foreignColumns: [subjects.schoolId, subjects.id],
    }).onDelete("cascade"),
    periodFk: foreignKey({
      columns: [t.schoolId, t.periodId],
      foreignColumns: [academicPeriod.schoolId, academicPeriod.periodId],
    }).onDelete("cascade"),
  }),
);

/**
 * The capture path a teacher chose for one (class × subject × period) — spec §4.4, chosen
 * per context and switchable. Absent row = the AUTO_COMPILE (Path A) default. Path drives
 * how the ledger is written: AUTO_COMPILE compiles from senior_assessment events;
 * DIRECT_ENTRY (Item 2) writes the five category scores straight onto the ledger.
 */
export const seniorLedgerPath = pgTable(
  "senior_ledger_path",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    classId: uuid("class_id").notNull(),
    subjectId: uuid("subject_id").notNull(),
    periodId: uuid("period_id").notNull(),
    path: capturePathEnum("path").notNull().default("AUTO_COMPILE"),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: unique("uniq_ledger_path_context").on(
      t.schoolId,
      t.classId,
      t.subjectId,
      t.periodId,
    ),
    classFk: foreignKey({
      columns: [t.schoolId, t.classId],
      foreignColumns: [classes.schoolId, classes.id],
    }).onDelete("cascade"),
    subjectFk: foreignKey({
      columns: [t.schoolId, t.subjectId],
      foreignColumns: [subjects.schoolId, subjects.id],
    }).onDelete("cascade"),
    periodFk: foreignKey({
      columns: [t.schoolId, t.periodId],
      foreignColumns: [academicPeriod.schoolId, academicPeriod.periodId],
    }).onDelete("cascade"),
  }),
);

/**
 * Which teacher teaches a subject to a class — the authoritative assignment (spec §6.1).
 * This is the ENUMERATION SOURCE for the Vice Headmaster progress view: rows are driven by
 * the assignments (what's expected), LEFT JOINed to ledger progress (what's started), so a
 * teacher who has done nothing still appears as an at-risk 0/5 row rather than vanishing.
 * Period-agnostic (a teacher owns a class-subject for the year). Populated at setup/onboarding.
 */
export const seniorSubjectTeacher = pgTable(
  "senior_subject_teacher",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    classId: uuid("class_id").notNull(),
    subjectId: uuid("subject_id").notNull(),
    teacherUserId: uuid("teacher_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: unique("uniq_subject_teacher_context").on(t.schoolId, t.classId, t.subjectId),
    classFk: foreignKey({
      columns: [t.schoolId, t.classId],
      foreignColumns: [classes.schoolId, classes.id],
    }).onDelete("cascade"),
    subjectFk: foreignKey({
      columns: [t.schoolId, t.subjectId],
      foreignColumns: [subjects.schoolId, subjects.id],
    }).onDelete("cascade"),
  }),
);

/**
 * Score Ledger Item 7 (INCR-6) — the retained, immutable version snapshot of a
 * senior_score_ledger row at commit time, forming a per-grain supersedes chain.
 *
 * GRAIN: one snapshot per (school × student × subject × period) per commit, all grains of a
 * single upload sharing one `batch_id` (backs the "supersedes the <date> upload" provenance;
 * partial re-upload → batch spans only its covered grains — B3/B5).
 *
 * APPEND-ONLY IMMUTABLE (Kofi Q2): each commit writes ONE new snapshot per grain that
 * self-FKs the *existing* prior latest for that grain (`supersedes_id`, NULL for genesis);
 * rows are never UPDATE/DELETEd except the Q6 period-scoped prune. The live
 * senior_score_ledger row stays the "latest verified" projection; this table is queryable
 * history + the new-vs-prior cell diff, deliberately distinct from audit_log (event log).
 *
 * PATH-AGNOSTIC: Path B (`commitScanLedger`) is the only writer today (Q7b), but `path_used`
 * is stored so a future Path-C checkpoint needs no migration.
 *
 * PRUNE (Q6, lazy): prunePriorPeriodVersions deletes rows whose period maps to a CLOSED
 * academic_period (`closed_at IS NOT NULL`) inside the same write tx — indexed on
 * (school_id, period_id). A reopened period is spared; supersedes is co-periodic and always
 * resolved from an existing row at write time, so a whole-chain prune never dangles the FK.
 * See INCR-6 in docs/senior-build-plan.md and docs/senior/item7-ledger-versions.md.
 */
export const seniorScoreLedgerVersion = pgTable(
  "senior_score_ledger_version",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    studentId: uuid("student_id").notNull(),
    subjectId: uuid("subject_id").notNull(),
    periodId: uuid("period_id").notNull(),
    // Monotonic per grain: exactly one row per (grain, version_number) — the concurrency +
    // chain-integrity guard (AC I1). v1 = genesis, v2 supersedes v1, …
    versionNumber: integer("version_number").notNull(),
    // Shared by every grain committed in one upload (B3); a partial re-upload's batch spans
    // only its covered grains (B5).
    batchId: uuid("batch_id").notNull(),
    // Faithful snapshot of the five category cells + weighted total + status at commit time
    // (same names/types as senior_score_ledger) — reproduces the grid and backs the
    // new-vs-prior cell diff (§7.2/D3). Weights_used / portfolio_manual are deliberately NOT
    // snapshotted: the version's job is provenance + cell diff, and the frozen weights live
    // on the durable senior_score_ledger row (a future weighted-total reconstruction from a
    // version would be an additive column, not needed now).
    asgnScore: score("asgn_score"),
    midSemScore: score("mid_sem_score"),
    endSemScore: score("end_sem_score"),
    projectScore: score("project_score"),
    portfolioScore: score("portfolio_score"),
    weightedTotal: score("weighted_total"),
    status: ledgerStatusEnum("status").notNull(),
    // Which capture path wrote this version (Path B = SCAN_EXTRACT today; path-agnostic).
    pathUsed: capturePathEnum("path_used").notNull(),
    committedByUserId: uuid("committed_by_user_id").references(() => users.id),
    committedAt: timestamp("committed_at", { withTimezone: true }).notNull().defaultNow(),
    // Composite self-FK → the prior latest version for this grain (co-periodic, same school).
    // NULL = genesis (B1). Nullable, so MATCH SIMPLE skips the FK check on genesis rows.
    supersedesId: uuid("supersedes_id"),
  },
  (t) => ({
    // Composite tenant UK — the target of the supersedes self-FK. Emitted INLINE in CREATE
    // TABLE; the self-FK is a later ALTER, so the UK always exists first (no 0033-class
    // FK-before-UNIQUE ordering hazard).
    tenantUk: unique("senior_score_ledger_version_tenant_uk").on(t.schoolId, t.id),
    // Exactly one version_number per grain — concurrency guard (AC I1) + chain integrity.
    // Its btree also serves latest-version-by-grain lookup (grain columns lead, version_number
    // trails → ORDER BY version_number DESC LIMIT 1 is an index scan), so no separate grain
    // index is needed. This is the conflict target the versioned-write path guards on.
    uniqGrainVersion: unique("uniq_ledger_version_grain_number").on(
      t.schoolId,
      t.studentId,
      t.subjectId,
      t.periodId,
      t.versionNumber,
    ),
    // Tenant-scoped prune index — prunePriorPeriodVersions deletes rows whose period maps to a
    // closed academic_period (period-scoped DELETE in the write tx).
    prune: index("senior_ledger_version_prune_idx").on(t.schoolId, t.periodId),
    studentFk: foreignKey({
      columns: [t.schoolId, t.studentId],
      foreignColumns: [students.schoolId, students.id],
    }).onDelete("cascade"),
    subjectFk: foreignKey({
      columns: [t.schoolId, t.subjectId],
      foreignColumns: [subjects.schoolId, subjects.id],
    }).onDelete("cascade"),
    periodFk: foreignKey({
      columns: [t.schoolId, t.periodId],
      foreignColumns: [academicPeriod.schoolId, academicPeriod.periodId],
    }).onDelete("cascade"),
    // Composite self-FK (school_id, supersedes_id) → (school_id, id) — intra-tenant, so
    // composite per the tenant-FK rule: a cross-tenant supersedes is structurally impossible
    // (J2). NO ACTION (default, not SET NULL): a composite SET NULL would also null school_id,
    // and supersedes_id is write-once immutable (A3); the whole-period prune deletes an entire
    // co-periodic chain in one statement (NO ACTION is satisfied at statement end).
    supersedesFk: foreignKey({
      columns: [t.schoolId, t.supersedesId],
      foreignColumns: [t.schoolId, t.id],
    }),
  }),
);
