import "../db/_loadenv";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  schools,
  students,
  studentGuardians,
  users,
  sickbayBed,
  sickbayHospital,
  sickbayVisit,
  sickbayAdmission,
  sickbayReferral,
  sickbayVitalReading,
  sickbayDoctorConsult,
  sickbayReferralUpdate,
  sickbayReferralCostLine,
  sickbayNotification,
  studentNhisCard,
  sickbayChronicEntry,
} from "@/db/schema";

/**
 * INCR-29 + INCR-32 parent-SICKBAY/NHIS-boundary verification. INCR-29 was the FIRST widening of the
 * 19a parent boundary (9 → 11): a parent gains ROW access to their OWN child's sickbay_admission +
 * sickbay_referral. INCR-32 is the THIRD widening (11 → 12): + their OWN child's student_nhis_card.
 * This proves the widening is exactly those three tables wide and child-scoped.
 *
 * MECHANISM (mirrors scripts/verify-parent-boundary.ts): the dev app role is a SUPERUSER, which
 * bypasses RLS, so `SET LOCAL ROLE omnischools_app` (the non-superuser role prod connects as) is set
 * before each parent read, with `app.current_school` + `app.current_parent_user` exactly as
 * lib/db/rls.ts `withParentScope` does. Fixture inserts run as the superuser (RLS bypassed). The whole
 * transaction is ROLLED BACK, so nothing persists.
 *
 * Proves, as omnischools_app with the parent GUC:
 *   (a) a parent reads their OWN child's open + closed admission and open/returned/voided referral rows;
 *   (b) a co-parent's / another child's rows in the SAME school → 0 (cross-child);
 *   (c) a foreign school's rows → 0 (cross-tenant);
 *   (d) EVERY other sickbay table → 0 rows to the parent GUC (catalog + behavioural canaries);
 *   + Class-4 reachability: the in-scope parent CAN select menses_note off the row (RLS cannot mask
 *     columns — the reader projection is the sole guard; flagged to Sarah).
 */

let failures = 0;
function ok(cond: boolean, label: string) {
  console.log(`${cond ? "✓" : "✗ FAIL"} ${label}`);
  if (!cond) failures++;
}
class Rollback extends Error {}

const APP_ROLE = sql`set local role omnischools_app`;
const setSchool = (id: string) =>
  sql`select set_config('app.current_school', ${id}, true)`;
const setParent = (id: string) =>
  sql`select set_config('app.current_parent_user', ${id}, true)`;

const P_MOM = "+233555900001"; // the mother's number — on childA/B guardian rows AND her login
const P_DAD = "+233555900003"; // childA co-guardian (unlinked)

