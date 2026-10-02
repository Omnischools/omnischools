/*
 * NO `import "server-only"` HERE, deliberately.
 *
 * That marker package is resolvable only inside the Next bundler graph; this module is also imported
 * by the vitest suite (and, for the provisioning modules, by a tsx CLI script), where the import
 * fails outright. The server-side boundary is therefore enforced the way this codebase already
 * enforces the read-back boundary — by an import-graph test with an explicit allow-list
 * (tests/auth-boundaries.test.ts, tests/provisioning-admin-gate.test.ts) plus the ESLint
 * no-restricted-imports rules — which catches a client component importing this at review time
 * rather than at bundle time, and which a test cannot silently lose.
 */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { requireSupabaseAuthConfig } from "@/lib/env";

/**
 * Server-side Supabase client for the ANALYTICS project's own Supabase Auth — the GES-staff pool
 * (docs/PROVISIONING.md §4b). This is NOT `omnischools-prod`'s auth: a school's head teacher and a
 * GES district director are different identities in different projects, on purpose.
 *
 * ── PORTED, NOT SHARED ────────────────────────────────────────────────────────────────────────────
 * This file is a deliberate COPY of `apps/web/lib/supabase/server.ts` (same App-Router cookie
 * plumbing, same `@supabase/ssr` call shape). The two apps have separate `pnpm-lock.yaml` files and
 * no shared package, so a cross-app import would couple two independently-deployed, independently-
 * versioned Next apps through a path alias that works only in a monorepo checkout. If you change the
 * cookie handling here, look at that file too — they are expected to stay the same shape, and the
 * pointer comment is the only link between them.
 *
 * ── TWO THINGS THAT ARE NOT THE SAME AS apps/web ──────────────────────────────────────────────────
 *  1. NO `?? ""` FALLBACK ON THE URL/KEY. apps/web's client is "dormant until Supabase env is set";
 *     Oversight's is not allowed to be dormant — a client built on empty strings would produce
 *     `getUser()` failures that look like "not signed in" rather than "this deployment cannot
 *     authenticate anybody". `requireSupabaseAuthConfig()` throws a named error instead, which the
 *     auth layer turns into a loud, explicit unavailable state (lib/auth/index.ts).
 *  2. NO SERVICE-ROLE CLIENT. apps/web has `lib/supabase/admin.ts`; Oversight deliberately has no
 *     equivalent and does not read `SUPABASE_SERVICE_ROLE_KEY` at all (see lib/env.ts).
 */
export async function createClient() {
  const { url, anonKey } = requireSupabaseAuthConfig();
  const cookieStore = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Called from a Server Component — safe to ignore; middleware refreshes the session.
        }
      },
    },
  });
}
