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
  isStaff,
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
export async function getActiveSchool(forUser?: AppUser): Promise<ActiveSchool | null> {
  // Callers that have ALREADY resolved the user pass it in. `requireSchool` does, so the school it
  // returns is derived from the very same identity as the roles it returns — otherwise this re-ran
  // `getCurrentUser()` in a second, independent transaction and could observe a different active
  // school than the one `user.roles` was scoped to (the assignment set can change between the two
  // reads). Passing the user closes that window and drops a redundant round-trip.
  const user = forUser ?? (await getCurrentUser());
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
/**
 * 🔴 STAFF-ONLY BY DEFAULT. This closes a live PII leak, and the placement is the whole point.
 *
 * WHAT WAS WRONG. This function authenticated and resolved an active school but performed NO role
 * check, and 62 of the 82 pages under `app/(app)` are gated by nothing else. Accepting a PARENT
 * invite creates a real `role_assignment` (`lib/actions/invites.ts`), so a claimed parent held an
 * active school, passed this gate, and could open `students/[id]` — blood group, allergies,
 * conditions, medications, emergency contact — plus admissions, attendance and billing.
 * Demonstrated end-to-end against a production build with a PARENT session: HTTP 200 carrying the
 * data.
 *
 * WHY THE 19a PARENT BOUNDARY DID NOT CATCH IT — and why it was not at fault. It binds through
 * `withParentScope`, which sets `app.current_parent_user`. Staff pages read under `withSchool`, so
 * that GUC is unset and `parent_deny`'s permit-by-default clause (`pu IS NULL OR …`) lets the row
 * through. Proven against the live DB as the non-superuser role: school-GUC-only read the health
 * record, parent-GUC-set read zero. The boundary is sound; a parent standing on a staff route never
 * met it. (This is exactly the polarity hazard Kofi flagged when specifying the chronic-register
 * boundary as deny-by-default.)
 *
 * WHY HERE AND NOT IN THE LAYOUT. A redirect thrown from a layout does not stop the page rendering —
 * layouts and pages render in parallel. A production build served a 307 whose body still carried the
 * health data. Every page calls this function in its OWN render, before its own queries, so this is
 * the seam where a refusal actually prevents the read.
 *
 * WHY `isStaff` RATHER THAN AN ALLOW-LIST. `isStaff` is false only for the two roles KNOWN to be
 * non-staff and true for everything else, so an unfamiliar or newly-added staff role is admitted
 * rather than locked out. For a guard covering 104 call sites that polarity is the safe one: the
 * failure mode is "a new role still works", never "the bursar cannot log in on Monday". A staff
 * member who is also a parent — common — holds a staff role and passes, correctly; roles are
 * active-school-scoped since #167, so this means "staff HERE, now".
 *
 * `allowNonStaff` is the ONE deliberate exception: `app/api/senior/readiness-statement/[id]` serves
 * a parent their own child's PDF (INCR-19b), proving ownership under `withParentScope` before it
 * renders. It is opt-IN and greppable precisely so a second one cannot appear by accident.
 * `requireParent()` does not route through here, so the parent portal is unaffected.
 */
export async function requireSchool(
  opts?: { allowNonStaff?: boolean },
): Promise<{ user: AppUser; school: ActiveSchool }> {
  const user = await requireUser();
  const school = await getActiveSchool(user);
  if (!school) redirect("/start");
  if (!opts?.allowNonStaff && !isStaff(user.roles)) {
    // A parent has somewhere to be; a student-only session has no portal yet, and `/start` is the
    // honest landing rather than a staff page they cannot use. Neither target is inside `app/(app)`,
    // which would loop.
    redirect(user.roles.includes("PARENT") ? "/wassce" : "/start");
  }
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
 * Page guard for the PARENT portal (SHS module 4.3 / INCR-19b) — its OWN route group, never the staff
 * `app/(app)` shell (Kofi R5). Admits a user holding PARENT at the ACTIVE school (roles are already
 * active-school-scoped since #167, so `.includes("PARENT")` means "PARENT here, now"); a non-parent
 * (staff-only) session is sent to the staff dashboard, and a parent whose active school can't resolve to
 * a school row lands on /start — never a leak. The child(ren) are resolved from the SESSION downstream
 * (resolveParentContext / loadParentPortal under withParentScope), never a URL parameter (Lucy L.2).
 */
export async function requireParent(): Promise<{ user: AppUser; school: ActiveSchool }> {
  const user = await requireUser();
  if (!user.roles.includes("PARENT")) redirect("/dashboard");
  const school = await getActiveSchool(user);
  if (!school) redirect("/start");
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
 * Prod: the signed-in user. Dev shim: a seeded real row holding the shim session's own first role —
 * ADMIN unless AUTH_DEV_ROLES overrode it, in which case the audit actor (and any downstream
 * role check on that id, e.g. `holdsMatronRole` on an attending clinician) matches the session the
 * developer is actually running as. Unset ⇒ identical to the shipped behaviour.
 */
export async function resolveActor(
  schoolId: string,
): Promise<{ id: string | null; role: string }> {
  const user = await getCurrentUser();
  if (!user) return { id: null, role: "APPLICANT" };
  const role = user.roles[0] ?? "ADMIN";
  if (!env.AUTH_DEV_BYPASS) return { id: user.id, role };
  return withoutTenantScope(async (tx) => {
    const rows = await tx
      .select({ id: users.id })
      .from(roleAssignments)
      .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
      .innerJoin(users, eq(roleAssignments.userId, users.id))
      .where(and(eq(roleAssignments.schoolId, schoolId), eq(roles.code, role)))
      .limit(1);
    return { id: rows[0]?.id ?? null, role };
  });
}
