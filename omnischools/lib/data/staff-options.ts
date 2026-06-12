import { and, asc, eq, inArray } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import { users, roles, roleAssignments } from "@/db/schema";
import { STAFF_ROLE_CODES } from "@/lib/staff-roles";

export type StaffOption = { id: string; name: string };

/** Distinct staff (anyone with a staff role) for teacher/assignee dropdowns. */
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
          inArray(roles.code, STAFF_ROLE_CODES),
        ),
      )
      .orderBy(asc(users.fullName)),
  );
  return rows.map((r) => ({ id: r.id, name: r.name ?? "—" }));
}
