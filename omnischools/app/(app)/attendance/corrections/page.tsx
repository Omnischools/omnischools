import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import {
  attendanceCorrections,
  attendanceRecords,
  attendanceSettings,
  students,
  studentGuardians,
  classes,
  academicPeriod,
  users,
} from "@/db/schema";
import { EditRequestReview, type CorrectionRow } from "@/components/attendance/edit-request-review";

export const dynamic = "force-dynamic";

const fmtTime = (d: Date | string) =>
  (d instanceof Date ? d : new Date(d))
    .toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true })
    .replace(/\b(am|pm)\b/i, (m) => m.toUpperCase());
const fmtDay = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
const fmtWhen = (d: Date | string) => {
  const dt = d instanceof Date ? d : new Date(d);
  return `${fmtTime(dt)}, ${dt.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}`;
};
const initials = (name: string | null) =>
  (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "—";

export default async function CorrectionsPage() {
  const { school } = await requireSchool();
  const today = new Date().toISOString().slice(0, 10);
  const requester = alias(users, "requester");
  const marker = alias(users, "marker");

  const data = await withSchool(school.id, async (tx) => {
    const rows = await tx
      .select({
        id: attendanceCorrections.id,
        requestedStatus: attendanceCorrections.requestedStatus,
        reason: attendanceCorrections.reason,
        status: attendanceCorrections.status,
        createdAt: attendanceCorrections.createdAt,
        requesterId: attendanceCorrections.requestedByUserId,
        requesterName: requester.fullName,
        // before record
        recordStatus: attendanceRecords.status,
        recordReasonCode: attendanceRecords.reasonCode,
        recordNote: attendanceRecords.note,
        markedAt: attendanceRecords.markedAt,
        markedByName: marker.fullName,
        date: attendanceRecords.date,
        classId: attendanceRecords.classId,
        className: classes.name,
        studentId: students.id,
        firstName: students.firstName,
        lastName: students.lastName,
        code: students.studentCode,
      })
      .from(attendanceCorrections)
      .innerJoin(attendanceRecords, eq(attendanceCorrections.attendanceRecordId, attendanceRecords.id))
      .innerJoin(students, eq(attendanceRecords.studentId, students.id))
      .leftJoin(requester, eq(attendanceCorrections.requestedByUserId, requester.id))
      .leftJoin(marker, eq(attendanceRecords.markedByUserId, marker.id))
      .leftJoin(classes, eq(attendanceRecords.classId, classes.id))
      .where(eq(attendanceCorrections.schoolId, school.id))
      .orderBy(desc(attendanceCorrections.createdAt))
      .limit(100);

    const studentIds = Array.from(new Set(rows.map((r) => r.studentId)));
    const guardians = studentIds.length
      ? await tx
          .select({
            studentId: studentGuardians.studentId,
            name: studentGuardians.name,
            phone: studentGuardians.phone,
            isPrimary: studentGuardians.isPrimary,
          })
          .from(studentGuardians)
          .where(inArray(studentGuardians.studentId, studentIds))
          .orderBy(desc(studentGuardians.isPrimary))
      : [];

    const [term] = await tx
      .select({ startsOn: academicPeriod.startsOn, endsOn: academicPeriod.endsOn })
      .from(academicPeriod)
      .where(
        and(
          eq(academicPeriod.schoolId, school.id),
          lte(academicPeriod.startsOn, today),
          gte(academicPeriod.endsOn, today),
        ),
      )
      .limit(1);

    const studentRecs =
      studentIds.length && term
        ? await tx
            .select({
              studentId: attendanceRecords.studentId,
              date: attendanceRecords.date,
              status: attendanceRecords.status,
            })
            .from(attendanceRecords)
            .where(
              and(
                eq(attendanceRecords.schoolId, school.id),
                inArray(attendanceRecords.studentId, studentIds),
                gte(attendanceRecords.date, term.startsOn),
                lte(attendanceRecords.date, term.endsOn),
              ),
            )
            .orderBy(asc(attendanceRecords.date))
        : [];

    const [cfg] = await tx
      .select({ absenceSms: attendanceSettings.absenceSms })
      .from(attendanceSettings)
      .where(eq(attendanceSettings.schoolId, school.id))
      .limit(1);

    return { rows, guardians, studentRecs, absenceSms: cfg?.absenceSms ?? true };
  });

  const primaryGuardian = new Map<string, { name: string; phone: string }>();
  for (const g of data.guardians)
    if (!primaryGuardian.has(g.studentId)) primaryGuardian.set(g.studentId, { name: g.name, phone: g.phone });

  const recsByStudent = new Map<string, { date: string; status: string }[]>();
  for (const r of data.studentRecs) {
    const arr = recsByStudent.get(r.studentId) ?? [];
    arr.push({ date: r.date, status: r.status });
    recsByStudent.set(r.studentId, arr);
  }

  const editCount = new Map<string, number>();
  for (const r of data.rows)
    if (r.requesterId) editCount.set(r.requesterId, (editCount.get(r.requesterId) ?? 0) + 1);

  const rows: CorrectionRow[] = data.rows.map((r) => {
    const recs = recsByStudent.get(r.studentId) ?? [];
    const attended = recs.filter((x) => x.status === "PRESENT" || x.status === "LATE").length;
    const termPct = recs.length ? Math.round((attended / recs.length) * 100) : null;
    const last14 = recs.slice(-14).map((x) => ({ date: x.date, status: x.status }));
    const markedMs = (r.markedAt instanceof Date ? r.markedAt : new Date(r.markedAt)).getTime();
    const createdMs = (r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt)).getTime();
    const hoursLate = Math.max(0, Math.round((createdMs - markedMs) / 3_600_000));
    const guardian = primaryGuardian.get(r.studentId) ?? null;
    return {
      id: r.id,
      status: r.status,
      requestedStatus: r.requestedStatus,
      recordStatus: r.recordStatus,
      reason: r.reason,
      reasonAttribution: `— ${r.requesterName ?? "a teacher"} · ${fmtWhen(r.createdAt)}`,
      requesterName: r.requesterName ?? "A teacher",
      requesterInitials: initials(r.requesterName),
      requesterEditCount: r.requesterId ? (editCount.get(r.requesterId) ?? 1) : 1,
      className: r.className ?? "—",
      registerDate: fmtDay(r.date),
      submittedLabel: fmtTime(r.markedAt),
      requestedLabel: `${new Date(r.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} · ${hoursLate}h late`,
      markedByName: r.markedByName ?? null,
      recordReasonCode: r.recordReasonCode,
      recordNote: r.recordNote,
      studentName: `${r.firstName} ${r.lastName}`,
      studentInitials: `${r.firstName[0] ?? ""}${r.lastName[0] ?? ""}`.toUpperCase(),
      studentCode: r.code,
      guardianName: guardian?.name ?? null,
      guardianPhone: guardian?.phone ?? null,
      termPct,
      last14,
      absenceSmsWasSent: r.recordStatus === "ABSENT" && data.absenceSms,
    };
  });

  return (
    <div className="mx-auto max-w-page">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">
        Omnischools · Attendance · Edit-request approval
      </div>
      <h1 className="mt-1 font-display text-3xl font-semibold text-navy">
        Approving the <em className="text-gold">change</em>
      </h1>
      <div className="mb-3 mt-2 h-0.5 w-16 bg-gold" />
      <p className="mb-6 max-w-2xl text-sm text-navy-3">
        Teacher-requested changes to a saved register. Open a request to see the before→after
        diff, the teacher&apos;s full reason, the student&apos;s recent attendance, and what
        approving will do — then co-sign.
      </p>

      <EditRequestReview rows={rows} />
    </div>
  );
}
