import { GraduationCap } from "lucide-react";
import { asc, count, eq } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { isFinanceOnly } from "@/lib/access";
import { withSchool } from "@/lib/db/rls";
import { classes, students } from "@/db/schema";
import { loadStaffOptions } from "@/lib/data/staff-options";
import { CreateClassForm } from "@/components/classes/create-class-form";
import { ClassesTable } from "@/components/classes/classes-table";
import { EmptyState } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";

export default async function ClassesPage() {
  const { school, user } = await requireSchool();
  // Finance-only staff (Accountant/Bursar) get a read-only view — no write controls.
  const readOnly = isFinanceOnly(user.roles);

  const [classRows, staff, countRows] = await Promise.all([
    withSchool(school.id, (tx) =>
      tx
        .select({
          id: classes.id,
          name: classes.name,
          level: classes.level,
          teacherId: classes.classTeacherUserId,
          active: classes.active,
        })
        .from(classes)
        .where(eq(classes.schoolId, school.id))
        .orderBy(asc(classes.name)),
    ),
    loadStaffOptions(school.id),
    withSchool(school.id, (tx) =>
      tx
        .select({ classId: students.classId, n: count() })
        .from(students)
        .where(eq(students.schoolId, school.id))
        .groupBy(students.classId),
    ),
  ]);

  const sizeOf = new Map(countRows.map((r) => [r.classId, Number(r.n)]));
  const tableRows = classRows.map((c) => ({
    id: c.id,
    name: c.name,
    level: c.level,
    teacherId: c.teacherId,
    size: sizeOf.get(c.id) ?? 0,
  }));

  return (
    <div className="mx-auto max-w-page">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">
            Omnischools · Classes
          </div>
          <h1 className="mt-1 font-display text-3xl font-semibold text-navy">
            Every form, <em className="text-gold">accounted for</em>
          </h1>
          <div className="mb-3 mt-2 h-0.5 w-16 bg-gold" />
          <p className="max-w-2xl text-sm text-navy-3">
            {classRows.length} {classRows.length === 1 ? "class" : "classes"} · assign a
            class teacher and build the timetable.
          </p>
        </div>
        {!readOnly && <CreateClassForm />}
      </div>

      {classRows.length === 0 ? (
        <EmptyState
          icon={<GraduationCap className="h-5 w-5" />}
          title="No classes yet."
          body="Create your forms/classes (e.g. JHS 1A) — students, attendance and the timetable all hang off them."
        />
      ) : (
        <ClassesTable rows={tableRows} staff={staff} readOnly={readOnly} />
      )}
    </div>
  );
}
