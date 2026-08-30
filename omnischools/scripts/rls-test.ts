import { config } from "dotenv";
import postgres from "postgres";

/**
 * Proves tenant isolation across EVERY tenant table.
 *
 * As the non-superuser app role (`omnischools_app`):
 *   - scoped to the seeded school  → its own rows are visible,
 *   - scoped to a foreign school id → zero rows,
 *   - unscoped (GUC never set)      → zero rows.
 *
 * Tenant tables are discovered dynamically (every `public` table with a `school_id`
 * column and FORCE RLS), so a newly-added tenant table is covered automatically — a
 * table that ships without the isolation policy makes this test fail loudly.
 *
 * Exits non-zero on any failed assertion.
 */
config({ path: ".env.local" });

const url =
  process.env.DATABASE_URL ??
  "postgresql://omnischools:omnischools@localhost:55432/omnischools_dev";

const FOREIGN_ID = "00000000-0000-0000-0000-0000000000ff";

/**
 * Liveness floor for the scoped direction: when the GUC names your school you must SEE your rows,
 * so the policy is not a blanket deny.
 *
 * These are MINIMUMS, deliberately not exact counts. An exact count here asserts SEED SHAPE, not
 * isolation — and every legitimate seed that adds a row (INCR-21's two MATRON assignments, a new
 * academic period) turns this script permanently red, at which point a real isolation regression
 * hides among the standing failures. Isolation itself is proven by the two directions below, which
 * stay EXACT: a foreign school id and an unset GUC must both return ZERO. A widened policy
 * (`USING (true)`, a dropped tenant_isolation, a table shipped without FORCE) shows up there —
 * verified by breaking one on purpose and watching this script go red.
 */
const MIN_OWN_ROWS: Record<string, number> = {
  academic_period: 2,
  ref_school_product: 1,
  role_assignment: 6,
};

let failures = 0;
function assert(label: string, actual: number, expected: number) {
  const ok = actual === expected;
  console.log(`${ok ? "✓" : "✗"} ${label}: got ${actual}, expected ${expected}`);
  if (!ok) failures++;
}
function assertAtLeast(label: string, actual: number, min: number) {
  const ok = actual >= min;
  console.log(`${ok ? "✓" : "✗"} ${label}: got ${actual}, expected ≥ ${min}`);
  if (!ok) failures++;
}
function assertTrue(label: string, ok: boolean) {
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (!ok) failures++;
}

