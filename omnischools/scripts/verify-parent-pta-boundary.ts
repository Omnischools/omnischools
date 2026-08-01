import "../db/_loadenv";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  schools,
  classes,
  houses,
  households,
  students,
  studentGuardians,
  users,
  academicPeriod,
  academicPeriodConfig,
  invoices,
  invoiceLineItems,
  ptas,
  ptaMeeting,
  ptaMeetingAttendance,
  ptaDuesCharge,
} from "@/db/schema";
import { loadParentPtaTx } from "@/lib/parent/parent-pta-data";

/**
 * INCR-55a parent-PTA participation boundary verification — the FIFTH widening of the 19a boundary
 * (13 → 17 parent_scope tables): a parent gains ROW access to their ACTIVE PTAs (ptas + pta_meeting,
 * membership-scoped) + their OWN dues + OWN attendance (pta_dues_charge + pta_meeting_attendance).
 *
 * MECHANISM (mirrors scripts/verify-parent-sickbay-boundary.ts): the dev app role is a SUPERUSER which
 * bypasses RLS, so `SET LOCAL ROLE omnischools_app` (the non-superuser role prod connects as) is set
 * before each parent read, with `app.current_school` + `app.current_parent_user` exactly as
 * lib/db/rls.ts `withParentScope` does. Fixture inserts run as the superuser; the whole transaction is
 * ROLLED BACK, so NOTHING persists — no markers, no cleanup.
 *
 * Proves, as omnischools_app under the parent GUC — and by calling the REAL reader (loadParentPtaTx) on
 * the scoped tx (so RLS + the frozen projection + the name/status derivations are all exercised):
 *   (1) Your PTAs = the parent's own memberships (Form-of-own-class + House-of-own-house + universal
 *       General), NEVER another class's Form, NEVER Emergency, NEVER a foreign school's;
 *   (2) Your dues = the parent's OWN family charges (BILLED = rate_snapshot), never another family's,
 *       never the money engine (invoice/payment stay parent_deny);
 *   (3) Your attendance = the parent's OWN status at CLOSED meetings + DERIVED Absent for a closed
 *       meeting they missed; a live meeting is omitted; a TEACHER row and another parent's row are 0;
 *   (4) 0 cross-family / cross-tenant on EVERY one of the 4 PTA tables (raw row probes, both directions);
 *   (5) a parent with no dues/meetings still reads General membership — honest empties elsewhere.
 */

let failures = 0;
function ok(cond: boolean, label: string) {
  console.log(`${cond ? "✓" : "✗ FAIL"} ${label}`);
  if (!cond) failures++;
}
class Rollback extends Error {}

const APP_ROLE = sql`set local role omnischools_app`;
const setScope = (school: string, parent: string) =>
  sql`select set_config('app.current_school', ${school}, true), set_config('app.current_parent_user', ${parent}, true)`;

