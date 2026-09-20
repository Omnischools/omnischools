import { pgTable, uuid, text, date, jsonb, timestamp, unique, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { schools } from "./tenancy";
import { users } from "./identity";

/**
 * GOV-8 GES census return (governance module, migration 0081) — ONE new tenant table holding a
 * write-once/render-back FILING DOCUMENT: one row per (school × cadence × academic year). Kofi
 * R386–R405. A census is GENERATED from the live readers (auto_snapshot), the gaps are HAND-FILLED
 * (hand_fill), and the whole thing is frozen as-of census_date and rendered back to the GES form —
 * it is a document, not a live query.
 *
 * The two payloads are JSONB, NOT typed columns (R): 50+ heterogeneous fields that drift every GES
 * revision, so the SHAPE is owned by app-side Zod (lib/), not the DDL — the DB stores plain jsonb and
 * the app casts. auto_snapshot carries the frozen reader outputs WITH their CAPTURED/NOT_CAPTURED tags;
 * hand_fill carries the manual answers (NULL until entered). academic_year is a TEXT tag ('2025/26'),
 * YEAR-scoped with NO period FK — mirrors terminal_exam_result, which carries no period ref; a term FK
 * would be speculative. census_date is the frozen point-in-time reference (age + roll as-of).
 *
 * TENANT / management-facing (NOT parent-facing): ENABLE + FORCE RLS + tenant_isolation (db:policies on
 * dev; db/sql/prod-paste-0087-census-return.sql by hand on prod — ⚠ RLS is NOT auto-applied on prod).
 * It carries NO parent_scope, so the catalog-driven RESTRICTIVE parent_deny loop in db/sql/policies.sql
 * auto-covers it (FORCE-RLS + school_id + no parent_scope → denied) with zero edits. Same shape as
 * terminal_exam_result (GOV-6) / facilities_snapshot (GOV-7).
 *
 * FKs are BOTH single-column ([[composite-tenant-fks]]): school_id → ref_school (the tenant ROOT, so
 * single-col, NOT composite) CASCADE; generated_by → the GLOBAL ref_user SET NULL (a removed user clears
 * the audit stamp, never deletes the filing). LEAF — nothing FKs here → NO tenant_uk. cadence / status are
 * TEXT + CHECK, NOT pg-enums (the ref_role / plc.type fixed-domain idiom).
 */
export const censusReturn = pgTable(
  "census_return",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    // MID_YEAR | ANNUAL — CHECK, not an enum (fixed, app-owned, non-extensible domain).
    cadence: text("cadence").notNull(),
    // e.g. '2025/26' — a YEAR tag, deliberately NO period FK (mirrors terminal_exam_result).
    academicYear: text("academic_year").notNull(),
    // DRAFT | COMPLETED — the filing lifecycle.
    status: text("status").notNull().default("DRAFT"),
    // The frozen as-of date: age + roll are computed as of this point-in-time.
    censusDate: date("census_date").notNull(),
    // Frozen reader outputs (with CAPTURED/NOT_CAPTURED tags). Shape owned by app-side Zod, NOT the DDL.
    autoSnapshot: jsonb("auto_snapshot").notNull(),
    // Manual answers — NULL until entered. Shape owned by app-side Zod, NOT the DDL.
    handFill: jsonb("hand_fill"),
    // Audit stamp — single-column SET NULL → the GLOBAL ref_user.
    generatedBy: uuid("generated_by").references(() => users.id, { onDelete: "set null" }),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // The idempotency / upsert conflict target (R): one return per (school × cadence × year). Plain
    // composite UNIQUE — no soft-delete, so not partial. Its (school_id) prefix serves the per-school
    // reads, so no separate school index.
    uniqFiling: unique("uniq_census_return_filing").on(t.schoolId, t.cadence, t.academicYear),
    // MID_YEAR | ANNUAL. NOT NULL, so the allow-list is mandatory.
    cadenceValid: check("census_return_cadence_valid", sql`${t.cadence} IN ('MID_YEAR', 'ANNUAL')`),
    // DRAFT | COMPLETED.
    statusValid: check("census_return_status_valid", sql`${t.status} IN ('DRAFT', 'COMPLETED')`),
  }),
);
