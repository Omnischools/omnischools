import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Refreshes the Supabase auth session cookie on navigation so Server Components
 * see a current session. No-ops when Supabase env is absent (dev bypass).
 */
export async function middleware(request: NextRequest) {
  // `.trim()` guards against a pasted trailing newline/space in the Vercel env value,
  // which would otherwise make Supabase's internal `new URL()` throw and surface as
  // MIDDLEWARE_INVOCATION_FAILED (a 500 on every route).
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return NextResponse.next();

  let response = NextResponse.next({ request });
  try {
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
    // Proactive session refresh is best-effort: a failure here (bad env, network,
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
