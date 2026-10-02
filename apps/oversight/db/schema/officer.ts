import {
  pgTable,
  uuid,
  text,
  boolean,
  date,
  timestamp,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { dimJurisdiction } from "./dim";
import { jurisdictionLevelEnum, officerRoleEnum } from "./_enums";

/**
 * OFFICER AUTH (increment G) — who is a GES oversight officer, and who made them one.
 *
 * Two tables, with opposite jobs:
 *   ref_oversight_officer        — the LIVE authority record. One row per Supabase auth user.
 *                                  Answers "what is this logged-in uid allowed to see". Mutable
 *                                  (deactivation, role change), tiny, and read on every request.
 *   audit_officer_provisioning   — the APPEND-ONLY history of how that authority was granted,
 *                                  changed and withdrawn. Answers "who gave this officer national
 *                                  access, when, on whose approval, and why".
 *
 * The split is the point. A directory alone can be edited into any state with no trace; a log alone
 * cannot authorise a request. Together, every widening of what someone can see is both effective
 * (the directory) and attributable (the log).
 *
 * ══ AND THE TWO ARE COUPLED IN THE DATABASE, NOT BY CONVENTION (finding S1) ══
 * "Together" used to be an APPLICATION property: `lib/provisioning/officers.ts` writes both rows in
 * one transaction. It does, and it is correct, but an app convention binds only the caller that
 * honours it — a bare `insert into ref_oversight_officer … 'NATIONAL_OVERSIGHT' …` on the
 * provisioner credential (or any SECURITY DEFINER path) committed happily with no audit row, no
 * actor and no approver, because the two-person rule and the append-only guarantee are enforced ON
 * audit_officer_provisioning and skipping that table skipped both.
 *
 * It is now a database guarantee: `ov_officer_directory_audit_guard()`, a DEFERRED CONSTRAINT
 * trigger on ref_oversight_officer (INSERT and UPDATE), requires at COMMIT an
 * audit_officer_provisioning row from the SAME transaction for the same officer, the same node and
 * the same resulting `is_active`. Deferred because the legitimate writers must insert the directory
 * row FIRST (the audit row's `*_before` columns are read from it); the deferral is what lets the
 * guard refuse the bare write without refusing the correct one. Its second-order effect is the one
 * that matters: because the matching audit row must name THIS node,
 * `ov_officer_provisioning_tier_guard()` forces that row's `target_tier` to the node's real level
 * and `ck_officer_provisioning_two_person` (below) then forces an approver — so a REGION/NATIONAL
 * DIRECTORY row can no longer exist without a second signature in its own transaction.
 *
 * NEITHER TABLE IS JURISDICTION-SCOPED, so neither gets the `jurisdiction_scope` policy every
 * fact/ref table carries. Their RLS is bespoke and lives in db/sql/policies.sql — see the
 * "officer auth" block there, and the reasoning below.
 *
 * ⚠ THE TRIGGERS AND FUNCTIONS NAMED IN THIS FILE ARE NOT DRIZZLE-MANAGED. drizzle-kit does not
 * generate triggers, functions or policies, so no numbered migration contains any of them: they
 * live in db/sql/policies.sql (local dev, via `pnpm db:policies`) and in
 * db/sql/prod-paste-0005-officer-directory.sql, which is applied to prod BY HAND. Changing a guard
 * described here therefore means editing both of those files, never a migration — and it means the
 * prod paste has to be re-run, which for the coupling guard above is the only way it reaches prod at
 * all (its absence is silent; see that file's RE-PASTE REQUIRED header).
 */

/**
 * ref_oversight_officer — the officer directory.
 *
 * ══ ONE ID, AND IT IS THE SUPABASE AUTH UID (Kofi AC14) ══
 * `officer_id` IS the uid issued by the analytics project's Supabase Auth. It is the value that
 * becomes `OfficerSession.officerId`, that `withJurisdiction()` writes into `app.current_officer`,
 * and that lands in `audit_access_log.officer_id`. There is deliberately NO second surrogate key:
 * with two candidate ids, some future writer eventually stamps the wrong one onto an audit row, and
 * the audit trail silently stops identifying anybody. One uid, used everywhere, is what makes
 * attribution survive offboarding — the directory row is deactivated, never deleted, so a uid found
 * on a five-year-old audit row still resolves to a name here.
 *
 * ⚠ NO `defaultRandom()` ON THE PRIMARY KEY, on purpose. A default would let an INSERT that forgot
 * to supply the uid succeed, minting an officer whose id matches no auth user: unloggable-in,
 * invisible in Supabase Auth, and the author of audit rows attributable to nobody. Without a default
 * the provisioning write must name the uid it is provisioning, or fail.
 *
 * ⚠ NO FOREIGN KEY TO `auth.users`, though it is the same database on Supabase. Three reasons:
 * drizzle-kit does not manage the `auth` schema, so the FK could not be generated or replayed; the
 * migration-replay / test harness has no `auth` schema at all; and `auth.users` is Supabase-owned,
 * so a cascade there must never be able to silently delete authority history. The consequence is
 * explicit: a directory row CAN outlive its auth user, in which case nothing can authenticate as it
 * and the session simply never forms — fail closed. Offboarding is `is_active = false`, NOT a
 * delete, on both sides.
 *
 * ══ NO `level` COLUMN (Kofi R2 / AC10) ══
 * The officer's tier is DERIVED from `dim_jurisdiction.level` of the node this row points at, every
 * time, by the join inside `ov_resolve_officer()`. Storing it here would create a second, writable
 * source of truth for the one value that decides how much of Ghana the officer can read, and the
 * failure mode of a stale copy is silent privilege escalation (a district node with a cached
 * 'NATIONAL' level reads every school in the country). There is therefore no code path — app,
 * trigger or policy — that can set a tier independently of the node.
 *
 * ══ PII, AND WHY IT IS OWNER-ONLY ══
 * `full_name` / `work_email` exist for the provisioner: reconciling the directory against a GES HR
 * list, and answering "who is 6000…-001" during an audit. They are NOT returned by
 * `ov_resolve_officer()` (which yields only id, node, derived tier and role), and the table has RLS
 * enabled with NO select policy, so NO read path available to the Oversight app credential can
 * reach them. The session's display name comes from the Supabase JWT — the officer's own identity,
 * which they already hold. This is the one operator-identity table in a database whose §9 promise is
 * "no individual records"; the promise is about oversight SUBJECTS (students, school staff), not
 * about the platform's own operators, and tests/no-individuals-in-analytics.test.ts now records that
 * exception explicitly rather than by the accident of a column name.
 */
export const refOversightOfficer = pgTable(
  "ref_oversight_officer",
  {
    // = Supabase auth uid. No default: see the note above.
    officerId: uuid("officer_id").primaryKey(),

    // The officer's OWN node — the ceiling of everything they can read, and the only input to their
    // derived tier. NOT NULL: an officer with no node has no ceiling, and the RLS helpers would read
    // that as NATIONAL-shaped (null jurisdiction) rather than as "no access". A NATIONAL officer
    // points at the national node itself; `ov_is_national()` short-circuits the subtree walk, so the
    // value is never used as a filter for them, but it is still recorded.
    jurisdictionId: uuid("jurisdiction_id")
      .notNull()
      .references(() => dimJurisdiction.jurisdictionId),

    // Must agree with the node's derived tier (DISTRICT→DISTRICT_OVERSIGHT, REGION→REGIONAL_
    // OVERSIGHT, NATIONAL→NATIONAL_OVERSIGHT) and the node must not be a SCHOOL. Both are enforced
    // by the ov_officer_node_valid() write trigger in db/sql/policies.sql — a CHECK cannot read
    // dim_jurisdiction. The column is descriptive of the post; the NODE is what grants the reach.
    officerRole: officerRoleEnum("officer_role").notNull(),

    // Deactivation is the offboarding mechanism (never DELETE — see the id note). It takes effect in
    // the database, not in the app: ov_resolve_officer() filters on it, so a deactivated officer
    // resolves to ZERO rows and is indistinguishable from an unprovisioned uid.
    isActive: boolean("is_active").notNull().default(true),

    fullName: text("full_name"),
    workEmail: text("work_email"),

    // Provenance, as every ref_* row carries (Principle 3): which GES list/decision this posting came
    // from, and as of when.
    //
    // TEXT, NOT the `ov_source` enum, deliberately. Adding 'GES_HR_DIRECTORY' to the pre-existing
    // `ov_source` type would be an `ALTER TYPE ... ADD VALUE`, and Postgres forbids USING a value in
    // the transaction that added it — so a single migration could not both add the value and set it
    // as this column's default. Splitting that across 0004/0005 to gain an enum on a provenance
    // label is not worth it, and the officer-provenance vocabulary (GES HR list, regional directive,
    // secondment) is the growing kind anyway — the same reasoning that keeps
    // `audit_access_log.staff_category` text.
    source: text("source").notNull().default("GES_HR_DIRECTORY"),
    asOfDate: date("as_of_date").notNull(),
  },
  (t) => [
    index("ref_oversight_officer_jurisdiction_idx").on(t.jurisdictionId),
    // At most one ACTIVE officer per work email — PARTIAL on is_active, which is load-bearing. A
    // plain UNIQUE would break the re-provisioning path: an officer who leaves and returns (or whose
    // auth account is recreated) keeps their work email while the old, deactivated row must stay for
    // audit attribution. Partial-on-active forbids the thing that is actually wrong (two live
    // identities for one person) and permits the thing that is actually right (one live row plus
    // history).
    uniqueIndex("ref_oversight_officer_active_email_idx")
      .on(t.workEmail)
      .where(sql`${t.isActive}`),
  ],
);

/**
 * audit_officer_provisioning — append-only history of every grant, change and withdrawal of
 * oversight authority.
 *
 * ══ WHY NOT `audit_access_log` ══
 * Wrong shape and wrong predicate. That table records a READ of a named record and is keyed on the
 * school's jurisdiction; its INSERT policy is
 * `officer_id = ov_current_officer() and ov_in_subtree(jurisdiction_id)`, which would reject every
 * row here — a provisioning event is written by an OMNISCHOOLS provisioner (who is not a GES officer
 * and has no `app.current_officer`) ABOUT a GES officer, with no jurisdiction GUC in play. Forcing
 * provisioning into it would mean weakening that predicate, i.e. paying for a new feature with the
 * audit log's integrity. Separate table, separate posture.
 *
 * ══ POSTURE ══
 * · APPEND-ONLY by trigger (`ov_officer_provisioning_append_only`), mirroring
 *   `ov_audit_append_only` on audit_access_log. As that file's header explains, the trigger is the
 *   loud half; the absent UPDATE/DELETE grant is the real guard.
 * · NOT readable by GES officers. RLS is enabled and the only SELECT policy is role-targeted at the
 *   Omnischools provisioner role; the Oversight app role is additionally REVOKEd on this table, so
 *   its floor is the missing grant rather than a policy. A district director has no business reading
 *   the national provisioning history, and an officer who could read this table could enumerate
 *   every other officer — which is exactly the property the directory's no-enumeration design
 *   exists to deny.
 * · WRITES happen on a privileged provisioner path (owner / BYPASSRLS), app-side. This file models
 *   the table, its constraints and its append-only guard; wiring the writer is the implementer's
 *   (see docs/PROVISIONING.md §4).
 * · A ROW HERE IS NOT OPTIONAL. `ov_officer_directory_audit_guard()` (see the header, and
 *   db/sql/policies.sql) makes every ref_oversight_officer INSERT/UPDATE require a matching row in
 *   this table from the same transaction, so this is no longer a log that a writer may forget — it
 *   is the thing that makes the directory write legal.
 */
export const auditOfficerProvisioning = pgTable(
  "audit_officer_provisioning",
  {
    provisioningId: uuid("provisioning_id").primaryKey().defaultRandom(),

    // PROVISION | ROLE_CHANGE | DEACTIVATE | REACTIVATE | APPROVE. Text + CHECK rather than an enum:
    // this is an audit vocabulary that will grow, and a CHECK can be widened by an ordinary
    // migration whereas an enum value-add cannot be used in the migration that adds it.
    action: text("action").notNull(),

    // The Omnischools provisioner who performed the action, and (two-person rule) the second person
    // who authorised it. Both are auth uids. NO FK to ref_oversight_officer: a provisioner is
    // Omnischools staff, not a GES oversight officer, so they have no row there at all.
    actorId: uuid("actor_id").notNull(),
    approverId: uuid("approver_id"),

    // The officer being provisioned — the Supabase auth uid, i.e. ref_oversight_officer.officer_id.
    //
    // ⚠ DELIBERATELY NO FOREIGN KEY, for the same reason audit_access_log.consent_ref has none in
    // spirit: this is a frozen historical claim. The log must be able to record a provisioning event
    // for a uid whose directory row is later hard-deleted by a privileged hand, and must never be
    // the thing that blocks (or, worse, cascades with) such a delete. Audit history outlives the
    // record it describes.
    targetOfficerId: uuid("target_officer_id").notNull(),

    // The node the authority was granted over, and its tier AT THE TIME.
    //
    // Recording the tier is not a second source of truth for the live tier (Kofi R2/AC10 — only
    // dim_jurisdiction.level is that, and nothing derives a session tier from this table). It is
    // here because the two-person rule is a property of the tier and a CHECK constraint cannot join
    // to another table; and because "a REGIONAL grant was approved by X" must stay readable even if
    // the node is later restructured.
    targetJurisdictionId: uuid("target_jurisdiction_id")
      .notNull()
      .references(() => dimJurisdiction.jurisdictionId),
    targetTier: jurisdictionLevelEnum("target_tier").notNull(),

    // Role/active state either side of the action. TEXT, not ov_officer_role (Kofi R2): a retired
    // post must stay recordable and readable after the enum has moved on. NULL `*_before` = the
    // officer did not exist before this action (a PROVISION).
    roleBefore: text("role_before"),
    roleAfter: text("role_after"),
    activeBefore: boolean("active_before"),
    activeAfter: boolean("active_after").notNull(),

    // NOT NULL and DEFAULT-LESS, for the same reason as audit_access_log.legal_basis: there is no
    // safe default justification for granting someone oversight of a region. The writer states why
    // or the INSERT fails.
    reason: text("reason").notNull(),

    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_officer_provisioning_target_idx").on(t.targetOfficerId, t.occurredAt),

    check(
      "ck_officer_provisioning_action",
      sql`${t.action} in ('PROVISION','ROLE_CHANGE','DEACTIVATE','REACTIVATE','APPROVE')`,
    ),

    // No SCHOOL-tier officer (Kofi R1), restated on the audit side. The directory's write trigger
    // already refuses a SCHOOL node; this makes it impossible even to RECORD having granted one, so
    // the history cannot describe a posting the system forbids. SCHOOL stays a valid
    // `jurisdiction_level` everywhere else — the constraint is on this table, not on the type.
    check("ck_officer_provisioning_tier_not_school", sql`${t.targetTier} <> 'SCHOOL'`),

    // TWO-PERSON RULE. A REGIONAL or NATIONAL grant — the tiers that see a region or the whole
    // country — requires a named approver, in the row, at write time. DISTRICT is single-signature.
    // Expressed as a CHECK and not as app logic because "who may widen someone's reach" is exactly
    // the rule that gets skipped under operational pressure by whoever is holding the console.
    //
    // ⚠ THIS CHECK IS ONLY AS GOOD AS `target_tier`, WHICH THE WRITER SUPPLIES. On its own it is
    // forgeable: claim `target_tier = 'DISTRICT'` for a national grant and the approver requirement
    // evaporates. That is why `ov_officer_node_valid()` (db/sql/policies.sql) also fires on this
    // table and RAISES unless `target_tier` equals `dim_jurisdiction.level` of
    // `target_jurisdiction_id`. The trigger makes the tier unforgeable; this CHECK then rests on a
    // value proven equal to the node's real level. Neither half is sufficient alone — do not remove
    // one because the other exists.
    //
    // THERE IS A THIRD HALF, ADDED FOR FINDING S1. Both of the above only bite on a row that is
    // actually written here, and nothing used to require one: the bare directory INSERT skipped this
    // table and therefore skipped this rule. `ov_officer_directory_audit_guard()` now makes a
    // ref_oversight_officer write require a row here for the SAME officer and the SAME node in the
    // same transaction, which is what carries the approver requirement across to the directory.
    check(
      "ck_officer_provisioning_two_person",
      sql`${t.targetTier} = 'DISTRICT' or ${t.approverId} is not null`,
    ),

    // …and two PEOPLE. An approver who is the actor is a rubber stamp with extra steps; a one-person
    // two-person rule is the failure this closes.
    check(
      "ck_officer_provisioning_distinct_approver",
      sql`${t.approverId} is null or ${t.approverId} <> ${t.actorId}`,
    ),

    // A PROVISION/REACTIVATE must land active, a DEACTIVATE must land inactive. Cheap, and it stops
    // a log that says "deactivated" beside a row that says the officer stayed live.
    //
    // ROLE_CHANGE and APPROVE are deliberately UNCONSTRAINED here: a role change can be applied to
    // either state, and APPROVE may be recorded before the provisioning it authorises (approve-then-
    // provision) or alongside it, so pinning its active_after would encode one workflow into the
    // schema. See docs/PROVISIONING.md §4 — the APPROVE ordering is the implementer's call.
    check(
      "ck_officer_provisioning_active_after",
      sql`case ${t.action}
            when 'DEACTIVATE' then ${t.activeAfter} = false
            when 'PROVISION'  then ${t.activeAfter} = true
            when 'REACTIVATE' then ${t.activeAfter} = true
            else true
          end`,
    ),
  ],
);
