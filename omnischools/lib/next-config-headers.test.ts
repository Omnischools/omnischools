import { describe, it, expect } from "vitest";
import nextConfig from "@/next.config.mjs";

/**
 * INCR-AUTH-OTP (headers half) — `next.config.mjs` `headers()` must apply the enforced hardening set to
 * every path, and ship CSP as **Report-Only by design** (a strict enforcing CSP on the App Router needs
 * live tuning first). This asserts the shape: the enforced keys/values, the report-only CSP, and the
 * ABSENCE of an enforcing `Content-Security-Policy` (flipping report-only → enforcing prematurely would
 * break hydration/styled-jsx, so its absence is the correct state today).
 */
async function headerMap() {
  const headersFn = nextConfig.headers;
  if (!headersFn) throw new Error("next.config.mjs must define headers()");
  const rules = await headersFn();
  expect(Array.isArray(rules)).toBe(true);
  expect(rules).toHaveLength(1);
  const rule = rules[0];
  expect(rule.source).toBe("/:path*"); // applied to every path
  const map = new Map<string, string>();
  for (const h of rule.headers) map.set(h.key, h.value);
  return map;
}

describe("headers · enforced hardening set", () => {
  it("HSTS pins HTTPS for two years incl. subdomains + preload", async () => {
    const m = await headerMap();
    expect(m.get("Strict-Transport-Security")).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );
  });

  it("clickjacking + MIME-sniff + referrer + permissions are locked down", async () => {
    const m = await headerMap();
    expect(m.get("X-Frame-Options")).toBe("DENY");
    expect(m.get("X-Content-Type-Options")).toBe("nosniff");
    expect(m.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(m.get("Permissions-Policy")).toBe(
      "camera=(), microphone=(), geolocation=(), browsing-topics=()",
    );
  });
});

describe("headers · CSP is Report-Only by design", () => {
  it("ships Content-Security-Policy-Report-Only with the app allowlist", async () => {
    const m = await headerMap();
    const csp = m.get("Content-Security-Policy-Report-Only");
    expect(csp, "report-only CSP header must be present").toBeTruthy();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });

  it("does NOT ship an ENFORCING Content-Security-Policy (report-only until a deploy proves it)", async () => {
    const m = await headerMap();
    expect(m.has("Content-Security-Policy")).toBe(false);
  });
});
