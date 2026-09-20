/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @react-pdf/renderer (receipt/report-card PDFs) is a Node-only lib pulling in fontkit;
  // keep it out of the webpack bundle so the server route can require it at runtime.
  serverExternalPackages: ["@react-pdf/renderer"],
  // No `images.remotePatterns` on purpose: with none configured, the optimiser
  // refuses every remote URL, so /_next/image can only ever transform files we
  // ship in public/. The two Supabase-hosted images we render (school logo and
  // stamp) go through plain <img>, never next/image, so nothing needs an entry
  // here. Do NOT add a wildcard host — `*.supabase.co` matches any Supabase
  // project, which lets anyone with a free project feed an attacker-crafted
  // image to sharp/libvips server-side.
  // Don't leak host-specific build details.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

/**
 * App-wide security headers (audit item #1 — XSS/clickjacking/transport hardening).
 *
 * The ENFORCED headers are all low-risk (they don't change what renders): HSTS pins HTTPS,
 * X-Frame-Options + frame-ancestors block clickjacking, nosniff stops MIME sniffing, a tight
 * Referrer-Policy stops path/PII leakage via Referer, and Permissions-Policy denies device APIs
 * the app never uses.
 *
 * CSP ships in **Report-Only** first (`Content-Security-Policy-Report-Only`): a strict enforcing CSP
 * on the Next.js App Router needs live tuning (inline hydration bootstrap, styled-jsx, the Supabase
 * API/realtime origins) that must be observed on a real deploy before it can block. Report-Only never
 * breaks a page — it only surfaces would-be violations in the browser console — so it's the safe way
 * to converge on an enforcing policy. Promote to `Content-Security-Policy` once the console is clean.
 * ponytail: report-only until a deploy proves the allowlist; flip the header name to enforce.
 */
const csp = [
  "default-src 'self'",
  // Next injects inline hydration/bootstrap scripts; no nonce middleware yet, so 'unsafe-inline'.
  // Cloudflare Turnstile (INCR-AUTH-CAPTCHA) loads its script from challenges.cloudflare.com.
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
  // Tailwind + styled-jsx emit inline styles.
  "style-src 'self' 'unsafe-inline'",
  // School logo/stamp are Supabase-storage <img>; data:/blob: for embedded assets.
  "img-src 'self' data: blob: https://*.supabase.co",
  "font-src 'self' data:",
  // Supabase Auth/REST/Realtime (wss for realtime) + Turnstile's siteverify/telemetry.
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://challenges.cloudflare.com",
  // Turnstile renders its challenge inside an iframe from challenges.cloudflare.com.
  "frame-src 'self' https://challenges.cloudflare.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  { key: "Content-Security-Policy-Report-Only", value: csp },
];

export default nextConfig;
