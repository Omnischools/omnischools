import "@/db/_loadenv";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  houses,
  roleAssignments,
  roles,
  schools,
  sickbayChronicEntry,
  sickbayChronicGrant,
  sickbayChronicMed,
  sickbayChronicRead,
  students,
  users,
} from "@/db/schema";

/**
 * INCR-23a — the THIRD RLS boundary verifier (AC X1–X16 + X-MUT), cloned from
 * scripts/verify-parent-boundary.ts. Fixtures are inserted as the DEV SUPERUSER in a ROLLED-BACK
 * transaction; every PROBE runs after `SET LOCAL ROLE omnischools_app` (the non-superuser role prod
 * connects as, so the RESTRICTIVE `staff_grant_scope` policies actually apply), with
 * `app.current_school` + `app.current_staff_user` set exactly as lib/db/rls.ts `withStaffScope` does.
 *
 * 🔴 The polarity that makes this boundary the INVERSE of the parent one: `app.current_staff_user`
 * unset ⇒ DENY (0 rows on all four tables), never permit. Flip it to `su IS NULL OR …` and X1 leaks.
 *
 * ⚠ Sarah L1 — on DEV the helper functions are owned by a superuser, so a DIRECT call
 * `chronic_entry_ids(A, matron)` is a cross-tenant oracle; that is NOT what this script does. It
 * probes THROUGH THE TABLES as `omnischools_app`, where the RESTRICTIVE policy is enforced on a
 * non-superuser — the enforcement path is faithful on dev. The one thing dev cannot show is the
 * three-function graph's acyclicity under FORCE (that needs prod-shaped ownership; Sarah verified it).
 */
let failures = 0;
function ok(cond: boolean, label: string) {
  console.log(`${cond ? "✓" : "✗ FAIL"} ${label}`);
  if (!cond) failures++;
}
class Rollback extends Error {}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTx = any;
const APP_ROLE = sql`set local role omnischools_app`;
const RESET_ROLE = sql`reset role`;
const setSchool = (id: string) => sql`select set_config('app.current_school', ${id}, true)`;
const setStaff = (id: string) => sql`select set_config('app.current_staff_user', ${id}, true)`;
const clearStaff = () => sql`select set_config('app.current_staff_user', '', true)`;
const setBypass = (v: string) => sql`select set_config('app.bypass_rls', ${v}, true)`;

