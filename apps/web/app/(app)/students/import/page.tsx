import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import { classes } from "@/db/schema";
import { StudentImport } from "@/components/students/student-import";
import { BackLink } from "@/components/ui/back-link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Import students" };

export default async function ImportStudentsPage() {
  const { school } = await requireSchool();
  const classRows = await withSchool(school.id, (tx) =>
    tx
      .select({ id: classes.id, name: classes.name })
      .from(classes)
      .where(and(eq(classes.schoolId, school.id), eq(classes.active, true))),
  );
  const classByName: Record<string, string> = Object.fromEntries(
    classRows.map((c) => [c.name, c.id]),
  );

  return (
    <div className="mx-auto max-w-page">
      <BackLink href="/students" label="Students" />
      <div className="mb-6 mt-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold text-navy">
            Import students
          </h1>
          <p className="text-sm text-navy-3">
            Add many students at once from a CSV, or{" "}
            <Link href="/students/new" className="text-gold underline">
              add a single student
            </Link>
            .
          </p>
        </div>
      </div>
      <StudentImport classByName={classByName} schoolName={school.name} />
    </div>
  );
}
