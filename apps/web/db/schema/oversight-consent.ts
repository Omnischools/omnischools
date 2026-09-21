import { pgTable, uuid, text, timestamp, unique, check, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { schools } from "./tenancy";
import { users } from "./identity";
import {
  oversightConsentScopeEnum,
  oversightConsentStateEnum,
  oversightConsentEventTypeEnum,
} from "./_enums";

/**
 * Oversight staff-consent capture — the OPERATIONAL side of the GES §6 individual drill-down (the
 * enforcement lives on apps/oversight, branch claude/oversight-individual-drilldown, already on
 * origin/main). The Oversight gate reads ONE row from `school_staff_oversight_consent` LIVE inside its
 * read-back transaction and fails closed on anything but an unambiguous live grant
 * (apps/oversight/lib/oversight/consent.ts). Build EXACTLY to that read contract — Oversight already
 * enforces against it.
 *
 * A4 READ-PREDICATE COMPATIBILITY (the load-bearing shape). The reader runs, over OPERATIONAL_READBACK_URL
 * as the `oversight_readback` role, inside its fetch transaction:
 *
 *   select id::text, state::text, revoked_at::text, granted_at::text, consent_statement_version
 *     from school_staff_oversight_consent
 *    where school_id = $1::uuid and scope::text = 'NON_GES_STAFF' limit 1
 *
 * So the columns id / state / revoked_at / granted_at / consent_statement_version must exist and cast, and
 * (school_id, scope) must select at most one row — the UNIQUE below guarantees that.
 *
 * TENANT / management-facing (NOT parent-facing): the standard tenant pattern — ENABLE + FORCE RLS +
 * tenant_isolation (db:policies on dev; db/sql/prod-paste-0102-oversight-consent.sql by hand on prod — ⚠
 * RLS is NOT auto-applied on prod). It carries NO parent_scope, so the catalog-driven RESTRICTIVE
 * parent_deny loop in db/sql/policies.sql auto-denies it (FORCE-RLS + school_id + no parent_scope). The
 * oversight_readback role reads it under its OWN tenant scope (app.current_school), one school at a time.
 *
 * FKs ([[composite-tenant-fks]]): school_id → the GLOBAL ref_school (tenant ROOT, single-col) CASCADE;
 * granted_by_user_id → the GLOBAL ref_user SET NULL (a removed user clears the audit stamp, never deletes
 * the consent). Both targets are global, so both FKs are single-column (the composite-FK rule is for
 * intra-tenant references, of which this table has none). LEAF — nothing FKs here → NO tenant_uk.
 */
export const schoolStaffOversightConsent = pgTable(
  "school_staff_oversight_consent",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    // v1 = NON_GES_STAFF only; the column is here so a per-person scope can be added later (A2 contract).
    scope: oversightConsentScopeEnum("scope").notNull(),
    // GRANTED | REVOKED. Pinned to agree with revoked_at by stateRevokedAgree below (A5).
    state: oversightConsentStateEnum("state").notNull(),
    // Who clicked grant/revoke + the role they held at the time. SET NULL: attribution survives a removed
    // user (the DPA defence is consent_statement_version, not the identity of the grantor).
    grantedByUserId: uuid("granted_by_user_id").references(() => users.id, { onDelete: "set null" }),
    grantedByRole: text("granted_by_role"),
    // Every consent row was granted at some moment (a REVOKED row is a grant that was later withdrawn).
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    // NULL while GRANTED; set the moment it is revoked. The reader's belt-and-braces column.
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    // The exact wording the grantor agreed to — the DPA (Act 843) defence, surfaced to the GES reviewer.
    consentStatementVersion: text("consent_statement_version").notNull(),
  },
  (t) => ({
    // One current-state row per (school × scope). This is what makes the reader's (school_id, scope)
    // predicate return at most one row. Its (school_id) prefix serves the per-school read, so no separate
    // school index.
    uniqSchoolScope: unique("school_staff_oversight_consent_school_scope_uk").on(t.schoolId, t.scope),

    // A5 (load-bearing, DB defence-in-depth for the reader). The Oversight predicate is
    // `state='GRANTED' AND revoked_at IS NULL`, written in full precisely so a one-sided write REFUSES
    // rather than releases. This CHECK makes a one-sided write STRUCTURALLY IMPOSSIBLE: a GRANTED row can
    // never carry a revoked_at, and a REVOKED row must carry one. The two can only ever agree.
    stateRevokedAgree: check(
      "school_staff_oversight_consent_state_revoked_agree",
      sql`(${t.state} = 'GRANTED' AND ${t.revokedAt} IS NULL)
        OR (${t.state} = 'REVOKED' AND ${t.revokedAt} IS NOT NULL)`,
    ),
  }),
);

/**
 * Append-only consent history (grant / revoke / re-grant). Same immutability posture as the Oversight
 * audit_access_log: a Postgres BEFORE UPDATE OR DELETE trigger that RAISEs (mirrors ov_audit_append_only —
 * apps/oversight/db/sql/policies.sql). "Consent that can be silently rewritten is not consent." The trigger
 * is DB-layer (drizzle cannot express it) — appended at the foot of the generated migration and carried in
 * db/sql/policies.sql (dev) + db/sql/prod-paste-0102-oversight-consent.sql (prod).
 *
 * TENANT: same ENABLE + FORCE RLS + tenant_isolation as the current-state table; catalog parent_deny
 * auto-covers it. FKs: school_id → ref_school CASCADE (single-col); actor_user_id → ref_user SET NULL.
 */
export const schoolStaffOversightConsentEvent = pgTable(
  "school_staff_oversight_consent_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    scope: oversightConsentScopeEnum("scope").notNull(),
    eventType: oversightConsentEventTypeEnum("event_type").notNull(),
    // The actor + role at the time; SET NULL keeps the history row after a user is removed.
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorRole: text("actor_role"),
    // The wording the actor agreed to on a GRANT/REGRANT (nullable — a REVOKE carries none).
    consentStatementVersion: text("consent_statement_version"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // The settings page's "who granted it and when" history read, newest first, per school.
    bySchoolTime: index("school_staff_oversight_consent_event_school_time_idx").on(
      t.schoolId,
      t.occurredAt.desc(),
    ),
  }),
);
