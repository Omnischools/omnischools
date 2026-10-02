import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { adminAnalytics, testDbConfig } from "./helpers";
import { JUR } from "./fixtures/ids";
import { deactivateOfficer, provisionOfficer } from "@/lib/provisioning/officers";

/**
 * SECURITY FINDING S1 — THE DIRECTORY↔AUDIT COUPLING, AS THE DATABASE ENFORCES IT.
 *
 * `ov_officer_directory_audit_guard()` (db/sql/policies.sql, and
 * db/sql/prod-paste-0005-officer-directory.sql for prod) is a DEFERRABLE INITIALLY DEFERRED
 * constraint trigger: at COMMIT, a `ref_oversight_officer` write must be accompanied by an
 * `audit_officer_provisioning` row written in the SAME transaction, for the same officer, the same
 * node, with a coherent `active_after`. That is what finally carries the two-person rule and the
 * append-only history across to the directory — pre-fix a provisioner credential could
 * `insert into ref_oversight_officer ... 'NATIONAL_OVERSIGHT' ...; commit` and hold oversight of
 * every school in Ghana with no actor, no approver and no reason recorded anywhere.
 *
 * ⚠ WHY THIS FILE EXISTS (Wells's gap). The guard shipped with no automated regression test at all:
 * a DB guarantee with no guard is a guarantee that survives exactly until someone edits the file it
 * lives in. Every refusal below is produced by actually COMMITTING a transaction — a deferred check
 * cannot be observed any other way, which is precisely why the statement-level RLS probes in
 * tests/audit-insert-rls.test.ts (which roll back) could not have caught this and did not.
 *
 * Everything runs as `ov_provisioner` — the NON-OWNER role that legitimately holds
 * SELECT+INSERT+UPDATE on the directory. Running as the owner would prove nothing about the posture
 * (and the trigger is deliberately SECURITY INVOKER). The last describe block proves the refusals
 * are attributable to THIS trigger by dropping it, re-running the canonical attack, and watching it
 * commit.
 */

const provisioner = postgres(testDbConfig.provisionerAnalyticsUrl, {
  max: 2,
  prepare: false,
});

afterAll(async () => {
  await provisioner.end({ timeout: 5 });
});

/** A distinct uid block from tests/provisioning-action-binding.test.ts's `…0d` series. */
let counter = 0;
function newUid(): string {
  counter += 1;
  return `6fffffff-0000-4000-8000-0000000c${String(counter).padStart(4, "0")}`;
}

/**
 * Run a transaction as the provisioner and ACTUALLY COMMIT IT. Returns the error message, or null.
 *
 * The commit is the point. `sql.begin()` issues COMMIT when the callback resolves, and that is the
 * statement a DEFERRED constraint trigger raises from — a helper that rolled back (the shape used by
 * the statement-level RLS probes) would report every one of these probes as a pass.
 */
