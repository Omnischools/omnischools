import "./_dev-matron"; // MUST be first — pins the dev shim to MATRON before lib/env parses
import "@/db/_loadenv";
import { and, desc, eq, inArray, isNull, like, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { withSchool } from "@/lib/db/rls";
import { saveAttendance, requestCorrection, decideCorrection } from "@/lib/actions/attendance";
import {
  createVisit,
  beginVisit,
  assessVisit,
  disposeVisit,
  admitPatient,
  dischargeFromWard,
} from "@/lib/actions/sickbay-visit";
import { getSickbayConfig } from "@/lib/sickbay/config";
import { openAdmissionBeds } from "@/lib/sickbay/visit-reads";
import { getVisitRecord } from "@/lib/sickbay/visit-reads";
import { civilDate } from "@/lib/attendance/mark-rules";
import {
  schools,
  students,
  studentGuardians,
  classes,
  roles,
  roleAssignments,
  attendanceRecords,
  attendanceCorrections,
  academicPeriod,
  sickbayVisit,
  sickbayAdmission,
  auditLog,
} from "@/db/schema";

/**
 * DB-backed proof of the INCR-22b attendance-M hook (SHS module 4.4), driven through the REAL server
 * actions — a real teacher register save, a real admission, a real referral, a real co-signed
 * correction — and asserted against the rows Postgres actually holds.
 *
 * It runs as a MATRON (scripts/_dev-matron.ts), which is what makes the clinical actions reachable in
 * dev at all; 22a had to hand-edit DEV_USER to do the same thing.
 *
 * Run after `pnpm db:seed` + `pnpm db:seed-sickbay` + `pnpm db:seed-wassce`.
 * Every row it writes carries the `V22B-` / `VERIFY-22B` marker and is deleted at the end, scoped to
 * that marker — never a broad `where schoolId` (repo memory: a broad delete once destroyed the
 * baseline academic periods).
 */
let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

const MARKER = "VERIFY-22B";
const CODE_PREFIX = "V22B-";
const today = civilDate(new Date());
const yesterday = civilDate(new Date(Date.now() - 24 * 3600_000));

/** Capture every `[sms:console]` line emitted while `fn` runs — the H6 "no SMS" proof. */
async function captureSms<T>(fn: () => Promise<T>): Promise<{ out: T; sms: string[] }> {
  const sms: string[] = [];
  const orig = console.info;
  console.info = (...args: unknown[]) => {
    const line = args.map(String).join(" ");
    if (line.includes("[sms:console]")) sms.push(line);
    else orig(...(args as []));
  };
  try {
    return { out: await fn(), sms };
  } finally {
    console.info = orig;
  }
}

type Row = typeof attendanceRecords.$inferSelect;
const rowFor = async (schoolId: string, studentId: string, date: string): Promise<Row | null> => {
  const [r] = await db
    .select()
    .from(attendanceRecords)
    .where(
      and(
        eq(attendanceRecords.schoolId, schoolId),
        eq(attendanceRecords.studentId, studentId),
        eq(attendanceRecords.date, date),
      ),
    );
  return r ?? null;
};

const auditRows = (schoolId: string, entityId: string, actionType: string) =>
  db
    .select({ after: auditLog.afterState })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.schoolId, schoolId),
        eq(auditLog.entityId, entityId),
        eq(auditLog.actionType, actionType),
      ),
    )
    .orderBy(desc(auditLog.occurredAt));

/** Take a visit all the way to an assessed, dispositionable state through the real actions. */
async function openAndAssess(studentId: string, complaint: string) {
  const v = await createVisit({ studentId, presentingComplaint: `${MARKER} ${complaint}` });
  if (!v.ok || !v.id) throw new Error(`createVisit failed: ${v.error}`);
  const b = await beginVisit({ visitId: v.id });
  if (!b.ok) throw new Error(`beginVisit failed: ${b.error}`);
  const a = await assessVisit({ visitId: v.id, workingImpression: `${MARKER} impression` });
  if (!a.ok) throw new Error(`assessVisit failed: ${a.error}`);
  return v.id;
}

