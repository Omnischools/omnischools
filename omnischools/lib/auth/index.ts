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
export type KnownAppRole =
  | "ADMIN"
  | "HEADMASTER"
  | "VICE_HEADMASTER_ACADEMIC"
  | "TEACHER"
  | "FORM_MASTER"
  | "HOUSEMASTER"
  | "STUDENT"
  | "PARENT"
  | "BURSAR"
  | "ACCOUNTANT"
  | "DEAN_OF_BOARDING"
  | "MATRON";
export type AppRole = KnownAppRole | (string & {});

export interface AppUser {
  id: string;
  phone: string;
  email?: string;
  name?: string;
  schoolId?: string;
  roles: AppRole[];
}

const DEV_USER: AppUser = {
  id: "00000000-0000-0000-0000-000000000001",
  phone: "+233200000000",
  name: "Dev Admin",
  roles: ["ADMIN"],
};

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
  if (!authIsLive()) return DEV_USER;

  const {
    data: { user },
  } = await (await authApi()).getUser();
  if (!user?.phone) return null;
  const phone = user.phone.startsWith("+") ? user.phone : `+${user.phone}`;

  // Privileged identity lookup (runs before tenant context) — bypass RLS.
  const { withoutTenantScope } = await import("@/lib/db/rls");
  const { users, roleAssignments, roles } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");

  return withoutTenantScope(async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.phone, phone));
    if (!u) return null;
    const ra = await tx
      .select({ code: roles.code, schoolId: roleAssignments.schoolId })
      .from(roleAssignments)
      .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
      .where(eq(roleAssignments.userId, u.id));
    return {
      id: u.id,
      phone,
      email: u.email ?? undefined,
      name: u.fullName ?? undefined,
      schoolId: ra[0]?.schoolId,
      roles: ra.map((r) => r.code) as AppRole[],
    } satisfies AppUser;
  });
}

/** Throw if the current user lacks the required role. */
export async function requireRole(role: AppRole): Promise<AppUser> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not authenticated");
  if (!user.roles.includes(role)) throw new Error(`Forbidden: requires role ${role}`);
  return user;
}
