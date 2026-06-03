import Link from "next/link";
import { eq, and, sql } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import { students, admissionApplications } from "@/db/schema";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { school } = await requireSchool();
  const stats = await withSchool(school.id, async (tx) => {
    const [{ activeStudents }] = await tx
      .select({ activeStudents: sql<number>`count(*)::int` })
      .from(students)
      .where(and(eq(students.schoolId, school.id), eq(students.status, "ACTIVE")));
    const [{ pending }] = await tx
      .select({ pending: sql<number>`count(*)::int` })
      .from(admissionApplications)
      .where(
        and(
          eq(admissionApplications.schoolId, school.id),
          eq(admissionApplications.status, "SUBMITTED"),
        ),
      );
    return { activeStudents, pending };
  });

  const cards = [
    { label: "Active students", value: stats.activeStudents, href: "/students" },
    { label: "Pending applications", value: stats.pending, href: "/admissions" },
  ];

  return (
    <div className="mx-auto max-w-page">
      <h1 className="mb-1 font-display text-3xl font-semibold text-navy">
        Good day, {school.shortName ?? "team"}.
      </h1>
      <p className="mb-8 text-sm text-navy-2">
        Here&apos;s the shape of your school today.
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            className="bg-surface rounded-xl border border-border p-5 transition-colors hover:border-gold-soft"
          >
            <div className="font-display text-4xl font-semibold text-navy">{c.value}</div>
            <div className="mt-1 text-sm text-navy-3">{c.label}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