async function commitAttempt(
  fn: (tx: postgres.TransactionSql) => Promise<void>,
): Promise<string | null> {
  try {
    await provisioner.begin(async (tx) => {
      await fn(tx as unknown as postgres.TransactionSql);
    });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** A bare directory write — the attack shape, with NO audit row anywhere. */
async function bareInsert(
  tx: postgres.TransactionSql,
  officerId: string,
  jurisdictionId: string,
  role: string,
): Promise<void> {
  await tx`
    insert into ref_oversight_officer
      (officer_id, jurisdiction_id, officer_role, as_of_date)
    values (${officerId}::uuid, ${jurisdictionId}::uuid,
            ${role}::ov_officer_role, current_date)
  `;
}

/** One audit row, written by hand so a probe can make it disagree with the directory row. */
async function auditRow(
  tx: postgres.TransactionSql,
  row: {
    action: string;
    targetOfficerId: string;
    targetJurisdictionId: string;
    targetTier: string;
    activeAfter: boolean;
    approverId?: string | null;
  },
): Promise<void> {
  await tx`
    insert into audit_officer_provisioning
      (action, actor_id, approver_id, target_officer_id, target_jurisdiction_id,
       target_tier, role_after, active_after, reason)
    values (
      ${row.action},
      ${ACTOR}::uuid,
      ${row.approverId ?? null}::uuid,
      ${row.targetOfficerId}::uuid,
      ${row.targetJurisdictionId}::uuid,
      ${row.targetTier}::jurisdiction_level,
      'DISTRICT_OVERSIGHT',
      ${row.activeAfter},
      'S1 coupling probe'
    )
  `;
}

const ACTOR = "90000000-0000-4000-8000-00000000000a";
const APPROVER = "90000000-0000-4000-8000-00000000000b";

const NO_AUDIT_ROW = /has no audit_officer_provisioning row in this transaction/;

async function directoryRow(officerId: string) {
  const rows = (await provisioner`
    select officer_id::text      as officer_id,
           jurisdiction_id::text as jurisdiction_id,
           officer_role::text    as officer_role,
           is_active             as is_active,
           full_name             as full_name
      from ref_oversight_officer
     where officer_id = ${officerId}::uuid
  `) as unknown as {
    officer_id: string;
    jurisdiction_id: string;
    officer_role: string;
    is_active: boolean;
    full_name: string | null;
  }[];
  return rows[0] ?? null;
}

async function auditRowsFor(officerId: string) {
  return (await provisioner`
    select action, target_jurisdiction_id::text as target_jurisdiction_id,
           target_tier::text as target_tier, active_after, approver_id::text as approver_id,
           occurred_at::text as occurred_at
      from audit_officer_provisioning
     where target_officer_id = ${officerId}::uuid
     order by occurred_at asc
  `) as unknown as {
    action: string;
    target_jurisdiction_id: string;
    target_tier: string;
    active_after: boolean;
    approver_id: string | null;
    occurred_at: string;
  }[];
}

// ─── the hole itself: a directory write nobody signed for ────────────────────────────────────────

describe("a ref_oversight_officer write with NO audit row does not commit (S1)", () => {
  it("REFUSES the canonical attack — a bare NATIONAL insert, committed", async () => {
    const uid = newUid();
    const error = await commitAttempt(async (tx) => {
      await bareInsert(tx, uid, JUR.national, "NATIONAL_OVERSIGHT");
    });
    expect(error).toMatch(NO_AUDIT_ROW);
    // …and the transaction took the row down with it. No national officer exists.
    expect(await directoryRow(uid)).toBeNull();
  });

  it("…at DISTRICT too — the coupling is about attribution, not about the tier", async () => {
    // DISTRICT is single-signature, so no CHECK constraint would ever have fired here. If the
    // coupling were only about the two-person rule this case would be permitted; it is not.
    const uid = newUid();
    const error = await commitAttempt(async (tx) => {
      await bareInsert(tx, uid, JUR.district, "DISTRICT_OVERSIGHT");
    });
    expect(error).toMatch(NO_AUDIT_ROW);
    expect(await directoryRow(uid)).toBeNull();
  });

  it("the INSERT STATEMENT SUCCEEDS and the COMMIT is what refuses — it is a DEFERRED check", async () => {
    // Load-bearing, not trivia. The legitimate writers insert the directory row FIRST and the audit
    // row SECOND (provisionOfficer reads role_before off the directory and lets `on conflict`
    // decide the action), so a before/after ROW trigger would refuse every correct write. This
    // asserts the check really is at commit, which is the only place the question
    // "did this transaction also record what it did" can be asked.
    const uid = newUid();
    let visibleInsideTx: unknown = "not read";
    const error = await commitAttempt(async (tx) => {
      await bareInsert(tx, uid, JUR.region, "REGIONAL_OVERSIGHT");
      const seen = (await tx`
        select officer_id::text as officer_id from ref_oversight_officer
         where officer_id = ${uid}::uuid
      `) as unknown as { officer_id: string }[];
      visibleInsideTx = seen[0]?.officer_id;
    });
    expect(visibleInsideTx).toBe(uid); // the statement itself was accepted
    expect(error).toMatch(NO_AUDIT_ROW); // the COMMIT was not
    expect(await directoryRow(uid)).toBeNull();
  });

  it("`set constraints all immediate` does NOT dodge it — it only makes it fire sooner", async () => {
    // policies.sql claims this; nothing checked it. IMMEDIATE can make a deferred check happen
    // earlier, never not happen, so the one thing a caller can do to this guard by hand is make it
    // stricter against themselves.
    const uid = newUid();
    const error = await commitAttempt(async (tx) => {
      await tx`set constraints all immediate`;
      await bareInsert(tx, uid, JUR.national, "NATIONAL_OVERSIGHT");
    });
    expect(error).toMatch(NO_AUDIT_ROW);
    expect(await directoryRow(uid)).toBeNull();
  });
});

// ─── a nearby audit row is not the same as a matching one ────────────────────────────────────────

describe("an audit row for a DIFFERENT officer or node does not satisfy the coupling", () => {
  it("REFUSES a directory row for officer A paired with an audit row about officer B", async () => {
    const victim = newUid();
    const alibi = newUid();
    const error = await commitAttempt(async (tx) => {
      await bareInsert(tx, victim, JUR.district, "DISTRICT_OVERSIGHT");
      // A perfectly valid, perfectly committed audit row — about somebody else.
      await auditRow(tx, {
        action: "PROVISION",
        targetOfficerId: alibi,
        targetJurisdictionId: JUR.district,
        targetTier: "DISTRICT",
        activeAfter: true,
      });
    });
    expect(error).toMatch(NO_AUDIT_ROW);
    expect(error).toContain(victim); // the message names the row that failed
    expect(await directoryRow(victim)).toBeNull();
  });

  it("REFUSES the TIER DODGE — a NATIONAL directory row with a DISTRICT audit row", async () => {
    // This is the exact path by which the two-person rule used to be skippable. The audit row is
    // for the right officer and is itself legal (DISTRICT is single-signature, so
    // ck_officer_provisioning_two_person demands no approver and
    // ov_officer_provisioning_tier_guard is satisfied by the district node it names) — yet the
    // directory row being created is NATIONAL. The node clause is what refuses it, and refusing it
    // is what forces the national grant through an audit row that must name an approver.
    const uid = newUid();
    const error = await commitAttempt(async (tx) => {
      await bareInsert(tx, uid, JUR.national, "NATIONAL_OVERSIGHT");
      await auditRow(tx, {
        action: "PROVISION",
        targetOfficerId: uid,
        targetJurisdictionId: JUR.district,
        targetTier: "DISTRICT",
        activeAfter: true,
      });
    });
    expect(error).toMatch(NO_AUDIT_ROW);
    expect(await directoryRow(uid)).toBeNull();

    // And the honest version of the same write STILL needs the second signature: name the national
    // node in the audit row and the two-person CHECK is what refuses it now.
    const unapproved = await commitAttempt(async (tx) => {
      await bareInsert(tx, uid, JUR.national, "NATIONAL_OVERSIGHT");
      await auditRow(tx, {
        action: "PROVISION",
        targetOfficerId: uid,
        targetJurisdictionId: JUR.national,
        targetTier: "NATIONAL",
        activeAfter: true,
        approverId: null,
      });
    });
    expect(unapproved).toMatch(/ck_officer_provisioning_two_person/);
    expect(await directoryRow(uid)).toBeNull();
  });

  it("REFUSES an INCOHERENT audit row — the log must describe the state the directory holds", async () => {
    // A live directory row (is_active defaults true) beside a DEACTIVATE/active_after=false record.
    // Without the active_after clause a withdrawal would be satisfiable by that same transaction's
    // PROVISION row, and a reactivation by a DEACTIVATE row.
    const uid = newUid();
    const error = await commitAttempt(async (tx) => {
      await bareInsert(tx, uid, JUR.district, "DISTRICT_OVERSIGHT");
      await auditRow(tx, {
        action: "DEACTIVATE",
        targetOfficerId: uid,
        targetJurisdictionId: JUR.district,
        targetTier: "DISTRICT",
        activeAfter: false,
      });
    });
    expect(error).toMatch(NO_AUDIT_ROW);
    expect(await directoryRow(uid)).toBeNull();
  });
});

// ─── the half that matters: a STALE audit row is not this transaction's ──────────────────────────

describe("a PREVIOUS transaction's audit row does not satisfy a new directory write", () => {
  it("REFUSES a bare UPDATE of an already-provisioned officer (same officer, same node, same state)", async () => {
    // The purest staleness probe. After a legitimate provision there IS an audit row matching this
    // officer, this node and this `is_active` on every clause EXCEPT
    // `occurred_at = transaction_timestamp()`. Drop that one clause and this write commits — which
    // is how a sitting officer gets quietly edited with no record.
    const uid = newUid();
    await provisionOfficer(provisioner, {
      officerId: uid,
      jurisdictionId: JUR.district,
      actorId: ACTOR,
      reason: "the legitimate original grant",
    });
    const before = await auditRowsFor(uid);
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({
      target_jurisdiction_id: JUR.district,
      active_after: true,
    });

    const error = await commitAttempt(async (tx) => {
      await tx`
        update ref_oversight_officer set full_name = 'quietly renamed'
         where officer_id = ${uid}::uuid
      `;
    });
    expect(error).toMatch(NO_AUDIT_ROW);
    // Unchanged, and no new history was written.
    expect(await directoryRow(uid)).toMatchObject({ full_name: null });
    expect(await auditRowsFor(uid)).toHaveLength(1);
  });

  it("REFUSES a bare RE-GRANT — moving a sitting district officer to the national node", async () => {
    const uid = newUid();
    await provisionOfficer(provisioner, {
      officerId: uid,
      jurisdictionId: JUR.district,
      actorId: ACTOR,
      reason: "district director",
    });

    const error = await commitAttempt(async (tx) => {
      await tx`
        update ref_oversight_officer
           set jurisdiction_id = ${JUR.national}::uuid,
               officer_role    = 'NATIONAL_OVERSIGHT'
         where officer_id = ${uid}::uuid
      `;
    });
    expect(error).toMatch(NO_AUDIT_ROW);
    expect(await directoryRow(uid)).toMatchObject({
      jurisdiction_id: JUR.district,
      officer_role: "DISTRICT_OVERSIGHT",
    });
  });

  it("REFUSES a bare REACTIVATION of a withdrawn officer", async () => {
    const uid = newUid();
    await provisionOfficer(provisioner, {
      officerId: uid,
      jurisdictionId: JUR.district,
      actorId: ACTOR,
      reason: "district director",
    });
    await deactivateOfficer(provisioner, {
      officerId: uid,
      actorId: ACTOR,
      reason: "transferred out",
    });
    expect(await directoryRow(uid)).toMatchObject({ is_active: false });

    const error = await commitAttempt(async (tx) => {
      await tx`
        update ref_oversight_officer set is_active = true
         where officer_id = ${uid}::uuid
      `;
    });
    expect(error).toMatch(NO_AUDIT_ROW);
    expect(await directoryRow(uid)).toMatchObject({ is_active: false });
  });

  it("REFUSES an audit row that BACKDATES itself past the same-transaction tie", async () => {
    // The documented operational consequence, asserted: a writer who supplies `occurred_at`
    // explicitly instead of letting it default cannot prove this transaction wrote it.
    const uid = newUid();
    const error = await commitAttempt(async (tx) => {
      await bareInsert(tx, uid, JUR.district, "DISTRICT_OVERSIGHT");
      await tx`
        insert into audit_officer_provisioning
          (action, actor_id, target_officer_id, target_jurisdiction_id, target_tier,
           role_after, active_after, reason, occurred_at)
        values ('PROVISION', ${ACTOR}::uuid, ${uid}::uuid, ${JUR.district}::uuid,
                'DISTRICT', 'DISTRICT_OVERSIGHT', true, 'backdated import',
                now() - interval '1 day')
      `;
    });
    expect(error).toMatch(NO_AUDIT_ROW);
    expect(await directoryRow(uid)).toBeNull();
  });
});

// ─── and the legitimate writer is not collateral damage ──────────────────────────────────────────

describe("the legitimate two-row transaction COMMITS", () => {
  it("provisionOfficer writes the directory row and its audit row, and commits", async () => {
    const uid = newUid();
    const result = await provisionOfficer(provisioner, {
      officerId: uid,
      jurisdictionId: JUR.national,
      actorId: ACTOR,
      approverId: APPROVER,
      reason: "national oversight desk — approved by a second administrator",
    });
    expect(result).toMatchObject({ action: "PROVISION", tier: "NATIONAL" });
    expect(await directoryRow(uid)).toMatchObject({
      jurisdiction_id: JUR.national,
      officer_role: "NATIONAL_OVERSIGHT",
      is_active: true,
    });
    const audit = await auditRowsFor(uid);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "PROVISION",
      target_jurisdiction_id: JUR.national,
      target_tier: "NATIONAL",
      active_after: true,
      approver_id: APPROVER,
    });
  });

  it("ROLE_CHANGE, REACTIVATE and DEACTIVATE all still commit through the module", async () => {
    const uid = newUid();
    await provisionOfficer(provisioner, {
      officerId: uid,
      jurisdictionId: JUR.district,
      actorId: ACTOR,
      reason: "district director",
    });
    // ROLE_CHANGE: a re-provision at a different node, which is the UPDATE path.
    const moved = await provisionOfficer(provisioner, {
      officerId: uid,
      jurisdictionId: JUR.region,
      actorId: ACTOR,
      approverId: APPROVER,
      reason: "promoted to regional director",
    });
    expect(moved).toMatchObject({ action: "ROLE_CHANGE", tier: "REGION" });

    await deactivateOfficer(provisioner, {
      officerId: uid,
      actorId: ACTOR,
      approverId: APPROVER,
      reason: "retired",
    });
    expect(await directoryRow(uid)).toMatchObject({ is_active: false });

    const reactivated = await provisionOfficer(provisioner, {
      officerId: uid,
      jurisdictionId: JUR.region,
      actorId: ACTOR,
      approverId: APPROVER,
      reason: "recalled to post",
    });
    expect(reactivated.action).toBe("REACTIVATE");
    expect(await directoryRow(uid)).toMatchObject({ is_active: true });

    // Four actions, four records, nothing rewritten.
    expect((await auditRowsFor(uid)).map((r) => r.action)).toEqual([
      "PROVISION",
      "ROLE_CHANGE",
      "DEACTIVATE",
      "REACTIVATE",
    ]);
  });
});

