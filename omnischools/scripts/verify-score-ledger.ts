import "@/db/_loadenv";
import { and, eq } from "drizzle-orm";
import { createStudent } from "@/lib/actions/students";
import { createClass, setStudentClass } from "@/lib/actions/attendance";
import { createSubject } from "@/lib/actions/gradebook";
import {
  createSeniorAssessment,
  saveAssessmentScores,
  savePortfolioScores,
  setLedgerPath,
  saveDirectLedgerScores,
} from "@/lib/actions/score-ledger";
import { db } from "@/lib/db";
import { withSchool } from "@/lib/db/rls";
import { loadVhmProgress } from "@/lib/score-ledger/vhm-progress";
import {
  students,
  subjects,
  classes,
  users,
  academicPeriod,
  seniorScoreLedger,
  seniorSubjectTeacher,
  schools,
} from "@/db/schema";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "✓" : "✗"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!cond) failures++;
}

async function ledgerRow(studentId: string, subjectId: string, periodId: string) {
  const [row] = await db
    .select()
    .from(seniorScoreLedger)
    .where(
      and(
        eq(seniorScoreLedger.studentId, studentId),
        eq(seniorScoreLedger.subjectId, subjectId),
        eq(seniorScoreLedger.periodId, periodId),
      ),
    );
  return row;
}

