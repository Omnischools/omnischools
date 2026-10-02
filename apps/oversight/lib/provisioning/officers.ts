import type postgres from "postgres";

/**
 * OFFICER PROVISIONING — the directory write path (increment G · Kofi R7 · docs/PROVISIONING.md §4b).
 *
 * Wells's note: "the provisioner write grants exist in harness + prod-paste but no code uses them
 * yet — that write path is yours." This is it, and it is written as PURE FUNCTIONS OVER A SQL
 * HANDLE rather than as a module that owns a connection, so the SAME code serves both writers:
 * `scripts/load-officers.ts` (a CLI seed/CSV load) and the admin console's server actions. Two
 * implementations of "write the directory row and the audit row" would eventually disagree about the
 * transaction, and the one that got it wrong would be the one nobody tested.
 *
 * ══ THE FOUR RULES, AND WHERE EACH IS ENFORCED ══
 *
 *  1. ONE TRANSACTION. The directory write and the `audit_officer_provisioning` row are a single
 *     unit of work. Not for tidiness: a directory row with no audit row is unattributable authority
 *     (someone can see a region and nobody knows who granted it), and an audit row with no directory
 *     row is a claim about a grant that never happened. Both failure modes are permanent, because
 *     the log is append-only — there is no "fix it up afterwards".
 *  2. NO SCHOOL-TIER OFFICER (Kofi R1). Checked here (loud, with a message naming the node) and
 *     refused again by `ov_officer_node_tier()` in the database. The app check exists for the error
 *     message; the trigger is the guard.
 *  3. THE TIER IS DERIVED, NEVER SUPPLIED. `resolveNodeTier()` reads `dim_jurisdiction.level`, and
 *     the role is derived from the tier. No argument of any function here accepts a tier or a role —
 *     which is the only durable way to express "scope cannot be widened by typing a level".
 *  4. TWO PEOPLE FOR REGION/NATIONAL. The approver must be present and distinct. Checked here, and
 *     enforced by `ck_officer_provisioning_two_person` + `ck_officer_provisioning_distinct_approver`
 *     with `ov_officer_provisioning_tier_guard()` making the recorded tier unforgeable.
 *
 * NOTHING HERE READS `app.current_*`. These writes are not jurisdiction-scoped — a provisioner is
 * Omnischools staff acting on the whole directory — and the write guards are SECURITY DEFINER
 * precisely so they work for a non-owner provisioner with no GUC set (policies.sql explains why the
 * alternative, having the provisioner grant itself national scope, was rejected). The ONE place a
 * GUC is needed is reading `dim_jurisdiction` for the node picker, which is RLS-scoped like any
 * other read — see `withNationalRead()`.
 */

export type OfficerTier = "DISTRICT" | "REGION" | "NATIONAL";

export const ROLE_FOR_TIER: Record<OfficerTier, string> = {
  DISTRICT: "DISTRICT_OVERSIGHT",
  REGION: "REGIONAL_OVERSIGHT",
  NATIONAL: "NATIONAL_OVERSIGHT",
};

/** The tiers that need a second administrator (Kofi R7): the ones that see a region or the country. */
export const TWO_PERSON_TIERS: readonly OfficerTier[] = ["REGION", "NATIONAL"];

export function requiresTwoPerson(tier: OfficerTier): boolean {
  return TWO_PERSON_TIERS.includes(tier);
}

export class ProvisioningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProvisioningError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuid(value: string, label: string): string {
  if (!UUID.test(value ?? "")) {
    throw new ProvisioningError(
      `${label} must be a uuid (got ${JSON.stringify(value)}).`,
    );
  }
  return value;
}

/**
 * Run a read that needs to see `dim_jurisdiction`.
 *
 * Wells's note, implemented: "provisioner reads of dim_jurisdiction need
 * `app.current_level='NATIONAL'` (read convenience, no guard depends on it)". That last clause is
 * the important half and is why this helper is named for what it is. Setting the GUC here buys the
 * node picker a list of nodes; it does NOT authorise anything, because every write guard derives the
 * tier through a SECURITY DEFINER function that ignores GUCs entirely. If this call were deleted the
 * picker would come back empty — nothing would become permitted.
 *
 * WHY `resolveNodeTier()` (used by the PROVISION path) may read through this, while
 * `deactivateOfficer()` deliberately does not: here the node is the CALLER'S INPUT, so a GUC-scoped
 * read that returns nothing fails the provision closed, and `ov_officer_node_tier()` fires on the
 * write anyway and refuses any row whose tier disagrees with the node — the database backstops a
 * wrong answer. On the withdrawal path the tier is read FROM THE EXISTING ROW to decide whether the
 * two-person rule applies, and nothing downstream re-derives it; a value that depends on the caller
 * having first granted itself national scope would be the wrong thing to hang that decision on, so
 * that read goes through the definer function instead.
 */