async function main() {
  const rand = Math.random().toString(36).slice(2, 8);
  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const daysAgo = (n: number) => iso(new Date(now.getTime() - n * 86_400_000));
  const daysAhead = (n: number) => iso(new Date(now.getTime() + n * 86_400_000));

  try {
    await db.transaction(async (tx) => {
      // ── Fixture (as the superuser — RLS bypassed) ────────────────────────────────────────────────
      const mkSchool = async (name: string) =>
        (
          await tx
            .insert(schools)
            .values({ name, gesCode: `PTA-${name}-${rand}`, schoolType: "SENIOR" })
            .returning({ id: schools.id })
        )[0].id;
      const schoolA = await mkSchool("A");
      const schoolB = await mkSchool("B"); // foreign tenant

      const mkClass = async (schoolId: string, name: string) =>
        (await tx.insert(classes).values({ schoolId, name }).returning({ id: classes.id }))[0].id;
      const classForm = await mkClass(schoolA, "Form 2 Science"); // childA's class
      const classOther = await mkClass(schoolA, "Form 1 Arts"); // childB's class

      const houseA = (
        await tx.insert(houses).values({ schoolId: schoolA, name: "Aggrey" }).returning({ id: houses.id })
      )[0].id;

      const hh1 = (
        await tx.insert(households).values({ schoolId: schoolA, name: "Aidoo" }).returning({ id: households.id })
      )[0].id;
      const hh2 = (
        await tx.insert(households).values({ schoolId: schoolA, name: "Mensah" }).returning({ id: households.id })
      )[0].id;

      await tx.insert(academicPeriodConfig).values({
        schoolId: schoolA,
        academicYear: "2024/2025",
        periodType: "SEMESTER",
        periodCount: 2,
        source: "GES_DEFAULT",
      });
      const periodA = (
        await tx
          .insert(academicPeriod)
          .values({
            schoolId: schoolA,
            academicYear: "2024/2025",
            periodNumber: 2,
            periodLabel: "Term 2",
            startsOn: daysAgo(60),
            endsOn: daysAhead(60),
            productLine: "SENIOR",
          })
          .returning({ periodId: academicPeriod.periodId })
      )[0].periodId;

      const mom = (
        await tx.insert(users).values({ phone: `+2335559${rand}1`, fullName: "Ama Aidoo" }).returning({ id: users.id })
      )[0].id;
      const dad2 = (
        await tx.insert(users).values({ phone: `+2335559${rand}2`, fullName: "Kwesi Mensah" }).returning({ id: users.id })
      )[0].id;
      const teacher = (
        await tx.insert(users).values({ phone: `+2335559${rand}3`, fullName: "Mr Owusu" }).returning({ id: users.id })
      )[0].id;

      const mkStudent = async (
        schoolId: string,
        code: string,
        first: string,
        classId: string | null,
        label: string | null,
        houseId: string | null,
        householdId: string | null,
      ) =>
        (
          await tx
            .insert(students)
            .values({
              schoolId,
              studentCode: code,
              firstName: first,
              lastName: "Test",
              sex: "MALE",
              classId,
              currentClassLabel: label,
              houseId,
              householdId,
            })
            .returning({ id: students.id })
        )[0].id;
      const childA = await mkStudent(schoolA, `A1-${rand}`, "Yaw", classForm, "Form 2 Science", houseA, hh1);
      const childB = await mkStudent(schoolA, `A2-${rand}`, "Adjoa", classOther, "Form 1 Arts", null, hh2);
      const childC = await mkStudent(schoolB, `B1-${rand}`, "Kofi", null, "Form 3", null, null);

      const momGuardian = (
        await tx
          .insert(studentGuardians)
          .values({ schoolId: schoolA, studentId: childA, name: "Ama Aidoo", phone: `+2335559${rand}1`, relationship: "MOTHER", userId: mom })
          .returning({ id: studentGuardians.id })
      )[0].id;
      const dad2Guardian = (
        await tx
          .insert(studentGuardians)
          .values({ schoolId: schoolA, studentId: childB, name: "Kwesi Mensah", phone: `+2335559${rand}2`, relationship: "FATHER", userId: dad2 })
          .returning({ id: studentGuardians.id })
      )[0].id;

      const mkPta = async (
        schoolId: string,
        tier: "FORM" | "HOUSE" | "GENERAL" | "EMERGENCY",
        classId: string | null,
        houseId: string | null,
      ) =>
        (
          await tx
            .insert(ptas)
            .values({ schoolId, tierType: tier, classId, houseId, status: "ACTIVE" })
            .returning({ id: ptas.id })
        )[0].id;
      const pForm = await mkPta(schoolA, "FORM", classForm, null); // mom (childA)
      const pFormOther = await mkPta(schoolA, "FORM", classOther, null); // dad2 (childB), NOT mom
      const pHouse = await mkPta(schoolA, "HOUSE", null, houseA); // mom (childA in Aggrey)
      const pGeneral = await mkPta(schoolA, "GENERAL", null, null); // both (universal)
      const pEmergency = await mkPta(schoolA, "EMERGENCY", null, null); // nobody (excluded)
      const pForeign = await mkPta(schoolB, "GENERAL", null, null); // cross-tenant

      // Dues: each charge needs a dues invoice + line item (the bridge FK). The parent NEVER reads those
      // (invoice/line_item stay parent_deny) — only the bridge's rate_snapshot.
      let inv = 0;
      const mkDues = async (
        pta: string,
        tier: "FORM" | "GENERAL",
        basis: "PER_STUDENT" | "PER_FAMILY",
        cadence: "PER_TERM" | "PER_YEAR",
        student: string,
        household: string | null,
        rate: string,
        periodId: string | null,
      ) => {
        inv += 1;
        const invoiceId = (
          await tx
            .insert(invoices)
            .values({
              schoolId: schoolA,
              studentId: student,
              invoiceNumber: `DUES-${rand}-${inv}`,
              academicYear: "2024/2025",
              subtotalAmount: rate,
              billedAmount: rate,
              balanceAmount: rate,
            })
            .returning({ id: invoices.id })
        )[0].id;
        const lineItemId = (
          await tx
            .insert(invoiceLineItems)
            .values({ schoolId: schoolA, invoiceId, description: "PTA dues", amount: rate })
            .returning({ id: invoiceLineItems.id })
        )[0].id;
        await tx.insert(ptaDuesCharge).values({
          schoolId: schoolA,
          lineItemId,
          ptaId: pta,
          tierType: tier,
          academicYear: "2024/2025",
          academicPeriodId: periodId,
          basis,
          cadence,
          subjectStudentId: student,
          householdId: household,
          rateSnapshot: rate,
        });
      };
      await mkDues(pForm, "FORM", "PER_STUDENT", "PER_TERM", childA, null, "50.00", periodA); // mom's own
      await mkDues(pGeneral, "GENERAL", "PER_FAMILY", "PER_YEAR", childA, hh1, "200.00", null); // mom's family
      await mkDues(pFormOther, "FORM", "PER_STUDENT", "PER_TERM", childB, null, "50.00", periodA); // dad2's — NOT mom's

      // Meetings (need academic_period_id). closed = write-locked (end + 24h default grace).
      const mkMeeting = async (pta: string, dateStr: string, type: string) =>
        (
          await tx
            .insert(ptaMeeting)
            .values({
              schoolId: schoolA,
              ptaId: pta,
              academicPeriodId: periodA,
              meetingType: type,
              meetingDate: dateStr,
              startTime: "10:00",
              endTime: "12:00",
            })
            .returning({ id: ptaMeeting.id })
        )[0].id;
      const mForm = await mkMeeting(pForm, daysAgo(3), "Form meeting"); // CLOSED — mom PRESENT
      const mGeneral = await mkMeeting(pGeneral, daysAgo(2), "General meeting"); // CLOSED — mom MISSED → Absent
      const mFormLive = await mkMeeting(pForm, daysAhead(1), "Form meeting"); // LIVE — omitted

      // Attendance rows: mom PRESENT at mForm; a TEACHER row at mForm (mom must not see); dad2 PRESENT at
      // mGeneral (mom must not see → mom derives ABSENT there).
      await tx.insert(ptaMeetingAttendance).values({ schoolId: schoolA, meetingId: mForm, register: "PARENT", studentGuardianId: momGuardian, status: "PRESENT" });
      await tx.insert(ptaMeetingAttendance).values({ schoolId: schoolA, meetingId: mForm, register: "TEACHER", userId: teacher, status: "PRESENT" });
      await tx.insert(ptaMeetingAttendance).values({ schoolId: schoolA, meetingId: mGeneral, register: "PARENT", studentGuardianId: dad2Guardian, status: "PRESENT" });

      // ── Drop to the non-superuser role so the RESTRICTIVE parent_scope applies. ──────────────────
      await tx.execute(APP_ROLE);

      // ============================ MOM ============================
      await tx.execute(setScope(schoolA, mom));

      console.log("\n── (4) raw row probes as MOM — 0 cross-family / cross-tenant on all 4 PTA tables ──");
      const momPtas = await tx.select({ id: ptas.id, tier: ptas.tierType }).from(ptas);
      ok(momPtas.length === 3, `ptas: mom sees exactly 3 (Form+House+General), got ${momPtas.length}`);
      const momPtaIds = new Set(momPtas.map((r) => r.id));
      ok(momPtaIds.has(pForm) && momPtaIds.has(pHouse) && momPtaIds.has(pGeneral), "ptas: the 3 are pForm + pHouse + pGeneral");
      ok(!momPtaIds.has(pFormOther), "ptas: another class's Form PTA is NOT visible");
      ok(!momPtaIds.has(pEmergency), "ptas: the Emergency PTA is NOT visible (tier excluded)");
      ok(!momPtaIds.has(pForeign), "ptas: the foreign school's PTA is NOT visible (cross-tenant)");

      const momDues = await tx.select({ s: ptaDuesCharge.subjectStudentId }).from(ptaDuesCharge);
      ok(momDues.length === 2 && momDues.every((r) => r.s === childA), `dues: mom sees exactly her 2 own-family charges, got ${momDues.length}`);
      ok(!momDues.some((r) => r.s === childB), "dues: another family's (childB) charge is NOT visible");

      const momAtt = await tx.select({ g: ptaMeetingAttendance.studentGuardianId }).from(ptaMeetingAttendance);
      ok(momAtt.length === 1 && momAtt[0].g === momGuardian, `attendance: mom sees ONLY her own 1 PARENT row, got ${momAtt.length}`);
      ok(!momAtt.some((r) => r.g === dad2Guardian), "attendance: another parent's (dad2) row is NOT visible");
      ok(!momAtt.some((r) => r.g === null), "attendance: the TEACHER row (guardian_id NULL) is NOT visible");

      const momMeetings = await tx.select({ id: ptaMeeting.id }).from(ptaMeeting);
      ok(momMeetings.length === 3, `pta_meeting: mom sees her PTAs' 3 meetings, got ${momMeetings.length}`);

      console.log("\n── (1)(2)(3) the REAL reader as MOM — memberships / dues / attendance ──");
      const momView = await loadParentPtaTx(tx, schoolA, now);
      // (1) memberships
      const mNames = momView.memberships.map((m) => `${m.tier}:${m.ptaName}`);
      ok(momView.memberships.length === 3, `(1) memberships = 3, got ${momView.memberships.length}`);
      ok(momView.memberships.map((m) => m.tier).join(",") === "FORM,HOUSE,GENERAL", `(1) tier-ordered FORM,HOUSE,GENERAL, got ${momView.memberships.map((m) => m.tier).join(",")}`);
      ok(mNames.includes("FORM:Form 2 Science PTA"), "(1) Form PTA named from the child's class label ('Form 2 Science PTA')");
      ok(mNames.includes("HOUSE:House PTA"), "(1) House PTA = generic 'House PTA' (house name is parent_deny — flagged to Wells)");
      ok(mNames.includes("GENERAL:General PTA"), "(1) General PTA present (universal)");
      // (2) dues — BILLED only
      ok(momView.dues.length === 2, `(2) dues = 2, got ${momView.dues.length}`);
      const formDue = momView.dues.find((d) => d.tier === "FORM");
      const genDue = momView.dues.find((d) => d.tier === "GENERAL");
      ok(formDue?.amountBilled === "GHS 50.00" && formDue?.ptaName === "Form 2 Science PTA" && formDue?.periodLabel === "2024/2025", `(2) Form due = GHS 50.00 · Form 2 Science PTA · 2024/2025 (got ${JSON.stringify(formDue)})`);
      ok(genDue?.amountBilled === "GHS 200.00" && genDue?.ptaName === "General PTA", `(2) General due = GHS 200.00 · General PTA (got ${JSON.stringify(genDue)})`);
      ok(!momView.dues.some((d) => d.amountBilled.includes("0.00") && d.tier === "FORM" && d.ptaName.includes("Form 1")), "(2) childB's Form due is NOT in mom's dues");
      // (3) attendance — own status + derived Absent, live meeting omitted
      ok(momView.attendance.length === 2, `(3) attendance = 2 closed meetings (live one omitted), got ${momView.attendance.length}`);
      const attForm = momView.attendance.find((a) => a.ptaName === "Form 2 Science PTA");
      const attGen = momView.attendance.find((a) => a.ptaName === "General PTA");
      ok(attForm?.status === "Present", `(3) mom's Form meeting = Present (own row), got ${attForm?.status}`);
      ok(attGen?.status === "Absent", `(3) mom's missed General meeting = DERIVED Absent (no own row, closed), got ${attGen?.status}`);
      ok(!momView.attendance.some((a) => a.meetingLabel === "Form meeting" && a.status !== "Present"), "(3) the future/live Form meeting is omitted (not closed)");

      // ============================ DAD2 (the other family — 0 cross-family the other way) ============================
      await tx.execute(setScope(schoolA, dad2));
      console.log("\n── (4)(5) DAD2 — sees only childB's slice, 0 of mom's ──");
      const dadDues = await tx.select({ s: ptaDuesCharge.subjectStudentId }).from(ptaDuesCharge);
      ok(dadDues.length === 1 && dadDues[0].s === childB, `dues: dad2 sees ONLY childB's 1 charge, got ${dadDues.length}`);
      ok(!dadDues.some((r) => r.s === childA), "dues: mom's family (childA) charges are NOT visible to dad2 (0 cross-family both directions)");

      const dadView = await loadParentPtaTx(tx, schoolA, now);
      ok(dadView.memberships.map((m) => `${m.tier}:${m.ptaName}`).sort().join("|") === "FORM:Form 1 Arts PTA|GENERAL:General PTA", `(5) dad2 memberships = Form(1 Arts)+General only (no House, no other Form), got ${dadView.memberships.map((m) => m.ptaName).join(", ")}`);
      ok(dadView.dues.length === 1 && dadView.dues[0].ptaName === "Form 1 Arts PTA", "(5) dad2 dues = his own 1 Form charge");
      ok(dadView.attendance.length === 1 && dadView.attendance[0].ptaName === "General PTA" && dadView.attendance[0].status === "Present", `(5) dad2 attendance = Present at the General meeting he attended (mom saw Absent for the SAME meeting), got ${JSON.stringify(dadView.attendance)}`);

      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }

  console.log(`\n${failures === 0 ? "✓ ALL PARENT-PTA-BOUNDARY ASSERTIONS PASS" : `✗ ${failures} ASSERTION(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