async function main() {
  const rand = Math.random().toString(36).slice(2, 8);
  try {
    await db.transaction(async (tx) => {
      // ── Fixture (as the superuser — RLS bypassed) ──────────────────────────────────────────────
      const [{ id: schoolA }] = await tx
        .insert(schools)
        .values({ name: "Sickbay Parent A", gesCode: `SPB-A-${rand}`, schoolType: "SENIOR" })
        .returning({ id: schools.id });
      const [{ id: schoolB }] = await tx
        .insert(schools)
        .values({ name: "Sickbay Parent B", gesCode: `SPB-B-${rand}`, schoolType: "SENIOR" })
        .returning({ id: schools.id });

      const [{ id: parentUser }] = await tx
        .insert(users)
        .values({ phone: P_MOM, fullName: "Ama Aidoo" })
        .returning({ id: users.id });

      const mkStudent = async (schoolId: string, code: string, first: string) => {
        const [{ id }] = await tx
          .insert(students)
          .values({ schoolId, studentCode: code, firstName: first, lastName: "Test", sex: "FEMALE" })
          .returning({ id: students.id });
        return id;
      };
      const childA = await mkStudent(schoolA, "SPB-A-001", "Yaa"); // the parent's OWN child
      const childB = await mkStudent(schoolA, "SPB-A-002", "Adwoa"); // another child, SAME school
      const childC = await mkStudent(schoolB, "SPB-B-001", "Kofi"); // FOREIGN school

      // THE live link: parentUser is childA's guardian. childB carries the SAME phone but is UNLINKED
      // (user_id NULL → a cross-child row that phone-equality must not reach). A co-guardian (P_DAD) too.
      await tx.insert(studentGuardians).values({
        schoolId: schoolA, studentId: childA, name: "Ama Aidoo", phone: P_MOM,
        relationship: "MOTHER", userId: parentUser,
      });
      await tx.insert(studentGuardians).values({
        schoolId: schoolA, studentId: childA, name: "Kwesi Aidoo", phone: P_DAD,
        relationship: "FATHER", userId: null,
      });
      await tx.insert(studentGuardians).values({
        schoolId: schoolA, studentId: childB, name: "Ama Aidoo", phone: P_MOM,
        relationship: "MOTHER", userId: null,
      });

      // Beds (schoolA needs two: one for childA's open stay, one for childB's) + hospitals.
      const mkBed = async (schoolId: string, n: number) => {
        const [{ id }] = await tx
          .insert(sickbayBed).values({ schoolId, bedNumber: n }).returning({ id: sickbayBed.id });
        return id;
      };
      const bedA1 = await mkBed(schoolA, 1);
      const bedA2 = await mkBed(schoolA, 2);
      const bedB1 = await mkBed(schoolB, 1);
      const mkHospital = async (schoolId: string, name: string) => {
        const [{ id }] = await tx
          .insert(sickbayHospital).values({ schoolId, name }).returning({ id: sickbayHospital.id });
        return id;
      };
      const hospA = await mkHospital(schoolA, "St Theresa's");
      const hospB = await mkHospital(schoolB, "Holy Family");

      const now = new Date();
      // A CLOSED visit (disposition set) — avoids the one-open-visit-per-student partial unique so a
      // student can carry several admission/referral rows in the fixture.
      const mkVisit = async (
        schoolId: string, studentId: string, disp: "ADMIT" | "REFER",
      ) => {
        const [{ id }] = await tx
          .insert(sickbayVisit)
          .values({
            schoolId, studentId, presentedAt: now, presentingComplaint: "Fever",
            disposition: disp, dispositionAt: now,
          })
          .returning({ id: sickbayVisit.id });
        return id;
      };

      // childA: OPEN admission + CLOSED admission (both must be returned to the parent scope — RLS
      // scopes by child, not by open-state; the open filter is the reader's job, R230).
      const vAdmOpen = await mkVisit(schoolA, childA, "ADMIT");
      const [{ id: admOpen }] = await tx
        .insert(sickbayAdmission)
        .values({ schoolId: schoolA, visitId: vAdmOpen, studentId: childA, bedId: bedA1, admittedAt: now })
        .returning({ id: sickbayAdmission.id });
      const vAdmClosed = await mkVisit(schoolA, childA, "ADMIT");
      const [{ id: admClosed }] = await tx
        .insert(sickbayAdmission)
        .values({
          schoolId: schoolA, visitId: vAdmClosed, studentId: childA, bedId: bedA1,
          admittedAt: now, dischargedAt: now, // discharged ⇒ exempt from the one-open-per-bed unique
        })
        .returning({ id: sickbayAdmission.id });

      // childA: OPEN + RETURNED + VOIDED referrals. The OPEN one carries menses_note (Class-4 canary).
      const mkReferral = async (
        studentId: string, hospitalId: string, schoolId: string,
        state: "open" | "returned" | "voided",
      ) => {
        const visitId = await mkVisit(schoolId, studentId, "REFER");
        const [{ id }] = await tx
          .insert(sickbayReferral)
          .values({
            schoolId, studentId, visitId, hospitalId,
            reasonReferredOut: "Suspected appendicitis",
            mensesNote: state === "open" ? "LMP 12 days ago" : null, // 🔴 Class-4 canary
            departedAt: now,
            returnedAt: state === "returned" ? now : null,
            status: state === "returned" ? "RETURNED" : "REFERRED",
            voidedAt: state === "voided" ? now : null,
            voidReason: state === "voided" ? "Entered on wrong student" : null,
          })
          .returning({ id: sickbayReferral.id });
        return id;
      };
      const refOpen = await mkReferral(childA, hospA, schoolA, "open");
      const refReturned = await mkReferral(childA, hospA, schoolA, "returned");
      const refVoided = await mkReferral(childA, hospA, schoolA, "voided");

      // childB (cross-child, SAME school): an open admission + open referral the parent must NOT see.
      const vB = await mkVisit(schoolA, childB, "ADMIT");
      await tx.insert(sickbayAdmission).values({
        schoolId: schoolA, visitId: vB, studentId: childB, bedId: bedA2, admittedAt: now,
      });
      const refB = await mkReferral(childB, hospA, schoolA, "open");

      // childC (cross-tenant, FOREIGN school): an open admission + open referral.
      const vC = await mkVisit(schoolB, childC, "ADMIT");
      await tx.insert(sickbayAdmission).values({
        schoolId: schoolB, visitId: vC, studentId: childC, bedId: bedB1, admittedAt: now,
      });
      const refC = await mkReferral(childC, hospB, schoolB, "open");

      // ── (d) Canary rows in the SIBLING sickbay tables, all tied to childA (the parent's OWN child).
      // If any of these tables had wrongly gained parent_scope, the parent would read a > 0 count here.
      await tx.insert(sickbayVitalReading).values({
        schoolId: schoolA, visitId: vAdmOpen, takenAt: now, tempC: "38.5", pulseBpm: 96,
      });
      await tx.insert(sickbayDoctorConsult).values({
        schoolId: schoolA, visitId: vAdmOpen, occurredAt: now, mode: "PHONE",
        clinicianName: "Dr Owusu", note: "Continue paracetamol",
      });
      await tx.insert(sickbayReferralUpdate).values({
        schoolId: schoolA, referralId: refOpen, occurredAt: now,
        clinicianName: "Ward Sister", body: "Admitted to ward 3",
      });
      await tx.insert(sickbayReferralCostLine).values({
        schoolId: schoolA, referralId: refOpen, itemLabel: "Consultation", nhisCovered: false,
        outOfPocketAmount: "50.00",
      });
      await tx.insert(sickbayNotification).values({
        schoolId: schoolA, studentId: childA, referralId: refOpen, tier: 1,
        channel: "SMS", direction: "OUTBOUND", recipient: "PARENT",
        privateNote: "STAFF ONLY — do not surface", // F4 — must never reach a parent
      });
      // student_nhis_card now carries parent_scope (INCR-32) — so childA's card is a POSITIVE read, and
      // childB (same school, unlinked) + childC (foreign school) cards must stay invisible. `valid_to`
      // is set so the derived status is real, but the boundary test cares about ROW access, not the date.
      const [{ id: cardA }] = await tx
        .insert(studentNhisCard)
        .values({ schoolId: schoolA, studentId: childA, cardNumber: "NHIS-123456", validTo: "2027-12-31" })
        .returning({ id: studentNhisCard.id });
      await tx.insert(studentNhisCard).values({
        schoolId: schoolA, studentId: childB, cardNumber: "NHIS-222222", validTo: "2027-12-31",
      });
      await tx.insert(studentNhisCard).values({
        schoolId: schoolB, studentId: childC, cardNumber: "NHIS-333333", validTo: "2027-12-31",
      });
      await tx.insert(sickbayChronicEntry).values({
        schoolId: schoolA, studentId: childA, condition: "ASTHMA",
      });

      // ── Parent-scoped reads (drop to the non-superuser role so the RESTRICTIVE parent_scope applies) ──
      await tx.execute(APP_ROLE);
      await tx.execute(setSchool(schoolA));
      await tx.execute(setParent(parentUser));

      const adm = async () =>
        (await tx.select({ id: sickbayAdmission.id, s: sickbayAdmission.studentId }).from(sickbayAdmission));
      const ref = async () =>
        (await tx.select({ id: sickbayReferral.id, s: sickbayReferral.studentId }).from(sickbayReferral));

      console.log("\n── (a) the parent reads their OWN child's admission + referral rows ──");
      const visAdm = await adm();
      ok(visAdm.length === 2, `(a) admission: parent sees exactly childA's 2 rows (open + closed), got ${visAdm.length}`);
      ok(visAdm.every((r) => r.s === childA), "(a) admission: every visible row belongs to childA");
      ok(visAdm.some((r) => r.id === admOpen) && visAdm.some((r) => r.id === admClosed),
        "(a) admission: BOTH the open AND the CLOSED row are returned (RLS scopes by child, not open-state)");
      const visRef = await ref();
      ok(visRef.length === 3, `(a) referral: parent sees exactly childA's 3 rows (open/returned/voided), got ${visRef.length}`);
      ok(visRef.every((r) => r.s === childA), "(a) referral: every visible row belongs to childA");
      ok([refOpen, refReturned, refVoided].every((id) => visRef.some((r) => r.id === id)),
        "(a) referral: the RETURNED and VOIDED rows are returned too (open filter is the reader's job)");

      console.log("\n── (b) cross-child (another child, SAME school) → 0 ──");
      ok(!visAdm.some((r) => r.s === childB), "(b) childB's admission (same school, same-phone unlinked guardian) is NOT visible");
      ok(!visRef.some((r) => r.id === refB), "(b) childB's referral is NOT visible");

      console.log("\n── (c) cross-tenant (foreign school) → 0 ──");
      ok(!visAdm.some((r) => r.s === childC), "(c) childC's admission (school B) is NOT visible");
      ok(!visRef.some((r) => r.id === refC), "(c) childC's referral is NOT visible");

      // ── Class-4 reachability (⚠ FLAG TO SARAH). RLS is row-level and cannot mask columns: the
      //    in-scope parent CAN read menses_note off the reachable row. The reader's frozen projection is
      //    the ONLY guard that keeps it off the wire (MEDIUM-3).
      console.log("\n── Class-4 adjacency (flag to Sarah) — the ROW is column-reachable, the reader is the guard ──");
      const menses = await tx
        .select({ m: sickbayReferral.mensesNote })
        .from(sickbayReferral)
        .where(and(eq(sickbayReferral.id, refOpen), eq(sickbayReferral.studentId, childA)));
      ok(menses[0]?.m === "LMP 12 days ago",
        "Class-4: the parent GUC CAN select menses_note off the in-scope row — RLS opens the ROW; the reader projection is the sole column guard (⚠ Sarah)");

      // ── NHIS (INCR-32) — own child's card visible; cross-child + cross-tenant → 0 (R254/NH11). ──
      console.log("\n── NHIS (INCR-32): own child's card visible; cross-child + cross-tenant → 0 ──");
      const nhisRows = await tx
        .select({ id: studentNhisCard.id, s: studentNhisCard.studentId })
        .from(studentNhisCard);
      ok(nhisRows.length === 1 && nhisRows[0].s === childA,
        `NHIS: parent sees EXACTLY childA's 1 card row (got ${nhisRows.length})`);
      ok(!nhisRows.some((r) => r.s === childB), "NHIS: childB's card (same school, same-phone unlinked) → 0");
      ok(!nhisRows.some((r) => r.s === childC), "NHIS: childC's card (foreign school) → 0");
      // MEDIUM-3 (⚠ Sarah, mirrors the menses canary): the in-scope parent CAN select card_number off the
      // reachable row. RLS opens the ROW; the reader's {status,validTo} projection is the SOLE guard.
      const cardNo = await tx
        .select({ c: studentNhisCard.cardNumber })
        .from(studentNhisCard)
        .where(eq(studentNhisCard.id, cardA));
      ok(cardNo[0]?.c === "NHIS-123456",
        "NHIS Class-4: the parent GUC CAN select card_number off the in-scope row — the reader projection is the sole column guard (⚠ Sarah)");

      // ── (d) EVERY other sickbay table → 0 to the parent. Catalog-driven, so a FUTURE sickbay table is
      //    covered automatically: enumerate every FORCE-RLS + school_id sickbay table (+ student_nhis_card),
      //    minus the two parent_scope tables, and assert (1) it carries parent_deny not parent_scope and
      //    (2) the parent reads 0 rows from it. The 7 canary tables above make several of these live denials.
      console.log("\n── (d) every OTHER sickbay table → 0 rows to the parent, and structurally parent_deny ──");
      const discovered = (await tx.execute(sql`
        select c.relname as t
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
        where c.relkind = 'r'
          and c.relforcerowsecurity
          and (c.relname like 'sickbay\_%' or c.relname = 'student_nhis_card')
          and exists (
            select 1 from information_schema.columns col
            where col.table_schema = 'public' and col.table_name = c.relname
              and col.column_name = 'school_id')
          and not exists (
            select 1 from pg_policy p where p.polrelid = c.oid and p.polname = 'parent_scope')
        order by c.relname`)) as unknown as { t: string }[];
      const siblings = discovered.map((r) => r.t);
      // student_nhis_card LEFT the deny set at INCR-32 (it now carries parent_scope), so the floor drops
      // by one and it is no longer a must-deny sibling.
      ok(siblings.length >= 17,
        `(d) discovered ${siblings.length} non-parent-scope sickbay tables to probe (≥ 17)`);
      ok(!siblings.includes("student_nhis_card"),
        "(d) student_nhis_card is NO LONGER in the deny set (it gained parent_scope at INCR-32)");
      for (const must of [
        "sickbay_visit", "sickbay_vital_reading", "sickbay_doctor_consult", "sickbay_chronic_entry",
        "sickbay_chronic_grant", "sickbay_chronic_read", "sickbay_med_admin", "sickbay_referral_update",
        "sickbay_referral_cost_line", "sickbay_notification", "sickbay_hospital",
      ]) {
        ok(siblings.includes(must), `(d) ${must} is in the deny set (no parent_scope)`);
      }
      const leaks: string[] = [];
      for (const t of siblings) {
        const res = (await tx.execute(sql.raw(`select count(*)::int as n from "${t}"`))) as unknown as { n: number }[];
        if (Number(res[0].n) !== 0) leaks.push(`${t}=${res[0].n}`);
      }
      ok(leaks.length === 0, `(d) parent reads 0 rows on EVERY other sickbay table (leaks: ${leaks.join(", ") || "none"})`);

      // ── catalog: EXACTLY the INCR-29 pair + the INCR-32 NHIS table opened; all else stays denied. ──
      console.log("\n── catalog: exactly {sickbay_admission, sickbay_referral, student_nhis_card} carry parent_scope ──");
      const scoped = (await tx.execute(sql`
        select c.relname as t
        from pg_class c join pg_policy p on p.polrelid = c.oid
        where p.polname = 'parent_scope'
          and (c.relname like 'sickbay\_%' or c.relname = 'student_nhis_card')
        order by c.relname`)) as unknown as { t: string }[];
      const scopedNames = scoped.map((r) => r.t);
      ok(
        scopedNames.length === 3 &&
          scopedNames.includes("sickbay_admission") &&
          scopedNames.includes("sickbay_referral") &&
          scopedNames.includes("student_nhis_card"),
        `catalog: exactly sickbay_admission + sickbay_referral + student_nhis_card have parent_scope (got: ${scopedNames.join(", ")})`,
      );

      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }

  console.log(`\n${failures === 0 ? "✓ ALL PARENT-SICKBAY-BOUNDARY ASSERTIONS PASS" : `✗ ${failures} ASSERTION(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
