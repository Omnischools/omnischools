import Link from "next/link";
import { Users } from "lucide-react";
import { and, asc, eq, notInArray } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import { users, roles, roleAssignments } from "@/db/schema";
import { NON_STAFF_ROLE_CODES } from "@/lib/staff-roles";
import { AddStaffForm } from "@/components/staff/add-staff-form";
import { StaffTable } from "@/components/staff/staff-table";
import { EmptyState } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";

type StaffMember = {
  userId: string;
  name: string | null;
  phone: string;
  email: string | null;
  roles: { assignmentId: string; code: string; label: string | null }[];
};

export default async function StaffPage() {
  const { school } = await requireSchool();

  const rows = await withSchool(school.id, (tx) =>
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
  );

  const byUser = new Map<string, StaffMember>();
  for (const r of rows) {
    let g = byUser.get(r.userId);
    if (!g) {
      g = { userId: r.userId, name: r.name, phone: r.phone, email: r.email, roles: [] };
      byUser.set(r.userId, g);
    }
    g.roles.push({ assignmentId: r.assignmentId, code: r.code, label: r.label });
  }
  const staff = Array.from(byUser.values());

  return (
    <div className="mx-auto max-w-page">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold text-navy">Staff</h1>
          <p className="text-sm text-navy-3">
            {staff.length} {staff.length === 1 ? "person" : "people"} · teachers, bursars
            and admins who can sign in.
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
        <StaffTable staff={staff} />
      )}
    </div>
  );
}
