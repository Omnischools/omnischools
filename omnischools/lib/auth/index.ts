import { env } from "@/lib/env";

/**
 * Thin auth interface (BUILD_STACK portability rule): feature code calls these,
 * never `supabase.auth.*` directly. In dev (AUTH_DEV_BYPASS) a shim issues a
 * session so the app is buildable/runnable before Supabase Auth is wired.
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

/** Normalise Ghanaian phone numbers to E.164 (+233XXXXXXXXX). */
export function normalizeGhanaPhone(input: string): string {
  const digits = input.replace(/[^\d+]/g, "");
  if (digits.startsWith("+233")) return digits;
  if (digits.startsWith("233")) return `+${digits}`;
  if (digits.startsWith("0")) return `+233${digits.slice(1)}`;
  if (/^\d{9}$/.test(digits)) return `+233${digits}`;
  return digits;
}

/** Begin phone-OTP sign-in. Real impl wraps supabase.auth.signInWithOtp at deploy. */
export async function signInWithPhone(phone: string): Promise<void> {
  const normalized = normalizeGhanaPhone(phone);
  if (env.AUTH_DEV_BYPASS) {
    console.info(`[auth:dev] OTP requested for ${normalized} (bypass enabled)`);
    return;
  }
  throw new Error("Supabase Auth not wired yet — set AUTH_DEV_BYPASS or wire provider.");
}

/** Resolve the current authenticated user, or null. */
export async function getCurrentUser(): Promise<AppUser | null> {
  if (env.AUTH_DEV_BYPASS) {
    return {
      id: "00000000-0000-0000-0000-000000000001",
      phone: "+233200000000",
      name: "Dev Admin",
      roles: ["ADMIN"],
    };
  }
  // TODO(deploy): read Supabase session via lib/supabase/server and map to AppUser.
  return null;
}

/** Throw if the current user lacks the required role. */
export async function requireRole(role: AppRole): Promise<AppUser> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not authenticated");
  if (!user.roles.includes(role)) {
    throw new Error(`Forbidden: requires role ${role}`);
  }
  return user;
}
