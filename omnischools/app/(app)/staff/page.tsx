import { and, asc, eq, inArray } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import { users, roles, roleAssignments } from "@/db/schema";
import { STAFF_ROLE_CODES } from "@/lib/staff-roles";
import { AddStaffForm } from "@/components/staff/add-staff-form";
import { StaffRow } from "@/components/staff/staff-row";

export const dynamic = "force-dynamic";

type StaffMember = {
  userId: string;
  name: string | null;
  phone: string;
  email: string | null;
  roles: { assignmentId: string; code: string }[];
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
      })
      .from(roleAssignments)
      .innerJoin(users, eq(roleAssignments.userId, users.id))
      .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
      .where(
        and(
          eq(roleAssignments.schoolId, school.id),
          inArray(roles.code, STAFF_ROLE_CODES),
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
    g.roles.push({ assignmentId: r.assignmentId, code: r.code });
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
        <AddStaffForm />
      </div>

      {staff.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-2 bg-surface p-12 text-center">
          <p className="font-display text-lg text-navy">No staff yet.</p>
          <p className="mt-1 text-sm text-navy-3">
            Add teachers and other staff so they can take attendance, enter scores and
            collect fees.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-bg text-left text-xs uppercase tracking-wide text-navy-3">
              <tr>
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Phone</th>
                <th className="px-4 py-3 font-semibold">Email</th>
                <th className="px-4 py-3 font-semibold">Roles</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {staff.map((m) => (
                <StaffRow key={m.userId} member={m} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
