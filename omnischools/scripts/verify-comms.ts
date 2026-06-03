import "@/db/_loadenv";
import { and, eq, inArray } from "drizzle-orm";
import { createStudent } from "@/lib/actions/students";
import { normalizeGhanaPhone } from "@/lib/auth";
import { createClass, setStudentClass } from "@/lib/actions/attendance";
import { createTemplate, sendSmsToAudience, postAnnouncement } from "@/lib/actions/comms";
import { db } from "@/lib/db";
import {
  students,
  classes,
  smsTemplates,
  announcements,
  notificationLog,
} from "@/db/schema";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "✓" : "✗"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!cond) failures++;
}

async function main() {
  const tag = Date.now() % 100000;
  const cls = await createClass({ name: `COMMS-${tag}` });
  if (!cls.ok) process.exit(1);
  const phones = ["0240000061", "0240000062"];
  const s1 = await createStudent({
    firstName: "Abena",
    lastName: "One",
    sex: "FEMALE",
    guardianName: "G1",
    guardianPhone: phones[0],
  });
  const s2 = await createStudent({
    firstName: "Yaw",
    lastName: "Two",
    sex: "MALE",
    guardianName: "G2",
    guardianPhone: phones[1],
  });
  if (!s1.ok || !s2.ok) process.exit(1);
  await setStudentClass({ studentId: s1.studentId, classId: cls.classId });
  await setStudentClass({ studentId: s2.studentId, classId: cls.classId });

  const tplName = `Welcome-${tag}`;
  const tpl = await createTemplate({
    name: tplName,
    body: "Hi {student}, welcome to {school}.",
  });
  check("template created", tpl.ok);

  const [tplRow] = await db
    .select()
    .from(smsTemplates)
    .where(eq(smsTemplates.name, tplName));

  const send = await sendSmsToAudience({
    audience: "CLASS",
    classId: cls.classId,
    templateId: tplRow?.id,
  });
  check(
    "send ok 2/0",
    send.ok &&
      (send as { sent: number; failed: number }).sent === 2 &&
      (send as { failed: number }).failed === 0,
    send.ok
      ? `${(send as { sent: number }).sent}/${(send as { failed: number }).failed}`
      : (send as { error: string }).error,
  );

  const normPhones = phones.map(normalizeGhanaPhone);
  const logs = await db
    .select()
    .from(notificationLog)
    .where(inArray(notificationLog.phone, normPhones));
  check(
    "2 log rows, all SENT",
    logs.length === 2 && logs.every((l) => l.status === "SENT"),
  );
  check(
    "placeholder rendered (student name)",
    logs.some((l) => l.message.includes("Abena")) &&
      logs.some((l) => l.message.includes("Yaw")),
  );

  const annTitle = `Reopening-${tag}`;
  const ann = await postAnnouncement({
    title: annTitle,
    body: "School reopens Monday.",
    audience: "WHOLE_SCHOOL",
  });
  check("announcement posted", ann.ok);
  const [annRow] = await db
    .select()
    .from(announcements)
    .where(eq(announcements.title, annTitle));
  check("announcement persisted", !!annRow);

  // cleanup
  await db.delete(notificationLog).where(inArray(notificationLog.phone, normPhones));
  if (annRow) await db.delete(announcements).where(eq(announcements.id, annRow.id));
  if (tplRow) await db.delete(smsTemplates).where(eq(smsTemplates.id, tplRow.id));
  await db.delete(students).where(inArray(students.id, [s1.studentId, s2.studentId]));
  await db.delete(classes).where(eq(classes.id, cls.classId));

  console.log(
    failures === 0
      ? "\n✓ Communications flow verified."
      : `\n✗ ${failures} assertion(s) failed.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("✗ verify-comms error:", err);
  process.exit(1);
});