async function main() {
  const sql = postgres(url, { max: 1 });
  try {
    // Discover every tenant table (school_id column + FORCE RLS), as the connecting role.
    const discovered = await sql<{ t: string }[]>`
      select c.relname as t
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      where c.relkind = 'r'
        and c.relforcerowsecurity
        and exists (
          select 1 from information_schema.columns col
          where col.table_schema = 'public'
            and col.table_name = c.relname
            and col.column_name = 'school_id'
        )
      order by c.relname`;
    const TABLES = discovered.map((r) => r.t);
    if (TABLES.length === 0) throw new Error("No tenant tables discovered — is RLS applied?");
    console.log(`Discovered ${TABLES.length} tenant tables.\n`);

    const rows = await sql`select id from ref_school where ges_code = 'WR-WAW-014'`;
    if (rows.length === 0) throw new Error("Seed missing — run db:seed first.");
    const schoolId = rows[0].id as string;

    // Scoped to the real school → own rows visible. Track the total to prove the
    // policy isn't a blanket deny (at least some rows must be visible when scoped).
    let ownTotal = 0;
    await sql.begin(async (tx) => {
      await tx`set local role omnischools_app`;
      await tx`select set_config('app.current_school', ${schoolId}, true)`;
      for (const t of TABLES) {
        const [{ n }] = await tx`select count(*)::int as n from ${tx(t)}`;
        ownTotal += n;
        if (t in MIN_OWN_ROWS) assertAtLeast(`${t} (own)`, n, MIN_OWN_ROWS[t]);
      }
      // ref_school is keyed on `id` (not school_id) — its own row must be visible.
      const [{ n }] = await tx`select count(*)::int as n from ref_school`;
      assert("ref_school (own)", n, 1);
    });
    assertAtLeast("scoped session sees data (sum over tenant tables)", ownTotal, 1);

    // Scoped to a foreign id → zero rows on every tenant table (and ref_school).
    await sql.begin(async (tx) => {
      await tx`set local role omnischools_app`;
      await tx`select set_config('app.current_school', ${FOREIGN_ID}, true)`;
      for (const t of TABLES) {
        const [{ n }] = await tx`select count(*)::int as n from ${tx(t)}`;
        assert(`${t} (foreign)`, n, 0);
      }
      const [{ n }] = await tx`select count(*)::int as n from ref_school`;
      assert("ref_school (foreign)", n, 0);
    });

    // Unscoped (GUC never set) → zero rows everywhere (fail-closed).
    await sql.begin(async (tx) => {
      await tx`set local role omnischools_app`;
      for (const t of TABLES) {
        const [{ n }] = await tx`select count(*)::int as n from ${tx(t)}`;
        assert(`${t} (unscoped)`, n, 0);
      }
      const [{ n }] = await tx`select count(*)::int as n from ref_school`;
      assert("ref_school (unscoped)", n, 0);
    });

    // ---------------------------------------------------------------------------------------------
    // Parent Communications WRITE path — BEHAVIORAL RLS probe (Quinn MAJOR: the tenant-isolation
    // loop above is shape-only; it can't catch a write that the superuser dev DB silently masks).
    //
    // A parent posts an INBOUND reply then calls parent_bump_conversation() to advance the thread's
    // last_message_at + reopen a CLOSED thread. A naive direct `UPDATE conversation` inside the parent
    // session hits parent_no_update → 0 ROWS SILENTLY on prod (staff never see the reply's unread /
    // recency signal); the SECURITY DEFINER bump fn is the fix. This probe proves the fix LANDS while
    // every forbidden write stays denied.
    //
    // 🔴 Run under PROD-SHAPED ownership: the fn owner is switched to the non-superuser omnischools_app
    // so FORCE RLS actually binds the SECURITY DEFINER body. A superuser owner (the dev default) would
    // bypass RLS inside the fn and MASK a regression — the very trap this task exists to close. All test
    // rows AND the owner switch live in one transaction that is rolled back, so nothing persists.
    console.log("\nParent Communications write path (behavioral):");
    const parentRows = await sql<{ id: string }[]>`select id from ref_user limit 1`;
    const kids = await sql<{ id: string }[]>`
      select id from students where school_id = ${schoolId} order by id limit 2`;
    if (parentRows.length < 1 || kids.length < 2) {
      console.log("• skipped — needs ≥1 ref_user and ≥2 students in the seeded school.");
    } else {
      const parent = parentRows[0].id;
      const ownChild = kids[0].id;
      const otherChild = kids[1].id; // a real child in the SAME school, NOT linked to this parent
      const ownThread = "aaaaaaaa-0000-4000-8000-00000000a001";
      const otherThread = "bbbbbbbb-0000-4000-8000-00000000b002";
      const OLD = "2020-01-01T00:00:00.000Z";
      const ROLLBACK = "__parent_comms_probe_rollback__";
      try {
        await sql.begin(async (tx) => {
          // ---- superuser setup (seeded owner bypasses RLS) ----
          await tx`insert into student_guardian
                     (id, school_id, student_id, name, relationship, phone, is_primary, user_id)
                   values (gen_random_uuid(), ${schoolId}, ${ownChild}, 'RLSTEST', 'MOTHER',
                           '+233RLSTEST01', true, ${parent})`;
          await tx`insert into conversation
                     (id, school_id, contact_phone, student_id, status, channel,
                      last_message_at, created_at, read_at, assigned_to_user_id, topic)
                   values (${ownThread}, ${schoolId}, '+233RLSTEST01', ${ownChild}, 'CLOSED', 'sms',
                           ${OLD}, now(), ${OLD}, ${parent}, 'FEES')`;
          await tx`insert into conversation
                     (id, school_id, contact_phone, student_id, status, channel, last_message_at, created_at)
                   values (${otherThread}, ${schoolId}, '+233OTHER02', ${otherChild}, 'CLOSED', 'sms',
                           ${OLD}, now())`;
          // prod-shape: definer owner = the non-superuser role subject to FORCE RLS
          await tx`alter function parent_bump_conversation(uuid) owner to omnischools_app`;

          // ---- act as the parent (RLS enforced) ----
          await tx`set local role omnischools_app`;
          await tx`select set_config('app.current_school', ${schoolId}, true)`;
          await tx`select set_config('app.current_parent_user', ${parent}, true)`;

          // (a) INBOUND reply into own thread → allowed + attributed to the parent
          await tx`insert into inbox_message
                     (id, school_id, conversation_id, direction, body, sent_by_user_id, created_at)
                   values (gen_random_uuid(), ${schoolId}, ${ownThread}, 'INBOUND', 'RLSTEST reply',
                           ${parent}, now())`;
          const [msg] = await tx<{ direction: string; sent_by_user_id: string }[]>`
            select direction, sent_by_user_id from inbox_message where body = 'RLSTEST reply'`;
          assertTrue("parent reply row is INBOUND", msg?.direction === "INBOUND");
          assertTrue("parent reply attributed to the parent", msg?.sent_by_user_id === parent);

          // (d) OUTBOUND insert → denied (savepoint so the expected RLS error doesn't poison the tx)
          let outboundDenied = false;
          try {
            await tx.savepoint(async (sp) => {
              await sp`insert into inbox_message
                         (id, school_id, conversation_id, direction, body, sent_by_user_id, created_at)
                       values (gen_random_uuid(), ${schoolId}, ${ownThread}, 'OUTBOUND', 'RLSTEST forge',
                               ${parent}, now())`;
            });
          } catch {
            outboundDenied = true;
          }
          assertTrue("parent OUTBOUND insert denied", outboundDenied);

          // (d) direct parent UPDATE conversation → denied (0 rows: the very bug a naive action hits)
          const upd = await tx`update conversation set last_message_at = now() where id = ${ownThread}`;
          assert("parent direct conversation UPDATE denied (rows)", upd.count, 0);

          // (b) the bump fn LANDS: last_message_at advances + CLOSED → OPEN
          const [before] = await tx<{ lma: Date }[]>`
            select last_message_at as lma from conversation where id = ${ownThread}`;
          await tx`select parent_bump_conversation(${ownThread})`;
          const [after] = await tx<{ lma: Date; status: string }[]>`
            select last_message_at as lma, status from conversation where id = ${ownThread}`;
          assertTrue("bump advances last_message_at", after.lma > before.lma);
          assertTrue("bump reopens the CLOSED thread", after.status === "OPEN");

          // (c) bump on another child's thread → no-op (still 2020, read as superuser)
          await tx`select parent_bump_conversation(${otherThread})`;
          await tx`reset role`;
          const [other] = await tx<{ lma: Date }[]>`
            select last_message_at as lma from conversation where id = ${otherThread}`;
          assertTrue(
            "out-of-scope bump is a no-op",
            other.lma.getTime() === new Date(OLD).getTime(),
          );

          // (d) parent DELETE → denied (0 rows)
          await tx`set local role omnischools_app`;
          const del = await tx`delete from inbox_message where conversation_id = ${ownThread}`;
          assert("parent inbox_message DELETE denied (rows)", del.count, 0);

          throw new Error(ROLLBACK); // discard all probe rows + the owner switch
        });
      } catch (e) {
        if ((e as Error).message !== ROLLBACK) throw e;
      }
    }

    // ---------------------------------------------------------------------------------------------
    // Parent BILLING (read-only) — BEHAVIORAL RLS probe (INCR — parent Billing tab, prod-paste-0095).
    //
    // Billing is the FIRST parent_scope that is STRUCTURALLY read-only: forging a `payment` (marking
    // fees paid) or an `invoice` is the high-value attack, so unlike the FOR-ALL parent_scope tables
    // the four billing tables use `parent_scope AS RESTRICTIVE FOR SELECT` + parent_no_insert/update/
    // delete. This probe proves — as the NON-SUPERUSER omnischools_app (the dev superuser masks RLS) —
    // that a parent READS own-child invoice/line_item/payment/receipt, sees 0 for another child / a
    // foreign tenant, and can NEVER INSERT/UPDATE/DELETE invoice or payment. All rows are set up as the
    // seeded (superuser) owner, then acted on as omnischools_app, in one rolled-back transaction.
    console.log("\nParent Billing read-only path (behavioral):");
    const bParentRows = await sql<{ id: string }[]>`select id from ref_user limit 1`;
    const bKids = await sql<{ id: string }[]>`
      select id from students where school_id = ${schoolId} order by id limit 2`;
    if (bParentRows.length < 1 || bKids.length < 2) {
      console.log("• skipped — needs ≥1 ref_user and ≥2 students in the seeded school.");
    } else {
      const bParent = bParentRows[0].id;
      const bOwn = bKids[0].id;
      const bOther = bKids[1].id; // a real child in the SAME school, NOT linked to this parent
      const ownInv = "aaaaaaaa-0000-4000-8000-0000000c1001";
      const othInv = "bbbbbbbb-0000-4000-8000-0000000c2002";
      const ownPay = "cccccccc-0000-4000-8000-0000000c3003";
      const othPay = "dddddddd-0000-4000-8000-0000000c4004";
      const ROLLBACK_B = "__parent_billing_probe_rollback__";
      try {
        await sql.begin(async (tx) => {
          // ---- superuser setup ----
          await tx`insert into student_guardian
                     (id, school_id, student_id, name, relationship, phone, is_primary, user_id)
                   values (gen_random_uuid(), ${schoolId}, ${bOwn}, 'RLSTEST', 'MOTHER',
                           '+233RLSTESTB1', true, ${bParent})`;
          for (const [inv, kid, num, pay] of [
            [ownInv, bOwn, "RLST-OWN", ownPay],
            [othInv, bOther, "RLST-OTH", othPay],
          ] as const) {
            await tx`insert into invoice
                       (id, school_id, student_id, invoice_number, academic_year,
                        subtotal_amount, billed_amount, balance_amount)
                     values (${inv}, ${schoolId}, ${kid}, ${num}, '2025/26', 300, 300, 300)`;
            await tx`insert into invoice_line_item (id, school_id, invoice_id, description, amount)
                     values (gen_random_uuid(), ${schoolId}, ${inv}, 'Tuition', 300)`;
            await tx`insert into payment (id, school_id, student_id, gross_amount, net_amount, method)
                     values (${pay}, ${schoolId}, ${kid}, 100, 100, 'CASH')`;
            await tx`insert into receipt (id, school_id, payment_id, receipt_number, student_id)
                     values (gen_random_uuid(), ${schoolId}, ${pay}, ${"RCPT-" + pay.slice(0, 6)}, ${kid})`;
          }

          // ---- act as the parent (RLS enforced, non-superuser) ----
          await tx`set local role omnischools_app`;
          await tx`select set_config('app.current_school', ${schoolId}, true)`;
          await tx`select set_config('app.current_parent_user', ${bParent}, true)`;

          // own-child READ works (all four tables)
          const c = async (t: string, w: string) =>
            (await tx.unsafe(`select count(*)::int n from ${t} ${w}`))[0].n as number;
          assert("parent reads own invoice", await c("invoice", `where id='${ownInv}'`), 1);
          assert("parent reads own line_item", await c("invoice_line_item", `where invoice_id='${ownInv}'`), 1);
          assert("parent reads own payment", await c("payment", `where id='${ownPay}'`), 1);
          assert("parent reads own receipt", await c("receipt", `where payment_id='${ownPay}'`), 1);

          // cross-CHILD (same school, not linked) → 0 (all four)
          assert("parent CANNOT read other-child invoice", await c("invoice", `where id='${othInv}'`), 0);
          assert("parent CANNOT read other-child line_item", await c("invoice_line_item", `where invoice_id='${othInv}'`), 0);
          assert("parent CANNOT read other-child payment", await c("payment", `where id='${othPay}'`), 0);
          assert("parent CANNOT read other-child receipt", await c("receipt", `where payment_id='${othPay}'`), 0);

          // WRITE DENIAL on invoice + payment — the read-only proof (savepoint so the RLS error can't poison the tx)
          const insDenied = async (label: string, stmt: string) => {
            let denied = false;
            try {
              await tx.savepoint(async (sp) => {
                await sp.unsafe(stmt);
              });
            } catch {
              denied = true;
            }
            assertTrue(label, denied);
          };
          await insDenied(
            "parent INSERT invoice denied",
            `insert into invoice (id, school_id, student_id, invoice_number, academic_year, subtotal_amount, billed_amount, balance_amount)
               values (gen_random_uuid(), '${schoolId}', '${bOwn}', 'FORGE-INV', '2025/26', 1, 1, 1)`,
          );
          await insDenied(
            "parent INSERT payment denied (fees-paid forge)",
            `insert into payment (id, school_id, student_id, gross_amount, net_amount, method)
               values (gen_random_uuid(), '${schoolId}', '${bOwn}', 999, 999, 'CASH')`,
          );
          assert("parent UPDATE invoice denied (rows)", (await tx`update invoice set paid_amount=300 where id=${ownInv}`).count, 0);
          assert("parent UPDATE payment denied (rows)", (await tx`update payment set net_amount=1 where id=${ownPay}`).count, 0);
          assert("parent DELETE invoice denied (rows)", (await tx`delete from invoice where id=${ownInv}`).count, 0);
          assert("parent DELETE payment denied (rows)", (await tx`delete from payment where id=${ownPay}`).count, 0);

          // cross-TENANT: a parent scoped to a FOREIGN school sees 0 of their own child's rows
          await tx`select set_config('app.current_school', ${FOREIGN_ID}, true)`;
          assert("parent in foreign tenant reads 0 invoices", await c("invoice", `where id='${ownInv}'`), 0);
          assert("parent in foreign tenant reads 0 payments", await c("payment", `where id='${ownPay}'`), 0);

          throw new Error(ROLLBACK_B); // discard all probe rows
        });
      } catch (e) {
        if ((e as Error).message !== ROLLBACK_B) throw e;
      }
    }

    // ---------------------------------------------------------------------------------------------
    // Parent House-PTA relabel — BEHAVIORAL RLS probe (INCR-58 R483/R484, prod-paste-0096).
    //
    // parent_house_names() is a SECURITY DEFINER helper that reads `house` (a parent_deny table) to give
    // the parent portal the NAME of their OWN children's houses so it can relabel the generic "House PTA".
    // On PROD the definer owner is a NON-SUPERUSER bound by FORCE RLS, so the ORIGINAL LANGUAGE sql body
    // hit house.parent_deny inside a parent session and returned 0 ROWS → the tab silently fell back to
    // "House PTA" (fail-closed, prod-only, masked by the dev superuser owner). The fix clears
    // app.current_parent_user for the scoped read then restores it. This probe proves — as the NON-
    // SUPERUSER omnischools_app owner (prod-shaped) — that a parent RESOLVES their own child's real house
    // name (not the generic fallback), never another (unlinked) house's name, and 0 across a foreign
    // tenant. A revert to the un-cleared LANGUAGE sql body turns "own house name resolves" red here.
    console.log("\nParent House-PTA relabel (behavioral):");
    const hParentRows = await sql<{ id: string }[]>`select id from ref_user limit 1`;
    const houseKids = await sql<{ sid: string; hname: string }[]>`
      select distinct on (s.house_id) s.id as sid, h.name as hname
      from students s join house h on h.id = s.house_id
      where s.school_id = ${schoolId} and s.house_id is not null
      order by s.house_id, s.id`;
    if (hParentRows.length < 1 || houseKids.length < 2) {
      console.log("• skipped — needs ≥1 ref_user and ≥2 students in DISTINCT houses in the seeded school.");
    } else {
      const hParent = hParentRows[0].id;
      const ownKid = houseKids[0].sid;
      const ownHouse = houseKids[0].hname; // the parent's OWN child's house name
      const otherHouse = houseKids[1].hname; // a real house the parent is NOT linked to
      const ROLLBACK_H = "__parent_house_probe_rollback__";
      try {
        await sql.begin(async (tx) => {
          // ---- superuser setup: link the parent to ONE child (in ownHouse) ----
          await tx`insert into student_guardian
                     (id, school_id, student_id, name, relationship, phone, is_primary, user_id)
                   values (gen_random_uuid(), ${schoolId}, ${ownKid}, 'RLSTEST', 'MOTHER',
                           '+233RLSHOUSE1', true, ${hParent})`;
          // prod-shape: definer owner = the non-superuser role subject to FORCE RLS (dev default owner is
          // a superuser that bypasses RLS inside the body and would MASK the prod-only defect).
          await tx`alter function parent_house_names(uuid, uuid) owner to omnischools_app`;

          // ---- act as the parent (RLS enforced) ----
          await tx`set local role omnischools_app`;
          await tx`select set_config('app.current_school', ${schoolId}, true)`;
          await tx`select set_config('app.current_parent_user', ${hParent}, true)`;

          const own = await tx<{ house_name: string }[]>`
            select house_name from parent_house_names(${schoolId}, ${hParent})`;
          const names = own.map((r) => r.house_name);
          assertTrue("parent resolves own child's house name (not the generic fallback)", names.includes(ownHouse));
          assertTrue("parent does NOT resolve an unlinked house's name", !names.includes(otherHouse));

          // cross-TENANT: scoped to a FOREIGN school, tenant_isolation still fences (GUC-clear can't widen)
          await tx`select set_config('app.current_school', ${FOREIGN_ID}, true)`;
          const foreign = await tx<{ house_name: string }[]>`
            select house_name from parent_house_names(${schoolId}, ${hParent})`;
          assert("parent in foreign tenant resolves 0 house names", foreign.length, 0);

          // prev-restore lock (Wells's nuance): the fn restores the PREVIOUS parent GUC, NOT the `pu` ARG.
          // Parent-shape → restored verbatim; staff-shape (GUC unset, a pu passed as an arg) → left EMPTY,
          // never mis-scoped as pu. A naive `pu::text` restore would fail the staff assertion below.
          await tx`select set_config('app.current_school', ${schoolId}, true)`; // back to own school
          const afterParent = await tx<{ v: string | null }[]>`
            select current_setting('app.current_parent_user', true) as v`;
          assertTrue("parent GUC restored to the caller's value after a call", afterParent[0]?.v === hParent);
          await tx`select set_config('app.current_parent_user', '', true)`; // staff/escalated shape (GUC unset)
          await tx`select house_name from parent_house_names(${schoolId}, ${hParent})`;
          const afterStaff = await tx<{ v: string | null }[]>`
            select current_setting('app.current_parent_user', true) as v`;
          assertTrue(
            "a pu-arg call leaves an unset parent GUC empty (not mis-scoped as pu)",
            (afterStaff[0]?.v ?? "") === "",
          );

          throw new Error(ROLLBACK_H); // discard the probe row + the owner switch
        });
      } catch (e) {
        if ((e as Error).message !== ROLLBACK_H) throw e;
      }
    }

    // Parent BOARDING (read-only, lean v1) — BEHAVIORAL RLS probe (INCR — parent Boarding tab,
    // prod-paste-0097). Proven as the NON-SUPERUSER omnischools_app; the dev superuser masks RLS.
    //
    // Three things this closes that a superuser run cannot:
    //  (1) THE GUC-CLEAR PROJECTION. boarding_bunk/boarding_dormitory/house are parent_deny, so a parent's
    //      DIRECT read of them returns 0 (asserted below). The placement projection returns 1 row ONLY
    //      because parent_boarding_placement() clears app.current_parent_user for the definer read — under
    //      the PROD-SHAPED owner (omnischools_app, FORCE RLS binds the definer body) a no-clear version
    //      would return 0. So "direct read 0" + "projection 1" together prove the clear is load-bearing.
    //  (2) THE VISITING CONSTRAINT. A parent SELECT on boarding_calendar_event returns the VISITING row but
    //      0 EXEAT_WINDOW rows — denied at the RLS layer, not a reader filter.
    //  (3) READ-ONLY + prev-restore nuance. Every parent write on both config tables is denied; the fn
    //      restores the caller's GUC VERBATIM (a pu-arg call with the GUC unset leaves it EMPTY, never
    //      mis-scoped to pu). NO bunk_position column ever leaves the projection.
    // All rows AND the fn owner switch live in one rolled-back transaction, so nothing persists.
    console.log("\nParent Boarding read-only path (behavioral):");
    const brParentRows = await sql<{ id: string }[]>`select id from ref_user limit 1`;
    const brKids = await sql<{ id: string }[]>`
      select id from students where school_id = ${schoolId} order by id limit 2`;
    if (brParentRows.length < 1 || brKids.length < 2) {
      console.log("• skipped — needs ≥1 ref_user and ≥2 students in the seeded school.");
    } else {
      const brParent = brParentRows[0].id;
      const brOwn = brKids[0].id;
      const brOther = brKids[1].id; // a real child in the SAME school, NOT linked to this parent
      const houseId = "11111111-0000-4000-8000-0000000b0001";
      const dormId = "22222222-0000-4000-8000-0000000b0002";
      const bunk1 = "33333333-0000-4000-8000-0000000b0003"; // own child, prefect HEAD
      const bunk2 = "44444444-0000-4000-8000-0000000b0004"; // other child
      const visitEvt = "55555555-0000-4000-8000-0000000b0005"; // VISITING → parent-readable
      const exeatEvt = "66666666-0000-4000-8000-0000000b0006"; // EXEAT_WINDOW → parent-DENIED
      const ROLLBACK_BR = "__parent_boarding_probe_rollback__";
      try {
        await sql.begin(async (tx) => {
          // ---- superuser setup (bypasses RLS) ----
          await tx`insert into student_guardian
                     (id, school_id, student_id, name, relationship, phone, is_primary, user_id)
                   values (gen_random_uuid(), ${schoolId}, ${brOwn}, 'RLSTEST', 'MOTHER',
                           '+233RLSTESTBR', true, ${brParent})`;
          await tx`insert into house (id, school_id, name) values (${houseId}, ${schoolId}, 'RLST House')`;
          await tx`insert into boarding_dormitory (id, school_id, house_id, name)
                   values (${dormId}, ${schoolId}, ${houseId}, 'RLST Dorm')`;
          await tx`insert into boarding_bunk (id, school_id, dormitory_id, position_number, prefect_role)
                   values (${bunk1}, ${schoolId}, ${dormId}, 1, 'HEAD')`;
          await tx`insert into boarding_bunk (id, school_id, dormitory_id, position_number)
                   values (${bunk2}, ${schoolId}, ${dormId}, 2)`;
          await tx`update students set current_bunk_id = ${bunk1} where id = ${brOwn}`; // own PLACED
          await tx`update students set current_bunk_id = ${bunk2} where id = ${brOther}`; // other PLACED, unlinked
          await tx`insert into boarding_settings (school_id) values (${schoolId})
                   on conflict (school_id) do nothing`;
          await tx`insert into boarding_calendar_event
                     (id, school_id, academic_year, event_type, event_date, label)
                   values (${visitEvt}, ${schoolId}, '2025/26', 'VISITING', '2026-03-08', 'RLST Visiting')`;
          await tx`insert into boarding_calendar_event
                     (id, school_id, academic_year, event_type, event_date, label)
                   values (${exeatEvt}, ${schoolId}, '2025/26', 'EXEAT_WINDOW', '2026-03-15', 'RLST Exeat')`;
          await tx`insert into boarding_approved_visitor (id, school_id, student_id, name, relationship)
                   values (gen_random_uuid(), ${schoolId}, ${brOwn}, 'RLST Visitor', 'Uncle')`;
          // prod-shape: definer owner = the non-superuser role FORCE RLS actually binds
          await tx`alter function parent_boarding_placement(uuid, uuid) owner to omnischools_app`;

          // ---- act as the parent (RLS enforced, non-superuser) ----
          await tx`set local role omnischools_app`;
          await tx`select set_config('app.current_school', ${schoolId}, true)`;
          await tx`select set_config('app.current_parent_user', ${brParent}, true)`;
          const c = async (t: string, w: string) =>
            (await tx.unsafe(`select count(*)::int n from ${t} ${w}`))[0].n as number;

          // (1) placement projection — own PLACED child → exactly 1 row with REAL house+dorm+prefect,
          // NO bunk_position (the GUC-clear works under the prod-shaped owner; a no-clear version → 0).
          const placement = await tx<
            { student_id: string; house_name: string; dorm_name: string; prefect_role: string }[]
          >`select * from parent_boarding_placement(${schoolId}::uuid, ${brParent}::uuid)`;
          assert("placement returns exactly own placed child", placement.length, 1);
          assertTrue("placement is the OWN child (not the other placed child)", placement[0]?.student_id === brOwn);
          assertTrue("placement house_name is the real House", placement[0]?.house_name === "RLST House");
          assertTrue("placement dorm_name is the real dormitory", placement[0]?.dorm_name === "RLST Dorm");
          assertTrue("placement prefect_role surfaced", placement[0]?.prefect_role === "HEAD");
          const pkeys = Object.keys(placement[0] ?? {}).sort().join(",");
          assertTrue(
            "placement columns are EXACTLY {student_id,house_name,dorm_name,prefect_role} — no bunk_position/ids",
            pkeys === "dorm_name,house_name,prefect_role,student_id",
          );
          assertTrue("placement row has NO bunk_position column", !("bunk_position" in (placement[0] ?? {})));

          // (3a) prev-restore VERBATIM: the caller's GUC is untouched after the fn returns.
          const [{ cur }] = await tx<{ cur: string }[]>`
            select current_setting('app.current_parent_user', true) as cur`;
          assertTrue("parent GUC restored VERBATIM after placement call", cur === brParent);

          // (2) VISITING readable, EXEAT_WINDOW denied at the RLS layer; boarding_settings readable.
          assert("parent reads the VISITING event", await c("boarding_calendar_event", `where id='${visitEvt}'`), 1);
          assert("parent CANNOT read the EXEAT_WINDOW event", await c("boarding_calendar_event", `where id='${exeatEvt}'`), 0);
          assertAtLeast("parent reads boarding_settings", await c("boarding_settings", `where school_id='${schoolId}'`), 1);

          // (3b) READ-ONLY: every parent write on both config tables is denied.
          const insDenied = async (label: string, stmt: string) => {
            let denied = false;
            try {
              await tx.savepoint(async (sp) => {
                await sp.unsafe(stmt);
              });
            } catch {
              denied = true;
            }
            assertTrue(label, denied);
          };
          await insDenied(
            "parent INSERT boarding_calendar_event denied (visiting-day forge)",
            `insert into boarding_calendar_event (id, school_id, academic_year, event_type, event_date, label)
               values (gen_random_uuid(), '${schoolId}', '2025/26', 'VISITING', '2026-04-12', 'FORGE')`,
          );
          await insDenied(
            "parent INSERT boarding_settings denied (policy forge)",
            `insert into boarding_settings (id, school_id) values (gen_random_uuid(), '${FOREIGN_ID}')`,
          );
          assert("parent UPDATE boarding_calendar_event denied (rows)", (await tx`update boarding_calendar_event set label='X' where id=${visitEvt}`).count, 0);
          assert("parent UPDATE boarding_settings denied (rows)", (await tx`update boarding_settings set visiting_cadence='X' where school_id=${schoolId}`).count, 0);
          assert("parent DELETE boarding_calendar_event denied (rows)", (await tx`delete from boarding_calendar_event where id=${visitEvt}`).count, 0);
          assert("parent DELETE boarding_settings denied (rows)", (await tx`delete from boarding_settings where school_id=${schoolId}`).count, 0);

          // never-widen: a parent's DIRECT read of the spine + exeat/visitor/inspection tables → 0
          // (boarding_bunk / boarding_approved_visitor have REAL rows here, so 0 proves DENIAL, not emptiness).
          assert("parent CANNOT read boarding_bunk (spine denied)", await c("boarding_bunk", `where school_id='${schoolId}'`), 0);
          assert("parent CANNOT read boarding_dormitory (spine denied)", await c("boarding_dormitory", `where school_id='${schoolId}'`), 0);
          assert("parent CANNOT read house (spine denied)", await c("house", `where id='${houseId}'`), 0);
          assert("parent CANNOT read boarding_approved_visitor", await c("boarding_approved_visitor", `where student_id='${brOwn}'`), 0);
          assert("parent CANNOT read boarding_exeat", await c("boarding_exeat", `where school_id='${schoolId}'`), 0);
          assert("parent CANNOT read inspections", await c("inspections", `where school_id='${schoolId}'`), 0);

          // cross-TENANT: a parent scoped to a FOREIGN school gets 0 placement rows.
          await tx`select set_config('app.current_school', ${FOREIGN_ID}, true)`;
          const foreignPlacement = await tx`select * from parent_boarding_placement(${schoolId}::uuid, ${brParent}::uuid)`;
          assert("placement in foreign tenant returns 0", foreignPlacement.length, 0);
          await tx`select set_config('app.current_school', ${schoolId}, true)`;

          // (3c) prev-restore with the GUC UNSET: a pu-arg call must leave the GUC EMPTY, not mis-scoped to pu.
          await tx`select set_config('app.current_parent_user', '', true)`; // simulate an unset caller GUC
          await tx`select * from parent_boarding_placement(${schoolId}::uuid, ${brParent}::uuid)`;
          const [{ cur2 }] = await tx<{ cur2: string }[]>`
            select current_setting('app.current_parent_user', true) as cur2`;
          assertTrue("pu-arg call with GUC unset leaves it EMPTY (never mis-scoped to pu)", cur2 === "");

          // staff (no parent GUC — pu IS NULL) is byte-unchanged: sees the EXEAT_WINDOW event AND the spine.
          assert("staff sees the EXEAT_WINDOW event (VISITING constraint is parent-only)", await c("boarding_calendar_event", `where id='${exeatEvt}'`), 1);
          assertAtLeast("staff sees the boarding spine (≥ the 2 probe bunks)", await c("boarding_bunk", `where school_id='${schoolId}'`), 2);

          throw new Error(ROLLBACK_BR); // discard all probe rows + the fn owner switch
        });
      } catch (e) {
        if ((e as Error).message !== ROLLBACK_BR) throw e;
      }
    }
  } finally {
    await sql.end();
  }

  if (failures > 0) {
    console.error(`\n✗ RLS test FAILED (${failures} assertion(s)).`);
    process.exit(1);
  }
  console.log("\n✓ RLS isolation verified across all tenant tables.");
}

main().catch((err) => {
  console.error("✗ RLS test error:", err);
  process.exit(1);
});
