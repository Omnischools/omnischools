import { and, asc, eq } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import { classes } from "@/db/schema";
import { NewStudentForm } from "@/components/students/new-student-form";
import { BackLink } from "@/components/ui/back-link";

export const metadata = { title: "Add student" };
export const dynamic = "force-dynamic";

export default async function NewStudentPage() {
  const { school } = await requireSchool();
  const classRows = await withSchool(school.id, (tx) =>
    tx
      .select({ id: classes.id, name: classes.name })
      .from(classes)
      .where(and(eq(classes.schoolId, school.id), eq(classes.active, true)))
      .orderBy(asc(classes.name)),
  );

  return (
    <div className="mx-auto max-w-3xl">
      <BackLink href="/students" label="Students" />
      <h1 className="mb-6 mt-2 font-display text-3xl font-semibold text-navy">
        Add a student
      </h1>
      <NewStudentForm classes={classRows} />
    </div>
  );
}
