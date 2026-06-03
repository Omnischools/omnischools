import "@/db/_loadenv";
import { eq } from "drizzle-orm";
import { submitApplication, decideApplication } from "@/lib/actions/admissions";
import { db } from "@/lib/db";
import { admissionApplications, students, studentGuardians } from "@/db/schema";

// End-to-end: public application → admin accept → student + guardian created.
// Uses the seeded Asankrangwa school (dev active school).
const CODE = "WR-WAW-014";

async function main() {
  const sub = await submitApplication({
    schoolCode: CODE,
    applicantFirstName: "Test",
    applicantLastName: "Applicant",
    sex: "MALE",
    desiredClassLabel: "JHS 1",
    guardianName: "G. Test",
    guardianPhone: "0240000099",
  });
  console.log("submit:", sub);
  if (!sub.ok) process.exit(1);

  const dec = await decideApplication({
    applicationId: sub.applicationId,
    decision: "ACCEPTED",
  });
  console.log("decide:", dec);
  if (!dec.ok || !dec.studentId) process.exit(1);

  const [stu] = await db.select().from(students).where(eq(students.id, dec.studentId));
  const guardians = await db
    .select()
    .from(studentGuardians)
    .where(eq(studentGuardians.studentId, dec.studentId));
  const [app] = await db
    .select()
    .from(admissionApplications)
    .where(eq(admissionApplications.id, sub.applicationId));

  console.log(
    `student=${stu?.studentCode} guardians=${guardians.length} appStatus=${app?.status} linked=${app?.studentId === dec.studentId}`,
  );
  const pass =
    !!stu &&
    guardians.length === 1 &&
    app?.status === "ACCEPTED" &&
    app?.studentId === dec.studentId;

  // cleanup (delete application first to release its student_id FK, then the student)
  await db
    .delete(admissionApplications)
    .where(eq(admissionApplications.id, sub.applicationId));
  await db.delete(students).where(eq(students.id, dec.studentId));

  console.log(
    pass ? "\n✓ Admissions → student flow verified." : "\n✗ Assertions failed.",
  );
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error("✗ verify-admissions error:", err);
  process.exit(1);
});
