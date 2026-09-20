import "@/db/_loadenv";
import { randomUUID } from "node:crypto";
import { and, eq, like, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { withSchool, withoutTenantScope, isUniqueViolation } from "@/lib/db/rls";
import { getMinutesView, resolvePtaChairAccess, loadResolutionSeqStart } from "@/lib/pta/minutes-data";
import { loadMeetingScope, resolvePtaWriteAccess } from "@/lib/pta/meeting-data";
import {
  adoptedFenceError,
  resolutionQuorumError,
  resolutionScopeToken,
  formatResolutionNo,
  slugToken,
} from "@/lib/pta/minutes";
import { isPtaMeetingEnded, isPtaMeetingWriteLocked } from "@/lib/pta/meeting-clock";
import {
  schools,
  users,
  roleAssignments,
  classes,
  students,
  studentGuardians,
  academicPeriod,
  ptas,
  ptaOfficer,
  ptaMeeting,
  ptaMinutes,
  ptaAgendaItem,
  ptaActionItem,
  ptaResolution,
} from "@/db/schema";
import type { Tx } from "@/lib/db";

const ROLE = {
  FORM_MASTER: "3db6ce35-4a95-4623-9c2f-3547ce2c539f",
  PARENT: "fb6e6ef5-3d81-4048-917c-be8083462e0b",
};
const MARK = "ZZMIN";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
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

async function cleanup(schoolId: string) {
  await withoutTenantScope(async (tx) => {
    const markerPtas = await tx
      .select({ id: ptas.id })
      .from(ptas)
      .leftJoin(classes, and(eq(classes.schoolId, ptas.schoolId), eq(classes.id, ptas.classId)))
      .where(and(eq(ptas.schoolId, schoolId), like(classes.name, MARK + "%")));
    const ptaIds = markerPtas.map((r) => r.id);
    if (ptaIds.length) {
      const ms = await tx.select({ id: ptaMeeting.id }).from(ptaMeeting).where(inArray(ptaMeeting.ptaId, ptaIds));
      const mIds = ms.map((m) => m.id);
      if (mIds.length) {
        const mins = await tx.select({ id: ptaMinutes.id }).from(ptaMinutes).where(inArray(ptaMinutes.meetingId, mIds));
        const minIds = mins.map((m) => m.id);
        if (minIds.length) {
          const ais = await tx.select({ id: ptaAgendaItem.id }).from(ptaAgendaItem).where(inArray(ptaAgendaItem.minutesId, minIds));
          const aiIds = ais.map((a) => a.id);
          if (aiIds.length) {
            await tx.delete(ptaActionItem).where(inArray(ptaActionItem.agendaItemId, aiIds));
            await tx.delete(ptaResolution).where(inArray(ptaResolution.agendaItemId, aiIds));
          }
          await tx.delete(ptaAgendaItem).where(inArray(ptaAgendaItem.minutesId, minIds));
          await tx.delete(ptaMinutes).where(inArray(ptaMinutes.id, minIds));
        }
      }
      await tx.delete(ptaMeeting).where(inArray(ptaMeeting.ptaId, ptaIds));
      await tx.delete(ptaOfficer).where(inArray(ptaOfficer.ptaId, ptaIds));
      await tx.delete(ptas).where(inArray(ptas.id, ptaIds));
    }
    const markerStudents = await tx.select({ id: students.id }).from(students).where(and(eq(students.schoolId, schoolId), like(students.studentCode, MARK + "%")));
    if (markerStudents.length) {
      await tx.delete(studentGuardians).where(inArray(studentGuardians.studentId, markerStudents.map((s) => s.id)));
      await tx.delete(students).where(inArray(students.id, markerStudents.map((s) => s.id)));
    }
    const markerClasses = await tx.select({ id: classes.id }).from(classes).where(and(eq(classes.schoolId, schoolId), like(classes.name, MARK + "%")));
    const markerUsers = await tx.select({ id: users.id }).from(users).where(like(users.fullName, MARK + "%"));
    if (markerUsers.length) await tx.delete(roleAssignments).where(inArray(roleAssignments.userId, markerUsers.map((u) => u.id)));
    if (markerClasses.length) await tx.delete(classes).where(inArray(classes.id, markerClasses.map((c) => c.id)));
    if (markerUsers.length) await tx.delete(users).where(inArray(users.id, markerUsers.map((u) => u.id)));
  });
}

async function main() {
  const [school] = await db.select({ id: schools.id }).from(schools).where(eq(schools.gesCode, "WR-WAW-014"));
  if (!school) throw new Error("demo school not found");
  const schoolId = school.id;
  console.log(`\nSchool: ${schoolId}`);
  await cleanup(schoolId);

  const fmId = randomUUID();
  const chairId = randomUUID();
  const classId = randomUUID();
  const s1 = randomUUID(), s2 = randomUUID();
  const formPtaId = randomUUID();
  let meeting1 = "";
  let meeting2 = "";
  let periodId = "";

  await withoutTenantScope(async (tx) => {
    periodId = await seniorPeriod(tx, schoolId);
    await tx.insert(users).values([
      { id: fmId, phone: "+233200000801", fullName: `${MARK} Mensah FormMaster` },
      { id: chairId, phone: "+233200000802", fullName: `${MARK} Adjei Chair` },
    ]);
    await tx.insert(roleAssignments).values([
      { userId: fmId, schoolId, roleId: ROLE.FORM_MASTER, startDate: "2025-09-01" },
      { userId: chairId, schoolId, roleId: ROLE.PARENT, startDate: "2025-09-01" },
    ]);
    await tx.insert(classes).values({ id: classId, schoolId, name: `${MARK} Form 2 GA A`, classTeacherUserId: fmId, active: true });
    await tx.insert(students).values([
      { id: s1, schoolId, studentCode: `${MARK}-001`, firstName: `${MARK} Kwame`, lastName: "Adjei", sex: "MALE", classId },
      { id: s2, schoolId, studentCode: `${MARK}-002`, firstName: `${MARK} Ama`, lastName: "Boateng", sex: "FEMALE", classId },
    ]);
    await tx.insert(studentGuardians).values([
      { schoolId, studentId: s1, name: `${MARK} Adjei Chair`, relationship: "FATHER", phone: "+233200000802", isPrimary: true, userId: chairId },
      { schoolId, studentId: s2, name: `${MARK} Joana Boateng`, relationship: "MOTHER", phone: "+233200000803", isPrimary: true },
    ]);
    await tx.insert(ptas).values({ id: formPtaId, schoolId, tierType: "FORM", classId, status: "ACTIVE" });
    // Chair = a stored parent officer (identity, not a role).
    await tx.insert(ptaOfficer).values({
      schoolId, ptaId: formPtaId, personUserId: chairId, office: "Chair",
      assignmentBasis: "ELECTED", electionRef: `${MARK} AGM`, termStart: "2025-10-01",
    });
    // A CLOSED meeting: a PAST date so (real now) is ENDED + WRITE-LOCKED. quorum_met = true.
    const agenda = { items: [{ text: "Welcome and prayer", durationMin: null, done: false }, { text: "Cape Coast trip funding", durationMin: null, done: false }, { text: "Weekly check-in calls", durationMin: null, done: false }] };
    const [m1] = await tx.insert(ptaMeeting).values({
      schoolId, ptaId: formPtaId, academicPeriodId: periodId,
      meetingType: `${MARK} Term 2 meeting`, meetingDate: "2026-07-01", startTime: "10:00", endTime: "12:00",
      location: "Block C4", agendaJson: agenda, quorumMet: true,
    }).returning({ id: ptaMeeting.id });
    meeting1 = m1.id;
    const [m2] = await tx.insert(ptaMeeting).values({
      schoolId, ptaId: formPtaId, academicPeriodId: periodId,
      meetingType: `${MARK} Term 2 follow-up`, meetingDate: "2026-07-08", startTime: "10:00", endTime: "12:00",
      quorumMet: true,
    }).returning({ id: ptaMeeting.id });
    meeting2 = m2.id;
  });

  console.log(`\nMarker IDs → school=${schoolId}`);
  console.log(`  formPta=${formPtaId}  meeting1=${meeting1}  meeting2=${meeting2}  classId=${classId}`);
  console.log(`  fmUser=${fmId}  chairUser=${chairId}  period=${periodId}  students=${s1},${s2}`);

  const fmViewer = { userId: fmId, roles: ["FORM_MASTER"] };
  const chairViewer = { userId: chairId, roles: ["PARENT"] };
  const NOW = new Date(); // real now — the 2026-07-01 meeting is long ended + write-locked

  // ── PROOF 1: pre-draft reader — Secretary can draft, meeting ended, quorum ok, no minute yet
  const pre = await getMinutesView(schoolId, meeting1, fmViewer, NOW);
  if (!pre) throw new Error("reader returned null");
  check("no minute yet → minutesId null; meeting ENDED + write-locked", pre.minutesId === null && pre.meetingEnded === true && pre.writeLocked === true);
  check("FM (ex-officio Secretary) canDraft; not Chair → canAdopt false", pre.canDraft === true && pre.canAdopt === false);
  check("quorum_met=true → NOT below quorum", pre.belowQuorum === false);
  const preChair = await getMinutesView(schoolId, meeting1, chairViewer, NOW);
  check("Chair (parent, identity) → canAdopt true; not Secretary → canDraft false", preChair!.canAdopt === true && preChair!.canDraft === false);

  // ── PROOF 2 (clock gates): draft-after-end vs adopt-after-lock
  await withSchool(schoolId, async (tx) => {
    const scope = await loadMeetingScope(tx, schoolId, meeting1);
    check("isPtaMeetingEnded past meeting → true", isPtaMeetingEnded(scope!.meetingDate, scope!.endTime, NOW) === true);
    check("isPtaMeetingWriteLocked past meeting → true (adopt gate open)", isPtaMeetingWriteLocked(scope!.meetingDate, scope!.endTime, 24, NOW) === true);
    // a hypothetical FUTURE meeting: neither gate open
    check("a FUTURE meeting → NOT ended, NOT locked", isPtaMeetingEnded("2999-01-01", "12:00", NOW) === false && isPtaMeetingWriteLocked("2999-01-01", "12:00", 24, NOW) === false);
    // the write-gate live (no bare role)
    const fmAcc = await resolvePtaWriteAccess(tx, schoolId, scope!, fmViewer);
    const randAcc = await resolvePtaWriteAccess(tx, schoolId, scope!, { userId: randomUUID(), roles: ["FORM_MASTER", "TEACHER"] });
    const chairAdopt = await resolvePtaChairAccess(tx, schoolId, formPtaId, chairViewer);
    const randAdopt = await resolvePtaChairAccess(tx, schoolId, formPtaId, { userId: randomUUID(), roles: ["PARENT", "TEACHER"] });
    check("write-gate: FM-Secretary canWrite; a bare FORM_MASTER (no office) refused", fmAcc.canWrite === true && randAcc.canWrite === false);
    check("chair-gate: stored Chair adopts; a bare role refused (no-role-alone)", chairAdopt === true && randAdopt === false);
  });

  // ── seed a DRAFT minute + subtree (mimics createDraftMinutes + classify + children)
  let ai1 = "", ai2 = "", ai3 = "", minutes1 = "";
  await withoutTenantScope(async (tx) => {
    const [min] = await tx.insert(ptaMinutes).values({ schoolId, meetingId: meeting1, status: "DRAFT", secretaryId: fmId }).returning({ id: ptaMinutes.id });
    minutes1 = min.id;
    const rows = await tx.insert(ptaAgendaItem).values([
      { schoolId, minutesId: min.id, seqNo: 1, title: "Welcome and prayer", classification: "DISCUSSION", narrative: "Opened at 10:23." },
      { schoolId, minutesId: min.id, seqNo: 2, title: "Cape Coast trip funding", classification: "RESOLUTION", narrative: "Voted by show of hands." },
      { schoolId, minutesId: min.id, seqNo: 3, title: "Weekly check-in calls", classification: "ACTION", narrative: "FM to begin calls." },
    ]).returning({ id: ptaAgendaItem.id, seqNo: ptaAgendaItem.seqNo });
    ai1 = rows.find((r) => r.seqNo === 1)!.id;
    ai2 = rows.find((r) => r.seqNo === 2)!.id;
    ai3 = rows.find((r) => r.seqNo === 3)!.id;
    await tx.insert(ptaResolution).values({ schoolId, agendaItemId: ai2, resolutionText: "RESOLVED THAT the trip is funded.", votesFor: 16, votesAgainst: 3, votesAbstain: 2, binding: true });
    await tx.insert(ptaActionItem).values({ schoolId, agendaItemId: ai3, description: "Begin weekly check-in calls", personUserId: fmId, deadline: null });
  });

  // ── PROOF 3 (reader derivations): outcome, provisional number, owner name, validator
  const draft = await getMinutesView(schoolId, meeting1, fmViewer, NOW);
  const resItem = draft!.agendaItems.find((i) => i.classification === "RESOLUTION");
  const actItem = draft!.agendaItems.find((i) => i.classification === "ACTION");
  check("resolution outcome DERIVED PASSED (16 > 3)", resItem?.resolution?.outcome === "PASSED");
  const scopeTok = resolutionScopeToken("FORM", `${MARK} Form 2 GA A`, null, formPtaId);
  check("provisional resolution number = {scope}-{period}-001 (frozen number still NULL)", resItem?.resolution?.provisionalNo?.startsWith(scopeTok) === true && resItem?.resolution?.provisionalNo?.endsWith("-001") === true && resItem?.resolution?.resolutionNo === null, resItem?.resolution?.provisionalNo);
  check("action owner name DERIVED from person_user_id (the Form Master)", actItem?.action?.ownerName === `${MARK} Mensah FormMaster` && actItem?.action?.deadlineLabel === "Ongoing");
  check("R455 validator canSubmit (all classified · action owned · resolution voted · quorum)", draft!.validator.canSubmit === true);

  // ── PROOF 4 (quorum→resolution gate): flip quorum false → guard refuses + reader disables RESOLUTION
  await withoutTenantScope((tx) => tx.update(ptaMeeting).set({ quorumMet: false }).where(eq(ptaMeeting.id, meeting1)));
  check("resolutionQuorumError(false) REFUSES (R452 guard)", resolutionQuorumError(false) !== null && resolutionQuorumError(true) === null);
  const belowView = await getMinutesView(schoolId, meeting1, fmViewer, NOW);
  check("reader belowQuorum true when quorum_met=false", belowView!.belowQuorum === true);
  await withoutTenantScope((tx) => tx.update(ptaMeeting).set({ quorumMet: true }).where(eq(ptaMeeting.id, meeting1)));

  // ── PROOF 5 (numbering at adoption, live cursor + UNIQUE guard): assign 001 to minute1's resolution,
  //     continue to 002 for a second resolution, and prove the school-level UNIQUE rejects a duplicate.
  await withSchool(schoolId, async (tx) => {
    const period = await tx.select({ label: academicPeriod.periodLabel }).from(academicPeriod).where(and(eq(academicPeriod.schoolId, schoolId), eq(academicPeriod.periodId, periodId))).limit(1);
    const periodTok = slugToken(period[0]?.label ?? "");
    let start = await loadResolutionSeqStart(tx, schoolId, formPtaId, periodId);
    check("loadResolutionSeqStart = 1 with no adopted resolutions yet", start === 1);
    const no1 = formatResolutionNo(scopeTok, periodTok, start);
    await tx.update(ptaResolution).set({ resolutionNo: no1 }).where(eq(ptaResolution.agendaItemId, ai2));
    // a second resolution (meeting2 minute) in the SAME pta × period → continues to 002
  });
  // seed meeting2's minute + resolution, then number it
  let ai4 = "";
  await withoutTenantScope(async (tx) => {
    const [min2] = await tx.insert(ptaMinutes).values({ schoolId, meetingId: meeting2, status: "DRAFT", secretaryId: fmId }).returning({ id: ptaMinutes.id });
    const [a] = await tx.insert(ptaAgendaItem).values({ schoolId, minutesId: min2.id, seqNo: 1, title: "Uniform levy", classification: "RESOLUTION" }).returning({ id: ptaAgendaItem.id });
    ai4 = a.id;
    await tx.insert(ptaResolution).values({ schoolId, agendaItemId: ai4, resolutionText: "RESOLVED THAT a levy applies.", votesFor: 10, votesAgainst: 2, votesAbstain: 0, binding: true });
  });
  await withSchool(schoolId, async (tx) => {
    const period = await tx.select({ label: academicPeriod.periodLabel }).from(academicPeriod).where(and(eq(academicPeriod.schoolId, schoolId), eq(academicPeriod.periodId, periodId))).limit(1);
    const periodTok = slugToken(period[0]?.label ?? "");
    const start = await loadResolutionSeqStart(tx, schoolId, formPtaId, periodId);
    check("loadResolutionSeqStart continues to 2 across meetings in one (pta × period)", start === 2, `start=${start}`);
    const no2 = formatResolutionNo(scopeTok, periodTok, start);
    await tx.update(ptaResolution).set({ resolutionNo: no2 }).where(eq(ptaResolution.agendaItemId, ai4));
    check("second number ends -002", no2.endsWith("-002"), no2);
  });
  // the UNIQUE(school_id, resolution_no) guard rejects a duplicate number
  let dupRejected = false;
  try {
    await withoutTenantScope((tx) => tx.update(ptaResolution).set({ resolutionNo: formatResolutionNo(scopeTok, "X", 1) }).where(eq(ptaResolution.agendaItemId, ai4)));
    // now force a real collision: set ai4's number equal to ai2's number
    const [r2no] = await withoutTenantScope((tx) => tx.select({ no: ptaResolution.resolutionNo }).from(ptaResolution).where(eq(ptaResolution.agendaItemId, ai2)));
    await withoutTenantScope((tx) => tx.update(ptaResolution).set({ resolutionNo: r2no.no }).where(eq(ptaResolution.agendaItemId, ai4)));
  } catch (e) {
    dupRejected = isUniqueViolation(e);
  }
  check("UNIQUE(school_id, resolution_no) REJECTS a duplicate number (R453 guard)", dupRejected);

  // ── PROOF 6 (🔴 R451 immutability fence): adopt minute1 → the fence refuses, and the DB has NO backstop
  await withoutTenantScope((tx) => tx.update(ptaMinutes).set({ status: "ADOPTED", adoptedAt: new Date(), adoptedByUserId: chairId }).where(eq(ptaMinutes.id, minutes1)));
  const adoptedView = await getMinutesView(schoolId, meeting1, fmViewer, NOW);
  check("adopted minute renders read-only (status ADOPTED)", adoptedView!.status === "ADOPTED");
  check("adoptedFenceError('ADOPTED') REFUSES — the guard EVERY mutating action calls", adoptedFenceError("ADOPTED") !== null && adoptedFenceError("DRAFT") === null);
  // prove the fence is APP-enforced (no DB trigger/constraint stops a raw subtree write) → the guard is load-bearing
  let dbAllowedRawEdit: boolean = false;
  await withoutTenantScope(async (tx) => {
    await tx.update(ptaAgendaItem).set({ narrative: "TAMPERED" }).where(eq(ptaAgendaItem.id, ai1));
    const [row] = await tx.select({ n: ptaAgendaItem.narrative }).from(ptaAgendaItem).where(eq(ptaAgendaItem.id, ai1));
    dbAllowedRawEdit = row.n === "TAMPERED";
    await tx.update(ptaAgendaItem).set({ narrative: "Opened at 10:23." }).where(eq(ptaAgendaItem.id, ai1)); // restore
  });
  check("DB has NO immutability backstop (raw edit of an adopted subtree succeeds) → the app fence is the ONLY guard", dbAllowedRawEdit);

  // ── CLEANUP
  await cleanup(schoolId);
  const leftover = await withoutTenantScope((tx) => tx.select({ n: sql<number>`count(*)::int` }).from(ptas).where(and(eq(ptas.schoolId, schoolId), eq(ptas.id, formPtaId))));
  check("cleanup: marker PTA + subtree removed", leftover[0]?.n === 0);

  console.log(`\n${failures === 0 ? "✅ ALL CHECKS PASSED" : `❌ ${failures} CHECK(S) FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
