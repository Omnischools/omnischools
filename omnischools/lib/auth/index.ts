import { env } from "@/lib/env";

/**
 * Thin auth interface (BUILD_STACK portability rule): feature code calls these,
 * never `supabase.auth.*` directly.
 *
 * Two modes, chosen by env:
 *  - Dev bypass (AUTH_DEV_BYPASS=true, no Supabase): a shim issues an ADMIN session
 *    so the app is runnable locally without an auth provider.
 *  - Real (Supabase URL set + AUTH_DEV_BYPASS=false): phone-OTP via Supabase Auth;
 *    the authenticated phone is mapped to a ref_user + role assignments.
 */
/**
 * Known role codes. Roles are stored as free text (ref_role.code), so a school may also
 * hold custom roles — `(string & {})` keeps autocomplete for the known set while allowing
 * any custom code through.
 */
export const KNOWN_APP_ROLES = [
  "ADMIN",
  "HEADMASTER",
  "VICE_HEADMASTER_ACADEMIC",
  "TEACHER",
  "FORM_MASTER",
  "HOUSEMASTER",
  "STUDENT",
  "PARENT",
  "BURSAR",
  "ACCOUNTANT",
  "DEAN_OF_BOARDING",
  "MATRON",
] as const;
export type KnownAppRole = (typeof KNOWN_APP_ROLES)[number];
export type AppRole = KnownAppRole | (string & {});

export interface AppUser {
  id: string;
  phone: string;
  email?: string;
  name?: string;
  /** The ACTIVE school — the earliest still-current role assignment. `roles` are scoped to it. */
  schoolId?: string;
  /**
   * INVARIANT — ONLY the roles held at `schoolId`. **Never a union across schools.**
   *
   * Every `hasAnyRole`/`assertAnyRole`/`requireSchoolRole` check in the app (~129 sites) trusts this,
   * so the whole authz model rests on it. It used to be the union of every assignment at every school,
   * which meant a TEACHER at school A who was ADMIN at school B passed ADMIN-gated checks *at A* — a
   * privilege escalation within the active school.
   *
   * There are exactly TWO constructors of an `AppUser`: `DEV_USER` below and `getCurrentUser` in this
   * file. **If you add a third** — impersonation, a service account, `getUserById` — it MUST scope
   * roles the same way, or it silently reopens the escalation for every one of those 129 checks.
   * Build it on `scopeRolesToActiveSchool` (`./roles`), which is where the rule and its tests live.
   */
  roles: AppRole[];
}

const DEV_USER: AppUser = {
  id: "00000000-0000-0000-0000-000000000001",
  phone: "+233200000000",
  name: "Dev Admin",
  roles: ["ADMIN"],
};

/**
 * The dev-bypass session. `AUTH_DEV_ROLES=MATRON,HEADMASTER` pins it to those roles instead of
 * ADMIN — the clinical module (SHS 4.4) is MATRON-gated, so without this NO ONE can reach the
 * sickbay UI or any clinical mutation in a local dev run.
 *
 * 🔒 It CANNOT widen roles in production: it is read only when `env.AUTH_DEV_BYPASS` is true, and
 * that switch defaults to "false" and fails closed (a missing or misspelled env var denies). When
 * AUTH_DEV_ROLES is unset the result is byte-identical to DEV_USER. Real sessions never reach here.
 */
function devUser(): AppUser {
  if (!env.AUTH_DEV_BYPASS) return DEV_USER;
  const roles = (env.AUTH_DEV_ROLES ?? "")
    .split(",")
    .map((r) => r.trim().toUpperCase())
    .filter(Boolean);
  // A typo here is otherwise invisible: the session is issued, every role gate denies it, and
  // nothing anywhere says why. Fail loudly instead — this is a dev-only switch.
  const unknown = roles.filter((r) => !(KNOWN_APP_ROLES as readonly string[]).includes(r));
  if (unknown.length > 0) {
    throw new Error(
      `AUTH_DEV_ROLES: unknown role code(s) ${unknown.join(", ")}. Known codes: ${KNOWN_APP_ROLES.join(", ")}.`,
    );
  }
  return roles.length > 0 ? { ...DEV_USER, roles } : DEV_USER;
}

