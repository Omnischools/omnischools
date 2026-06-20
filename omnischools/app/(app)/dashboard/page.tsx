import Link from "next/link";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import {
  students,
  admissionApplications,
  classes,
  roles,
  roleAssignments,
  academicPeriodConfig,
  academicPeriod,
} from "@/db/schema";

export const dynamic = "force-dynamic";

const fmtDate = (d: Date) =>
  d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

export default async function DashboardPage() {
  const { school } = await requireSchool();
  const today = new Date().toISOString().slice(0, 10);

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
    const [{ classCount }] = await tx
      .select({ classCount: sql<number>`count(*)::int` })
      .from(classes)
      .where(and(eq(classes.schoolId, school.id), eq(classes.active, true)));
    const [{ teacherCount }] = await tx
      .select({ teacherCount: sql<number>`count(distinct ${roleAssignments.userId})::int` })
      .from(roleAssignments)
      .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
      .where(and(eq(roleAssignments.schoolId, school.id), eq(roles.code, "TEACHER")));
    const [cfg] = await tx
      .select({ academicYear: academicPeriodConfig.academicYear })
      .from(academicPeriodConfig)
      .where(eq(academicPeriodConfig.schoolId, school.id));
    const [term] = await tx
      .select({ label: academicPeriod.periodLabel })
      .from(academicPeriod)
      .where(
        and(
          eq(academicPeriod.schoolId, school.id),
          lte(academicPeriod.startsOn, today),
          gte(academicPeriod.endsOn, today),
        ),
      )
      .limit(1);
    return {
      activeStudents,
      pending,
      classCount,
      teacherCount,
      academicYear: cfg?.academicYear ?? null,
      term: term?.label ?? null,
    };
  });

  const ratio = stats.teacherCount > 0 ? Math.round(stats.activeStudents / stats.teacherCount) : 0;
  const avgClass =
    stats.classCount > 0 ? Math.round(stats.activeStudents / stats.classCount) : 0;

  const kpis = [
    {
      label: "Teaching staff",
      value: stats.teacherCount,
      sub: ratio > 0 ? `student:teacher ratio ${ratio}:1` : "no teachers yet",
      href: "/staff",
    },
    {
      label: "Active classes",
      value: stats.classCount,
      sub: stats.classCount > 0 ? "across the school" : "set up under Classes",
      href: "/classes",
    },
    {
      label: "Avg class size",
      value: avgClass,
      sub: avgClass > 0 ? "students per class" : "—",
      href: "/classes",
    },
  ];

  return (
    <div className="mx-auto max-w-page">
      <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-gold">
        Dashboard
      </div>
      <h1 className="font-display text-3xl font-semibold text-navy">
        Good day,{" "}
        <em className="not-italic text-gold [font-style:italic]">
          {school.shortName ?? school.name}.
        </em>
      </h1>
      <p className="mt-1.5 text-sm text-navy-2">Here&apos;s the shape of your school today.</p>

      {/* Snapshot pill */}
      <div className="mt-4 inline-flex flex-wrap items-center gap-x-2 rounded-pill border border-border-2 bg-bg px-3.5 py-1.5 text-[11px] text-navy-3">
        <span>Snapshot as of</span>
        <b className="text-navy">{fmtDate(new Date())}</b>
        {stats.academicYear && (
          <>
            <span>·</span>
            <span>
              academic year <b className="text-navy">{stats.academicYear}</b>
            </span>
          </>
        )}
        {stats.term && (
          <>
            <span>·</span>
            <b className="text-navy">{stats.term}</b>
          </>
        )}
      </div>

      {/* KPI strip — featured primary + 3 cards */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link
          href="/students"
          className="rounded-xl border border-navy bg-navy p-5 text-bg transition-colors hover:bg-navy-deep"
        >
          <div className="font-display text-4xl font-semibold">{stats.activeStudents}</div>
          <div className="mt-1 text-sm text-gold-soft">Total students</div>
          <div className="mt-0.5 text-[11px] text-bg/60">active on roll</div>
        </Link>
        {kpis.map((k) => (
          <Link
            key={k.label}
            href={k.href}
            className="rounded-xl border border-border bg-surface p-5 transition-colors hover:border-gold-soft"
          >
            <div className="font-display text-4xl font-semibold text-navy">{k.value}</div>
            <div className="mt-1 text-sm text-navy-3">{k.label}</div>
            <div className="mt-0.5 text-[11px] text-navy-3">{k.sub}</div>
          </Link>
        ))}
      </div>

      {/* Needs attention */}
      <div className="mt-4">
        <Link
          href="/admissions"
          className={`flex items-center justify-between rounded-xl border p-4 transition-colors ${
            stats.pending > 0
              ? "border-warn/40 bg-warn-bg/40 hover:border-warn"
              : "border-border bg-surface hover:border-gold-soft"
          }`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`flex h-9 w-9 items-center justify-center rounded-lg font-display text-lg font-semibold ${
                stats.pending > 0 ? "bg-warn text-surface" : "bg-bg text-navy-3"
              }`}
            >
              {stats.pending}
            </div>
            <div>
              <div className="text-sm font-semibold text-navy">Pending applications</div>
              <div className="text-[11px] text-navy-3">
                {stats.pending > 0
                  ? "Awaiting review in Admissions"
                  : "Nothing waiting — you're all caught up"}
              </div>
            </div>
          </div>
          <span className="text-sm font-semibold text-gold">Open admissions →</span>
        </Link>
      </div>
    </div>
  );
}
