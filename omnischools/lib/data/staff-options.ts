import { and, asc, eq, notInArray } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import { users, roles, roleAssignments } from "@/db/schema";
import { NON_STAFF_ROLE_CODES } from "@/lib/staff-roles";

export type StaffOption = { id: string; name: string };

/** Distinct staff (anyone holding a non-student/parent role, incl. custom) for dropdowns. */
export async function loadStaffOptions(schoolId: string): Promise<StaffOption[]> {
  const rows = await withSchool(schoolId, (tx) =>
    tx
      .selectDistinct({ id: users.id, name: users.fullName })
      .from(roleAssignments)
      .innerJoin(users, eq(roleAssignments.userId, users.id))
      .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
      .where(
        and(
          eq(roleAssignments.schoolId, schoolId),
          notInArray(roles.code, NON_STAFF_ROLE_CODES),
        ),
      )
      .orderBy(asc(users.fullName)),
  );
  return rows.map((r) => ({ id: r.id, name: r.name ?? "—" }));
}
