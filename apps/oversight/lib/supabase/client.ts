"use client";
import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client (analytics project auth — the GES-staff pool).
 *
 * A deliberate COPY of `apps/web/lib/supabase/client.ts`, for the reason given at the top of
 * `./server.ts`: separate lockfiles, no shared package, so the apps stay independently deployable.
 *
 * It reads `process.env.NEXT_PUBLIC_*` DIRECTLY rather than through `@/lib/env`. Those two values
 * are inlined into the client bundle by Next at build time; importing the zod-validated `env` module
 * here would drag the whole server-side schema (the analytics DB URL, the read-back URL, the
 * provisioner URL) into a module that runs in the browser. None of those are `NEXT_PUBLIC_`, so Next
 * would substitute `undefined` and the parse would fail in the browser — and a future refactor that
 * "fixed" that by making them public would be a credential leak. The narrow read is the safe one.
 *
 * The browser client exists for ONE job: the MFA enrol/challenge round trip needs the SDK's
 * `auth.mfa.*` calls to run against the user's own session. No officer AUTHORISATION is ever decided
 * here — the session is re-verified server-side with `supabase.auth.getUser()` and the scope is
 * re-resolved from the database on every request (lib/auth/index.ts).
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Supabase auth is not configured in this build (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY). Sign-in is unavailable.",
    );
  }
  return createBrowserClient(url, anonKey);
}
