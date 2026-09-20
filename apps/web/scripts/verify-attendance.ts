import "@/db/_loadenv";
import { and, eq, inArray } from "drizzle-orm";
import { createStudent } from "@/lib/actions/students";
import {
  createClass,
  setStudentClass,
  saveAttendance,
  requestCorrection,
  decideCorrection,
} from "@/lib/actions/attendance";
import { db } from "@/lib/db";
import { classes, students, attendanceRecords, attendanceCorrections } from "@/db/schema";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "✓" : "✗"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!cond) failures++;
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);

  // class + two students enrolled
  const cls = await createClass({
    name: `VERIFY-${Date.now() % 100000}`,
    level: "JHS 1",
  });
  if (!cls.ok) {
    console.error(cls);
    process.exit(1);
  }
  const s1 = await createStudent({
    firstName: "Ama",
    lastName: "Present",
    sex: "FEMALE",
  });
  const s2 = await createStudent({
    firstName: "Kofi",
    lastName: "Absent",
    sex: "MALE",
    guardianName: "G. Absent",
    guardianPhone: "0240000077",
  });
  if (!s1.ok || !s2.ok) {
    console.error("createStudent failed");
    process.exit(1);
  }
  await setStudentClass({ studentId: s1.studentId, classId: cls.classId });
  await setStudentClass({ studentId: s2.studentId, classId: cls.classId });

  // mark register: s1 present, s2 absent
  const save = await saveAttendance({
    classId: cls.classId,
    date: today,
    entries: [
      { studentId: s1.studentId, status: "PRESENT" },
      { studentId: s2.studentId, status: "ABSENT" },
    ],
  });
  check(
    "save ok",
    save.ok,
    save.ok
      ? `marked ${save.marked}, absent ${save.absent}, alerts ${save.alertsSent}`
      : (save as { error: string }).error,
  );
  if (save.ok) {
    check(
      "2 marked, 1 absent, 1 alert",
      save.marked === 2 && save.absent === 1 && save.alertsSent === 1,
    );
  }

  const recs = await db
    .select()
    .from(attendanceRecords)
    .where(
      and(eq(attendanceRecords.classId, cls.classId), eq(attendanceRecords.date, today)),
    );
  const s2rec = recs.find((r) => r.studentId === s2.studentId);
  check("s2 recorded ABSENT", s2rec?.status === "ABSENT");

  // teacher requests correction ABSENT → PRESENT, admin approves
  if (s2rec) {
    await requestCorrection({
      attendanceRecordId: s2rec.id,
      requestedStatus: "PRESENT",
      reason: "Arrived late, was present",
    });
    const [corr] = await db
      .select()
      .from(attendanceCorrections)
      .where(eq(attendanceCorrections.attendanceRecordId, s2rec.id));
    check("correction pending", corr?.status === "PENDING");
    if (corr) {
      const dec = await decideCorrection({ correctionId: corr.id, approve: true });
      check("decide ok", dec.ok);
    }
    const [after] = await db
      .select()
      .from(attendanceRecords)
      .where(eq(attendanceRecords.id, s2rec.id));
    check("after approve: s2 PRESENT", after?.status === "PRESENT");
  }

  // cleanup (students cascade attendance_record → corrections; then class)
  await db.delete(students).where(inArray(students.id, [s1.studentId, s2.studentId]));
  await db.delete(classes).where(eq(classes.id, cls.classId));

  console.log(
    failures === 0
      ? "\n✓ Attendance flow verified."
      : `\n✗ ${failures} assertion(s) failed.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("✗ verify-attendance error:", err);
  process.exit(1);
});
