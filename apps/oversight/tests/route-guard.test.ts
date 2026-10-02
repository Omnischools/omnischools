import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PRE_AUTH_PATHS,
  isAssetPath,
  isPreAuthPath,
  routeDecision,
  safeReturnPath,
} from "@/lib/auth/route-guard";

/**
 * DENY-BY-DEFAULT ROUTE PROTECTION (increment G).
 *
 * The property under test is authorship-independence: a page added by someone who has never read
 * this file must still be protected. That cannot be asserted by checking the pages — there is
 * nothing to check, which is the point — so it is asserted two ways:
 *   1. the DECISION TABLE refuses anything outside the pre-auth allow-list (including paths that do
 *      not exist yet);
 *   2. the ALLOW-LIST is pinned, so widening it is a visible, reviewed edit rather than a side
 *      effect of adding a route.
 */

const LIVE = {
  authenticated: true,
  mfaSatisfied: true,
  expiry: null,
  devBypass: false,
  authConfigured: true,
} as const;

describe("the pre-auth allow-list is pinned", () => {
  it("contains exactly the three paths a session is obtained or ended through", () => {
    expect([...PRE_AUTH_PATHS]).toEqual(["/sign-in", "/signed-out", "/auth"]);
  });
});

describe("anything not on the allow-list is protected — including routes that do not exist yet", () => {
  it("redirects an anonymous visitor to sign-in, carrying the path", () => {
    for (const pathname of [
      "/",
      "/compliance-records",
      "/compliance-records/new",
      "/schools/abc/facilities",
      "/admin/officers",
      // The authorship-independence case: a page nobody has written. It is protected because the
      // default is protection, not because anyone remembered it.
      "/reports/some-future-surface",
      "/a/deeply/nested/thing",
    ]) {
      const decision = routeDecision({ ...LIVE, pathname, authenticated: false });
      expect(decision, pathname).toEqual({
        action: "redirect",
        to: `/sign-in?next=${encodeURIComponent(pathname)}`,
        reason: "unauthenticated",
      });
    }
  });

  it("allows a fully signed-in officer through", () => {
    expect(routeDecision({ ...LIVE, pathname: "/compliance-records" })).toEqual({
      action: "allow",
    });
  });
});

describe("ordering of the checks is part of the behaviour", () => {
  it("EXPIRY is reported before the MFA requirement, so the copy can explain itself", () => {
    // Both conditions hold. If MFA were checked first the officer would get a bare challenge for a
    // session that has actually timed out — which reads as "this app logs me out at random".
    const decision = routeDecision({
      ...LIVE,
      pathname: "/",
      mfaSatisfied: false,
      expiry: "absolute",
    });
    expect(decision).toEqual({
      action: "redirect",
      to: "/sign-in?reason=expired",
      reason: "expired-absolute",
    });
  });

  it("distinguishes the idle timeout from the absolute cap (Lucy G6 has two copies)", () => {
    expect(routeDecision({ ...LIVE, pathname: "/", expiry: "idle" })).toEqual({
      action: "redirect",
      to: "/sign-in?reason=idle",
      reason: "expired-idle",
    });
  });

  it("sends an aal1 session to the MFA step, carrying the return path", () => {
    expect(
      routeDecision({ ...LIVE, pathname: "/compliance-records", mfaSatisfied: false }),
    ).toEqual({
      action: "redirect",
      to: "/sign-in?reason=mfa&next=%2Fcompliance-records",
      reason: "mfa-required",
    });
  });

  it("refuses with an explicit reason when auth is not configured at all", () => {
    expect(
      routeDecision({
        ...LIVE,
        pathname: "/",
        authenticated: false,
        authConfigured: false,
      }),
    ).toEqual({
      action: "redirect",
      to: "/sign-in?reason=unavailable",
      reason: "auth-unavailable",
    });
  });
});

describe("no redirect loops", () => {
  it("the sign-in page is allowed for an anonymous visitor", () => {
    expect(
      routeDecision({ ...LIVE, pathname: "/sign-in", authenticated: false }),
    ).toEqual({ action: "allow" });
  });

  it("…and still allowed when auth is unconfigured, so it can render the refusal", () => {
    expect(
      routeDecision({
        ...LIVE,
        pathname: "/sign-in",
        authenticated: false,
        authConfigured: false,
      }),
    ).toEqual({ action: "allow" });
  });

  it("sign-out stays reachable WITH a session (you must be able to end one)", () => {
    expect(routeDecision({ ...LIVE, pathname: "/signed-out" })).toEqual({
      action: "allow",
    });
    expect(routeDecision({ ...LIVE, pathname: "/auth/sign-out" })).toEqual({
      action: "allow",
    });
  });

  it("a fully signed-in officer on /sign-in is sent to the landing, not bounced", () => {
    expect(routeDecision({ ...LIVE, pathname: "/sign-in" })).toEqual({
      action: "redirect",
      to: "/",
      reason: "already-signed-in",
    });
  });

  it("an EXPIRED session on /sign-in is allowed to stay there and re-authenticate", () => {
    expect(routeDecision({ ...LIVE, pathname: "/sign-in", expiry: "idle" })).toEqual({
      action: "allow",
    });
  });
});