/** True when real Supabase Auth should be used. */
export function authIsLive(): boolean {
  return !env.AUTH_DEV_BYPASS && !!env.NEXT_PUBLIC_SUPABASE_URL;
}

/** Normalise Ghanaian phone numbers to E.164 (+233XXXXXXXXX). */
export function normalizeGhanaPhone(input: string): string {
  const digits = input.replace(/[^\d+]/g, "");
  if (digits.startsWith("+233")) return digits;
  if (digits.startsWith("233")) return `+${digits}`;
  if (digits.startsWith("0")) return `+233${digits.slice(1)}`;
  if (/^\d{9}$/.test(digits)) return `+233${digits}`;
  return digits;
}

/**
 * Minimal, explicitly-typed view of the Supabase auth client for the methods we use.
 * We call through this instead of the inferred `.auth` type because duplicated
 * @supabase/* type copies can drop methods from `SupabaseAuthClient` in some install
 * layouts (passes locally, failed on Vercel). Runtime is unchanged — the methods exist.
 */
type SupabaseAuthApi = {
  signInWithOtp(creds: { phone: string }): Promise<{ error: { message: string } | null }>;
  verifyOtp(creds: {
    phone: string;
    token: string;
    type: "sms";
  }): Promise<{ error: { message: string } | null }>;
  signUp(creds: {
    phone: string;
    password: string;
  }): Promise<{ error: { message: string } | null }>;
  signInWithPassword(creds: {
    phone: string;
    password: string;
  }): Promise<{ error: { message: string } | null }>;
  getUser(): Promise<{ data: { user: { phone?: string | null } | null } }>;
  getSession(): Promise<{
    data: {
      session: { access_token?: string | null; user?: { id?: string | null } | null } | null;
    };
  }>;
  signOut(): Promise<unknown>;
};

async function authApi(): Promise<SupabaseAuthApi> {
  const { createClient } = await import("@/lib/supabase/server");
  return (await createClient()).auth as unknown as SupabaseAuthApi;
}

