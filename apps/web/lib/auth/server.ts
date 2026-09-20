import { cache } from "react";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { eq, and } from "drizzle-orm";
import { env } from "@/lib/env";
import { withoutTenantScope } from "@/lib/db/rls";
import { schools, roleAssignments, roles, users, districts, regions } from "@/db/schema";
import {
  getCurrentUser,
  authIsLive,
  sessionLoginAtMs,
  sessionAuthMethods,
  otpLoginRequired,
  type AppUser,
  type AppRole,
} from "@/lib/auth";
import { sessionAgeExceeded } from "@/lib/auth/session-age";
import { twoFactorStepUpRequired } from "@/lib/auth/two-factor";
import {
  isFinanceOnly,
  pathAllowedForFinance,
  FINANCE_HOME,
  isBoardOnly,
  pathAllowedForBoard,
  BOARD_HOME,
  hasAnyRole,
  isStaff,
  TWO_FACTOR_ADMIN_ROLES,
} from "@/lib/access";

export interface ActiveSchool {
  id: string;
  name: string;
  shortName: string | null;
  gesCode: string;
  schoolType: "BASIC" | "SENIOR" | "COMBINED";
  /** District (or region) name, for the sidebar "tier · location" line. */
  location: string | null;
  /** "Session length" security setting (hours); null = the school never configured a limit. */
  sessionHours: number | null;
  /** "Require two-factor for administrators" security setting; null/false = off (the default). */
  require2fa: boolean | null;
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
    sessionHours: schools.sessionHours,
    require2fa: schools.require2fa,
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

/**
 * INCR-254 — enforce the school's "Session length" security setting (ref_school.session_hours). The
 * signed-in session must be younger than the configured number of hours, measured as an ABSOLUTE age
 * from the original login (not idle time — the copy is "8 hours (a school day)", i.e. a wall-clock
 * span). Over-age ⇒ redirect to /login to re-authenticate; the login page renders its form for an
 * authed-but-stale session (it does not bounce back), so there is no loop, and every (app) guard keeps
 * refusing the stale session until a fresh login resets its age.
 *
 * FAIL-CLOSED (Sarah): a configured limit whose age can't be read forces re-auth. Inert when the
 * school set no limit (null) or under dev-bypass (no real session). ponytail: guard-level block — the
 * GoTrue refresh token stays valid but reaches no (app) page; a hard token revocation would need a
 * route handler (SC cookie writes are no-ops here), add if token-level kill is ever required.
 */
async function enforceSessionAge(school: ActiveSchool): Promise<void> {
  if (school.sessionHours == null || !authIsLive()) return;
  const loginAtMs = await sessionLoginAtMs();
  if (sessionAgeExceeded({ limitHours: school.sessionHours, isLive: true, loginAtMs })) {
    redirect("/login?expired=1");
  }
}

/**
 * INCR-254 (deferred half) — enforce the school's "Require two-factor for administrators" setting
 * (ref_school.require_2fa). When ON, a signed-in admin-tier user (TWO_FACTOR_ADMIN_ROLES) whose session
 * completed only a password factor (no OTP in its `amr`) is sent to `/login?stepup=1` to re-authenticate
 * through the EXISTING phone-OTP path (the login form defaults to its Phone-OTP tab; no new flow). The
 * decision lives in the pure `twoFactorStepUpRequired`; this only reads the setting/roles/amr and redirects.
 *
 * 🔴 FAIL-SAFE (Sarah), the deliberate inverse of enforceSessionAge: enforcement fires ONLY when OTP is
 * genuinely DELIVERABLE (`otpLoginRequired()` — the same gate that decides whether OTP is required at
 * login). If OTP can't be delivered yet (pre-#260, SMS console-only), forcing it would permanently lock
 * out the school's ONLY admins — so no-deliverable-OTP ⇒ do NOT block. Also inert under dev-bypass /
 * `!authIsLive()` (both fold into `otpLoginRequired()` being false) and whenever the setting is off. The
 * full reasoning + the amr-readability asymmetry are on `twoFactorStepUpRequired`.
 *
 * The cheap `!school.require2fa` short-circuit (default OFF for ~every school) skips the getSession()
 * round-trip on the hot path; the pure fn re-checks it and remains the tested authority.
 */
async function enforceRequireTwoFactor(school: ActiveSchool, user: AppUser): Promise<void> {
  if (!school.require2fa) return;
  const isAdmin = hasAnyRole(user.roles, TWO_FACTOR_ADMIN_ROLES);
  if (!isAdmin) return;
  const amr = await sessionAuthMethods();
  if (
    twoFactorStepUpRequired({
      require2fa: school.require2fa,
      isAdmin,
      otpDeliverable: otpLoginRequired(),
      amr,
    })
  ) {
    redirect("/login?stepup=1");
  }
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
  await enforceSessionAge(school);
  // AFTER school-resolve, alongside session-age: an admin the school requires to 2FA but who is
  // password-only is bounced to step-up. Fail-SAFE (never blocks when OTP is undeliverable) — see
  // enforceRequireTwoFactor. Placed here so it covers every (app) page's own render, like the staff gate.
  await enforceRequireTwoFactor(school, user);
  if (!opts?.allowNonStaff && !isStaff(user.roles)) {
    // A board-only session hitting a staff URL lands on its own read-only overview FIRST (GOV-2 / R334);
    // a parent has somewhere to be; a student-only session has no portal yet, and `/start` is the honest
    // landing rather than a staff page they cannot use. None of these targets is inside `app/(app)`,
    // which would loop.
    redirect(
      isBoardOnly(user.roles)
        ? BOARD_HOME
        : user.roles.includes("PARENT")
          ? "/wassce"
          : "/start",
    );
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
  // GOV-2 (R336) — a board-only session is read-only across the WHOLE app, so it throws here too. Do NOT
  // fold this clause away: removing `isBoardOnly(user.roles)` reopens a write path for a board session
  // (a mutation of this line must red a test).
  if (user && (isFinanceOnly(user.roles) || isBoardOnly(user.roles))) {
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
// `cache()` — request-level single-flight. requireParent takes no args, so every caller in one render
// (a page body AND the async ParentNav that self-gates on school.schoolType) shares ONE identity/school
// resolution instead of re-running the GoTrue hop + identity/getActiveSchool reads per call (Dex INCR-BOARD).
export const requireParent = cache(
  async (): Promise<{ user: AppUser; school: ActiveSchool }> => {
    const user = await requireUser();
    if (!user.roles.includes("PARENT")) redirect("/dashboard");
    const school = await getActiveSchool(user);
    if (!school) redirect("/start");
    await enforceSessionAge(school);
    return { user, school };
  },
);

/**
 * Page guard for the read-only BOARD/DIRECTOR overview (GOV-2 / R335) — its OWN `(board)` route group,
 * NEVER the staff `app/(app)` shell (BOARD_MEMBER is non-staff, so `requireSchool` would bounce it). It
 * mirrors `requireParent()`, plus a finance-style path confinement: admits a BOARD_MEMBER at the active
 * school; a non-board session is sent to the staff dashboard; a board session with no resolvable school
 * lands on /start; and a board session reaching any path OUTSIDE `/board` is redirected to BOARD_HOME.
 * Every `(board)` page awaits this in its OWN render (before its own queries) — that, not the layout, is
 * where the confinement actually bites (a layout redirect does not stop a page rendering).
 */
export async function requireBoard(): Promise<{ user: AppUser; school: ActiveSchool }> {
  const user = await requireUser();
  if (!user.roles.includes("BOARD_MEMBER")) redirect("/dashboard");
  const school = await getActiveSchool(user);
  if (!school) redirect("/start");
  await enforceSessionAge(school);
  const pathname = (await headers()).get("x-pathname") ?? "";
  if (pathname && !pathAllowedForBoard(pathname)) redirect(BOARD_HOME);
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
