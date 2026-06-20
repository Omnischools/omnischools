import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * Service-role Supabase client for privileged storage operations (server only).
 * Returns null when Supabase isn't configured (local dev / build) so callers can
 * fail gracefully rather than crash. NEVER expose the service key to the client.
 */
export function createAdminClient(): SupabaseClient | null {
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Public bucket for school branding assets (logo, stamp). Created via SQL on deploy. */
export const BRANDING_BUCKET = "branding";
