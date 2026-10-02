import type { ExpiryReason } from "./session-policy";

/**
 * ROUTE PROTECTION, DENY BY DEFAULT — pure (no next/*, no Supabase), so the decision table is
 * unit-testable and a new route's protection is a property of the ALLOW-LIST rather than of whoever
 * wrote the page.
 *
 * ── WHY THE DEFAULT HAS TO BE "PROTECTED" ────────────────────────────────────────────────────────
 * Before G, each gated surface called `getOfficerSession()` itself and rendered its own refusal.
 * That is good copy and a bad boundary: it protects exactly the pages whose authors remembered to do
 * it. A page added next month that forgets the call is public, and nothing fails — no test, no lint,
 * no type error, just a surface that renders. So the authority moved here: every path is protected
 * unless it appears in `PRE_AUTH_PATHS` below, and adding a route cannot accidentally opt out of
 * authentication because opting out requires editing this list (which fails
 * tests/route-guard.test.ts's allow-list assertion until it is argued for).
 *
 * ── WHAT THIS DOES AND DOES NOT DECIDE ───────────────────────────────────────────────────────────
 * It decides AUTHENTICATION and SESSION LIFETIME — "is there a verified, MFA'd, unexpired session".
 * It decides nothing about jurisdiction, provisioning or tier: those need the database, which the
 * middleware runtime cannot reach, and they are resolved per request in `(oversight)/layout.tsx` and
 * re-resolved inside every scoped read. The per-page refusal COPY also stays where it is — this
 * guard redirects an anonymous visitor to sign-in; it does not replace the gate's own "sign in
 * required" state for a session that exists but cannot do something.
 */

/** Paths that must work WITHOUT a session, because they are how a session is obtained or ended. */
export const PRE_AUTH_PATHS = [
  "/sign-in", // G1 — primary factor + MFA enrol/challenge
  "/signed-out", // G3 — the post-sign-out confirmation
  "/auth", // auth callbacks / sign-out POST target
] as const;

/** Next internals and static files. Never protected, never application surface. */
const ASSET_PATTERN =
  /^\/(_next\/|favicon\.ico$|robots\.txt$|sitemap\.xml$|.*\.(?:png|jpe?g|svg|webp|ico|css|js|map|woff2?)$)/;

export function isAssetPath(pathname: string): boolean {
  return ASSET_PATTERN.test(pathname);
}

export function isPreAuthPath(pathname: string): boolean {
  return PRE_AUTH_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`) || pathname.startsWith(`${p}?`),
  );
}

export type GuardDecision =
  { action: "allow" } | { action: "redirect"; to: string; reason: GuardReason };

export type GuardReason =
  | "unauthenticated"
  | "mfa-required"
  | "expired-absolute"
  | "expired-idle"
  | "auth-unavailable"
  | "already-signed-in";

export interface GuardInput {
  pathname: string;
  /** A server-VERIFIED session exists (`supabase.auth.getUser()` returned a user). */
  authenticated: boolean;
  /** The session completed a second factor (lib/auth/session-policy.ts). */
  mfaSatisfied: boolean;
  /** Which lifetime limit has been hit, if any. */
  expiry: ExpiryReason | null;
  /** `AUTH_DEV_BYPASS` — non-production only; the production hard stop is in lib/auth/index.ts. */
  devBypass: boolean;
  /** Supabase auth vars present. When false, nobody can sign in and we must say so, not loop. */
  authConfigured: boolean;
}

/**
 * The whole decision table.
 *
 * ORDER IS LOAD-BEARING. Expiry is checked BEFORE the MFA requirement so an officer whose 8-hour cap
 * has lapsed sees "session timed out" (Lucy G6) rather than a bare MFA challenge — the copy has to
 * tell them why they are being asked again, or the honest conclusion is "this app logs me out at
 * random". Assets first, so a redirect never fires for a stylesheet; pre-auth paths next, so the
 * sign-in page cannot redirect to itself (an infinite loop is the classic way a route guard gets
 * disabled in a hurry).
 */
export function routeDecision(input: GuardInput): GuardDecision {
  const { pathname } = input;

  if (isAssetPath(pathname)) return { action: "allow" };

  if (isPreAuthPath(pathname)) {
    // An officer who is already fully signed in has no business on the sign-in screen; send them
    // to the landing so a bookmarked /sign-in is not a dead end. Everything else pre-auth is
    // unconditionally allowed, including while a session exists (you must be able to sign out).
    if (
      pathname.startsWith("/sign-in") &&
      input.authenticated &&
      input.mfaSatisfied &&
      input.expiry === null
    ) {
      return { action: "redirect", to: "/", reason: "already-signed-in" };
    }
    return { action: "allow" };
  }

  // The dev shim issues a NATIONAL session with no authentication. It is hard-stopped in production
  // at module load (lib/auth/index.ts) and re-checked per call; here it simply means "there is a
  // session", so local development is not a sign-in loop against a Supabase project that does not
  // exist on the developer's machine.
  if (input.devBypass) return { action: "allow" };

  if (!input.authConfigured) {
    // Nothing can authenticate. Send to sign-in, which renders the explicit "sign-in unavailable"
    // state rather than a form that cannot work. This is a refusal, not a loop: /sign-in is
    // pre-auth, so it is allowed above and will not bounce back here.
    return {
      action: "redirect",
      to: "/sign-in?reason=unavailable",
      reason: "auth-unavailable",
    };
  }

  if (!input.authenticated) {
    return {
      action: "redirect",
      to: `/sign-in?next=${encodeURIComponent(pathname)}`,
      reason: "unauthenticated",
    };
  }

  if (input.expiry === "absolute") {
    return {
      action: "redirect",
      to: "/sign-in?reason=expired",
      reason: "expired-absolute",
    };
  }
  if (input.expiry === "idle") {
    return { action: "redirect", to: "/sign-in?reason=idle", reason: "expired-idle" };
  }

  if (!input.mfaSatisfied) {
    // MFA is mandatory and every-session (Kofi R5). An authenticated-but-aal1 session is sent to
    // the challenge/enrol step, carrying the path it was going to so Lucy G6's "we'll take you
    // back" line has something to show.
    return {
      action: "redirect",
      to: `/sign-in?reason=mfa&next=${encodeURIComponent(pathname)}`,
      reason: "mfa-required",
    };
  }

  return { action: "allow" };
}

/**
 * The post-sign-in return path, sanitised.
 *
 * ONLY same-origin, absolute-path targets are honoured. A `next` parameter is attacker-controllable
 * (it is in a URL an officer can be sent), so `//evil.example` or `https://evil.example` would make
 * the sign-in page an open redirect — a credible phishing step for a government tool whose officers
 * are told to expect a sign-in link. Anything that is not a single-slash-prefixed path falls back to
 * the landing, and a `next` pointing back at the sign-in flow is dropped so a loop is impossible.
 */
export function safeReturnPath(next: string | null | undefined): string {
  if (!next) return "/";
  if (!next.startsWith("/")) return "/";
  if (next.startsWith("//")) return "/";
  if (next.includes("\\")) return "/";
  if (isPreAuthPath(next)) return "/";
  return next;
}