async function main() {
  const rand = Math.random().toString(36).slice(2, 8);
  try {
    await db.transaction(async (tx) => {
      // ── Fixture (as the superuser — RLS bypassed, exactly as seeds/ETL run) ────────────────────
      const mkSchool = async (name: string) => {
        const [{ id }] = await tx
          .insert(schools)
          .values({ name, gesCode: `SGB-${name}-${rand}`, schoolType: "SENIOR" })
          .returning({ id: schools.id });
        return id;
      };
      const schoolA = await mkSchool("A");
      const schoolB = await mkSchool("B");

      const mkUser = async (label: string) => {
        const [{ id }] = await tx
          .insert(users)
          .values({ phone: `+2335${rand}${label}`.slice(0, 15), fullName: `SGB ${label}` })
          .returning({ id: users.id });
        return id;
      };
      const matron = await mkUser("matron");
      const hm = await mkUser("hm");
      const grantee = await mkUser("grantee"); // FULL_PLAN on the SCD entry
      const nobody = await mkUser("nobody"); // staff, no grant, no clinical role
      const expiredU = await mkUser("expired");
      const revokedU = await mkUser("revoked");
      const houseHm = await mkUser("househm");
      const mhGrantee = await mkUser("mhgrantee"); // DIRECTIVE on the MH entry

      // Global ref_role ids by code (seeded; created here if the dev DB lacks one).
      const roleId = async (code: string) => {
        const [r] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.code, code));
        if (r) return r.id;
        const [ins] = await tx
          .insert(roles)
          .values({ code, label: code })
          .returning({ id: roles.id });
        return ins.id;
      };
      const MATRON = await roleId("MATRON");
      const HEADMASTER = await roleId("HEADMASTER");
      const HOUSEMASTER = await roleId("HOUSEMASTER");
      const assign = async (userId: string, schoolId: string, roleIdV: string) => {
        await tx.insert(roleAssignments).values({ userId, schoolId, roleId: roleIdV });
      };
      await assign(matron, schoolA, MATRON);
      await assign(hm, schoolA, HEADMASTER);
      await assign(grantee, schoolA, HOUSEMASTER);
      await assign(nobody, schoolA, HOUSEMASTER);
      await assign(houseHm, schoolA, HOUSEMASTER);

      const mkStudent = async (schoolId: string, code: string, houseId?: string) => {
        const [{ id }] = await tx
          .insert(students)
          .values({
            schoolId,
            studentCode: code,
            firstName: code,
            lastName: "T",
            sex: "FEMALE",
            ...(houseId ? { houseId } : {}),
          })
          .returning({ id: students.id });
        return id;
      };

      const [{ id: houseH }] = await tx
        .insert(houses)
        .values({ schoolId: schoolA, name: `H-${rand}`, hmUserId: houseHm })
        .returning({ id: houses.id });

      const sStudent = await mkStudent(schoolA, `A-SCD-${rand}`);
      const mStudent = await mkStudent(schoolA, `A-MH-${rand}`);
      const hStudent = await mkStudent(schoolA, `A-HOU-${rand}`, houseH);
      const bStudent = await mkStudent(schoolB, `B-SCD-${rand}`);

      // Chronic entries — hm_restricted is GENERATED ALWAYS, never inserted.
      const mkEntry = async (
        schoolId: string,
        studentId: string,
        condition: "SICKLE_CELL" | "MENTAL_HEALTH" | "ASTHMA",
      ) => {
        const mh = condition === "MENTAL_HEALTH";
        const [{ id }] = await tx
          .insert(sickbayChronicEntry)
          .values({
            schoolId,
            studentId,
            condition,
            conditionLabel: condition,
            onSiteTreatable: !mh, // R96 CHECK: MENTAL_HEALTH ⇒ (false, true)
            referralManaged: mh,
          })
          .returning({ id: sickbayChronicEntry.id });
        return id;
      };
      const entrySCD = await mkEntry(schoolA, sStudent, "SICKLE_CELL");
      const entryMH = await mkEntry(schoolA, mStudent, "MENTAL_HEALTH");
      const entryHouse = await mkEntry(schoolA, hStudent, "ASTHMA");
      await mkEntry(schoolB, bStudent, "SICKLE_CELL"); // school-B entry — for the cross-tenant + bypass probes

      // A med on the SCD entry (PRN, so no schedule slot needed; is_prn XOR slot_id).
      await tx.insert(sickbayChronicMed).values({
        schoolId: schoolA,
        entryId: entrySCD,
        drugName: "SGB-DRUG",
        doseLabel: "PRN",
        isPrn: true,
      });

      // Grants. hm_restricted MUST match the entry's generated value (the composite FK enforces it).
      const mkGrant = async (v: {
        entryId: string;
        grantee: string;
        scope: "FULL_PLAN" | "PARTIAL" | "DIRECTIVE";
        hmRestricted: boolean;
        houseId?: string;
        expiresAt?: Date;
        revokedAt?: Date;
        directiveNote?: string;
      }) => {
        const [{ id }] = await tx
          .insert(sickbayChronicGrant)
          .values({
            schoolId: schoolA,
            entryId: v.entryId,
            hmRestricted: v.hmRestricted,
            granteeUserId: v.grantee,
            scope: v.scope,
            ...(v.houseId ? { houseId: v.houseId } : {}),
            ...(v.expiresAt ? { expiresAt: v.expiresAt } : {}),
            ...(v.revokedAt ? { revokedAt: v.revokedAt } : {}),
            ...(v.directiveNote ? { directiveNote: v.directiveNote } : {}),
          })
          .returning({ id: sickbayChronicGrant.id });
        return id;
      };
      const grantFull = await mkGrant({
        entryId: entrySCD,
        grantee,
        scope: "FULL_PLAN",
        hmRestricted: false,
      });
      await mkGrant({
        entryId: entrySCD,
        grantee: expiredU,
        scope: "FULL_PLAN",
        hmRestricted: false,
        expiresAt: new Date(Date.now() - 3600_000), // an hour ago
      });
      await mkGrant({
        entryId: entrySCD,
        grantee: revokedU,
        scope: "FULL_PLAN",
        hmRestricted: false,
        revokedAt: new Date(Date.now() - 3600_000),
      });
      await mkGrant({
        entryId: entryHouse,
        grantee: houseHm,
        scope: "FULL_PLAN",
        hmRestricted: false,
        houseId: houseH,
      });
      await mkGrant({
        entryId: entryMH,
        grantee: mhGrantee,
        scope: "DIRECTIVE",
        hmRestricted: true, // MUST match entryMH's generated true, or the composite FK rejects it
        directiveNote: "Escalate to the counsellor.",
      });

      // ── PROBES (drop to omnischools_app so the RESTRICTIVE policies apply) ──────────────────────
      const listEntries = () =>
        tx.select({ id: sickbayChronicEntry.id }).from(sickbayChronicEntry);
      const nEntries = async () => (await listEntries()).length;
      const nMeds = async () =>
        (await tx.select({ id: sickbayChronicMed.id }).from(sickbayChronicMed)).length;
      const nGrants = async () =>
        (await tx.select({ id: sickbayChronicGrant.id }).from(sickbayChronicGrant)).length;
      const nGrantsOn = async (entryId: string) =>
        (
          await tx
            .select({ id: sickbayChronicGrant.id })
            .from(sickbayChronicGrant)
            .where(eq(sickbayChronicGrant.entryId, entryId))
        ).length;
      const nReads = async () =>
        (await tx.select({ id: sickbayChronicRead.id }).from(sickbayChronicRead)).length;
      const visibleIds = async () => (await listEntries()).map((r) => r.id);

      /** Run a write in a SAVEPOINT so an RLS abort does not kill the outer fixture tx. */
      const refused = async (fn: (sp: AnyTx) => Promise<unknown>): Promise<boolean> => {
        try {
          await tx.transaction(async (sp) => {
            await fn(sp);
          });
          return false;
        } catch {
          return true;
        }
      };

      await tx.execute(APP_ROLE);
      await tx.execute(setSchool(schoolA));

      // ── X1 · POLARITY — school set, staff UNSET ⇒ 0 on all four tables (deny-by-default) ────────
      await tx.execute(clearStaff());
      const x1 =
        (await nEntries()) === 0 &&
        (await nMeds()) === 0 &&
        (await nGrants()) === 0 &&
        (await nReads()) === 0;
      ok(x1, "X1: staff GUC UNSET → 0/0/0/0 (deny-by-default; a `su IS NULL OR` flip would leak 3/1/…)");

      // ── X2 · MATRON is a default clinical reader — the non-vacuous positive control for X1 ──────
      await tx.execute(setStaff(matron));
      const matronEntries = await nEntries();
      ok(matronEntries === 3, `X2: MATRON reads ALL 3 school-A entries (got ${matronEntries})`);
      ok((await nMeds()) === 1, "X2: MATRON reads the SCD med");
      ok((await nGrants()) === 5, "X2: MATRON reads every grant on her school's entries");

      // ── X3 · HEADMASTER reads exactly the non-MENTAL_HEALTH entries (R116) ──────────────────────
      await tx.execute(setStaff(hm));
      const hmIds = await visibleIds();
      ok(
        hmIds.length === 2 && hmIds.includes(entrySCD) && hmIds.includes(entryHouse),
        `X3: HEADMASTER reads SCD + asthma, NOT the MH entry (got ${hmIds.length})`,
      );
      ok(!hmIds.includes(entryMH), "X3: the MENTAL_HEALTH entry is invisible to the HEADMASTER");
      ok((await nMeds()) === 1, "X3: the SCD med is visible to the HEADMASTER (positive control)");
      // R128/R129 — he cannot even ENUMERATE a grant on the MH entry (no entry_id, no directive_note).
      ok((await nGrantsOn(entryMH)) === 0, "X3/R128: HEADMASTER sees 0 grants on the MH entry");
      // He sees ALL 3 non-hm_restricted grants on the SCD entry — live, expired AND revoked: a clinical
      // reader sees the grant history (§04 renders revoked rows), the carve-out is on hm_restricted only.
      ok((await nGrantsOn(entrySCD)) === 3, "X3: HEADMASTER sees the SCD entry's 3 grants (positive control)");

      // ── X4 · a staff member with no clinical role and no grant reads NOTHING ────────────────────
      await tx.execute(setStaff(nobody));
      ok((await nEntries()) === 0, "X4: a HOUSEMASTER with no grant reads 0 entries (deny-by-default)");

      // ── X5 · a FULL_PLAN grantee reads the granted entry AND its med ────────────────────────────
      await tx.execute(setStaff(grantee));
      const gIds = await visibleIds();
      ok(gIds.includes(entrySCD), "X5: the FULL_PLAN grantee reads the granted SCD entry");
      ok((await nMeds()) === 1, "X5: the grantee reads the granted entry's med");

      // ── X6 · the grant is PER ENTRY (R105) — the grantee reads ONLY the granted entry ───────────
      ok(
        gIds.length === 1 && !gIds.includes(entryHouse) && !gIds.includes(entryMH),
        `X6: the grantee reads ONLY his one granted entry (got ${gIds.length})`,
      );

      // ── X7 · an EXPIRED grant is dead in the SAME statement (DB now(), R114) ────────────────────
      await tx.execute(setStaff(expiredU));
      ok((await nEntries()) === 0, "X7: an EXPIRED grantee reads 0 (expiry evaluated against DB now())");

      // ── X8 · a REVOKED grant is dead ────────────────────────────────────────────────────────────
      await tx.execute(setStaff(revokedU));
      ok((await nEntries()) === 0, "X8: a REVOKED grantee reads 0");

      // ── X9 · a HOUSE-TIED grant dies when the student leaves the House (R107) ───────────────────
      await tx.execute(setStaff(houseHm));
      ok((await visibleIds()).includes(entryHouse), "X9: house-tied grantee reads the entry while the student is in-House");
      // Move the student out of the House (as superuser), then re-probe as the house HM.
      await tx.execute(RESET_ROLE);
      await tx
        .update(students)
        .set({ houseId: null })
        .where(and(eq(students.schoolId, schoolA), eq(students.id, hStudent)));
      await tx.execute(APP_ROLE);
      await tx.execute(setSchool(schoolA));
      await tx.execute(setStaff(houseHm));
      ok((await nEntries()) === 0, "X9: after the student moves House, the house-tied grantee reads 0");
      // restore the student to the House for later probes
      await tx.execute(RESET_ROLE);
      await tx
        .update(students)
        .set({ houseId: houseH })
        .where(and(eq(students.schoolId, schoolA), eq(students.id, hStudent)));
      await tx.execute(APP_ROLE);
      await tx.execute(setSchool(schoolA));

      // ── X10 · a grantee cannot SELF-ISSUE a grant (WITH CHECK = MATRON) ─────────────────────────
      await tx.execute(setStaff(grantee));
      const x10 = await refused((sp) =>
        sp.insert(sickbayChronicGrant).values({
          schoolId: schoolA,
          entryId: entryHouse,
          hmRestricted: false,
          granteeUserId: grantee,
          scope: "FULL_PLAN",
        }),
      );
      ok(x10, "X10: a grantee's self-issued grant is REFUSED (WITH CHECK = MATRON)");

      // ── X11 · a grantee cannot EXTEND his own grant's expiry ────────────────────────────────────
      const x11 = await refused((sp) =>
        sp
          .update(sickbayChronicGrant)
          .set({ expiresAt: new Date(Date.now() + 3600_000) })
          .where(eq(sickbayChronicGrant.id, grantFull)),
      );
      ok(x11, "X11: a grantee extending his own expiry is REFUSED");

      // ── X12 · cross-tenant refused in BOTH directions ──────────────────────────────────────────
      await tx.execute(setStaff(matron));
      await tx.execute(setSchool(schoolB));
      ok((await nEntries()) === 0, "X12a: MATRON of A scoped to school B reads 0 (no role there)");
      await tx.execute(setSchool(schoolA));
      const x12b = await refused((sp) =>
        sp
          .update(sickbayChronicEntry)
          .set({ schoolId: schoolB })
          .where(eq(sickbayChronicEntry.id, entrySCD)),
      );
      ok(x12b, "X12b: relocating an entry A→B is REFUSED (tenant boundary, both directions)");

      // ── X13 · a grantee sees his OWN grant row, never others', and CANNOT read the trail ────────
      await tx.execute(setStaff(grantee));
      ok((await nGrants()) === 1, "X13: the grantee sees ONLY his own grant row (R122 — never who else knows)");
      ok((await nReads()) === 0, "X13: the grantee cannot read the read-audit trail (clinical-reader-only)");
      // He CAN write his own read row but reads the log back as 0 (MEDIUM-1 — append-only against him).
      await refused((sp) =>
        sp.insert(sickbayChronicRead).values({
          schoolId: schoolA,
          entryId: entrySCD,
          actorUserId: grantee,
          readOn: new Date().toISOString().slice(0, 10),
        }),
      );
      ok((await nReads()) === 0, "X13: the grantee's own audit insert is not readable back by him");
      // …and forging a row attributed to the HEADMASTER is REFUSED (WITH CHECK actor = the staff GUC).
      const forge = await refused((sp) =>
        sp.insert(sickbayChronicRead).values({
          schoolId: schoolA,
          entryId: entrySCD,
          actorUserId: hm, // not the session
          readOn: new Date().toISOString().slice(0, 10),
        }),
      );
      ok(forge, "X13/MEDIUM-1: a read row forged as the HEADMASTER is REFUSED");

      // ── X14 · DRIFT GUARD — every sickbay_chronic_* table carries the right policies ────────────
      const chronicTables = (
        (await tx.execute(sql`
          select c.relname as t
          from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname='public'
          where c.relkind='r' and c.relname like 'sickbay_chronic_%'
          order by c.relname`)) as unknown as { t: string }[]
      ).map((r) => r.t);
      const EXPECTED = [
        "sickbay_chronic_entry",
        "sickbay_chronic_grant",
        "sickbay_chronic_med",
        "sickbay_chronic_read",
      ];
      ok(
        JSON.stringify(chronicTables) === JSON.stringify(EXPECTED),
        `X14: the sickbay_chronic_* set is exactly the four expected (got ${chronicTables.join(", ")})`,
      );
      const policyRows = (await tx.execute(sql`
        select c.relname as t, p.polname as name, pg_get_expr(p.polqual, p.polrelid) as using_expr
        from pg_policy p join pg_class c on c.oid = p.polrelid
        where c.relname like 'sickbay_chronic_%'`)) as unknown as {
        t: string;
        name: string;
        using_expr: string | null;
      }[];
      let x14 = true;
      for (const t of EXPECTED) {
        const forT = policyRows.filter((p) => p.t === t);
        if (!forT.some((p) => p.name === "staff_grant_scope")) x14 = false;
        if (!forT.some((p) => p.name === "parent_deny")) x14 = false;
        // R130 — every staff_grant_scope USING gates on chronic_entry_ids/readable OR the hm_restricted arm.
        const scope = forT.find((p) => p.name === "staff_grant_scope");
        const e = scope?.using_expr ?? "";
        if (!/chronic_entry_ids|chronic_entry_readable|hm_restricted/.test(e)) x14 = false;
      }
      ok(x14, "X14: each chronic table has staff_grant_scope + parent_deny, and the scope gates on the shared predicate (R130)");
      const deleteGuarded = ["sickbay_chronic_entry", "sickbay_chronic_grant", "sickbay_chronic_med"];
      const x14d = deleteGuarded.every((t) =>
        policyRows.some((p) => p.t === t && p.name === "staff_grant_delete"),
      );
      ok(x14d, "X14: entry/med/grant each carry a staff_grant_delete policy");

      // ── X15 · bypass (withoutTenantScope) is the ONLY escape ────────────────────────────────────
      await tx.execute(clearStaff());
      await tx.execute(setBypass("on"));
      const bypassAll = await nEntries();
      ok(bypassAll >= 4, `X15: a bypass session reads ALL entries across schools (${bypassAll} ≥ 4)`);
      await tx.execute(setBypass(""));
      ok((await nEntries()) === 0, "X15: with bypass OFF and no staff GUC, the escape is closed again (0)");

      // ── X16 · DELETE guards — a grantee cannot delete what he was shown ─────────────────────────
      await tx.execute(setStaff(grantee));
      const delEntry = await tx
        .delete(sickbayChronicEntry)
        .where(eq(sickbayChronicEntry.id, entrySCD))
        .returning({ id: sickbayChronicEntry.id });
      ok(delEntry.length === 0, "X16: a FULL_PLAN grantee's DELETE of the care plan removes 0 rows");
      const delGrant = await tx
        .delete(sickbayChronicGrant)
        .where(eq(sickbayChronicGrant.id, grantFull))
        .returning({ id: sickbayChronicGrant.id });
      ok(delGrant.length === 0, "X16: a grantee cannot DELETE his own grant row (erase the evidence)");
      await tx.execute(setStaff(matron));
      const delRead = await tx
        .delete(sickbayChronicRead)
        .returning({ id: sickbayChronicRead.id });
      ok(delRead.length === 0, "X16: even the MATRON's DELETE on the read audit removes 0 rows (bypass-only)");

      // ── X-MUT · the asymmetry proves the carve-out is live INDEPENDENTLY of the grant arm ───────
      // Baseline recap: HM entries = 2 (no MH); an ungranted staffer (`nobody`) reads 0.
      const readCount = async (su: string) => {
        await tx.execute(setStaff(su));
        return nEntries();
      };
      // (a) rewrite the predicate to IGNORE su → BOTH the HM carve-out AND grant-scoping break.
      await tx.execute(RESET_ROLE);
      await tx.execute(sql`
        create or replace function chronic_entry_readable(
            school uuid, su uuid, entry uuid, student uuid, cond chronic_condition)
          returns boolean language sql stable security definer
          set search_path = public, pg_temp
        as $$ select su is not null $$`);
      await tx.execute(APP_ROLE);
      await tx.execute(setSchool(schoolA));
      const mutAHm = await readCount(hm);
      const mutANobody = await readCount(nobody);
      ok(mutAHm === 3, `X-MUT(a): ignoring su LEAKS the MH entry to the HEADMASTER (${mutAHm} = RED)`);
      ok(mutANobody === 3, `X-MUT(a): ignoring su also breaks grant-scoping — an ungranted staffer reads all (${mutANobody} = RED)`);

      // (b) drop ONLY the MENTAL_HEALTH clause → the HM carve-out breaks, grant-scoping SURVIVES.
      await tx.execute(RESET_ROLE);
      await tx.execute(sql`
        create or replace function chronic_entry_readable(
            school uuid, su uuid, entry uuid, student uuid, cond chronic_condition)
          returns boolean language sql stable security definer
          set search_path = public, pg_temp
        as $$
          select su is not null and (
            chronic_clinical_role(school, su) = 'MATRON'
            or chronic_clinical_role(school, su) = 'HEADMASTER'   -- MENTAL_HEALTH clause DROPPED
            or exists (
              select 1 from sickbay_chronic_grant g
              where g.school_id = school and g.entry_id = entry and g.grantee_user_id = su
                and g.revoked_at is null and (g.expires_at is null or g.expires_at > now())
            )
          )
        $$`);
      await tx.execute(APP_ROLE);
      await tx.execute(setSchool(schoolA));
      const mutBHm = await readCount(hm);
      const mutBNobody = await readCount(nobody);
      ok(mutBHm === 3, `X-MUT(b): dropping the MH clause LEAKS the MH entry to the HEADMASTER (${mutBHm} = RED, X3 alone)`);
      ok(
        mutBNobody === 0,
        `X-MUT(b): grant-scoping is UNTOUCHED — an ungranted staffer still reads 0 (${mutBNobody} = GREEN). The asymmetry proves the carve-out is independent of the grant arm.`,
      );

      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }

  console.log(
    `\n${failures === 0 ? "✓ ALL SICKBAY GRANT-BOUNDARY ASSERTIONS PASS" : `✗ ${failures} ASSERTION(S) FAILED`}`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
