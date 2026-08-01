import "../db/_loadenv";
import { and, eq, sql } from "drizzle-orm";
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
  ptaOfficer,
  ptaMinutes,
  ptaAgendaItem,
  ptaActionItem,
  ptaResolution,
} from "@/db/schema";
import { loadParentPtaTx } from "@/lib/parent/parent-pta-data";

/**
 * INCR-55a/b parent-PTA boundary verification — the FIFTH widening of the 19a boundary (13 → 22
 * parent_scope tables): 55a gave ROW access to ACTIVE PTAs (ptas + pta_meeting, membership-scoped) +
 * OWN dues + OWN attendance (pta_dues_charge + pta_meeting_attendance); 55b adds the RECORDS & DIRECTORY
 * subtree — pta_officer (current holders of own PTAs, R479) + the ADOPTED-only minutes subtree
 * (pta_minutes / pta_agenda_item / pta_action_item / pta_resolution, R478). This harness proves 55a AND
 * the 55b additions against the SAME fixture, all as omnischools_app under the parent GUC, rolled back.
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
 *
 * INCR-58 (Kofi R483/R484/R485) EXTENDS this same harness (no schema/RLS change — Wells's SECURITY DEFINER
 * parent_house_names is already applied): (6) parent_house_names returns ONLY the parent's OWN children's
 * houses as (id, name) — two boarders → two DISTINCT names, 0 cross-family / cross-tenant / non-parent, and
 * `house` direct-SELECT stays 0 (parent_deny); the House PTA RELABELS to the House name ("Aggrey PTA"); and
 * the adopted-minutes action owner gains the R485 office caption (resolves under the proxy — pta_officer is
 * a tenant table). The whole tx is rolled back — no residue.
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

      const mkHouse = async (schoolId: string, name: string) =>
        (await tx.insert(houses).values({ schoolId, name }).returning({ id: houses.id }))[0].id;
      const houseA = await mkHouse(schoolA, "Aggrey"); // childA (mom's) — the House PTA host
      const houseD = await mkHouse(schoolA, "Guggisberg"); // childA2 (mom's SECOND boarder) — two distinct names
      const houseE = await mkHouse(schoolA, "Slessor"); // childB (dad2's) — mom must NOT read this name
      const houseF = await mkHouse(schoolB, "Foreign House"); // childC (cross-tenant) — 0 to every schoolA parent

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
      // childA2 — mom's SECOND boarder, in a SECOND house (houseD) but the SAME class (no new PTA membership):
      // proves parent_house_names returns TWO distinct names (PP58-2) without disturbing any 55a count.
      const childA2 = await mkStudent(schoolA, `A1b-${rand}`, "Efua", classForm, "Form 2 Science", houseD, hh1);
      const childB = await mkStudent(schoolA, `A2-${rand}`, "Adjoa", classOther, "Form 1 Arts", houseE, hh2);
      const childC = await mkStudent(schoolB, `B1-${rand}`, "Kofi", null, "Form 3", houseF, null);

      const momGuardian = (
        await tx
          .insert(studentGuardians)
          .values({ schoolId: schoolA, studentId: childA, name: "Ama Aidoo", phone: `+2335559${rand}1`, relationship: "MOTHER", userId: mom })
          .returning({ id: studentGuardians.id })
      )[0].id;
      // mom also guards childA2 (her second boarder, in houseD) — so parent_student_ids(mom) = {childA, childA2}.
      await tx
        .insert(studentGuardians)
        .values({ schoolId: schoolA, studentId: childA2, name: "Ama Aidoo", phone: `+2335559${rand}1`, relationship: "MOTHER", userId: mom });
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

      // ── 55b fixture: OFFICERS (R479) ────────────────────────────────────────────────────────────
      // Current holders of mom's PTAs (visible), an ENDED holder (invisible), a cross-family Form officer
      // and a cross-tenant officer (both invisible). termEnd null → "While in post"; set → a date range.
      const mkOfficer = async (
        sId: string,
        pta: string,
        office: string,
        opts: { userId?: string; external?: string; termEnd?: string | null; ended?: boolean } = {},
      ) =>
        tx.insert(ptaOfficer).values({
          schoolId: sId,
          ptaId: pta,
          office,
          personUserId: opts.userId ?? null,
          externalName: opts.userId ? null : (opts.external ?? "External Holder"),
          assignmentBasis: "ELECTED",
          electionRef: "AGM 2025",
          termStart: daysAgo(300),
          termEnd: opts.termEnd === undefined ? daysAhead(400) : opts.termEnd,
          endedAt: opts.ended ? now : null,
          endReason: opts.ended ? "relocated" : null,
        });
      await mkOfficer(schoolA, pGeneral, "Chair", { userId: teacher, termEnd: null }); // While in post
      await mkOfficer(schoolA, pGeneral, "Treasurer", { userId: mom }); // mom's OWN hat; date-range term
      await mkOfficer(schoolA, pGeneral, "Secretary", { userId: dad2, ended: true }); // ENDED → invisible
      await mkOfficer(schoolA, pForm, "Chair", { external: "Mr Boahen" }); // mom's Form
      await mkOfficer(schoolA, pFormOther, "Chair", { userId: dad2, termEnd: null }); // dad2's Form — mom 0
      await mkOfficer(schoolB, pForeign, "Chair", {}); // cross-tenant — mom 0

      // ── 55b fixture: ADOPTED MINUTES (R478) + subtree ───────────────────────────────────────────
      await tx
        .update(ptaMeeting)
        .set({ quorumMet: true })
        .where(and(eq(ptaMeeting.schoolId, schoolA), eq(ptaMeeting.id, mGeneral)));
      const mkAgenda = async (
        sId: string,
        minutesId: string,
        seqNo: number,
        title: string,
        classification: string,
        narrative: string | null = null,
      ) =>
        (
          await tx
            .insert(ptaAgendaItem)
            .values({ schoolId: sId, minutesId, seqNo, title, classification, narrative })
            .returning({ id: ptaAgendaItem.id })
        )[0].id;

      // Adopted minutes on mom's CLOSED General meeting — mom (and every General member) reads it.
      const genMinutes = (
        await tx
          .insert(ptaMinutes)
          .values({ schoolId: schoolA, meetingId: mGeneral, status: "ADOPTED" })
          .returning({ id: ptaMinutes.id })
      )[0].id;
      await mkAgenda(schoolA, genMinutes, 1, "Budget review", "DISCUSSION", "The committee reviewed the term budget.");
      const aiAction = await mkAgenda(schoolA, genMinutes, 2, "Roof repair", "ACTION");
      const aiRes = await mkAgenda(schoolA, genMinutes, 3, "Annual dues", "RESOLUTION");
      await tx.insert(ptaActionItem).values({ schoolId: schoolA, agendaItemId: aiAction, description: "Repair the dining-hall roof", personUserId: mom, status: "PENDING" });
      await tx.insert(ptaResolution).values({ schoolId: schoolA, agendaItemId: aiRes, resolutionNo: "GEN-2026-Q2-001", resolutionText: "RESOLVED THAT annual dues be set at GHS 200.", votesFor: 20, votesAgainst: 3, votesAbstain: 1, binding: true });

      // DRAFT minutes on mom's Form meeting — un-adopted, must NEVER surface (R478 status gate).
      const draftMinutes = (
        await tx.insert(ptaMinutes).values({ schoolId: schoolA, meetingId: mForm, status: "DRAFT" }).returning({ id: ptaMinutes.id })
      )[0].id;
      await mkAgenda(schoolA, draftMinutes, 1, "Draft item", "DISCUSSION", "Not yet adopted.");

      // Adopted minutes on dad2's Form (another family) — visible to dad2, 0 to mom (cross-family).
      const mFormOther = await mkMeeting(pFormOther, daysAgo(4), "Form meeting");
      const otherMinutes = (
        await tx.insert(ptaMinutes).values({ schoolId: schoolA, meetingId: mFormOther, status: "ADOPTED" }).returning({ id: ptaMinutes.id })
      )[0].id;
      await mkAgenda(schoolA, otherMinutes, 1, "Other-class item", "DISCUSSION", "Adopted, but not mom's PTA.");

      // Adopted minutes in the FOREIGN school — cross-tenant, 0 to every schoolA parent.
      await tx.insert(academicPeriodConfig).values({ schoolId: schoolB, academicYear: "2024/2025", periodType: "SEMESTER", periodCount: 2, source: "GES_DEFAULT" });
      const periodB = (
        await tx
          .insert(academicPeriod)
          .values({ schoolId: schoolB, academicYear: "2024/2025", periodNumber: 2, periodLabel: "Term 2", startsOn: daysAgo(60), endsOn: daysAhead(60), productLine: "SENIOR" })
          .returning({ periodId: academicPeriod.periodId })
      )[0].periodId;
      const mForeign = (
        await tx
          .insert(ptaMeeting)
          .values({ schoolId: schoolB, ptaId: pForeign, academicPeriodId: periodB, meetingType: "General meeting", meetingDate: daysAgo(5), startTime: "10:00", endTime: "12:00", quorumMet: true })
          .returning({ id: ptaMeeting.id })
      )[0].id;
      const foreignMinutes = (
        await tx.insert(ptaMinutes).values({ schoolId: schoolB, meetingId: mForeign, status: "ADOPTED" }).returning({ id: ptaMinutes.id })
      )[0].id;
      const foreignAgenda = await mkAgenda(schoolB, foreignMinutes, 1, "Foreign item", "RESOLUTION");
      await tx.insert(ptaResolution).values({ schoolId: schoolB, agendaItemId: foreignAgenda, resolutionNo: "B-2026-Q2-001", resolutionText: "RESOLVED", votesFor: 5, votesAgainst: 0, votesAbstain: 0, binding: true });

      // ── PROD-MODEL: the officer / action-owner NAME join reads the GLOBAL ref_user. In prod the app
      //    connects as the TABLE OWNER (omnischools), which is EXEMPT from ref_user's ENABLE-not-FORCE RLS
      //    (policies.sql §global — "the app's direct connection … keeps full access"), so the holder name
      //    RESOLVES. The omnischools_app PROXY used below is a NON-owner (to FORCE the tenant-table RLS
      //    boundary) and therefore CANNOT read the global ref_user — so ref_user-backed names DEGRADE to
      //    '—' under the proxy. That is NOT a leak: the officer ROW is already parent-scoped; the holder
      //    name is a global-identity governance fact resolved by the owner-connection. Prove that here.
      ok(
        (await tx.select({ n: users.fullName }).from(users).where(eq(users.id, mom)))[0]?.n === "Ama Aidoo",
        "PROD-MODEL: the owner connection resolves ref_user names — the officer/owner name join works in prod",
      );

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

      console.log("\n── (58·Item 1) HOUSE NAMES as MOM — parent_house_names returns own children's houses (id+name) ONLY ──");
      // `house` STAYS parent_deny — a direct SELECT returns 0 even though the definer function resolves the name.
      ok((await tx.select({ id: houses.id }).from(houses)).length === 0, "(58) `house` direct-SELECT stays 0 for the parent (house is parent_deny — the name comes ONLY via the definer function)");
      const momHouses = (await tx.execute(
        sql`SELECT house_id, house_name FROM parent_house_names(${schoolA}::uuid, ${mom}::uuid)`,
      )) as unknown as { house_id: string; house_name: string }[];
      const momHouseName = new Map(momHouses.map((h) => [h.house_id, h.house_name]));
      ok(momHouses.length === 2, `(58) parent_house_names(mom) = 2 rows (her two boarders' two houses), got ${momHouses.length}`);
      ok(momHouseName.get(houseA) === "Aggrey" && momHouseName.get(houseD) === "Guggisberg", `(58·PP58-2) two DISTINCT names Aggrey + Guggisberg, got ${JSON.stringify([...momHouseName.values()])}`);
      ok(!momHouseName.has(houseE), "(58·PP58-3) dad2's child's house (Slessor) is NOT returned to mom (0 cross-family)");
      ok(!momHouseName.has(houseF), "(58·PP58-4) the foreign school's house is NOT returned to mom (0 cross-tenant)");
      ok(momHouses.every((h) => Object.keys(h).sort().join(",") === "house_id,house_name"), `(58·PP58-5) name-ONLY projection — exactly {house_id, house_name}, got ${JSON.stringify(Object.keys(momHouses[0] ?? {}))}`);

      console.log("\n── (1)(2)(3) the REAL reader as MOM — memberships / dues / attendance ──");
      const momView = await loadParentPtaTx(tx, schoolA, mom, now);
      // (1) memberships
      const mNames = momView.memberships.map((m) => `${m.tier}:${m.ptaName}`);
      ok(momView.memberships.length === 3, `(1) memberships = 3, got ${momView.memberships.length}`);
      ok(momView.memberships.map((m) => m.tier).join(",") === "FORM,HOUSE,GENERAL", `(1) tier-ordered FORM,HOUSE,GENERAL, got ${momView.memberships.map((m) => m.tier).join(",")}`);
      ok(mNames.includes("FORM:Form 2 Science PTA"), "(1) Form PTA named from the child's class label ('Form 2 Science PTA')");
      ok(mNames.includes("HOUSE:Aggrey PTA"), "(1·58) House PTA RELABELLED to the child's House NAME ('Aggrey PTA') via parent_house_names (R483)");
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

      console.log("\n── (55b·A) OFFICERS as MOM — current holders of her PTAs; ended/cross-family/cross-tenant = 0 ──");
      const momOfficerRows = await tx.select({ ptaId: ptaOfficer.ptaId }).from(ptaOfficer);
      ok(momOfficerRows.length === 3, `pta_officer: mom sees exactly 3 current holders (Form Chair + General Chair/Treasurer), got ${momOfficerRows.length}`);
      ok(!momOfficerRows.some((r) => r.ptaId === pFormOther), "pta_officer: another class's Form officer is NOT visible (cross-family)");
      ok(!momOfficerRows.some((r) => r.ptaId === pForeign), "pta_officer: the foreign school's officer is NOT visible (cross-tenant)");

      ok(momView.officers.length === 3, `(A) reader officers = 3, got ${momView.officers.length}`);
      ok(momView.officers.map((o) => o.tier).join(",") === "FORM,GENERAL,GENERAL", `(A) tier-ordered FORM,GENERAL,GENERAL, got ${momView.officers.map((o) => o.tier).join(",")}`);
      const momGenOfficers = momView.officers.filter((o) => o.ptaName === "General PTA");
      ok(momGenOfficers.map((o) => o.office).join(",") === "Chair,Treasurer", `(A) General officers office-ranked Chair,Treasurer, got ${momGenOfficers.map((o) => o.office).join(",")}`);
      const momYou = momView.officers.filter((o) => o.isYou);
      ok(momYou.length === 1 && momYou[0].office === "Treasurer" && momYou[0].ptaName === "General PTA", `(A) exactly one 'You' hat = Treasurer of General PTA, got ${JSON.stringify(momYou)}`);
      ok(momGenOfficers.find((o) => o.office === "Chair")?.term === "While in post", "(A) the term_end-null Chair reads 'While in post'");
      ok(momYou[0].term.includes("→"), `(A) the Treasurer (term_end set) reads a date range, got ${momYou[0].term}`);
      ok(!momView.officers.some((o) => o.ptaName.includes("Form 1 Arts")), "(A) no cross-family (Form 1 Arts) officer in mom's projection");
      ok(momView.officers.find((o) => o.ptaName === "Form 2 Science PTA")?.holderName === "Mr Boahen", "(A) the EXTERNAL (non-user) Form Chair name projects from external_name (a tenant column — proxy-readable)");
      // ref_user is owner-read (see PROD-MODEL above) → the staff-user Chair name degrades to '—' under the
      // omnischools_app proxy. The ROW is still correctly scoped; the name resolves in prod / the preview.
      ok(momGenOfficers.find((o) => o.office === "Chair")?.holderName === "—", "(A) staff-user holder name is '—' under the proxy (global ref_user is owner-read; resolves in prod)");

      console.log("\n── (55b·B) ADOPTED MINUTES as MOM — adopted own-PTA only; DRAFT/cross-family/cross-tenant = 0 ──");
      const momMinutesRows = await tx.select({ id: ptaMinutes.id }).from(ptaMinutes);
      ok(momMinutesRows.length === 1, `pta_minutes: mom sees exactly 1 ADOPTED own-PTA minutes (DRAFT + cross-family + cross-tenant excluded), got ${momMinutesRows.length}`);
      const momAgendaRows = await tx.select({ id: ptaAgendaItem.id }).from(ptaAgendaItem);
      ok(momAgendaRows.length === 3, `pta_agenda_item: mom sees the 3 agenda items of her adopted minutes only, got ${momAgendaRows.length}`);
      const momResRows = await tx.select({ id: ptaResolution.id }).from(ptaResolution);
      ok(momResRows.length === 1, `pta_resolution: mom sees the 1 resolution of her adopted minutes only, got ${momResRows.length}`);
      const momActRows = await tx.select({ id: ptaActionItem.id }).from(ptaActionItem);
      ok(momActRows.length === 1, `pta_action_item: mom sees the 1 action of her adopted minutes only, got ${momActRows.length}`);

      ok(momView.minutes.length === 1, `(B) reader minutes = 1, got ${momView.minutes.length}`);
      const gm = momView.minutes[0];
      ok(gm.ptaName === "General PTA" && gm.quorumMet === true, `(B) adopted minutes = General PTA + quorum met, got ${gm.ptaName}/${gm.quorumMet}`);
      ok(gm.agendaItems.map((a) => a.classification).join(",") === "Discussion,Action,Resolution", `(B) agenda classifications ordered Discussion,Action,Resolution, got ${gm.agendaItems.map((a) => a.classification).join(",")}`);
      // owner NAME degrades to '—' under the proxy (ref_user owner-read; resolves to "Ama Aidoo" in prod), but
      // the R485 OFFICE caption resolves EVEN under the proxy — pta_officer is a tenant table, so mom's own
      // General-Treasurer hat is proxy-readable → owner = "— · Treasurer" (prod: "Ama Aidoo · Treasurer"). The
      // ACTION row is correctly scoped and carries description + status only (NO deadline — R478).
      ok(gm.actionItems.length === 1 && gm.actionItems[0].description === "Repair the dining-hall roof" && gm.actionItems[0].status === "Pending" && gm.actionItems[0].owner === "— · Treasurer", `(B·58) action = 'Repair the dining-hall roof' · Pending · owner '— · Treasurer' (R485 office caption resolves under proxy; name resolves in prod), got ${JSON.stringify(gm.actionItems)}`);
      ok(gm.resolutions.length === 1 && gm.resolutions[0].result === "PASSED" && gm.resolutions[0].binding === true && gm.resolutions[0].resolutionNo === "GEN-2026-Q2-001", `(B) resolution = PASSED · binding · GEN-2026-Q2-001, got ${JSON.stringify(gm.resolutions[0])}`);
      ok(!momView.minutes.some((m) => m.ptaName.includes("Form 1 Arts")), "(B) no cross-family (Form 1 Arts) adopted minutes for mom");

      // ============================ DAD2 (the other family — 0 cross-family the other way) ============================
      await tx.execute(setScope(schoolA, dad2));
      console.log("\n── (4)(5) DAD2 — sees only childB's slice, 0 of mom's ──");
      const dadDues = await tx.select({ s: ptaDuesCharge.subjectStudentId }).from(ptaDuesCharge);
      ok(dadDues.length === 1 && dadDues[0].s === childB, `dues: dad2 sees ONLY childB's 1 charge, got ${dadDues.length}`);
      ok(!dadDues.some((r) => r.s === childA), "dues: mom's family (childA) charges are NOT visible to dad2 (0 cross-family both directions)");

      const dadView = await loadParentPtaTx(tx, schoolA, dad2, now);
      ok(dadView.memberships.map((m) => `${m.tier}:${m.ptaName}`).sort().join("|") === "FORM:Form 1 Arts PTA|GENERAL:General PTA", `(5) dad2 memberships = Form(1 Arts)+General only (no House, no other Form), got ${dadView.memberships.map((m) => m.ptaName).join(", ")}`);
      ok(dadView.dues.length === 1 && dadView.dues[0].ptaName === "Form 1 Arts PTA", "(5) dad2 dues = his own 1 Form charge");
      // dad2 now has TWO closed meetings: the General meeting he ATTENDED (Present — mom saw Absent for the
      // SAME meeting) + his Form's closed meeting (mFormOther, the 55b adopted-minutes host) he missed
      // (derived Absent). Order = most-recent first (Form daysAgo(4) is older than General daysAgo(2)).
      ok(dadView.attendance.length === 2, `(5) dad2 attendance = 2 closed meetings, got ${dadView.attendance.length}`);
      ok(dadView.attendance.find((a) => a.ptaName === "General PTA")?.status === "Present", "(5) dad2 = Present at the General meeting he attended (mom saw Absent for the SAME meeting)");
      ok(dadView.attendance.find((a) => a.ptaName === "Form 1 Arts PTA")?.status === "Absent", "(5) dad2 = derived Absent at his Form's closed meeting he missed");

      console.log("\n── (55b) DAD2 — General officers/minutes (member) + his OWN Form; 0 of mom's Form ──");
      ok(dadView.officers.length === 3, `(A) dad2 sees 3 officers (General Chair/Treasurer + his own Form Chair), got ${dadView.officers.length}`);
      ok(dadView.officers.some((o) => o.ptaName === "General PTA" && o.office === "Treasurer"), "(A) dad2 reads the General Treasurer (public governance — the office-holder is mom)");
      ok(dadView.officers.some((o) => o.isYou && o.ptaName === "Form 1 Arts PTA"), "(A) dad2's OWN Form Chair carries the 'You' hat (own-hats is per-viewer)");
      ok(!dadView.officers.some((o) => o.ptaName === "Form 2 Science PTA"), "(A) mom's Form (2 Science) officer is NOT visible to dad2 (0 cross-family)");
      ok(dadView.minutes.length === 2, `(B) dad2 sees 2 adopted minutes (General + his own Form), got ${dadView.minutes.length}`);
      ok(dadView.minutes.some((m) => m.ptaName === "General PTA"), "(B) dad2 reads the General adopted minutes (he is a General member)");
      ok(dadView.minutes.some((m) => m.ptaName === "Form 1 Arts PTA"), "(B) dad2 reads his own Form's adopted minutes");

      // ============================ NON-PARENT (a teacher user — no guardian row) ============================
      await tx.execute(setScope(schoolA, teacher));
      console.log("\n── (55b/58) NON-PARENT (teacher) — 0 officers, 0 adopted minutes, 0 house names ──");
      ok((await tx.select({ id: ptaOfficer.id }).from(ptaOfficer)).length === 0, "pta_officer: a non-parent (teacher) sees 0 officers");
      ok((await tx.select({ id: ptaMinutes.id }).from(ptaMinutes)).length === 0, "pta_minutes: a non-parent (teacher) sees 0 adopted minutes");
      ok(((await tx.execute(sql`SELECT house_id FROM parent_house_names(${schoolA}::uuid, ${teacher}::uuid)`)) as unknown as unknown[]).length === 0, "(58·PP58-6) parent_house_names returns 0 for a NON-parent (teacher — no children)");
      ok((await tx.select({ id: houses.id }).from(houses)).length === 0, "(58·PP58-10) `house` direct-SELECT stays 0 for a non-parent too (parent_deny)");
      const teacherView = await loadParentPtaTx(tx, schoolA, teacher, now);
      ok(teacherView.officers.length === 0 && teacherView.minutes.length === 0, `(reader) non-parent officers+minutes = 0, got ${teacherView.officers.length}/${teacherView.minutes.length}`);

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
