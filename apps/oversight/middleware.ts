import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { routeDecision } from "@/lib/auth/route-guard";
import {
  loginAtMsFromClaims,
  mfaRequirementSatisfied,
  sessionExpiry,
} from "@/lib/auth/session-policy";
import { LAST_SEEN_COOKIE } from "@/lib/auth/last-seen";

/**
 * DENY-BY-DEFAULT ROUTE PROTECTION (Lucy G1/G6 · Kofi R5).
 *
 * ── WHY MIDDLEWARE AND NOT JUST A LAYOUT GUARD ───────────────────────────────────────────────────
 * Both, actually, and they do different jobs:
 *   · THIS FILE is authorship-independent. Its matcher covers everything that is not a static asset,
 *     so a page added next month is protected before its first line is written. A layout guard only
 *     protects the routes that happen to sit under that layout — add `app/reports/page.tsx` outside
 *     the `(oversight)` group and the layout never runs, while this still does.
 *   · `app/(oversight)/layout.tsx` resolves the OFFICER (provisioning, jurisdiction, tier) and picks
 *     Lucy's G4/G5 copy. It needs the analytics database, which this runtime cannot reach, and it
 *     needs to render — which a middleware redirect cannot.
 * So: middleware answers "is there a verified, MFA'd, unexpired session"; the layout answers "and is
 * that person a provisioned officer, with what reach". Neither is sufficient alone, and the per-page
 * refusal copy (the gate's "Sign in required", for instance) stays exactly where it was.
 *
 * ── ENV IS READ DIRECTLY, NOT THROUGH `@/lib/env` ────────────────────────────────────────────────
 * `lib/env.ts` does `schema.parse(process.env)`, i.e. a DYNAMIC read of the whole environment. In
 * the edge runtime `process.env` is not a full object — Next inlines the vars a module references
 * STATICALLY — so a dynamic parse here can silently see an empty environment and conclude that auth
 * is unconfigured on every request. Naming the four variables one by one is what makes them actually
 * arrive. (The same reasoning as lib/supabase/client.ts, for a different runtime.)
 *
 * ── NO VERCEL-SPECIFIC ANYTHING ──────────────────────────────────────────────────────────────────
 * Cookies and one HTTPS call to the auth server. No KV, no Edge Config, no platform session store —
 * this file must run unchanged wherever the app is moved.
 */

function flag(name: string): boolean {
  return process.env[name] === "true";
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const devBypass = flag("AUTH_DEV_BYPASS");
  const authConfigured = Boolean(url && anonKey);
  const pathname = request.nextUrl.pathname;

  // The response the Supabase client is allowed to write refreshed auth cookies onto. It has to be
  // created up front and returned (or copied onto a redirect) or a rotated refresh token is lost,
  // which logs the officer out mid-session for no reason they can see.
  let response = NextResponse.next({ request });

  let authenticated = false;
  let claims: unknown = null;

  if (authConfigured && !devBypass) {
    const supabase = createServerClient(url!, anonKey!, {
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

    try {
      // `getUser()`, never `getSession()` — the cookie is not evidence of anything until the auth
      // server (or a verified signature) says so.
      const { data, error } = await supabase.auth.getUser();
      authenticated = !error && Boolean(data?.user?.id);
      if (authenticated) {
        const { data: claimsData } = await supabase.auth.getClaims();
        claims = claimsData?.claims ?? null;
      }
    } catch {
      // Auth server unreachable ⇒ we cannot verify ⇒ treat as unauthenticated. The officer sees the
      // sign-in screen rather than an unverified session being waved through.
      authenticated = false;
    }
  }

  const lastSeenRaw = request.cookies.get(LAST_SEEN_COOKIE)?.value;
  const lastSeenMs = lastSeenRaw ? Number.parseInt(lastSeenRaw, 10) : NaN;

  const expiry =
    authenticated && claims
      ? sessionExpiry({
          maxHours: num("OVERSIGHT_SESSION_MAX_HOURS", 8),
          idleMinutes: num("OVERSIGHT_SESSION_IDLE_MINUTES", 30),
          loginAtMs: loginAtMsFromClaims(claims),
          lastSeenMs: Number.isFinite(lastSeenMs) && lastSeenMs > 0 ? lastSeenMs : null,
        })
      : null;

  const decision = routeDecision({
    pathname,
    authenticated,
    mfaSatisfied: authenticated && claims ? mfaRequirementSatisfied(claims) : false,
    expiry,
    devBypass,
    authConfigured,
  });

  if (decision.action === "redirect") {
    const target = new URL(decision.to, request.url);
    const redirect = NextResponse.redirect(target);
    // Carry any refreshed auth cookies onto the redirect, and CLEAR the idle stamp when the session
    // has ended — otherwise the next sign-in inherits a stale "last seen" and can be declared idle
    // before the officer has done anything.
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    if (decision.reason === "expired-idle" || decision.reason === "expired-absolute") {
      redirect.cookies.delete(LAST_SEEN_COOKIE);
    }
    return redirect;
  }

  // Touch the idle stamp on every ALLOWED protected request. Not on redirects (a bounced request is
  // not activity) and not on assets (a background prefetch of a stylesheet must not keep a session
  // alive at an unattended desk, which is the whole point of an idle limit).
  if (authenticated || devBypass) {
    response.cookies.set(LAST_SEEN_COOKIE, String(Date.now()), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
  }

  return response;
}

/**
 * EVERYTHING except Next internals and static files.
 *
 * Written as an exclusion, not an inclusion, deliberately: an inclusion list ("/compliance-records/
 * :path*", …) is a list of the routes someone remembered, and the failure mode of forgetting one is
 * an unprotected page. The pre-auth allow-list lives in ONE place — `PRE_AUTH_PATHS` in
 * lib/auth/route-guard.ts — where it is unit-tested.
 */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|woff2?)$).*)",
  ],
};
