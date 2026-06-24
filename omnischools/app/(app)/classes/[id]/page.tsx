import { notFound } from "next/navigation";
import { and, asc, eq, isNull } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import { classes, students, subjects, timetableSlots, users } from "@/db/schema";
import { loadStaffOptions } from "@/lib/data/staff-options";
import { ClassTeacherSelect } from "@/components/classes/class-teacher-select";
import { RosterManager } from "@/components/classes/roster-manager";
import { SubjectsManager } from "@/components/classes/subjects-manager";
import { TimetableBuilder } from "@/components/classes/timetable-builder";
import { BackLink } from "@/components/ui/back-link";

export const dynamic = "force-dynamic";

const studentName = (s: {
  lastName: string;
  firstName: string;
  otherNames: string | null;
}) => `${s.lastName}, ${s.firstName}${s.otherNames ? ` ${s.otherNames}` : ""}`;

export default async function ClassDetailPage({ params }: { params: { id: string } }) {
  const { school } = await requireSchool();
  const classId = params.id;

  const [cls] = await withSchool(school.id, (tx) =>
    tx
      .select({
        id: classes.id,
        name: classes.name,
        level: classes.level,
        teacherId: classes.classTeacherUserId,
      })
      .from(classes)
      .where(and(eq(classes.id, classId), eq(classes.schoolId, school.id))),
  );
  if (!cls) notFound();

  const studentCols = {
    id: students.id,
    code: students.studentCode,
    firstName: students.firstName,
    lastName: students.lastName,
    otherNames: students.otherNames,
  };

  const [roster, unassigned, staff, subjectRows, slotRows] = await Promise.all([
    withSchool(school.id, (tx) =>
      tx
        .select(studentCols)
        .from(students)
        .where(and(eq(students.schoolId, school.id), eq(students.classId, classId)))
        .orderBy(asc(students.lastName)),
    ),
    withSchool(school.id, (tx) =>
      tx
        .select(studentCols)
        .from(students)
        .where(and(eq(students.schoolId, school.id), isNull(students.classId)))
        .orderBy(asc(students.lastName))
        .limit(500),
    ),
    loadStaffOptions(school.id),
    withSchool(school.id, (tx) =>
      tx
        .select({ id: subjects.id, name: subjects.name })
        .from(subjects)
        .where(and(eq(subjects.schoolId, school.id), eq(subjects.active, true)))
        .orderBy(asc(subjects.name)),
    ),
    withSchool(school.id, (tx) =>
      tx
        .select({
          id: timetableSlots.id,
          dayOfWeek: timetableSlots.dayOfWeek,
          periodIndex: timetableSlots.periodIndex,
          startTime: timetableSlots.startTime,
          endTime: timetableSlots.endTime,
          subjectName: subjects.name,
          teacherName: users.fullName,
          teacherUserId: timetableSlots.teacherUserId,
        })
        .from(timetableSlots)
        .leftJoin(subjects, eq(timetableSlots.subjectId, subjects.id))
        .leftJoin(users, eq(timetableSlots.teacherUserId, users.id))
        .where(
          and(
            eq(timetableSlots.schoolId, school.id),
            eq(timetableSlots.classId, classId),
          ),
        ),
    ),
  ]);

  const inClass = roster.map((s) => ({ id: s.id, code: s.code, name: studentName(s) }));
  const free = unassigned.map((s) => ({ id: s.id, code: s.code, name: studentName(s) }));

  return (
    <div className="mx-auto max-w-page space-y-8">
      <div>
        <BackLink href="/classes" label="Classes" />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl font-semibold text-navy">{cls.name}</h1>
            <p className="text-sm text-navy-3">{cls.level ?? "No level set"}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-navy-3">Class teacher:</span>
            <ClassTeacherSelect classId={cls.id} current={cls.teacherId} staff={staff} />
          </div>
        </div>
      </div>

      <RosterManager classId={cls.id} inClass={inClass} unassigned={free} />

      <SubjectsManager subjects={subjectRows} />

      <TimetableBuilder
        classId={cls.id}
        slots={slotRows}
        subjects={subjectRows}
        teachers={staff}
      />
    </div>
  );
}
