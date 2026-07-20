import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { eq, and } from "drizzle-orm";
import { env } from "@/lib/env";
import { withoutTenantScope } from "@/lib/db/rls";
import { schools, roleAssignments, roles, users, districts, regions } from "@/db/schema";
import { getCurrentUser, type AppUser, type AppRole } from "@/lib/auth";
import {
  isFinanceOnly,
  pathAllowedForFinance,
  FINANCE_HOME,
  hasAnyRole,
} from "@/lib/access";

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
    // Resolve the school `getCurrentUser` ALREADY picked, rather than re-deriving it. This used to be
    // an independent unordered `LIMIT 1` over role_assignment, so for a user with assignments at more
    // than one school it could return a DIFFERENT school than the one `user.roles` was taken from —
    // i.e. the active school and the roles in force could disagree. Reading `user.schoolId` makes that
    // divergence structurally impossible, and it is already time-filtered and deterministically
    // ordered there. No active assignment ⇒ no school ⇒ the caller redirects to /start.
    if (!user.schoolId) return null;
    const assigned = await tx
      .select(cols)
      .from(schools)
      .leftJoin(districts, eq(schools.districtId, districts.id))
      .leftJoin(regions, eq(schools.regionId, regions.id))
      .where(eq(schools.id, user.schoolId))
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
  // Finance-only staff (Accountant/Bursar) are confined to the billing sections.
  // Runs on every app page (and its server actions) via this shared guard; the path
  // comes from the middleware-stamped `x-pathname` header.
  if (isFinanceOnly(user.roles)) {
    const pathname = (await headers()).get("x-pathname") ?? "";
    if (pathname && !pathAllowedForFinance(pathname)) redirect(FINANCE_HOME);
  }
  return { user, school };
}

/**
 * Throw if the current user is finance-only (Accountant/Bursar). Call at the top of
 * mutation actions for records a finance role may only *read* (students, classes) so
 * read-only access holds even against a hand-crafted request.
 */
export async function assertWriteAccess(): Promise<void> {
  const user = await getCurrentUser();
  if (user && isFinanceOnly(user.roles)) {
    throw new Error("Forbidden: your role has read-only access to this record.");
  }
}

/**
 * Page guard: ensure a signed-in user + resolvable school AND that the user holds at least
 * one of the allowed roles, else redirect to their dashboard. For role-restricted surfaces
 * (the Senior score ledger — teaching; the Vice Headmaster progress view — management).
 * Extends requireSchool, so the finance-only confinement still applies underneath.
 */
export async function requireSchoolRole(
  allowed: readonly AppRole[],
): Promise<{ user: AppUser; school: ActiveSchool }> {
  const { user, school } = await requireSchool();
  if (!hasAnyRole(user.roles, allowed)) redirect("/dashboard");
  return { user, school };
}

/**
 * Action guard: throw unless the current user holds one of the allowed roles. Call at the
 * top of a mutating server action so STUDENT/PARENT (and other unlisted roles) cannot POST it.
 */
export async function assertAnyRole(allowed: readonly AppRole[]): Promise<void> {
  const user = await getCurrentUser();
  if (!user || !hasAnyRole(user.roles, allowed)) {
    throw new Error("Forbidden: your role cannot perform this action.");
  }
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
