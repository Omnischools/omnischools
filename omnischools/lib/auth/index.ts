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
export type AppRole =
  | "ADMIN"
  | "HEADMASTER"
  | "VICE_HEADMASTER_ACADEMIC"
  | "TEACHER"
  | "FORM_MASTER"
  | "HOUSEMASTER"
  | "STUDENT"
  | "PARENT"
  | "BURSAR"
  | "DEAN_OF_BOARDING"
  | "MATRON";

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

/** Begin phone-OTP sign-in (sends an SMS code in live mode). */
export async function signInWithPhone(
  phone: string,
): Promise<{ ok: boolean; error?: string }> {
  const normalized = normalizeGhanaPhone(phone);
  if (!authIsLive()) {
    console.info(`[auth:dev] OTP requested for ${normalized} (bypass enabled)`);
    return { ok: true };
  }
  const { createClient } = await import("@/lib/supabase/server");
  const { error } = await createClient().auth.signInWithOtp({ phone: normalized });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Verify a phone-OTP code; establishes the session cookie in live mode. */
export async function verifyPhoneOtp(
  phone: string,
  token: string,
): Promise<{ ok: boolean; error?: string }> {
  const normalized = normalizeGhanaPhone(phone);
  if (!authIsLive()) return { ok: true };
  const { createClient } = await import("@/lib/supabase/server");
  const { error } = await createClient().auth.verifyOtp({
    phone: normalized,
    token,
    type: "sms",
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function signOut(): Promise<void> {
  if (!authIsLive()) return;
  const { createClient } = await import("@/lib/supabase/server");
  await createClient().auth.signOut();
}

/** Resolve the current authenticated user, or null. */
export async function getCurrentUser(): Promise<AppUser | null> {
  if (!authIsLive()) return DEV_USER;

  const { createClient } = await import("@/lib/supabase/server");
  const {
    data: { user },
  } = await createClient().auth.getUser();
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
