import { redirect } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { env } from "@/lib/env";
import { withoutTenantScope } from "@/lib/db/rls";
import { schools, roleAssignments, roles, users, districts, regions } from "@/db/schema";
import { getCurrentUser, type AppUser } from "@/lib/auth";

export interface ActiveSchool {
  id: string;
  name: string;
  shortName: string | null;
  gesCode: string;
  schoolType: "BASIC" | "SENIOR" | "COMBINED";
  /** District (or region) name, for the sidebar "tier · location" line. */
  location: string | null;
}

/**
 * Resolve the school the current user is operating.
 * Dev shim: the seeded demo school (Asankrangwa), else the first school.
 * Prod: the user's first active role assignment's school.
 * Runs under the RLS-bypass role — identity/school resolution happens before a
 * tenant context exists, so it cannot itself be tenant-scoped.
 */
export async function getActiveSchool(): Promise<ActiveSchool | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const cols = {
    id: schools.id,
    name: schools.name,
    shortName: schools.shortName,
    gesCode: schools.gesCode,
    schoolType: schools.schoolType,
    districtName: districts.name,
    regionName: regions.name,
  };

  const row = await withoutTenantScope(async (tx) => {
    if (env.AUTH_DEV_BYPASS) {
      const demo = await tx
        .select(cols)
        .from(schools)
        .leftJoin(districts, eq(schools.districtId, districts.id))
        .leftJoin(regions, eq(schools.regionId, regions.id))
        .where(eq(schools.gesCode, "WR-WAW-014"))
        .limit(1);
      if (demo[0]) return demo[0];
      const first = await tx
        .select(cols)
        .from(schools)
        .leftJoin(districts, eq(schools.districtId, districts.id))
        .leftJoin(regions, eq(schools.regionId, regions.id))
        .limit(1);
      return first[0] ?? null;
    }
    const assigned = await tx
      .select(cols)
      .from(roleAssignments)
      .innerJoin(schools, eq(roleAssignments.schoolId, schools.id))
      .leftJoin(districts, eq(schools.districtId, districts.id))
      .leftJoin(regions, eq(schools.regionId, regions.id))
      .where(eq(roleAssignments.userId, user.id))
      .limit(1);
    return assigned[0] ?? null;
  });

  if (!row) return null;
  const { districtName, regionName, ...rest } = row;
  return { ...rest, location: districtName ?? regionName ?? null };
}

/** For app pages: ensure a signed-in user, else send to login. */
export async function requireUser(): Promise<AppUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** For app pages: ensure a user AND a resolvable school, else redirect. */
export async function requireSchool(): Promise<{ user: AppUser; school: ActiveSchool }> {
  const user = await requireUser();
  const school = await getActiveSchool();
  if (!school) redirect("/start");
  return { user, school };
}

/**
 * Resolve a real `ref_user` id to attribute audit rows to (FK-safe).
 * Prod: the signed-in user. Dev shim: the school's ADMIN user (a seeded real row).
 */
export async function resolveActor(
  schoolId: string,
): Promise<{ id: string | null; role: string }> {
  const user = await getCurrentUser();
  if (!user) return { id: null, role: "APPLICANT" };
  if (!env.AUTH_DEV_BYPASS) return { id: user.id, role: user.roles[0] ?? "ADMIN" };
  return withoutTenantScope(async (tx) => {
    const rows = await tx
      .select({ id: users.id })
      .from(roleAssignments)
      .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
      .innerJoin(users, eq(roleAssignments.userId, users.id))
      .where(and(eq(roleAssignments.schoolId, schoolId), eq(roles.code, "ADMIN")))
      .limit(1);
    return { id: rows[0]?.id ?? null, role: "ADMIN" };
  });
}