export async function withNationalRead<T>(
  sql: postgres.Sql,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('app.current_level', 'NATIONAL', true)`;
    return fn(tx as unknown as postgres.TransactionSql);
  }) as unknown as Promise<T>;
}

export interface JurisdictionOption {
  jurisdictionId: string;
  name: string;
  level: OfficerTier;
  parentName: string | null;
  /** Derived, read-only in the UI — the admin never types a tier or a role (Lucy G8.b). */
  derivedRole: string;
}

/**
 * The node picker's options. SCHOOL nodes are EXCLUDED BY THE QUERY, not hidden by the UI.
 *
 * Lucy G8.b is explicit that they must not be shown-then-disabled ("to avoid implying it's a coming
 * option"), and doing the filtering in SQL means a second UI built on this function inherits the
 * rule. There is no SCHOOL-tier oversight officer: a head teacher is an operational user of
 * apps/web, and one credential must not both run a school and oversee it.
 */
export async function listJurisdictionOptions(
  sql: postgres.Sql,
): Promise<JurisdictionOption[]> {
  const rows = await withNationalRead(sql, async (tx) => {
    return (await tx`
      select dj.jurisdiction_id::text as jurisdiction_id,
             dj.name                  as name,
             dj.level::text           as level,
             parent.name              as parent_name
        from dim_jurisdiction dj
        left join dim_jurisdiction parent on parent.jurisdiction_id = dj.parent_id
       where dj.level <> 'SCHOOL'
       order by case dj.level
                  when 'NATIONAL' then 1 when 'REGION' then 2 else 3 end,
                dj.name
    `) as unknown as {
      jurisdiction_id: string;
      name: string;
      level: OfficerTier;
      parent_name: string | null;
    }[];
  });
  return rows.map((r) => ({
    jurisdictionId: r.jurisdiction_id,
    name: r.name,
    level: r.level,
    parentName: r.parent_name,
    derivedRole: ROLE_FOR_TIER[r.level],
  }));
}

/** The node's tier, read from the spine. Refuses SCHOOL and refuses an unknown node. */
export async function resolveNodeTier(
  sql: postgres.Sql,
  jurisdictionId: string,
): Promise<OfficerTier> {
  requireUuid(jurisdictionId, "jurisdictionId");
  const rows = await withNationalRead(sql, async (tx) => {
    return (await tx`
      select level::text as level from dim_jurisdiction
       where jurisdiction_id = ${jurisdictionId}::uuid
    `) as unknown as { level: string }[];
  });
  const level = rows[0]?.level;
  if (!level) {
    throw new ProvisioningError(
      `Jurisdiction ${jurisdictionId} is not in dim_jurisdiction — refusing to provision an officer against a node that does not exist.`,
    );
  }
  if (level === "SCHOOL") {
    throw new ProvisioningError(
      `Jurisdiction ${jurisdictionId} is a SCHOOL node. There is no SCHOOL-tier oversight officer (Kofi R1) — officers are provisioned at District, Region or National.`,
    );
  }
  return level as OfficerTier;
}

export interface OfficerDirectoryRow {
  officerId: string;
  jurisdictionId: string;
  jurisdictionName: string | null;
  tier: string | null;
  officerRole: string;
  isActive: boolean;
  fullName: string | null;
  workEmail: string | null;
  source: string;
  asOfDate: string;
}

/**
 * The officer list (Lucy G8.a). Readable ONLY through the provisioner connection — the app role has
 * no policy on this table at all, which is what makes the roster unenumerable from the runtime.
 */
export async function listOfficers(sql: postgres.Sql): Promise<OfficerDirectoryRow[]> {
  const rows = await withNationalRead(sql, async (tx) => {
    return (await tx`
      select o.officer_id::text      as officer_id,
             o.jurisdiction_id::text as jurisdiction_id,
             j.name                  as jurisdiction_name,
             j.level::text           as tier,
             o.officer_role::text    as officer_role,
             o.is_active             as is_active,
             o.full_name             as full_name,
             o.work_email            as work_email,
             o.source                as source,
             o.as_of_date::text      as as_of_date
        from ref_oversight_officer o
        left join dim_jurisdiction j on j.jurisdiction_id = o.jurisdiction_id
       order by o.is_active desc, j.level, j.name
    `) as unknown as Record<string, unknown>[];
  });
  return rows.map((r) => ({
    officerId: r.officer_id as string,
    jurisdictionId: r.jurisdiction_id as string,
    jurisdictionName: (r.jurisdiction_name as string | null) ?? null,
    tier: (r.tier as string | null) ?? null,
    officerRole: r.officer_role as string,
    isActive: Boolean(r.is_active),
    fullName: (r.full_name as string | null) ?? null,
    workEmail: (r.work_email as string | null) ?? null,
    source: r.source as string,
    asOfDate: r.as_of_date as string,
  }));
}

export interface ProvisioningAuditRow {
  provisioningId: string;
  action: string;
  actorId: string;
  approverId: string | null;
  targetOfficerId: string;
  targetJurisdictionId: string;
  targetTier: string;
  roleBefore: string | null;
  roleAfter: string | null;
  activeBefore: boolean | null;
  activeAfter: boolean;
  reason: string;
  occurredAt: string;
}

/** The append-only provisioning history (Lucy G8.e). */
export async function listProvisioningAudit(
  sql: postgres.Sql,
  limit = 100,
): Promise<ProvisioningAuditRow[]> {
  const rows = (await sql`
    select provisioning_id::text        as provisioning_id,
           action                       as action,
           actor_id::text               as actor_id,
           approver_id::text            as approver_id,
           target_officer_id::text      as target_officer_id,
           target_jurisdiction_id::text as target_jurisdiction_id,
           target_tier::text            as target_tier,
           role_before                  as role_before,
           role_after                   as role_after,
           active_before                as active_before,
           active_after                 as active_after,
           reason                       as reason,
           occurred_at::text            as occurred_at
      from audit_officer_provisioning
     order by occurred_at desc
     limit ${limit}
  `) as unknown as Record<string, unknown>[];
  return rows.map((r) => ({
    provisioningId: r.provisioning_id as string,
    action: r.action as string,
    actorId: r.actor_id as string,
    approverId: (r.approver_id as string | null) ?? null,
    targetOfficerId: r.target_officer_id as string,
    targetJurisdictionId: r.target_jurisdiction_id as string,
    targetTier: r.target_tier as string,
    roleBefore: (r.role_before as string | null) ?? null,
    roleAfter: (r.role_after as string | null) ?? null,
    activeBefore: (r.active_before as boolean | null) ?? null,
    activeAfter: Boolean(r.active_after),
    reason: r.reason as string,
    occurredAt: r.occurred_at as string,
  }));
}

export interface ProvisionInput {
  /** The Supabase auth uid being provisioned. There is NO default: the writer names the uid. */
  officerId: string;
  jurisdictionId: string;
  /** The Omnischools provisioner performing the action. */
  actorId: string;
  /** The SECOND administrator, required for REGION/NATIONAL and distinct from the actor. */
  approverId?: string | null;
  fullName?: string | null;
  workEmail?: string | null;
  /** Why. NOT NULL and default-less in the schema: there is no safe default justification. */
  reason: string;
  source?: string;
  asOfDate?: string;
}

export interface ProvisionResult {
  officerId: string;
  tier: OfficerTier;
  officerRole: string;
  provisioningId: string;
  action: "PROVISION" | "ROLE_CHANGE" | "REACTIVATE";
}

/**
 * Validate the two-person rule in the APP as well as in the database.
 *
 * The CHECK constraint is the guard; this is the error message. A `ck_officer_provisioning_two_person`
 * violation tells an administrator nothing about what to do next, and an operator who cannot tell a
 * missing approver from a database fault reaches for the owner credential — which is the posture the
 * whole separate-provisioner-role design exists to avoid.
 */
export function assertTwoPersonRule(
  tier: OfficerTier,
  actorId: string,
  approverId: string | null | undefined,
): void {
  requireUuid(actorId, "actorId");
  if (!requiresTwoPerson(tier)) return;
  if (!approverId) {
    throw new ProvisioningError(
      `A ${tier}-tier grant requires a second administrator to approve it (Kofi R7). ${tier} officers see ${tier === "NATIONAL" ? "the whole country" : "an entire region"}, so one person cannot grant it alone.`,
    );
  }
  requireUuid(approverId, "approverId");
  if (approverId.toLowerCase() === actorId.toLowerCase()) {
    throw new ProvisioningError(
      "The approver must be a DIFFERENT administrator from the proposer — an approver who is the actor is a rubber stamp with extra steps.",
    );
  }
}

/**
 * PROVISION (or re-provision) an officer, and record it. ONE TRANSACTION, always.
 *
 * Re-provisioning an existing uid is an UPDATE of the directory row plus a new audit row, never an
 * edit of history: the previous state is captured in `role_before` / `active_before`, so the log can
 * answer "what changed" without anything being rewritten. Offboarding is `deactivateOfficer()` —
 * there is deliberately no delete path in this module at all.
 */
export async function provisionOfficer(
  sql: postgres.Sql,
  input: ProvisionInput,
): Promise<ProvisionResult> {
  requireUuid(input.officerId, "officerId");
  requireUuid(input.jurisdictionId, "jurisdictionId");
  if (!input.reason?.trim()) {
    throw new ProvisioningError(
      "A reason is required — the posting letter, directive or decision this provision rests on. There is no safe default justification for granting someone oversight of a district.",
    );
  }

  const tier = await resolveNodeTier(sql, input.jurisdictionId);
  assertTwoPersonRule(tier, input.actorId, input.approverId);
  const officerRole = ROLE_FOR_TIER[tier];

  /*
   * as_of_date is NOT NULL with no default (every ref_* row carries its vintage — Principle 3). A
   * console-driven provision has no file vintage to quote, and the honest answer to "as of when is
   * this true" is the day the decision was taken, so an omitted date becomes current_date inside
   * the INSERT below rather than failing the write. A LOADED row always supplies the file's own
   * as_of_date, which is the vintage that matters when reconciling against a GES HR list.
   */
  return sql.begin(async (tx) => {
    // The previous state, for the audit row's `*_before` columns. Locked FOR UPDATE so a concurrent
    // provisioning of the same uid cannot interleave between the read and the write and leave the
    // log describing a transition that never happened.
    const existing = (await tx`
      select officer_role::text as officer_role, is_active
        from ref_oversight_officer
       where officer_id = ${input.officerId}::uuid
       for update
    `) as unknown as { officer_role: string; is_active: boolean }[];
    const before = existing[0] ?? null;

    const action: ProvisionResult["action"] = !before
      ? "PROVISION"
      : before.is_active
        ? "ROLE_CHANGE"
        : "REACTIVATE";

    await tx`
      insert into ref_oversight_officer
        (officer_id, jurisdiction_id, officer_role, is_active, full_name, work_email, source, as_of_date)
      values (
        ${input.officerId}::uuid,
        ${input.jurisdictionId}::uuid,
        ${officerRole}::ov_officer_role,
        true,
        ${input.fullName ?? null},
        ${input.workEmail ?? null},
        ${input.source ?? "GES_HR_DIRECTORY"},
        coalesce(${input.asOfDate ?? null}::date, current_date)
      )
      on conflict (officer_id) do update set
        jurisdiction_id = excluded.jurisdiction_id,
        officer_role    = excluded.officer_role,
        is_active       = true,
        full_name       = coalesce(excluded.full_name, ref_oversight_officer.full_name),
        work_email      = coalesce(excluded.work_email, ref_oversight_officer.work_email),
        source          = excluded.source,
        as_of_date      = coalesce(excluded.as_of_date, ref_oversight_officer.as_of_date)
    `;

    const audit = (await tx`
      insert into audit_officer_provisioning
        (action, actor_id, approver_id, target_officer_id, target_jurisdiction_id, target_tier,
         role_before, role_after, active_before, active_after, reason)
      values (
        ${action},
        ${input.actorId}::uuid,
        ${input.approverId ?? null}::uuid,
        ${input.officerId}::uuid,
        ${input.jurisdictionId}::uuid,
        ${tier}::jurisdiction_level,
        ${before?.officer_role ?? null},
        ${officerRole},
        ${before?.is_active ?? null},
        true,
        ${input.reason.trim()}
      )
      returning provisioning_id::text as provisioning_id
    `) as unknown as { provisioning_id: string }[];

    return {
      officerId: input.officerId,
      tier,
      officerRole,
      provisioningId: audit[0]!.provisioning_id,
      action,
    };
  }) as unknown as Promise<ProvisionResult>;
}

export interface DeactivateInput {
  officerId: string;
  actorId: string;
  approverId?: string | null;
  reason: string;
}

/**
 * WITHDRAW an officer's access (Lucy G8.c). `is_active = false`, NEVER a delete: a deleted directory
 * row orphans every `audit_access_log` entry attributed to that uid, and five-year-old attribution
 * is the whole reason the id is the auth uid.
 *
 * ⚠ TWO-PERSON ON WITHDRAWAL IS APPLIED (Lucy R11, owner-ratify). Withdrawing a REGION/NATIONAL
 * officer takes a second administrator, symmetrically with granting one. Lucy's map recommends it
 * and flags it as unconfirmed; the asymmetric alternative would mean the control that protects the
 * broadest access can be removed by one person acting alone, which is the wrong default to ship
 * while the question is open. It is a one-line change here if the owner rules the other way.
 */
export async function deactivateOfficer(
  sql: postgres.Sql,
  input: DeactivateInput,
): Promise<{ provisioningId: string; tier: OfficerTier }> {
  requireUuid(input.officerId, "officerId");
  if (!input.reason?.trim()) {
    throw new ProvisioningError(
      "A reason is required for a withdrawal — it is an internal control record (not shown to the officer; Lucy R5).",
    );
  }

  return sql.begin(async (tx) => {
    /*
     * The tier comes from `ov_officer_node_tier()`, NOT from a join to dim_jurisdiction.
     *
     * Wells's note: a provisioner's own reads of the spine need `app.current_level = 'NATIONAL'`
     * because dim_jurisdiction is RLS-scoped like any other table. That GUC is fine for a picker
     * (see `withNationalRead`) but this read decides whether the two-person rule applies, and a
     * correctness-critical value must not depend on the caller having first granted itself national
     * scope — the exact habit the separate provisioner role exists to prevent. The SECURITY DEFINER
     * function is RLS-exempt, so it answers with no GUC set and cannot be made to answer differently
     * by one.
     */
    const existing = (await tx`
      select o.officer_role::text                        as officer_role,
             o.is_active                                 as is_active,
             o.jurisdiction_id::text                     as jurisdiction_id,
             ov_officer_node_tier(o.jurisdiction_id)::text as level
        from ref_oversight_officer o
       where o.officer_id = ${input.officerId}::uuid
       for update
    `) as unknown as {
      officer_role: string;
      is_active: boolean;
      jurisdiction_id: string;
      level: string;
    }[];
    const before = existing[0];
    if (!before) {
      throw new ProvisioningError(
        `No directory row for ${input.officerId} — nothing to withdraw. (A uid that was never provisioned and one that was already withdrawn are different states; this is the former.)`,
      );
    }
    const tier = before.level as OfficerTier;
    assertTwoPersonRule(tier, input.actorId, input.approverId);

    await tx`
      update ref_oversight_officer
         set is_active = false
       where officer_id = ${input.officerId}::uuid
    `;

    const audit = (await tx`
      insert into audit_officer_provisioning
        (action, actor_id, approver_id, target_officer_id, target_jurisdiction_id, target_tier,
         role_before, role_after, active_before, active_after, reason)
      values (
        'DEACTIVATE',
        ${input.actorId}::uuid,
        ${input.approverId ?? null}::uuid,
        ${input.officerId}::uuid,
        ${before.jurisdiction_id}::uuid,
        ${tier}::jurisdiction_level,
        ${before.officer_role},
        ${before.officer_role},
        ${before.is_active},
        false,
        ${input.reason.trim()}
      )
      returning provisioning_id::text as provisioning_id
    `) as unknown as { provisioning_id: string }[];

    return { provisioningId: audit[0]!.provisioning_id, tier };
  }) as unknown as Promise<{ provisioningId: string; tier: OfficerTier }>;
}
