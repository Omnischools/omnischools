import {
  pgTable,
  uuid,
  text,
  date,
  smallint,
  timestamp,
  unique,
  check,
  foreignKey,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { schools } from "./tenancy";
import { users } from "./identity";
import { students } from "./students";
import {
  senCategoryEnum,
  senSeverityEnum,
  senDiagnosisSourceEnum,
  senConsentStateEnum,
} from "./_enums";

/**
 * GOV-10 SEN register (governance module, migration 0082) — ONE new CONFIDENTIAL tenant table holding a
 * Special-Educational-Needs record: exactly ONE row per (school × student) (R409/R415). Kofi R406–R418.
 * The de-identified category×gender aggregate of this table auto-fills the GES ANNUAL census §5 (a 12-cell
 * 6×2 grid) — but that is an app-layer reader (getCensusSpecialNeeds); the DDL is a plain tenant table.
 *
 * TENANT / management-facing (NOT parent-facing), the standard tenant-table pattern: ENABLE + FORCE RLS +
 * tenant_isolation (db:policies on dev; db/sql/prod-paste-0088-sen-register.sql by hand on prod — ⚠ RLS is
 * NOT auto-applied on prod). It carries NO parent_scope, so the catalog-driven RESTRICTIVE parent_deny loop
 * in db/sql/policies.sql auto-covers it (FORCE-RLS + school_id + no parent_scope → denied) with zero edits.
 * RLS-wise IDENTICAL to census_return (GOV-8) / facilities_snapshot (GOV-7): the CONFIDENTIAL handling
 * (sen_-prefix audit-redaction, the sole-content-path reader gate) is entirely APP-LAYER, never a special
 * DB policy.
 *
 * FKs ([[composite-tenant-fks]]): school_id → ref_school (the tenant ROOT, so single-col, NOT composite)
 * CASCADE; created_by → the GLOBAL ref_user SET NULL (a removed user clears the audit stamp, never deletes
 * the record). PLUS a COMPOSITE (school_id, student_id) → students(school_id, id) CASCADE — the target is
 * students_tenant_uk, so the student reference is structurally intra-tenant and can NEVER cross schools
 * (per the composite-tenant-FK rule, an intra-tenant link to students is NEVER a single-column FK). LEAF —
 * nothing FKs here → NO tenant_uk.
 *
 * NO `sex` column (R414): gender comes from a students.sex join — the single source; the register never
 * duplicates it. NO IEP / medication / behavioural-log / clinical-history columns (R417 HARD scope fence).
 * severity is OPERATIONAL only, never in the census (R408). category is NOT NULL — a pending row still
 * needs its census bucket (R409).
 *
 * CONSENT (R410, KEY): the pending_no_detail CHECK is DB-layer defense-in-depth for children's sensitive
 * data — a PENDING-consent row may carry student_id + category ONLY; the whole sensitive detail cluster
 * (severity + the diagnosis cluster + support_notes + accommodations) MUST be NULL. GRANTED unlocks the
 * full record. consent_on_file_at is deliberately NOT in the CHECK — it is consent metadata (the date the
 * granted artefact was filed), not diagnosis DETAIL, so it is not part of the sensitivity gate.
 */
export const senRegister = pgTable(
  "sen_register",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    // Composite-FK member (see studentFk): (school_id, student_id) → students, intra-tenant.
    studentId: uuid("student_id").notNull(),

    // The census bucket — NOT NULL even on a pending row (R409). The 6 values = the §5 6×2 grid.
    category: senCategoryEnum("category").notNull(),
    // OPERATIONAL ONLY — NEVER read into the census (R408). Nullable.
    severity: senSeverityEnum("severity"),

    // Free-text operational support notes. Nullable; withheld (null) on a PENDING row.
    supportNotes: text("support_notes"),
    // Native text[] — the list of granted classroom accommodations. Nullable; withheld on a PENDING row.
    accommodations: text("accommodations").array(),

    // ---- The sensitive diagnosis cluster (R409) — ALL nullable, ALL withheld on a PENDING row ----
    diagnosisSource: senDiagnosisSourceEnum("diagnosis_source"),
    diagnosingClinician: text("diagnosing_clinician"),
    diagnosingInstitution: text("diagnosing_institution"),
    diagnosisYear: smallint("diagnosis_year"),

    // ---- Consent (R410) ----
    // GRANTED | PENDING — NOT NULL. Gates the DETAIL, not the census count.
    consentState: senConsentStateEnum("consent_state").notNull(),
    // The date the granted consent artefact was recorded (doc upload deferred, OC-SEN-CONSENT-ARTEFACT).
    // Nullable — null until consent is on file.
    consentOnFileAt: date("consent_on_file_at"),

    // Audit stamp — single-column SET NULL → the GLOBAL ref_user.
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Composite intra-tenant FK to the student. Target = students_tenant_uk (school_id, id) — a
    // cross-tenant student reference is structurally impossible. CASCADE: removing the student removes
    // the record.
    studentFk: foreignKey({
      columns: [t.schoolId, t.studentId],
      foreignColumns: [students.schoolId, students.id],
    }).onDelete("cascade"),
    // One SEN row per (school × student) (R415; OC-SEN-MULTI-CATEGORY deferred). Its (school_id) prefix
    // serves the per-school reads, so no separate school index.
    uniqStudent: unique("uniq_sen_register_student").on(t.schoolId, t.studentId),

    // R410 defense-in-depth: a PENDING-consent row must NOT carry any sensitive detail — only
    // (student_id, category) are permitted; the whole detail cluster stays NULL. GRANTED unlocks it.
    // A NULL leg is satisfied (three-valued logic), so an omitted value passes and a present one on a
    // PENDING row is rejected.
    pendingNoDetail: check(
      "sen_register_pending_no_detail",
      sql`${t.consentState} = 'GRANTED' OR (
        ${t.severity} IS NULL
        AND ${t.diagnosisSource} IS NULL
        AND ${t.diagnosingClinician} IS NULL
        AND ${t.diagnosingInstitution} IS NULL
        AND ${t.diagnosisYear} IS NULL
        AND ${t.supportNotes} IS NULL
        AND ${t.accommodations} IS NULL
      )`,
    ),
  }),
);

