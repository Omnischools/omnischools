import { pgTable, uuid, text, integer, timestamp, unique, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { schools } from "./tenancy";
import { users } from "./identity";

/**
 * GOV-6 terminal-results capture (governance module, migration 0079) — ONE new tenant table holding
 * SCHOOL-LEVEL AGGREGATES of terminal-exam outcomes, one row per (school × exam_type × year). Kofi
 * R363/R364/R370/R372: AGGREGATE-ONLY — NO per-candidate rows, names, or scores ever live here; the
 * management dashboard reads counts, never a candidate list.
 *
 * Only the FOUR sex-split LEAF COUNTS are stored (female/male × candidates/passed). total / passed /
 * pass-rate are DERIVED at read (lib/), NEVER stored columns (R363) — a stored rate would drift from
 * its own leaves. Sex-split is MANDATORY (NOT NULL, R373-a): the census requires M/F disaggregation.
 *
 * TENANT / management-facing (NOT parent-facing): ENABLE + FORCE RLS + tenant_isolation (db:policies on
 * dev; db/sql/prod-paste-0085-terminal-exam-result.sql by hand on prod — ⚠ RLS is NOT auto-applied on
 * prod). It carries NO parent_scope, so the catalog-driven RESTRICTIVE parent_deny loop in
 * db/sql/policies.sql auto-covers it (FORCE-RLS + school_id + no parent_scope → denied) with zero edits.
 *
 * FKs are BOTH single-column ([[composite-tenant-fks]]): school_id → ref_school (the tenant ROOT, so
 * single-col, NOT composite) CASCADE; captured_by → the GLOBAL ref_user SET NULL (a removed user clears
 * the audit stamp, never deletes the aggregate). LEAF — nothing FKs here → NO tenant_uk. exam_type is
 * TEXT + CHECK, NOT a pg-enum (the ref_role / plc.type fixed-domain idiom).
 */
export const terminalExamResult = pgTable(
  "terminal_exam_result",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    // BECE | WASSCE — CHECK, not an enum (fixed, app-owned, non-extensible domain).
    examType: text("exam_type").notNull(),
    // Exam-sitting calendar year (e.g. 2026).
    year: integer("year").notNull(),
    // The four stored LEAF counts (R372). total/passed/rate are DERIVED at read, never stored.
    femaleCandidates: integer("female_candidates").notNull(),
    maleCandidates: integer("male_candidates").notNull(),
    femalePassed: integer("female_passed").notNull(),
    malePassed: integer("male_passed").notNull(),
    note: text("note"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    // Audit stamp — single-column SET NULL → the GLOBAL ref_user.
    capturedBy: uuid("captured_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => ({
    // The idempotency / upsert conflict target (R370): one aggregate per (school × exam × year). Plain
    // composite UNIQUE — no soft-delete in v1, so not partial. Its (school_id) prefix serves the
    // per-school reads, so no separate school index.
    uniqSitting: unique("uniq_terminal_exam_result_sitting").on(t.schoolId, t.examType, t.year),
    // BECE | WASSCE (R364). NOT NULL, so the allow-list is mandatory.
    examTypeValid: check(
      "terminal_exam_result_exam_type_valid",
      sql`${t.examType} IN ('BECE', 'WASSCE')`,
    ),
    // Non-negativity on the two candidate leaves.
    femaleCandidatesNonneg: check(
      "terminal_exam_result_female_candidates_nonneg",
      sql`${t.femaleCandidates} >= 0`,
    ),
    maleCandidatesNonneg: check(
      "terminal_exam_result_male_candidates_nonneg",
      sql`${t.maleCandidates} >= 0`,
    ),
    // Passed is bounded 0 ≤ passed ≤ candidates, per sex (a pass count can never exceed its sitters).
    femalePassedBounds: check(
      "terminal_exam_result_female_passed_bounds",
      sql`${t.femalePassed} >= 0 AND ${t.femalePassed} <= ${t.femaleCandidates}`,
    ),
    malePassedBounds: check(
      "terminal_exam_result_male_passed_bounds",
      sql`${t.malePassed} >= 0 AND ${t.malePassed} <= ${t.maleCandidates}`,
    ),
    // A captured sitting has ≥1 candidate → the derived pass-rate is never 0/0.
    minOneCandidate: check(
      "terminal_exam_result_min_one_candidate",
      sql`${t.femaleCandidates} + ${t.maleCandidates} >= 1`,
    ),
  }),
);
