import { describe, it, expect } from "vitest";
import { readCode } from "@/lib/test-utils/source-shape";

/**
 * INCR-38 · backlog hardening — the OTP send is gated on a known account (Sarah's L3 auto-provisioning
 * follow-up), and importStaff surfaces its skipped-row count (Dex INCR-37 LOW). Source-shape assertions.
 */
const SEAM = readCode("lib/auth/index.ts");
const IMPORT = readCode("components/staff/staff-import.tsx");

describe("INCR-38 · OTP existence gate — no auto-provisioning for unknown phones", () => {
  it("signInWithPhone checks phoneIsRegistered BEFORE calling signInWithOtp", () => {
    const body = SEAM.slice(
      SEAM.indexOf("export async function signInWithPhone"),
      SEAM.indexOf("async function phoneIsRegistered"),
    );
    expect(body).toContain("phoneIsRegistered(normalized)");
    // the existence check gates the send — it precedes signInWithOtp
    expect(body.indexOf("phoneIsRegistered")).toBeLessThan(body.indexOf("signInWithOtp"));
    // enumeration-safe: an unknown phone returns the SAME { ok: true } (no error, no code sent)
    expect(body).toContain("if (!(await phoneIsRegistered(normalized))) return { ok: true }");
    // Sarah BLOCK fix — the SEND path is neutral-always too: a registered phone's signInWithOtp error
    // (e.g. a rate-limit) is SWALLOWED, not returned, so it can't be the only path that yields {ok:false}
    // (which would re-open the oracle). No `{ ok: false }` after the send.
    const sendTail = body.slice(body.indexOf("signInWithOtp"));
    expect(sendTail).not.toContain("ok: false");
    expect(sendTail).toContain("swallowed for enumeration-safety");
  });

  it("phoneIsRegistered reads ref_user under withoutTenantScope (pre-tenant identity)", () => {
    const fn = SEAM.slice(SEAM.indexOf("async function phoneIsRegistered"));
    expect(fn.slice(0, 400)).toContain("withoutTenantScope");
    expect(fn.slice(0, 400)).toContain("users");
  });
});

describe("INCR-38 · importStaff surfaces the skipped count", () => {
  it("the import success toast includes res.skipped", () => {
    expect(IMPORT).toContain("res.skipped");
    expect(IMPORT).toContain("skipped");
  });
});