/**
 * GOV-10 SEN module adoption marker (R413, the honesty crux) — ONE row per school marking the EXPLICIT
 * opt-in to the SEN module. This is what distinguishes NOT-adopted (→ annual census §5 arm NONE +
 * hand-fill reason, never a fabricated zeros payload) from adopted-with-genuine-zero (→ FULL with all 12
 * cells a captured 0, a truth). Bare sen_register row-existence cannot tell those two apart, so the
 * presence/absence of THIS row is the signal.
 *
 * NOT confidential — it is a config flag (who enabled the module + when), no student data. But it IS a
 * tenant table (school_id), so the SAME tenant pattern: ENABLE + FORCE RLS + tenant_isolation, parent_deny
 * auto-covered. school_id IS the primary key (one row per school → naturally unique, the R413 signal is
 * row-presence). FKs: school_id → ref_school CASCADE (single-col, tenant ROOT); enabled_by → the GLOBAL
 * ref_user SET NULL.
 */
export const senModuleAdoption = pgTable("sen_module_adoption", {
  schoolId: uuid("school_id")
    .primaryKey()
    .references(() => schools.id, { onDelete: "cascade" }),
  // When the school opted in. Row-presence is the R413 signal; this stamps the moment.
  enabledAt: timestamp("enabled_at", { withTimezone: true }).notNull().defaultNow(),
  // Audit stamp — single-column SET NULL → the GLOBAL ref_user.
  enabledBy: uuid("enabled_by").references(() => users.id, { onDelete: "set null" }),
});