describe("the dev bypass", () => {
  it("passes through, so local dev is not a sign-in loop against a project that does not exist", () => {
    expect(
      routeDecision({
        ...LIVE,
        pathname: "/compliance-records",
        authenticated: false,
        devBypass: true,
        authConfigured: false,
      }),
    ).toEqual({ action: "allow" });
  });

  it("…and the PRODUCTION hard stop lives in lib/auth, not here", () => {
    // Stated as a test so the division is explicit: this module is pure and must not read env. The
    // module-load guard in lib/auth/index.ts is what fails a production deploy
    // (tests/auth-dev-bypass.test.ts).
    const source = readFileSync(join(process.cwd(), "lib/auth/route-guard.ts"), "utf8");
    expect(source).not.toMatch(/process\.env|@\/lib\/env/);
  });
});

describe("assets are never protected, and never redirected", () => {
  it("recognises Next internals and static files", () => {
    for (const asset of [
      "/_next/static/chunk.js",
      "/favicon.ico",
      "/robots.txt",
      "/logo.svg",
      "/styles.css",
    ]) {
      expect(isAssetPath(asset), asset).toBe(true);
      expect(routeDecision({ ...LIVE, pathname: asset, authenticated: false })).toEqual({
        action: "allow",
      });
    }
  });

  it("does not mistake an app route for an asset", () => {
    expect(isAssetPath("/compliance-records")).toBe(false);
    expect(isPreAuthPath("/compliance-records")).toBe(false);
  });
});

describe("safeReturnPath — the `next` parameter is attacker-controllable", () => {
  it("honours same-origin absolute paths", () => {
    expect(safeReturnPath("/compliance-records/new")).toBe("/compliance-records/new");
  });

  it("refuses open-redirect shapes", () => {
    // A government tool whose officers are told to expect a sign-in link is exactly where an open
    // redirect becomes a credible phishing step.
    for (const hostile of [
      "https://evil.example",
      "//evil.example",
      "http://evil.example/x",
      "\\\\evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
    ]) {
      expect(safeReturnPath(hostile), hostile).toBe("/");
    }
  });

  it("drops a `next` that points back into the sign-in flow", () => {
    expect(safeReturnPath("/sign-in")).toBe("/");
    expect(safeReturnPath("/signed-out")).toBe("/");
  });

  it("falls back to the landing for null/empty", () => {
    expect(safeReturnPath(null)).toBe("/");
    expect(safeReturnPath("")).toBe("/");
  });
});

describe("the middleware matcher covers the app, not a list of remembered routes", () => {
  it("is written as an EXCLUSION", () => {
    const source = readFileSync(join(process.cwd(), "middleware.ts"), "utf8");
    // An inclusion list is a list of the routes someone remembered; the failure mode of forgetting
    // one is an unprotected page.
    expect(source).toMatch(/matcher/);
    expect(source).toMatch(/\(\?!/); // a negative lookahead ⇒ exclusion
  });

  it("every App-Router page lives under a path the matcher protects or is explicitly pre-auth", () => {
    const appDir = join(process.cwd(), "app");
    const routes = walkRoutes(appDir);
    const unprotected = routes.filter((r) => isAssetPath(r));
    expect(unprotected).toEqual([]);

    // Every route is either pre-auth (and on the pinned allow-list) or protected by default.
    // `/auth` is reserved in the allow-list for an auth callback/sign-out handler; no route lives
    // there yet (sign-out is a server action), so it must not appear here.
    const preAuth = routes.filter((r) => isPreAuthPath(r)).sort();
    expect(preAuth).toEqual(["/sign-in", "/signed-out"]);
  });
});

/** Every `page.tsx` / `route.ts` under app/, as a URL path with route groups stripped. */
function walkRoutes(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walkRoutes(full, out);
    } else if (/^(page|route)\.(ts|tsx)$/.test(entry)) {
      const rel = relative(join(process.cwd(), "app"), full).replaceAll("\\", "/");
      const path = `/${rel
        .replace(/\/(page|route)\.(ts|tsx)$/, "")
        .split("/")
        .filter((seg) => !/^\(.*\)$/.test(seg))
        .join("/")}`;
      out.push(path === "/" ? "/" : path.replace(/\/$/, ""));
    }
  }
  return out;
}