// ─── is this trigger the thing doing the work? ───────────────────────────────────────────────────

const POLICIES_SQL = join(process.cwd(), "db/sql/policies.sql");
const PROD_PASTE_SQL = join(
  process.cwd(),
  "db/sql/prod-paste-0005-officer-directory.sql",
);

const GUARD_FN_RE =
  /create or replace function ov_officer_directory_audit_guard\(\)[\s\S]*?end \$\$;/i;
const GUARD_TRIGGER_RE =
  /create constraint trigger officer_directory_audit_guard[\s\S]*?;/i;

function extract(file: string, re: RegExp): string {
  const match = readFileSync(file, "utf8").match(re);
  if (!match) throw new Error(`${file} no longer contains ${re}`);
  return match[0];
}

/** Comments and case/whitespace differ between the two files by house style; the SQL must not. */
function normalise(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

describe("the refusals above are attributable to THIS trigger", () => {
  it("is installed as a DEFERRABLE INITIALLY DEFERRED constraint trigger on the directory", async () => {
    // Not cosmetic: a non-constraint trigger cannot defer, so this metadata IS the "fires at commit"
    // property the whole design rests on. Re-installing it as a plain AFTER trigger would refuse
    // every legitimate provision instead, and someone would then delete it.
    const rows = (await provisioner`
      select t.tgname,
             t.tgconstraint <> 0 as is_constraint_trigger,
             t.tgdeferrable, t.tginitdeferred, t.tgenabled::text as tgenabled,
             p.proname::text as function_name,
             p.prosecdef as is_security_definer
        from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        join pg_proc p  on p.oid = t.tgfoid
       where c.relname = 'ref_oversight_officer'
         and t.tgname  = 'officer_directory_audit_guard'
    `) as unknown as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      is_constraint_trigger: true,
      tgdeferrable: true,
      tginitdeferred: true,
      tgenabled: "O", // enabled for ORIGIN — i.e. actually on
      function_name: "ov_officer_directory_audit_guard",
      // SECURITY INVOKER by design: a writer who cannot READ the provisioning log must not be able
      // to satisfy the coupling with a row it cannot see. A `true` here is a finding.
      is_security_definer: false,
    });
  });

  it("DROP THE TRIGGER AND THE HOLE IS BACK — so this file is what is holding it shut", async () => {
    // The discrimination check, run in-suite rather than taken on trust. Without it every assertion
    // above could be passing for some unrelated reason (a missing grant, an RLS policy, the
    // directory guard) and nobody would know the coupling had been removed.
    const owner = adminAnalytics();
    const uid = newUid();
    try {
      await owner.unsafe(
        "drop trigger if exists officer_directory_audit_guard on ref_oversight_officer",
      );

      const withoutGuard = await commitAttempt(async (tx) => {
        await bareInsert(tx, uid, JUR.national, "NATIONAL_OVERSIGHT");
      });
      // Sarah's finding, reproduced: a NATIONAL officer, committed, with no audit row at all.
      expect(withoutGuard).toBeNull();
      expect(await directoryRow(uid)).toMatchObject({
        jurisdiction_id: JUR.national,
        officer_role: "NATIONAL_OVERSIGHT",
      });
      expect(await auditRowsFor(uid)).toHaveLength(0);
    } finally {
      // Clean up the unattributable row (the provisioner has no DELETE grant — by design) and put
      // the guard back from policies.sql itself, so this test cannot leave the database weakened and
      // cannot drift from the real DDL.
      await owner.unsafe(
        `delete from ref_oversight_officer where officer_id = '${uid}'`,
      );
      await owner.unsafe(extract(POLICIES_SQL, GUARD_TRIGGER_RE));
      await owner.end({ timeout: 5 });
    }

    // Restored, and refusing again.
    const restored = await commitAttempt(async (tx) => {
      await bareInsert(tx, newUid(), JUR.national, "NATIONAL_OVERSIGHT");
    });
    expect(restored).toMatch(NO_AUDIT_ROW);
  });

  it("…and PROD gets the same guard — policies.sql and prod-paste-0005 do not drift", async () => {
    // The harness applies policies.sql ONLY, so every assertion in this file is silent about prod.
    // These two files are maintained by hand in parallel; comparing the normalised SQL is what makes
    // the coverage above mean something for the database that matters.
    expect(normalise(extract(PROD_PASTE_SQL, GUARD_FN_RE))).toBe(
      normalise(extract(POLICIES_SQL, GUARD_FN_RE)),
    );
    expect(normalise(extract(PROD_PASTE_SQL, GUARD_TRIGGER_RE))).toBe(
      normalise(extract(POLICIES_SQL, GUARD_TRIGGER_RE)),
    );
  });
});
