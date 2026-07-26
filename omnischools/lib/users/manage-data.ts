import "server-only";
import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import { users, roleAssignments, roles, userSchoolBlock } from "@/db/schema";
import { rankOf } from "@/lib/access";

/**
 * INCR-35 (L2b) — the user-management list for `/settings/users` (Kofi R266). Every user with a
 * currently-active role_assignment at the manager's OWN school, with their role code(s), block status,
 * and rank. Read under `withSchool` so RLS scopes to the school (a manager never sees another school's
 * users). The PAGE gates this behind `requireSchool` + `assertAnyRole(USER_ADMIN_ROLES)`; this loader
 * assumes that gate has run. Students are excluded from the list (no student login today, R266).
 */
export interface ManagedUser {
  id: string;
  name: string | null;
  phone: string;
  roles: string[];
  blocked: boolean;
  rank: number;
}

export async function loadSchoolUsers(schoolId: string): Promise<ManagedUser[]> {
  return withSchool(schoolId, async (tx) => {
    const today = new Date().toISOString().slice(0, 10);
    const rows = await tx
      .select({
        userId: roleAssignments.userId,
        name: users.fullName,
        phone: users.phone,
        code: roles.code,
        blockedAt: userSchoolBlock.blockedAt,
      })
      .from(roleAssignments)
      .innerJoin(users, eq(users.id, roleAssignments.userId))
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .leftJoin(
        userSchoolBlock,
        and(
          eq(userSchoolBlock.schoolId, roleAssignments.schoolId),
          eq(userSchoolBlock.userId, roleAssignments.userId),
        ),
      )
      .where(
        and(
          eq(roleAssignments.schoolId, schoolId),
          lte(roleAssignments.startDate, today),
          or(isNull(roleAssignments.endDate), gte(roleAssignments.endDate, today)),
        ),
      );

    // Group the role rows by user (a user may hold several roles at the school).
    const byUser = new Map<string, ManagedUser>();
    for (const r of rows) {
      let u = byUser.get(r.userId);
      if (!u) {
        u = { id: r.userId, name: r.name, phone: r.phone, roles: [], blocked: !!r.blockedAt, rank: -1 };
        byUser.set(r.userId, u);
      }
      if (!u.roles.includes(r.code)) u.roles.push(r.code);
    }
    // Exclude student-only users (no student login today, R266); compute rank from the collected roles.
    const list: ManagedUser[] = [];
    for (const u of byUser.values()) {
      if (u.roles.length === 1 && u.roles[0] === "STUDENT") continue;
      u.rank = rankOf(u.roles);
      list.push(u);
    }
    // Highest rank first, then by name (stable, human-friendly ordering for the table).
    list.sort((a, b) => b.rank - a.rank || (a.name ?? "").localeCompare(b.name ?? ""));
    return list;
  });
}
