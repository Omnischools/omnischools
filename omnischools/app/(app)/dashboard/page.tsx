import Link from "next/link";
import { eq, and, gte, lte, ne, sql } from "drizzle-orm";
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
  invoices,
  announcements,
} from "@/db/schema";
import { EmptyState } from "@/components/ui/empty-state";
import {
  AdminChecklist,
  type ChecklistStep,
} from "@/components/dashboard/admin-checklist";
import {
  TeacherHero,
  type TeacherAssignment,
} from "@/components/dashboard/teacher-hero";

export const dynamic = "force-dynamic";

const fmtDate = (d: Date) =>
  d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

export default async function DashboardPage() {
  const { user, school } = await requireSchool();
  const today = new Date().toISOString().slice(0, 10);

  const roleSet = new Set(user.roles);
  const isAdminOrHead = roleSet.has("ADMIN") || roleSet.has("HEADMASTER");
  const isTeacher = roleSet.has("TEACHER");
  // A teacher who just joined (and isn't also an admin/head) gets the welcome hero.
  const isTeacherOnly = isTeacher && !isAdminOrHead;

  // ── Teacher branch: just accepted their invite → welcome hero ────────────
  if (isTeacherOnly) {
    const myClasses = await withSchool(school.id, async (tx) =>
      tx
        .select({ name: classes.name, level: classes.level })
        .from(classes)
        .where(
          and(
            eq(classes.schoolId, school.id),
            eq(classes.active, true),
            eq(classes.classTeacherUserId, user.id),
          ),
        )
        .orderBy(classes.name),
    );
    const assignments: TeacherAssignment[] = myClasses.map((c) => ({
      className: c.name,
      note: "Form teacher",
    }));
    return <TeacherHero name={user.name} assignments={assignments} />;
  }

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
    const byClass = await tx
      .select({
        name: classes.name,
        total: sql<number>`count(${students.id})::int`,
        male: sql<number>`coalesce(sum(case when ${students.sex} = 'MALE' then 1 else 0 end),0)::int`,
        female: sql<number>`coalesce(sum(case when ${students.sex} = 'FEMALE' then 1 else 0 end),0)::int`,
      })
      .from(classes)
      .leftJoin(
        students,
        and(eq(students.classId, classes.id), eq(students.status, "ACTIVE")),
      )
      .where(and(eq(classes.schoolId, school.id), eq(classes.active, true)))
      .groupBy(classes.id, classes.name)
      .orderBy(classes.name);
    const statusRows = await tx
      .select({ status: students.status, n: sql<number>`count(*)::int` })
      .from(students)
      .where(eq(students.schoolId, school.id))
      .groupBy(students.status);
    // First-run signals (admin checklist): does the school have a non-voided
    // invoice and at least one announcement yet?
    const [{ invoiceCount }] = await tx
      .select({ invoiceCount: sql<number>`count(*)::int` })
      .from(invoices)
      .where(and(eq(invoices.schoolId, school.id), ne(invoices.status, "VOIDED")));
    const [{ announcementCount }] = await tx
      .select({ announcementCount: sql<number>`count(*)::int` })
      .from(announcements)
      .where(eq(announcements.schoolId, school.id));
    return {
      activeStudents,
      pending,
      classCount,
      teacherCount,
      periodConfigured: !!cfg,
      academicYear: cfg?.academicYear ?? null,
      term: term?.label ?? null,
      byClass,
      statusRows,
      invoiceCount,
      announcementCount,
    };
  });

  // ── Admin / head first-run branch: setup not yet complete → checklist ────
  if (isAdminOrHead) {
    const steps: ChecklistStep[] = [
      {
        title: "Review your school setup",
        sub: "Calendar, classes, subjects and fees are pre-filled — confirm they fit",
        done: stats.periodConfigured,
        href: "/settings/academic",
        cta: "Review →",
      },
      {
        title: "Invite your teachers",
        sub: "Add teaching staff so they can take attendance and grade",
        done: stats.teacherCount > 0,
        href: "/staff",
        cta: "Invite teachers →",
      },
      {
        title: "Add your students",
        sub: "Upload a CSV or add students one by one — the most important step",
        done: stats.activeStudents > 0,
        href: "/students",
        cta: "Add students →",
      },
      {
        title: "Issue Term 1 invoices",
        sub: "Once students are loaded, send the first round of fee invoices",
        done: stats.invoiceCount > 0,
        href: "/billing",
        cta: "Issue invoices →",
        locked: stats.activeStudents === 0,
      },
      {
        title: "Send the first announcement",
        sub: "A welcome message goes out to all parents and students",
        done: stats.announcementCount > 0,
        href: "/communication",
        cta: "Write one →",
        optional: true,
      },
    ];
    const doneCount = steps.filter((s) => s.done).length;
    const progressPct = Math.round((doneCount / steps.length) * 100);
    // First-run = the three foundational steps aren't all done yet.
    const setupComplete =
      stats.periodConfigured && stats.teacherCount > 0 && stats.activeStudents > 0;
    if (!setupComplete) {
      return (
        <AdminChecklist
          steps={steps}
          progressPct={progressPct}
          firstName={user.name?.trim().split(/\s+/)[0] ?? null}
        />
      );
    }
  }

  const ratio = stats.teacherCount > 0 ? Math.round(stats.activeStudents / stats.teacherCount) : 0;
  const avgClass =
    stats.classCount > 0 ? Math.round(stats.activeStudents / stats.classCount) : 0;

  const male = stats.byClass.reduce((s, c) => s + c.male, 0);
  const female = stats.byClass.reduce((s, c) => s + c.female, 0);
  const genderTotal = male + female;
  const malePct = genderTotal > 0 ? Math.round((male / genderTotal) * 100) : 0;

  const statusOf = (s: string) =>
    stats.statusRows.find((r) => r.status === s)?.n ?? 0;
  const FLOW: { key: string; label: string; tone: string }[] = [
    { key: "ACTIVE", label: "Active", tone: "bg-green" },
    { key: "GRADUATED", label: "Graduated", tone: "bg-gold" },
    { key: "TRANSFERRED", label: "Transferred", tone: "bg-warn" },
    { key: "WITHDRAWN", label: "Withdrawn", tone: "bg-terra" },
    { key: "INACTIVE", label: "Inactive", tone: "bg-navy-3" },
  ];

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

      {/* Gender split + enrolment status */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-surface p-5">
          <h2 className="font-display text-base font-semibold text-navy">Gender mix</h2>
          {genderTotal === 0 ? (
            <EmptyState tone="muted" className="mt-2">
              No students on roll yet.
            </EmptyState>
          ) : (
            <>
              <div className="mt-3 flex h-3 overflow-hidden rounded-pill">
                <div className="bg-navy" style={{ width: `${malePct}%` }} />
                <div className="bg-gold" style={{ width: `${100 - malePct}%` }} />
              </div>
              <div className="mt-2 flex justify-between text-sm">
                <span className="text-navy-2">
                  <b className="text-navy">{male}</b> boys · {malePct}%
                </span>
                <span className="text-navy-2">
                  {100 - malePct}% · <b className="text-navy">{female}</b> girls
                </span>
              </div>
            </>
          )}
        </div>

        <div className="rounded-xl border border-border bg-surface p-5">
          <h2 className="font-display text-base font-semibold text-navy">Enrolment status</h2>
          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
            {FLOW.map((f) => (
              <div key={f.key} className="flex items-center gap-2 text-sm">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${f.tone}`} />
                <span className="text-navy-3">{f.label}</span>
                <span className="ml-auto font-mono font-medium text-navy">
                  {statusOf(f.key)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Class composition */}
      <div className="mt-6">
        <h2 className="mb-2 font-display text-lg font-semibold text-navy">
          Class composition
        </h2>
        {stats.byClass.length === 0 ? (
          <EmptyState tone="muted">
            No classes yet —{" "}
            <Link href="/classes" className="text-gold underline">
              set them up
            </Link>
            .
          </EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-bg text-left text-xs uppercase tracking-wide text-navy-3">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Class</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Students</th>
                  <th className="px-4 py-2.5 font-semibold">Gender mix</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {stats.byClass.map((c) => {
                  const mp = c.total > 0 ? Math.round((c.male / c.total) * 100) : 0;
                  return (
                    <tr key={c.name} className="hover:bg-bg">
                      <td className="px-4 py-2.5 font-medium text-navy">{c.name}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-navy-2">
                        {c.total}
                      </td>
                      <td className="px-4 py-2.5">
                        {c.total === 0 ? (
                          <span className="text-navy-3">—</span>
                        ) : (
                          <div className="flex items-center gap-3">
                            <div className="flex h-2 w-28 overflow-hidden rounded-pill">
                              <div className="bg-navy" style={{ width: `${mp}%` }} />
                              <div className="bg-gold" style={{ width: `${100 - mp}%` }} />
                            </div>
                            <span className="text-[11px] text-navy-3">
                              {c.male}M · {c.female}F
                            </span>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
