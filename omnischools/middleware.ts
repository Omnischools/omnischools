import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase auth session cookie on navigation so Server Components
 * see a current session. No-ops when Supabase env is absent (dev bypass).
 *
 * `@supabase/ssr` is imported *dynamically inside the try* on purpose: a static
 * top-level import is evaluated when the Edge function is instantiated, so if any
 * transitive @supabase code is incompatible with the Edge runtime it crashes the
 * whole invocation (MIDDLEWARE_INVOCATION_FAILED → 500 on every route) *before*
 * this function body runs, where no try/catch can reach it. A dynamic import
 * instead returns a rejected promise that the catch below handles, so a refresh
 * failure degrades to a no-op rather than taking the site down.
 */
export async function middleware(request: NextRequest) {
  // `.trim()` guards against a pasted trailing newline/space in the Vercel env value.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return NextResponse.next();

  let response = NextResponse.next({ request });
  try {
    const { createServerClient } = await import("@supabase/ssr");
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    });
    // Cast: see lib/auth — avoids a cross-version @supabase type-dup that drops methods
    // from the inferred `.auth` type in some install layouts. Runtime is unaffected.
    await (supabase.auth as unknown as { getUser(): Promise<unknown> }).getUser();
  } catch (err) {
    // Best-effort: a failure here (Edge-incompatible import, bad env, network,
    // Supabase down) must never 500 the whole site. Server Components still resolve
    // the session on their own. Log and continue with the unmodified response.
    console.error("[middleware] supabase session refresh skipped:", err);
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|img/|.*\\.(?:png|jpg|jpeg|svg|ico)$).*)",
  ],
};
