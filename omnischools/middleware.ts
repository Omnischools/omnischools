import { NextResponse, type NextRequest } from "next/server";

/**
 * Intentionally a no-op pass-through.
 *
 * We previously refreshed the Supabase session cookie here, but importing
 * `@supabase/ssr` pulls Edge-incompatible code into the middleware's single Edge
 * chunk, which crashed every request with MIDDLEWARE_INVOCATION_FAILED. The chunk
 * fails at instantiation — before the function body runs — so no in-function
 * try/catch can survive it, and a dynamic `import()` doesn't help because Next
 * bundles it into the same Edge chunk rather than deferring evaluation.
 *
 * Auth does NOT depend on this middleware: sessions are resolved server-side via
 * `getCurrentUser()` (lib/auth) in pages and server actions, and server actions
 * can refresh/rotate the cookie when needed. A proactive refresh can be
 * reintroduced later on the Node runtime (Next 15 middleware `runtime: 'nodejs'`)
 * or via a dedicated route handler — both keep @supabase/ssr out of the Edge chunk.
 */
export function middleware(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|img/|.*\\.(?:png|jpg|jpeg|svg|ico)$).*)",
  ],
};