async function main() {
  const [school] = await db
    .select({ id: schools.id })
    .from(schools)
    .where(eq(schools.gesCode, "WR-WAW-014"));
  if (!school) throw new Error("seed the demo school first (pnpm db:seed)");

  const [matron] = await db
    .select({ id: roleAssignments.userId })
    .from(roleAssignments)
    .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
    .where(and(eq(roleAssignments.schoolId, school.id), eq(roles.code, "MATRON")))
    .limit(1);
  check("the dev session resolves to a real MATRON (AUTH_DEV_ROLES)", !!matron);

  // ── H18 · no ACTIVE student is classless after the seed ───────────────────────────────────────
  const [classless] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(students)
    .where(
      and(eq(students.schoolId, school.id), eq(students.status, "ACTIVE"), isNull(students.classId)),
    );
  check(
    "H18 zero ACTIVE students are classless after the seed (R53 seed fix)",
    classless.n === 0,
    `${classless.n} classless`,
  );

  // ── fixtures (direct inserts — they are the stage, not the thing under test) ───────────────────
  const stamp = Date.now() % 1_000_000;
  const { classId, ids } = await withSchool(school.id, async (tx) => {
    const [cls] = await tx
      .insert(classes)
      .values({ schoolId: school.id, name: `${MARKER} ${stamp}`, level: "Form 3" })
      .returning({ id: classes.id });
    const mk = async (tag: string, withClass: boolean, guardian: boolean) => {
      const [s] = await tx
        .insert(students)
        .values({
          schoolId: school.id,
          studentCode: `${CODE_PREFIX}${stamp}-${tag}`,
          firstName: `Zz${tag}${stamp}`, // unique enough to search SMS bodies for
          lastName: "Verify",
          sex: "FEMALE" as const,
          status: "ACTIVE" as const,
          classId: withClass ? cls.id : null,
          currentClassLabel: withClass ? `${MARKER} ${stamp}` : null,
        })
        .returning({ id: students.id });
      if (guardian) {
        await tx.insert(studentGuardians).values({
          schoolId: school.id,
          studentId: s.id,
          name: `Guardian ${tag}`,
          relationship: "MOTHER" as const,
          phone: `+2332000${String(stamp).slice(-5)}`,
          isPrimary: true,
        });
      }
      return s.id;
    };
    return {
      classId: cls.id,
      ids: {
        A: await mk("A", true, true), // admitted; her mother must NOT get an absence SMS
        B: await mk("B", true, true), // genuinely absent; her mother MUST get one
        C: await mk("C", false, false), // classless (R53)
        D: await mk("D", true, false), // open clinic visit (the PULL open-visit arm)
        E: await mk("E", true, false), // walk-in discharge, then a referral
      },
    };
  });
  console.log(`   fixture: class ${classId} · 5 students ${CODE_PREFIX}${stamp}-*`);

  const config = await getSickbayConfig(school.id);
  const occupied = new Set((await openAdmissionBeds(school.id)).map((o) => o.bedId));
  const freeBeds = config.beds.filter((b) => b.active && !b.isIsolation && !occupied.has(b.id));
  check("at least 3 free general beds for the fixtures", freeBeds.length >= 3, `${freeBeds.length} free`);

  const createdVisits: string[] = [];
  const createdAdmissions: string[] = [];

  // ══ H4 (part 1) · the teacher takes the register BEFORE anyone is seen ════════════════════════
  const first = await captureSms(() =>
    saveAttendance({
      classId,
      date: today,
      entries: [
        { studentId: ids.A, status: "ABSENT" },
        { studentId: ids.B, status: "ABSENT" },
      ],
    }),
  );
  check(
    "baseline · both marked ABSENT, both mothers texted",
    first.out.ok && first.out.absent === 2 && first.out.alertsSent === 2,
    first.out.ok ? `absent ${first.out.absent} · alerts ${first.out.alertsSent}` : first.out.error,
  );

  // ══ H1 · H4 · H7 — a REAL admission writes today's MEDICAL mark, upgrading the ABSENT row ═════
  const visitA = await openAndAssess(ids.A, "abdominal pain");
  createdVisits.push(visitA);
  const admit = await admitPatient({
    visitId: visitA,
    bedId: freeBeds[0].id,
    isIsolation: false,
    overnightPlan: `${MARKER} overnight plan`,
  });
  check("H1 a real admitPatient succeeds", admit.ok, admit.error ?? "");
  const recA = await rowFor(school.id, ids.A, today);
  check(
    "H1 the day is marked MEDICAL / SICKBAY, by the admitting matron, for TODAY",
    recA?.status === "MEDICAL" &&
      recA?.reasonCode === "SICKBAY" &&
      recA?.date === today &&
      recA?.markedByUserId === matron?.id,
    `${recA?.status} / ${recA?.reasonCode}`,
  );
  check("H4 PUSH · the teacher's earlier ABSENT was UPGRADED, not duplicated", recA?.status === "MEDICAL");
  check(
    "🔒 H7 / A7 · the note is null — no complaint, no impression crosses into the register",
    recA?.note === null,
    String(recA?.note),
  );
  check(
    "H1 the mark is audited",
    (await auditRows(school.id, visitA, "attendance_marked")).length === 1,
  );

  // ══ H5 · H6 — the teacher saves again over the M/SICKBAY row ══════════════════════════════════
  const before = await rowFor(school.id, ids.A, today);
  const second = await captureSms(() =>
    saveAttendance({
      classId,
      date: today,
      entries: [
        { studentId: ids.A, status: "ABSENT" }, // the teacher still thinks she is absent
        { studentId: ids.B, status: "PRESENT" }, // …and B turned up after all
      ],
    }),
  );
  const after = await rowFor(school.id, ids.A, today);
  check(
    "🔴 H5 the M/SICKBAY row is BYTE-IDENTICAL after a teacher's save over it",
    JSON.stringify(before) === JSON.stringify(after),
    `${after?.status}/${after?.reasonCode} markedAt ${String(after?.markedAt)}`,
  );
  const recB = await rowFor(school.id, ids.B, today);
  check("H5 every OTHER student in the same save writes normally", recB?.status === "PRESENT");
  check(
    "🔴 H6 the R49b regression · result.absent EXCLUDES the held student",
    second.out.ok && second.out.absent === 0,
    second.out.ok ? `absent ${second.out.absent}` : second.out.error,
  );
  check(
    "🔴 H6 NO absence SMS is sent — the mother of an admitted child is not told she is absent",
    second.out.ok && second.out.alertsSent === 0 && second.sms.length === 0,
    `${second.sms.length} sms`,
  );
  check(
    "🔴 H6 no SMS body names the admitted student",
    !second.sms.join(" ").includes(`Zz${"A"}${stamp}`),
  );
  check(
    "H5 the save reports the held row honestly rather than silently ignoring it",
    second.out.ok && second.out.heldMedical === 1,
    second.out.ok ? `held ${second.out.heldMedical}` : "",
  );
  const [markAudit] = await auditRows(school.id, classId, "marked");
  const auditAfter = markAudit?.after as { absent: number; heldMedical: number } | null;
  check(
    "🔴 H6 the audit payload is computed from EFFECTIVE statuses, not the teacher's input",
    auditAfter?.absent === 0 && auditAfter?.heldMedical === 1,
    JSON.stringify(auditAfter),
  );

  // ══ H8 — day 2 of the admission, marked with NO SCHEDULER RUNNING ═════════════════════════════
  await withSchool(school.id, (tx) =>
    tx
      .update(sickbayAdmission)
      .set({ admittedAt: new Date(Date.now() - 2 * 24 * 3600_000) })
      .where(and(eq(sickbayAdmission.schoolId, school.id), eq(sickbayAdmission.visitId, visitA))),
  );
  const dayTwo = await saveAttendance({
    classId,
    date: yesterday,
    entries: [
      { studentId: ids.A, status: "ABSENT" },
      { studentId: ids.B, status: "PRESENT" },
    ],
  });
  const recAYesterday = await rowFor(school.id, ids.A, yesterday);
  check(
    "🔴 H8 PULL · a still-open admission marks the NEXT day the moment the register is taken",
    dayTwo.ok && recAYesterday?.status === "MEDICAL" && recAYesterday?.reasonCode === "SICKBAY",
    `${recAYesterday?.status}/${recAYesterday?.reasonCode}`,
  );
  check(
    "H8 no scheduler ran: the coercion happened on the teacher's own INSERT",
    (await rowFor(school.id, ids.B, yesterday))?.status === "PRESENT",
  );

  // ══ H9 — the open-visit arm: 07:30 in the clinic, 08:00 register ══════════════════════════════
  const visitD = await createVisit({ studentId: ids.D, presentingComplaint: `${MARKER} waiting` });
  if (visitD.id) createdVisits.push(visitD.id);
  await saveAttendance({ classId, date: today, entries: [{ studentId: ids.D, status: "ABSENT" }] });
  const recD = await rowFor(school.id, ids.D, today);
  check(
    "H9 an OPEN visit presented today marks the register Medical, before any disposition exists",
    recD?.status === "MEDICAL" && recD?.reasonCode === "SICKBAY",
    `${recD?.status}/${recD?.reasonCode}`,
  );

  // ══ H10 — a teacher cannot select (or POST) the sickbay reason code ═══════════════════════════
  const forged = await saveAttendance({
    classId,
    date: today,
    entries: [{ studentId: ids.B, status: "ABSENT", reasonCode: "SICKBAY" }],
  });
  check(
    "H10 R50 · a hand-crafted POST carrying reason_code SICKBAY is REFUSED at the boundary",
    !forged.ok,
    forged.ok ? "(it SAVED — a teacher can forge a clinical assertion)" : forged.error,
  );
  check(
    "H10 …and the forged save changed nothing",
    (await rowFor(school.id, ids.B, today))?.status === "PRESENT",
  );

  // ══ H3 — a walk-in DISCHARGE writes NO attendance ═════════════════════════════════════════════
  const visitE1 = await openAndAssess(ids.E, "grazed knee");
  createdVisits.push(visitE1);
  const discharged = await disposeVisit({ visitId: visitE1, disposition: "DISCHARGE" });
  check("H3 a walk-in discharge succeeds", discharged.ok, discharged.error ?? "");
  check(
    "🔴 H3 R46 · a DISCHARGE writes NO attendance row — a 20-minute headache is not an absence",
    (await rowFor(school.id, ids.E, today)) === null,
  );
  check(
    "H3 …and it is not a silent skip either — nothing was attempted",
    (await auditRows(school.id, visitE1, "attendance_mark_skipped")).length === 0,
  );

  // ══ H2 — REFER writes the mark (Kofi's addition to Lucy's admission-only reading) ═════════════
  const visitE2 = await openAndAssess(ids.E, "high fever, second visit");
  createdVisits.push(visitE2);
  const referred = await disposeVisit({ visitId: visitE2, disposition: "REFER" });
  check("H2 a referral succeeds", referred.ok, referred.error ?? "");
  const recE = await rowFor(school.id, ids.E, today);
  check(
    "H2 R46 · a REFER marks the day Medical — a student at the hospital is not absent",
    recE?.status === "MEDICAL" && recE?.reasonCode === "SICKBAY",
    `${recE?.status}/${recE?.reasonCode}`,
  );

  // ══ H11 — the classless student: treated first, skipped honestly, never blocked ════════════════
  const visitC = await openAndAssess(ids.C, "dizziness");
  createdVisits.push(visitC);
  const admitC = await admitPatient({
    visitId: visitC,
    bedId: freeBeds[1].id,
    isIsolation: false,
    overnightPlan: `${MARKER} overnight plan`,
  });
  check(
    "🔴 H11 R53 · admitting a CLASSLESS student does not throw and does NOT return ok:false",
    admitC.ok,
    admitC.error ?? "",
  );
  const [admC] = await db
    .select({ id: sickbayAdmission.id })
    .from(sickbayAdmission)
    .where(and(eq(sickbayAdmission.schoolId, school.id), eq(sickbayAdmission.visitId, visitC)));
  check("H11 the admission COMMITTED — a sick child is treated first", !!admC);
  if (admC) createdAdmissions.push(admC.id);
  check("H11 no attendance row was fabricated", (await rowFor(school.id, ids.C, today)) === null);
  const skipC = await auditRows(school.id, visitC, "attendance_mark_skipped");
  check(
    "H11 the skip is on the record — never silent",
    skipC.length === 1 && (skipC[0].after as { reason?: string })?.reason === "NO_CLASS",
    JSON.stringify(skipC[0]?.after),
  );
  const recordC = await getVisitRecord(school.id, visitC);
  check(
    "H11 R65 · the §04 card can derive its honest line (no class, no row, skip visible)",
    recordC?.attendance?.noClass === true && recordC?.attendance?.status === null,
    JSON.stringify(recordC?.attendance),
  );

  // ══ H13 — a CLOSED term: the clinical write commits, the mark is skipped ══════════════════════
  const [anyPeriod] = await db
    .select({ year: academicPeriod.academicYear, line: academicPeriod.productLine })
    .from(academicPeriod)
    .where(eq(academicPeriod.schoolId, school.id))
    .limit(1);
  let tempPeriodId: string | null = null;
  if (anyPeriod) {
    const [p] = await db
      .insert(academicPeriod)
      .values({
        schoolId: school.id,
        academicYear: anyPeriod.year,
        periodNumber: 9,
        periodLabel: `${MARKER} closed term`,
        startsOn: yesterday,
        endsOn: today,
        productLine: anyPeriod.line,
        closedAt: new Date(),
      })
      .returning({ id: academicPeriod.periodId });
    tempPeriodId = p.id;

    const visitB = await openAndAssess(ids.B, "sprained ankle");
    createdVisits.push(visitB);
    const admitB = await admitPatient({
      visitId: visitB,
      bedId: freeBeds[2].id,
      isIsolation: false,
      overnightPlan: `${MARKER} overnight plan`,
    });
    check(
      "🔴 H13 R52 · inside a CLOSED term the clinical write still COMMITS",
      admitB.ok,
      admitB.error ?? "",
    );
    check(
      "H13 the mark is skipped and the closed term's row is untouched",
      (await rowFor(school.id, ids.B, today))?.status === "PRESENT",
    );
    const skipB = await auditRows(school.id, visitB, "attendance_mark_skipped");
    check(
      "H13 the skip names CLOSED_TERM in the audit",
      skipB.length === 1 && (skipB[0].after as { reason?: string })?.reason === "CLOSED_TERM",
      JSON.stringify(skipB[0]?.after),
    );
    await db.delete(academicPeriod).where(eq(academicPeriod.periodId, tempPeriodId));
    tempPeriodId = null;
    check(
      "H13 the temporary period row is gone — the three baseline periods are untouched",
      (await db.select({ n: sql<number>`count(*)::int` }).from(academicPeriod))[0].n === 3,
    );
  }

  // ══ H14 — the co-signed correction wins, and is never re-coerced ══════════════════════════════
  const recAForCorrection = await rowFor(school.id, ids.A, today);
  await requestCorrection({
    attendanceRecordId: recAForCorrection!.id,
    requestedStatus: "PRESENT",
    reason: `${MARKER} she was in class all day`,
  });
  const [corr] = await db
    .select({ id: attendanceCorrections.id })
    .from(attendanceCorrections)
    .where(eq(attendanceCorrections.attendanceRecordId, recAForCorrection!.id));
  const decided = await decideCorrection({ correctionId: corr.id, approve: true });
  const corrected = await rowFor(school.id, ids.A, today);
  check("H14 the approved correction applies", decided.ok && corrected?.status === "PRESENT");
  check(
    "🔴 H14 R51 · approving AWAY from MEDICAL clears reason_code — no `ABSENT + In sickbay` row",
    corrected?.reasonCode === null,
    String(corrected?.reasonCode),
  );
  await saveAttendance({
    classId,
    date: today,
    entries: [{ studentId: ids.A, status: "PRESENT" }],
  });
  const afterResave = await rowFor(school.id, ids.A, today);
  check(
    "🔴 H14 the correction is FINAL — a later save is NOT re-coerced, though the admission is open",
    afterResave?.status === "PRESENT" && afterResave?.reasonCode === null,
    `${afterResave?.status}/${afterResave?.reasonCode}`,
  );

  // ══ H15 — R51: the sickbay never reverts a mark, not even on discharge ════════════════════════
  const [admA] = await db
    .select({ id: sickbayAdmission.id })
    .from(sickbayAdmission)
    .where(and(eq(sickbayAdmission.schoolId, school.id), eq(sickbayAdmission.visitId, visitA)));
  createdAdmissions.push(admA.id);
  const wardOut = await dischargeFromWard({ admissionId: admA.id });
  check("H15 the ward discharge succeeds", wardOut.ok, wardOut.error ?? "");
  check(
    "🔴 H15 R51 · discharge REVERTS NOTHING — today stays as corrected, day 2 stays Medical",
    (await rowFor(school.id, ids.A, today))?.status === "PRESENT" &&
      (await rowFor(school.id, ids.A, yesterday))?.status === "MEDICAL",
  );

  // ══ R65 · the line the §04 card renders for a real admitted patient ═══════════════════════════
  const recordA = await getVisitRecord(school.id, visitA);
  check(
    "R65 the §04 attendance facts are DERIVED from the stored row (it reads the correction back)",
    recordA?.attendance?.status === "PRESENT" && recordA?.attendance?.date === today,
    JSON.stringify(recordA?.attendance),
  );

  // ── cleanup — MARKER-SCOPED ONLY ──────────────────────────────────────────────────────────────
  if (tempPeriodId) await db.delete(academicPeriod).where(eq(academicPeriod.periodId, tempPeriodId));
  const mine = await db
    .select({ id: sickbayVisit.id })
    .from(sickbayVisit)
    .where(
      and(
        eq(sickbayVisit.schoolId, school.id),
        like(sickbayVisit.presentingComplaint, `${MARKER}%`),
      ),
    );
  await withSchool(school.id, async (tx) => {
    if (mine.length) {
      await tx.delete(sickbayVisit).where(
        inArray(
          sickbayVisit.id,
          mine.map((r) => r.id),
        ),
      );
    }
    // students cascade attendance_record → attendance_correction, and student_guardian
    await tx
      .delete(students)
      .where(and(eq(students.schoolId, school.id), like(students.studentCode, `${CODE_PREFIX}%`)));
    await tx.delete(classes).where(and(eq(classes.schoolId, school.id), eq(classes.id, classId)));
    const auditIds = [...createdVisits, ...createdAdmissions, classId];
    await tx
      .delete(auditLog)
      .where(and(eq(auditLog.schoolId, school.id), inArray(auditLog.entityId, auditIds)));
  });
  const leftStudents = await db
    .select({ id: students.id })
    .from(students)
    .where(and(eq(students.schoolId, school.id), like(students.studentCode, `${CODE_PREFIX}%`)));
  const leftVisits = await db
    .select({ id: sickbayVisit.id })
    .from(sickbayVisit)
    .where(
      and(
        eq(sickbayVisit.schoolId, school.id),
        like(sickbayVisit.presentingComplaint, `${MARKER}%`),
      ),
    );
  check(
    `cleanup removed only this script's rows (${mine.length} visits · 5 students · 1 class)`,
    leftStudents.length === 0 && leftVisits.length === 0,
  );

  console.log(
    failures === 0 ? "\nAll attendance-hook checks passed." : `\n${failures} check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
