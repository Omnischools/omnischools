import Link from "next/link";
import { Users } from "lucide-react";
import { and, asc, eq, notInArray, sql } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import { users, roles, roleAssignments, staffProfiles, students } from "@/db/schema";
import { NON_STAFF_ROLE_CODES } from "@/lib/staff-roles";
import { AddStaffForm } from "@/components/staff/add-staff-form";
import { StaffBrowser, type StaffBrowserMember } from "@/components/staff/staff-browser";
import { EmptyState } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";

export default async function StaffPage() {
  const { school } = await requireSchool();

  const [rows, profileRows, [{ activeStudents }]] = await Promise.all([
    withSchool(school.id, (tx) =>
      tx
        .select({
          assignmentId: roleAssignments.id,
          userId: users.id,
          name: users.fullName,
          phone: users.phone,
          email: users.email,
          code: roles.code,
          label: roles.label,
        })
        .from(roleAssignments)
        .innerJoin(users, eq(roleAssignments.userId, users.id))
        .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
        .where(
          and(
            eq(roleAssignments.schoolId, school.id),
            notInArray(roles.code, NON_STAFF_ROLE_CODES),
          ),
        )
        .orderBy(asc(users.fullName)),
    ),
    withSchool(school.id, (tx) =>
      tx
        .select({ userId: staffProfiles.userId, level: staffProfiles.qualificationLevel })
        .from(staffProfiles)
        .where(eq(staffProfiles.schoolId, school.id)),
    ),
    withSchool(school.id, (tx) =>
      tx
        .select({ activeStudents: sql<number>`count(*)::int` })
        .from(students)
        .where(and(eq(students.schoolId, school.id), eq(students.status, "ACTIVE"))),
    ),
  ]);

  const qualByUser = new Map(profileRows.map((p) => [p.userId, p.level]));

  const byUser = new Map<string, StaffBrowserMember>();
  for (const r of rows) {
    let g = byUser.get(r.userId);
    if (!g) {
      g = {
        userId: r.userId,
        name: r.name,
        phone: r.phone,
        email: r.email,
        roles: [],
        qualificationLevel: qualByUser.get(r.userId) ?? null,
      };
      byUser.set(r.userId, g);
    }
    g.roles.push({ assignmentId: r.assignmentId, code: r.code, label: r.label });
  }
  const staff = Array.from(byUser.values());

  // Distinct roles present, for the filter dropdown.
  const roleMap = new Map<string, string>();
  for (const r of rows) roleMap.set(r.code, r.label ?? r.code);
  const roleOptions = Array.from(roleMap.entries())
    .map(([code, label]) => ({ code, label }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div className="mx-auto max-w-page">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">
            Omnischools · Staff
          </div>
          <h1 className="mt-1 font-display text-3xl font-semibold text-navy">
            The people who <em className="text-gold">run it</em>
          </h1>
          <div className="mb-3 mt-2 h-0.5 w-16 bg-gold" />
          <p className="max-w-2xl text-sm text-navy-3">
            Teaching strength, the pupil-teacher ratio and qualifications at a glance.
            Filter by role or qualification, then open any record from the row.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/staff/import"
            className="rounded-md border border-border-2 px-4 py-2.5 text-sm font-semibold text-navy-2 transition-colors hover:bg-bg"
          >
            Import
          </Link>
          <AddStaffForm />
        </div>
      </div>

      {staff.length === 0 ? (
        <EmptyState
          icon={<Users className="h-5 w-5" />}
          title="No staff yet."
          body="Add teachers and other staff so they can take attendance, enter scores and collect fees."
        />
      ) : (
        <StaffBrowser
          staff={staff}
          activeStudents={activeStudents}
          roleOptions={roleOptions}
        />
      )}
    </div>
  );
}
