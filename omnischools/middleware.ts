import { NextResponse, type NextRequest } from "next/server";

/**
 * Stamp the request path onto a header so server components / guards can read the
 * current pathname (Next.js doesn't expose it in `headers()` by default). Used by
 * `requireSchool()` to enforce finance-only section access. No DB / auth work here —
 * role resolution stays in the (DB-backed) server guard.
 */
export function middleware(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.set("x-pathname", req.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Everything except Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)"],
};
