import "@/db/_loadenv";
import { and, eq } from "drizzle-orm";
import { createStudent } from "@/lib/actions/students";
import { createClass, setStudentClass } from "@/lib/actions/attendance";
import {
  createSubject,
  createGradebookColumn,
  saveColumnScores,
  generateReportCards,
} from "@/lib/actions/gradebook";
import { db } from "@/lib/db";
import {
  students,
  subjects,
  classes,
  academicPeriod,
  gradebookScores,
  reportCards,
  schools,
} from "@/db/schema";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "✓" : "✗"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!cond) failures++;
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

  const cls = await createClass({ name: `GB-${Date.now() % 100000}` });
  const sub = await createSubject({ name: `Maths-${Date.now() % 100000}` });
  const stu = await createStudent({
    firstName: "Esi",
    lastName: "Scholar",
    sex: "FEMALE",
  });
  if (!cls.ok || !sub.ok || !sub.id || !stu.ok) {
    console.error("setup failed", { cls, sub, stu });
    process.exit(1);
  }
  await setStudentClass({ studentId: stu.studentId, classId: cls.classId });

  // One CA column (80/100 → CA 80%) + one EXAM column (60/100 → Exam 60%);
  // default 50/50 weights → total 70. Grade comes from the school's grade scale.
  const caCol = await createGradebookColumn({
    classId: cls.classId,
    subjectId: sub.id,
    periodId: period.periodId,
    name: "CA",
    category: "CA",
    maxScore: 100,
  });
  const examCol = await createGradebookColumn({
    classId: cls.classId,
    subjectId: sub.id,
    periodId: period.periodId,
    name: "Exam",
    category: "EXAM",
    maxScore: 100,
  });
  if (!caCol.ok || !examCol.ok) {
    console.error("column setup failed", { caCol, examCol });
    process.exit(1);
  }
  const save = await saveColumnScores({
    classId: cls.classId,
    subjectId: sub.id,
    periodId: period.periodId,
    scores: [
      { columnId: caCol.columnId, studentId: stu.studentId, raw: "80" },
      { columnId: examCol.columnId, studentId: stu.studentId, raw: "60" },
    ],
  });
  check("save column scores ok", save.ok);

  const [sc] = await db
    .select()
    .from(gradebookScores)
    .where(
      and(
        eq(gradebookScores.studentId, stu.studentId),
        eq(gradebookScores.subjectId, sub.id),
        eq(gradebookScores.periodId, period.periodId),
      ),
    );
  check(
    "rollup total 70.00, grade set",
    Number(sc?.total) === 70 && sc?.grade != null,
    `${sc?.total}/${sc?.grade}`,
  );

  const gen = await generateReportCards({
    classId: cls.classId,
    periodId: period.periodId,
  });
  check(
    "generate ok",
    gen.ok,
    gen.ok ? `${gen.generated} card(s)` : (gen as { error: string }).error,
  );

  const [rc] = await db
    .select()
    .from(reportCards)
    .where(
      and(
        eq(reportCards.studentId, stu.studentId),
        eq(reportCards.periodId, period.periodId),
      ),
    );
  check(
    "report card overall 70.00 / B / 1 subject",
    Number(rc?.overallTotal) === 70 && rc?.overallGrade === "B" && rc?.subjectCount === 1,
    `${rc?.overallTotal}/${rc?.overallGrade}/${rc?.subjectCount}`,
  );

  // cleanup (student cascades scores + report cards; then subject, class)
  await db.delete(students).where(eq(students.id, stu.studentId));
  await db.delete(subjects).where(eq(subjects.id, sub.id));
  await db.delete(classes).where(eq(classes.id, cls.classId));

  console.log(
    failures === 0
      ? "\n✓ Gradebook flow verified."
      : `\n✗ ${failures} assertion(s) failed.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("✗ verify-gradebook error:", err);
  process.exit(1);
});