/**
 * GOV-10b SEN support-grant (Kofi R434) — a per-student, expiring, APPEND-ONLY grant that lets an
 * administrator hand ONE named teacher read access to a single child's ACCOMMODATIONS (never the
 * diagnosis cluster — that exclusion is app-layer, R436) for accommodation planning. The gate
 * (R435, lib/sen/grants.ts) reads THIS table in-tx to answer "does this user hold a live grant on
 * this student?"; a grant is live iff `revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`.
 *
 * This is the STRIPPED sibling of sickbay_chronic_grant: there is exactly ONE teacher scope, so
 * NO scope enum, NO scope_label/directive_note, NO house tie, and NO clinical/policy-bit columns.
 * One row per grant (a re-grant is a new row; a revoke stamps the row, never deletes it).
 *
 * TENANT / management-facing (NOT parent-facing): ENABLE + FORCE RLS + tenant_isolation, IDENTICAL
 * to sen_register (db:policies on dev; db/sql/prod-paste-0089-sen-support-grant.sql by hand on prod
 * — ⚠ RLS is NOT auto-applied on prod). It carries NO parent_scope, so the catalog-driven RESTRICTIVE
 * parent_deny loop in db/sql/policies.sql auto-denies it (FORCE-RLS + school_id + no parent_scope).
 *
 * FKs ([[composite-tenant-fks]]): school_id → ref_school CASCADE (tenant ROOT, single-col). A COMPOSITE
 * (school_id, student_id) → students(school_id, id) CASCADE (target students_tenant_uk) so a cross-tenant
 * grant is structurally impossible — mirrors sen_register's studentFk. grantee_user_id → the GLOBAL
 * ref_user CASCADE and NOT NULL (a grant with no grantee is not a grant — the chronic idiom: NOT NULL ⇒
 * CASCADE, not SET NULL). granted_by/revoked_by → ref_user SET NULL (audit stamps survive a removed user).
 * LEAF — nothing FKs here → NO tenant_uk.
 *
 * ⚠ Deliberately NO "one live grant" unique index (the chronic-grant lesson, R832-note above): `live`
 * depends on now() which is not immutable and cannot appear in an index predicate, and a bare
 * `WHERE revoked_at IS NULL` is worse than nothing (an EXPIRED grant is not a revoked one → a lawful
 * re-grant would collide with a dead row). Duplicate live grants are idempotent; the gate resolves a
 * SET of live grants anyway.
 */
export const senSupportGrant = pgTable(
  "sen_support_grant",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    // Composite-FK member (see studentFk): (school_id, student_id) → students, intra-tenant.
    studentId: uuid("student_id").notNull(),
    // NOT NULL: a grant with no grantee is not a grant. Single-column FK to the GLOBAL ref_user;
    // CASCADE rather than SET NULL precisely because it is NOT NULL (the chronic-grant idiom).
    granteeUserId: uuid("grantee_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // The admin's accommodation-planning justification. NOT NULL.
    reason: text("reason").notNull(),
    // Audit stamp — single-column SET NULL → the GLOBAL ref_user.
    grantedByUserId: uuid("granted_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    // NULL ⇒ no expiry. Evaluated against the DB's now() in the same statement that reads the row
    // (R435) — never a session claim.
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    // APPEND-ONLY revoke: the row is never deleted, only stamped.
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedByUserId: uuid("revoked_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => ({
    // THE HOT PATH (R435): the gate's "does this user hold a live grant" read, on every query behind
    // the grantee view.
    byGrantee: index("sen_support_grant_grantee_idx").on(t.schoolId, t.granteeUserId),
    // The admin's per-student grant list.
    byStudent: index("sen_support_grant_student_idx").on(t.schoolId, t.studentId),
    // Composite intra-tenant FK to the student. Target = students_tenant_uk (school_id, id) — a
    // cross-tenant grant is structurally impossible. CASCADE: removing the student removes the grant.
    studentFk: foreignKey({
      columns: [t.schoolId, t.studentId],
      foreignColumns: [students.schoolId, students.id],
    }).onDelete("cascade"),
  }),
);