/** Begin phone-OTP sign-in (sends an SMS code in live mode). */
export async function signInWithPhone(
  phone: string,
): Promise<{ ok: boolean; error?: string }> {
  const normalized = normalizeGhanaPhone(phone);
  if (!authIsLive()) {
    console.info(`[auth:dev] OTP requested for ${normalized} (bypass enabled)`);
    return { ok: true };
  }
  const { error } = await (await authApi()).signInWithOtp({ phone: normalized });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Verify a phone-OTP code; establishes the session cookie in live mode. */
export async function verifyPhoneOtp(
  phone: string,
  token: string,
): Promise<{ ok: boolean; error?: string }> {
  const normalized = normalizeGhanaPhone(phone);
  if (!authIsLive()) return { ok: true };
  const { error } = await (
    await authApi()
  ).verifyOtp({
    phone: normalized,
    token,
    type: "sms",
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Create a phone+password account for an invited user (idempotent on re-accept). */
export async function createPasswordUser(
  phone: string,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!authIsLive()) return { ok: true };
  const { error } = await (
    await authApi()
  ).signUp({
    phone: normalizeGhanaPhone(phone),
    password,
  });
  if (error && !/already (registered|exists)/i.test(error.message)) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/** Phone + password sign-in; establishes the session cookie in live mode. */
export async function signInWithPassword(
  phone: string,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!authIsLive()) return { ok: true };
  const { error } = await (
    await authApi()
  ).signInWithPassword({
    phone: normalizeGhanaPhone(phone),
    password,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function signOut(): Promise<void> {
  if (!authIsLive()) return;
  await (await authApi()).signOut();
}

/** Resolve the current authenticated user, or null. */
export async function getCurrentUser(): Promise<AppUser | null> {
  if (!authIsLive()) return devUser();

  const {
    data: { user },
  } = await (await authApi()).getUser();
  if (!user?.phone) return null;
  const phone = user.phone.startsWith("+") ? user.phone : `+${user.phone}`;

  // Privileged identity lookup (runs before tenant context) — bypass RLS.
  const { withoutTenantScope } = await import("@/lib/db/rls");
  const { users, roleAssignments, roles } = await import("@/db/schema");
  const { and, eq, gte, isNull, lte, or } = await import("drizzle-orm");
  const { scopeRolesToActiveSchool } = await import("./roles");

  return withoutTenantScope(async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.phone, phone));
    if (!u) return null;
    const today = new Date().toISOString().slice(0, 10); // role_assignment start/end are DATE columns

    const ra = await tx
      .select({
        code: roles.code,
        schoolId: roleAssignments.schoolId,
        // Selected so `scopeRolesToActiveSchool` can RE-APPLY the time window in tested code — the
        // WHERE below is only a pre-filter, and a typo in it would be invisible to the suite.
        startDate: roleAssignments.startDate,
        endDate: roleAssignments.endDate,
      })
      .from(roleAssignments)
      .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
      .where(
        and(
          eq(roleAssignments.userId, u.id),
          // Only a CURRENTLY-ACTIVE assignment confers a role. Previously unfiltered, so a member of
          // staff whose assignment had ended kept every permission it granted.
          lte(roleAssignments.startDate, today),
          or(isNull(roleAssignments.endDate), gte(roleAssignments.endDate, today)),
        ),
      )
      // The earliest-CREATED still-current assignment picks the active school (`created_at`, not
      // `start_date` — the latter is date-granular and would tie en masse on the batch-insert paths in
      // seed/onboarding). Previously unordered, so `ra[0]` — and therefore the whole identity — could
      // vary between requests.
      //
      // This is not a strict total order on ROWS: `created_at` defaults to transaction-start time, so
      // a batch insert ties. It IS deterministic in the OUTPUT, which is what matters — a tie on all
      // three keys means the same school and the same role code (`ref_role.code` is globally unique),
      // so the rows differ only by `scope_ref` and are interchangeable here: same `schoolId`, and the
      // Set below collapses the duplicate code.
      .orderBy(roleAssignments.createdAt, roleAssignments.schoolId, roles.code);

    // Roles are scoped to the active school. See ./roles for why this is fixed HERE and not at the
    // ~129 call sites: every existing and future role check inherits the correction for free.
    const scoped = scopeRolesToActiveSchool(ra, today);
    return {
      id: u.id,
      phone,
      email: u.email ?? undefined,
      name: u.fullName ?? undefined,
      schoolId: scoped.schoolId,
      roles: scoped.roles,
    } satisfies AppUser;
  });
}

/**
 * A STABLE client-side partition key for the current auth session — used to key the Score-Ledger
 * PWA IndexedDB store + SW ledger cache (INCR-14 · Item 9). The key must:
 *   - SURVIVE the hourly access-token refresh (else the offline buffer is orphaned every hour), and
 *   - ROTATE on logout / a different teacher signing in on the same tablet (else teacher B inherits
 *     teacher A's durable pending SCORES — a shared-device PII leak; Sarah gate).
 *
 * The Supabase client `Session` exposes no first-class "session id" field, but the access-token JWT
 * carries a `session_id` claim: the PARENT session's opaque id — constant across every token
 * refresh within one login, regenerated on a fresh login. We read ONLY that claim, never the raw
 * JWT (it rotates hourly and is a bearer secret). The signature is intentionally NOT verified: this
 * value only names a client-side cache partition, it is not an authorization decision (RLS remains
 * the boundary). Kept inside lib/auth (portability seam — feature code never touches supabase.auth).
 * Dev-bypass (no Supabase session) → the uid, which is single-user by construction.
 */
export async function getSessionId(): Promise<string> {
  if (!authIsLive()) return DEV_USER.id;
  const {
    data: { session },
  } = await (await authApi()).getSession();
  const fromClaim = session?.access_token ? sessionIdFromJwt(session.access_token) : null;
  return fromClaim ?? session?.user?.id ?? DEV_USER.id;
}

/** Decode the `session_id` claim from a Supabase access-token JWT (unverified — partition key only). */
function sessionIdFromJwt(jwt: string): string | null {
  try {
    const payload = jwt.split(".")[1];
    if (!payload) return null;
    const claim = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))?.session_id;
    return typeof claim === "string" && claim ? claim : null;
  } catch {
    return null;
  }
}

/**
 * Throw if the current user lacks the required role.
 * Reads `user.roles`, which is scoped to the ACTIVE school only — see the invariant on `AppUser.roles`.
 */
export async function requireRole(role: AppRole): Promise<AppUser> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not authenticated");
  if (!user.roles.includes(role)) throw new Error(`Forbidden: requires role ${role}`);
  return user;
}