async function main() {
  const [school] = await db
    .select({ id: schools.id })
    .from(schools)
    .where(eq(schools.gesCode, "WR-WAW-014"));
  const [period] = await db
    .select()
    .from(academicPeriod)
    .where(eq(academicPeriod.schoolId, school.id))
    .limit(1);
  if (!period) {
    console.error("no academic period seeded");
    process.exit(1);
  }
  const periodId = period.periodId;

  // Fresh context so the run is isolated and cleans up after itself.
  const tag = Date.now() % 100000;
  const cls = await createClass({ name: `SL-${tag}` });
  const sub = await createSubject({ name: `SLsub-${tag}` });
  const s1 = await createStudent({ firstName: "Kojo", lastName: "One", sex: "MALE" });
  const s2 = await createStudent({ firstName: "Adjoa", lastName: "Two", sex: "FEMALE" });
  if (!cls.ok || !sub.ok || !sub.id || !s1.ok || !s2.ok) {
    console.error("setup failed", { cls, sub, s1, s2 });
    process.exit(1);
  }
  const subjectId = sub.id;
  const classId = cls.classId;
  await setStudentClass({ studentId: s1.studentId, classId });
  await setStudentClass({ studentId: s2.studentId, classId });
  const ctx = { classId, subjectId, periodId };

  // ---------- Path C (Item 2) ----------
  // Guard: a fresh context defaults to AUTO_COMPILE — direct entry must be refused.
  const guard = await saveDirectLedgerScores({
    ...ctx,
    scores: [
      { studentId: s1.studentId, asgn: "80", midSem: "70", endSem: "60", project: "90", portfolio: "85" },
    ],
  });
  check("direct entry refused before path is DIRECT_ENTRY", !guard.ok);

  // setLedgerPath rejects Path B (not built).
  const scanReject = await setLedgerPath({ ...ctx, path: "SCAN_EXTRACT" });
  check("setLedgerPath rejects SCAN_EXTRACT (Path B)", !scanReject.ok);

  // Switch to Path C.
  const setC = await setLedgerPath({ ...ctx, path: "DIRECT_ENTRY" });
  check("setLedgerPath → DIRECT_ENTRY ok", setC.ok, setC.ok ? "" : setC.error);

  // Full direct entry for s1: 80/70/60/90/85 @ 15/15/40/15/15 → 72.75, COMPLETE.
  const full = await saveDirectLedgerScores({
    ...ctx,
    scores: [
      { studentId: s1.studentId, asgn: "80", midSem: "70", endSem: "60", project: "90", portfolio: "85" },
    ],
  });
  check("direct entry save ok", full.ok);
  const r1 = await ledgerRow(s1.studentId, subjectId, periodId);
  check(
    "direct weighted total 72.75, COMPLETE",
    Number(r1?.weightedTotal) === 72.75 && r1?.status === "COMPLETE",
    `${r1?.weightedTotal}/${r1?.status}`,
  );

  // Partial direct entry for s2: only assignments → DRAFT, stored total null.
  const partial = await saveDirectLedgerScores({
    ...ctx,
    scores: [
      { studentId: s2.studentId, asgn: "80", midSem: "", endSem: "", project: "", portfolio: "" },
    ],
  });
  check("partial direct entry save ok", partial.ok);
  const r2 = await ledgerRow(s2.studentId, subjectId, periodId);
  check(
    "partial entry → DRAFT, total null, weight snapshot frozen",
    r2?.status === "DRAFT" && r2?.weightedTotal == null && r2?.asgnWeightUsed === 15,
    `${r2?.status}/${r2?.weightedTotal}/${r2?.asgnWeightUsed}`,
  );

  // ATOMICITY (the MAJOR): a batch with one out-of-range cell must commit NOTHING.
  const bad = await saveDirectLedgerScores({
    ...ctx,
    scores: [
      { studentId: s1.studentId, asgn: "10", midSem: "10", endSem: "10", project: "10", portfolio: "10" },
      { studentId: s2.studentId, asgn: "150", midSem: "", endSem: "", project: "", portfolio: "" },
    ],
  });
  const r1After = await ledgerRow(s1.studentId, subjectId, periodId);
  check("out-of-range batch rejected", !bad.ok);
  check(
    "atomicity: valid row in the rejected batch was NOT committed (s1 still 72.75)",
    Number(r1After?.weightedTotal) === 72.75,
    `${r1After?.weightedTotal}`,
  );

  // Roster filter: a studentId outside the class is ignored, not written, not counted.
  const stranger = await createStudent({ firstName: "Not", lastName: "Inclass", sex: "MALE" });
  if (!stranger.ok) {
    console.error("stranger setup failed");
    process.exit(1);
  }
  const off = await saveDirectLedgerScores({
    ...ctx,
    scores: [
      { studentId: stranger.studentId, asgn: "50", midSem: "50", endSem: "50", project: "50", portfolio: "50" },
    ],
  });
  const strangerRow = await ledgerRow(stranger.studentId, subjectId, periodId);
  check(
    "off-roster student not written and not counted",
    off.ok && off.saved === 0 && strangerRow == null,
    off.ok ? `saved=${off.saved}` : "action failed",
  );

  // ---------- Path A (Item 1) regression ----------
  // Fresh student so no prior Path-C portfolio pollutes the compile assertion.
  const s3 = await createStudent({ firstName: "Yaw", lastName: "Three", sex: "MALE" });
  if (!s3.ok) {
    console.error("s3 setup failed");
    process.exit(1);
  }
  await setStudentClass({ studentId: s3.studentId, classId });
  const setA = await setLedgerPath({ ...ctx, path: "AUTO_COMPILE" });
  check("setLedgerPath → AUTO_COMPILE ok", setA.ok);
  const mk = (category: "ASSIGNMENT" | "MID_SEM_EXAM" | "END_SEM_EXAM" | "PROJECT", title: string) =>
    createSeniorAssessment({ ...ctx, category, title, maxMark: 100 });
  const a = await mk("ASSIGNMENT", "A1");
  const mid = await mk("MID_SEM_EXAM", "Mid");
  const end = await mk("END_SEM_EXAM", "End");
  const proj = await mk("PROJECT", "Proj");
  if (!a.ok || !mid.ok || !end.ok || !proj.ok) {
    console.error("assessment setup failed", { a, mid, end, proj });
    process.exit(1);
  }
  const marks = await saveAssessmentScores({
    ...ctx,
    scores: [
      { assessmentId: a.id, studentId: s3.studentId, raw: "80" },
      { assessmentId: mid.id, studentId: s3.studentId, raw: "70" },
      { assessmentId: end.id, studentId: s3.studentId, raw: "60" },
      { assessmentId: proj.id, studentId: s3.studentId, raw: "90" },
    ],
  });
  check("Path A save marks + auto-compile ok", marks.ok);
  const rA = await ledgerRow(s3.studentId, subjectId, periodId);
  check(
    "Path A compiled four categories, portfolio pending → DRAFT",
    Number(rA?.asgnScore) === 80 &&
      Number(rA?.endSemScore) === 60 &&
      rA?.portfolioScore == null &&
      rA?.status === "DRAFT",
    `${rA?.asgnScore}/${rA?.midSemScore}/${rA?.endSemScore}/${rA?.projectScore}/${rA?.status}`,
  );
  const pf = await savePortfolioScores({
    ...ctx,
    scores: [{ studentId: s3.studentId, value: "85" }],
  });
  check("Path A portfolio entry ok", pf.ok);
  const rA2 = await ledgerRow(s3.studentId, subjectId, periodId);
  check(
    "Path A complete → 72.75, COMPLETE",
    Number(rA2?.weightedTotal) === 72.75 && rA2?.status === "COMPLETE",
    `${rA2?.weightedTotal}/${rA2?.status}`,
  );

  // ---------- Item 3: VHM progress (enumerate from assignments) ----------
  // A fresh assignment with NO ledger activity must still surface as at-risk 0/5 "never" —
  // the load-bearing correctness point (enumerate from expected, LEFT JOIN progress).
  const [anyUser] = await db.select({ id: users.id }).from(users).limit(1);
  const vClass = await createClass({ name: `VHM-${tag}` });
  const vSub = await createSubject({ name: `VHMsub-${tag}` });
  const vStu = await createStudent({ firstName: "Vera", lastName: "Vhm", sex: "FEMALE" });
  if (!vClass.ok || !vSub.ok || !vSub.id || !vStu.ok || !anyUser) {
    console.error("vhm setup failed");
    process.exit(1);
  }
  await setStudentClass({ studentId: vStu.studentId, classId: vClass.classId });
  await db.insert(seniorSubjectTeacher).values({
    schoolId: school.id,
    classId: vClass.classId,
    subjectId: vSub.id,
    teacherUserId: anyUser.id,
  });
  const progress = await withSchool(school.id, (tx) =>
    loadVhmProgress(tx, school.id, periodId, new Date()),
  );
  const vhmRow = progress.find(
    (r) => r.classId === vClass.classId && r.subjectId === vSub.id,
  );
  check("VHM: never-started assignment still appears (enumerate from assignments)", !!vhmRow);
  check(
    "VHM: never-started → at_risk, 0/5, last activity 'never'",
    vhmRow?.status === "at_risk" &&
      vhmRow?.categoriesDone === 0 &&
      vhmRow?.lastActivityAt == null,
    `${vhmRow?.status}/${vhmRow?.categoriesDone}/${vhmRow?.lastActivityAt}`,
  );
  check(
    "VHM: row exposes NO score value (completion only, §6.2)",
    vhmRow != null && !Object.keys(vhmRow).some((k) => /score|weighted|total/i.test(k)),
    Object.keys(vhmRow ?? {}).join(","),
  );

  // cleanup — students cascade ledger/assessments/scores; then subject, class, path.
  await db.delete(students).where(eq(students.id, s1.studentId));
  await db.delete(students).where(eq(students.id, s2.studentId));
  await db.delete(students).where(eq(students.id, s3.studentId));
  await db.delete(students).where(eq(students.id, stranger.studentId));
  await db.delete(students).where(eq(students.id, vStu.studentId));
  await db.delete(subjects).where(eq(subjects.id, subjectId));
  await db.delete(subjects).where(eq(subjects.id, vSub.id));
  await db.delete(classes).where(eq(classes.id, classId));
  await db.delete(classes).where(eq(classes.id, vClass.classId));

  console.log(
    failures === 0
      ? "\n✓ Score-ledger (Path A + Path C) flow verified."
      : `\n✗ ${failures} assertion(s) failed.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("✗ verify-score-ledger error:", err);
  process.exit(1);
});
