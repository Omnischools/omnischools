import "@/db/_loadenv";
import { randomUUID } from "node:crypto";
import { and, eq, like, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { withSchool, withoutTenantScope } from "@/lib/db/rls";
import {
  getPtaMeeting,
  loadMeetingScope,
  resolvePtaWriteAccess,
} from "@/lib/pta/meeting-data";
import { coalescePtaTiers, reconcilePtas, type PtaTierType } from "@/lib/pta/defaults";
import {
  schools,
  users,
  roleAssignments,
  classes,
  houses,
  students,
  studentGuardians,
  ptas,
  ptaOfficer,
  ptaMeeting,
  ptaMeetingAttendance,
  ptaTiersConfig,
  academicPeriod,
} from "@/db/schema";
import type { Tx } from "@/lib/db";

const ROLE = {
  FORM_MASTER: "3db6ce35-4a95-4623-9c2f-3547ce2c539f",
  PARENT: "fb6e6ef5-3d81-4048-917c-be8083462e0b",
};
const MARK = "ZZMEET";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

async function cleanup(schoolId: string) {
  await withoutTenantScope(async (tx) => {
    // meetings + attendance for our marker PTAs (marker class / on-demand emergency created here)
    const markerPtas = await tx
      .select({ id: ptas.id })
      .from(ptas)
      .leftJoin(classes, and(eq(classes.schoolId, ptas.schoolId), eq(classes.id, ptas.classId)))
      .where(and(eq(ptas.schoolId, schoolId), sql`(${classes.name} like ${MARK + "%"} or ${ptas.tierType} = 'EMERGENCY')`));
    const ptaIds = markerPtas.map((r) => r.id);
    if (ptaIds.length) {
      const ms = await tx.select({ id: ptaMeeting.id }).from(ptaMeeting).where(inArray(ptaMeeting.ptaId, ptaIds));
      const mIds = ms.map((m) => m.id);
      if (mIds.length) await tx.delete(ptaMeetingAttendance).where(inArray(ptaMeetingAttendance.meetingId, mIds));
      await tx.delete(ptaMeeting).where(inArray(ptaMeeting.ptaId, ptaIds));
      await tx.delete(ptaOfficer).where(inArray(ptaOfficer.ptaId, ptaIds));
      await tx.delete(ptas).where(inArray(ptas.id, ptaIds));
    }
    await tx.delete(studentGuardians).where(and(eq(studentGuardians.schoolId, schoolId), like(studentGuardians.name, MARK + "%")));
    const markerStudents = await tx.select({ id: students.id }).from(students).where(and(eq(students.schoolId, schoolId), like(students.studentCode, MARK + "%")));
    if (markerStudents.length) {
      await tx.delete(studentGuardians).where(inArray(studentGuardians.studentId, markerStudents.map((s) => s.id)));
      await tx.delete(students).where(inArray(students.id, markerStudents.map((s) => s.id)));
    }
    const markerClasses = await tx.select({ id: classes.id }).from(classes).where(and(eq(classes.schoolId, schoolId), like(classes.name, MARK + "%")));
    // role assignments + users for our marker people
    const markerUsers = await tx.select({ id: users.id }).from(users).where(like(users.fullName, MARK + "%"));
    if (markerUsers.length) {
      await tx.delete(roleAssignments).where(inArray(roleAssignments.userId, markerUsers.map((u) => u.id)));
    }
    if (markerClasses.length) await tx.delete(classes).where(inArray(classes.id, markerClasses.map((c) => c.id)));
    if (markerUsers.length) await tx.delete(users).where(inArray(users.id, markerUsers.map((u) => u.id)));
  });
}

async function main() {
  const [school] = await db.select({ id: schools.id }).from(schools).where(eq(schools.gesCode, "WR-WAW-014"));
  if (!school) throw new Error("demo school not found");
  const schoolId = school.id;
  console.log(`\nSchool: ${schoolId}`);
  await cleanup(schoolId); // idempotent re-runs

  // ── SETUP (RLS-bypass; marker data) ──────────────────────────────────────────────
  const fmId = randomUUID();
  const chairId = randomUUID();
  const classId = randomUUID();
  const s1 = randomUUID(), s2 = randomUUID(), s3 = randomUUID();
  const formPtaId = randomUUID();
  const emergencyPtaId = randomUUID();
  let formMeetingId = "";
  let emergencyMeetingId = "";

  await withoutTenantScope(async (tx) => {
    await tx.insert(users).values([
      { id: fmId, phone: "+233200000901", fullName: `${MARK} Mensah FormMaster` },
      { id: chairId, phone: "+233200000902", fullName: `${MARK} Samuel Adjei` },
    ]);
    await tx.insert(roleAssignments).values([
      { userId: fmId, schoolId, roleId: ROLE.FORM_MASTER, startDate: "2025-09-01" },
      { userId: chairId, schoolId, roleId: ROLE.PARENT, startDate: "2025-09-01" },
    ]);
    await tx.insert(classes).values({ id: classId, schoolId, name: `${MARK} Form 2 GA A`, classTeacherUserId: fmId, active: true });
    await tx.insert(students).values([
      { id: s1, schoolId, studentCode: `${MARK}-001`, firstName: `${MARK} Kwame`, lastName: "Adjei", sex: "MALE", classId },
      { id: s2, schoolId, studentCode: `${MARK}-002`, firstName: `${MARK} Ama`, lastName: "Adjei", sex: "FEMALE", classId },
      { id: s3, schoolId, studentCode: `${MARK}-003`, firstName: `${MARK} Kofi`, lastName: "Boateng", sex: "MALE", classId },
    ]);
    await tx.insert(studentGuardians).values([
      // twins Kwame + Ama share ONE guardian person (chair user) → must dedupe to a single parent row
      { schoolId, studentId: s1, name: `${MARK} Samuel Adjei`, relationship: "FATHER", phone: "+233200000902", isPrimary: true, userId: chairId },
      { schoolId, studentId: s2, name: `${MARK} Samuel Adjei`, relationship: "FATHER", phone: "+233200000902", isPrimary: true, userId: chairId },
      // Kofi's SMS-only primary guardian (no ref_user)
      { schoolId, studentId: s3, name: `${MARK} Joana Boateng`, relationship: "MOTHER", phone: "+233200000903", isPrimary: true },
    ]);
    await tx.insert(ptas).values({ id: formPtaId, schoolId, tierType: "FORM", classId, status: "ACTIVE" });
    await tx.insert(ptaOfficer).values({
      schoolId, ptaId: formPtaId, personUserId: chairId, office: "Chair",
      assignmentBasis: "ELECTED", electionRef: `${MARK} AGM 2025`, termStart: "2025-10-01",
    });
    const [fm] = await tx.insert(ptaMeeting).values({
      schoolId, ptaId: formPtaId, academicPeriodId: (await seniorPeriod(tx, schoolId)),
      meetingType: `${MARK} Regular PTA meeting`, meetingDate: "2026-08-01", startTime: "10:00", endTime: "12:00", location: "Block C4",
    }).returning({ id: ptaMeeting.id });
    formMeetingId = fm.id;
  });

  console.log(`\nMarker IDs → school=${schoolId}`);
  console.log(`  formPta=${formPtaId}  formMeeting=${formMeetingId}  classId=${classId}`);
  console.log(`  fmUser=${fmId}  chairUser=${chairId}  students=${s1},${s2},${s3}`);

  const DURING = new Date("2026-08-01T11:00:00Z"); // inside the 10–12 window
  const LOCKED = new Date("2026-08-03T00:00:00Z"); // past 12:00 + 24h grace

  // ── PROOF 1: reader derivation (present-by-default teacher / absent-by-default parent + count-once + tags)
  const fmViewer = { userId: fmId, roles: ["FORM_MASTER"] };
  const view = await getPtaMeeting(schoolId, formMeetingId, fmViewer, DURING);
  if (!view) throw new Error("reader returned null");
  const secretary = view.teacherRows.find((r) => r.officerExOfficio);
  check("teacher = ex-officio Secretary (the Form Master), PRESENT-by-default", !!secretary && secretary.status === "present" && secretary.officerTag === "Secretary (ex-officio)", secretary?.name);
  check("parent register is count-once: twins dedupe → 2 parents (not 3)", view.parentRows.length === 2, `${view.parentRows.length} rows`);
  const samuel = view.parentRows.find((r) => r.officerTag === "Chair");
  check("parent-officer tag on the ONE deduped row (Chair)", !!samuel, samuel?.context);
  check("twins named on the single Samuel row", !!samuel && samuel.context.includes("Kwame") && samuel.context.includes("Ama"));
  check("PARENT absent-by-default = 'awaiting' while live", view.parentRows.every((r) => r.status === "awaiting"));
  check("canWrite TRUE for the Form-Master-Secretary (the gating fix)", view.canWrite === true);

  const viewClosed = await getPtaMeeting(schoolId, formMeetingId, fmViewer, LOCKED);
  check("PARENT unmarked flips to 'absent' once locked (pure derivation)", !!viewClosed && viewClosed.parentRows.every((r) => r.status === "absent"));

  // ── PROOF 2: the write-gate IDOR fence (live, server-loaded offices)
  await withSchool(schoolId, async (tx) => {
    const scope = await loadMeetingScope(tx, schoolId, formMeetingId);
    if (!scope) throw new Error("scope null");
    const fm = await resolvePtaWriteAccess(tx, schoolId, scope, { userId: fmId, roles: ["FORM_MASTER"] });
    const rando = await resolvePtaWriteAccess(tx, schoolId, scope, { userId: randomUUID(), roles: ["TEACHER", "FORM_MASTER"] });
    const chair = await resolvePtaWriteAccess(tx, schoolId, scope, { userId: chairId, roles: ["PARENT"] });
    const admin = await resolvePtaWriteAccess(tx, schoolId, scope, { userId: randomUUID(), roles: ["ADMIN"] });
    check("gate: the class-teacher Secretary CAN write", fm.canWrite === true);
    check("gate: a bare TEACHER/FORM_MASTER (no office) is REFUSED (no-role-alone)", rando.canWrite === false);
    check("gate: the PTA Chair is REFUSED (Chair-write deferred; not the Secretary)", chair.canWrite === false);
    check("gate: ADMIN break-glass CAN write", admin.canWrite === true);
  });

  // ── PROOF 3: a mark persists on the SINGLE deduped row + quorum counts it
  const repGuardianId = samuel!.studentGuardianId;
  await withSchool(schoolId, async (tx) => {
    await tx.insert(ptaMeetingAttendance).values({
      schoolId, meetingId: formMeetingId, register: "PARENT", studentGuardianId: repGuardianId, status: "PRESENT", recordedByUserId: fmId,
    });
  });
  const afterMark = await getPtaMeeting(schoolId, formMeetingId, fmViewer, DURING);
  const samuelAfter = afterMark!.parentRows.find((r) => r.officerTag === "Chair");
  check("mark persists on the deduped row → Samuel PRESENT", samuelAfter?.status === "present");
  check("still exactly one row for Samuel (count-once holds after a mark)", afterMark!.parentRows.length === 2);
  check("quorum present-count (P+L) = 1 after the mark", afterMark!.quorum.presentCount === 1, `${afterMark!.quorum.presentCount}/${afterMark!.quorum.totalParents}`);

  // ── PROOF 4: conveneEmergencyMeeting shape — a NEW EMERGENCY ptas instance + its meeting
  await withoutTenantScope(async (tx) => {
    await tx.insert(ptas).values({ id: emergencyPtaId, schoolId, tierType: "EMERGENCY", classId: null, houseId: null, status: "ACTIVE" });
    const [em] = await tx.insert(ptaMeeting).values({
      schoolId, ptaId: emergencyPtaId, academicPeriodId: (await seniorPeriod(tx, schoolId)),
      meetingType: `${MARK} Emergency PTA meeting`, meetingDate: "2026-08-01", startTime: "14:00", endTime: "15:00",
    }).returning({ id: ptaMeeting.id });
    emergencyMeetingId = em.id;
  });
  const emView = await getPtaMeeting(schoolId, emergencyMeetingId, { userId: fmId, roles: ["ADMIN"] }, DURING);
  check("emergency instance reads as tier EMERGENCY / 'Emergency PTA'", emView?.tierType === "EMERGENCY" && emView?.label === "Emergency PTA");

  // ── PROOF 5 (R441): generatePtas' reconcile must NOT machine-close the live Emergency
  await withSchool(schoolId, async (tx) => {
    const tierRows = await tx.select({
      tierType: ptaTiersConfig.tierType, active: ptaTiersConfig.active, frequencyNorm: ptaTiersConfig.frequencyNorm,
      officerRoles: ptaTiersConfig.officerRoles, quorumRule: ptaTiersConfig.quorumRule, duesEnabled: ptaTiersConfig.duesEnabled,
      duesAmount: ptaTiersConfig.duesAmount, duesBasis: ptaTiersConfig.duesBasis, duesCadence: ptaTiersConfig.duesCadence,
      tierSettings: ptaTiersConfig.tierSettings, configuredAt: ptaTiersConfig.configuredAt,
    }).from(ptaTiersConfig).where(eq(ptaTiersConfig.schoolId, schoolId));
    const tiers = coalescePtaTiers(tierRows).map((t) => ({ tierType: t.tierType, active: t.active }));
    const activeClasses = await tx.select({ id: classes.id }).from(classes).where(and(eq(classes.schoolId, schoolId), eq(classes.active, true)));
    const activeHouses = await tx.select({ id: houses.id }).from(houses).where(and(eq(houses.schoolId, schoolId), eq(houses.active, true)));
    const existing = await tx.select({ tierType: ptas.tierType, classId: ptas.classId, houseId: ptas.houseId, status: ptas.status }).from(ptas).where(eq(ptas.schoolId, schoolId));
    const ops = reconcilePtas(
      tiers, activeClasses, activeHouses,
      existing.map((e) => ({ tierType: e.tierType as PtaTierType, classId: e.classId, houseId: e.houseId, status: e.status as "ACTIVE" | "CLOSED" })),
    );
    const emergencyClose = ops.some((o) => o.tierType === "EMERGENCY" && o.action === "close");
    check("R441: reconcile emits NO close for the live Emergency PTA", emergencyClose === false);
  });
  const emStill = await withSchool(schoolId, (tx) => tx.select({ status: ptas.status }).from(ptas).where(eq(ptas.id, emergencyPtaId)));
  check("R441: the Emergency PTA is STILL ACTIVE", emStill[0]?.status === "ACTIVE");

  // ── CLEANUP ──────────────────────────────────────────────────────────────────────
  await cleanup(schoolId);
  const leftover = await withoutTenantScope((tx) => tx.select({ n: sql<number>`count(*)::int` }).from(ptas).where(and(eq(ptas.schoolId, schoolId), inArray(ptas.id, [formPtaId, emergencyPtaId]))));
  check("cleanup: marker PTAs removed", leftover[0]?.n === 0);

  console.log(`\n${failures === 0 ? "✅ ALL CHECKS PASSED" : `❌ ${failures} CHECK(S) FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

async function seniorPeriod(tx: Tx, schoolId: string): Promise<string> {
  const rows = await tx
    .select({ periodId: academicPeriod.periodId })
    .from(academicPeriod)
    .where(and(eq(academicPeriod.schoolId, schoolId), eq(academicPeriod.productLine, "SENIOR")))
    .orderBy(sql`${academicPeriod.startsOn} desc`)
    .limit(1);
  return rows[0].periodId;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
