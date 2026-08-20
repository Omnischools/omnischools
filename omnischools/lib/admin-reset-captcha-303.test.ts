import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readCode } from "@/lib/test-utils/source-shape";

/**
 * #303 — the admin-initiated password reset must WORK once CAPTCHA (Turnstile) is enabled. An admin
 * resetting ANOTHER user's password is an AUTHENTICATED, role-gated action, so the OTP is dispatched via
 * the SERVICE-ROLE client (`adminSendPhoneOtp`), which GoTrue does not captcha-gate — never the PUBLIC,
 * captcha-gated `signInWithPhone`. Proven here: the seam routes the send through the admin client and
 * succeeds with captcha ON (runtime, mocked GoTrue), and the PUBLIC seam still forwards its token (source).
 */

// A capturing service-role admin client (mock of @/lib/supabase/admin, which adminSendPhoneOtp imports).
const admin = vi.hoisted(() => {
  const signInWithOtp = vi.fn(async () => ({ error: null as { message: string } | null }));
  const client = { auth: { signInWithOtp } };
  return { signInWithOtp, createAdminClient: vi.fn((): typeof client | null => client) };
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: admin.createAdminClient }));

// The ANON server client — adminSendPhoneOtp must NEVER touch this (it's the captcha-gated public path).
const anon = vi.hoisted(() => ({ createClient: vi.fn(async () => ({ auth: {} })) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: anon.createClient }));

describe("#303 · adminSendPhoneOtp — service-role OTP, works with CAPTCHA enabled", () => {
  beforeEach(() => {
    vi.resetModules();
    // authIsLive() true (reach GoTrue) + CAPTCHA enabled (the exact condition that broke the admin reset).
    vi.stubEnv("AUTH_DEV_BYPASS", "false");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "0x_test_sitekey");
    admin.signInWithOtp.mockClear();
    admin.createAdminClient.mockClear();
    admin.createAdminClient.mockReturnValue({ auth: { signInWithOtp: admin.signInWithOtp } });
    anon.createClient.mockClear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("SUCCEEDS with captcha on, via the SERVICE-ROLE client — no captchaToken, no anon/public call", async () => {
    const { captchaEnabled } = await import("@/lib/captcha");
    expect(captchaEnabled()).toBe(true); // the condition that permanently killed the admin reset pre-fix

    const { adminSendPhoneOtp } = await import("@/lib/auth/admin");
    const res = await adminSendPhoneOtp("0200000000");

    expect(res).toEqual({ ok: true });
    expect(admin.createAdminClient).toHaveBeenCalledTimes(1); // routed through the service-role client
    // The admin send carries NO captcha token — GoTrue bypasses captcha for service-role requests.
    expect(admin.signInWithOtp).toHaveBeenCalledWith({ phone: "+233200000000" });
    // MUTATION GUARD: revert the seam to the public `signInWithPhone` and this fails — the anon client is untouched.
    expect(anon.createClient).not.toHaveBeenCalled();
  });

  it("surfaces a real error (no swallowed lie) when the GoTrue send fails", async () => {
    admin.signInWithOtp.mockResolvedValueOnce({ error: { message: "boom" } });
    const { adminSendPhoneOtp } = await import("@/lib/auth/admin");
    expect((await adminSendPhoneOtp("0200000000")).ok).toBe(false);
  });

  it("degrades to an error (not a false success) when the service key isn't configured", async () => {
    admin.createAdminClient.mockReturnValueOnce(null);
    const { adminSendPhoneOtp } = await import("@/lib/auth/admin");
    expect((await adminSendPhoneOtp("0200000000")).ok).toBe(false);
    expect(admin.signInWithOtp).not.toHaveBeenCalled();
  });
});

describe("#303 · the PUBLIC path is UNCHANGED + the admin seam never CONFIRMS a phone (source)", () => {
  const SEAM = readCode("lib/auth/index.ts");
  const ADMIN = readCode("lib/auth/admin.ts");
  const body = (src: string, name: string) => {
    const s = src.indexOf(`export async function ${name}`);
    const e = src.indexOf("\nexport ", s + 1);
    return src.slice(s, e === -1 ? undefined : e);
  };

  it("signInWithPhone still forwards options.captchaToken (public flow keeps its token)", () => {
    const b = body(SEAM, "signInWithPhone");
    expect(b).toContain(".signInWithOtp({");
    expect(b).toContain("options: captchaToken ? { captchaToken } : undefined");
  });

  it("adminSendPhoneOtp forwards NO captcha token — it relies on service-role bypass, not a token", () => {
    expect(body(ADMIN, "adminSendPhoneOtp")).not.toContain("captchaToken");
  });

  // AUTH-OTP-05 (extended to the one new place a service-role client lives): the admin seam SENDS an OTP and
  // never CONFIRMS a phone on create — else it would void OTP-first, exactly what create-password-user-anon
  // guards for createPasswordUser. `readCode` strips comments so the docblock's mention can't self-trip this.
  it("the admin seam uses ONLY signInWithOtp — never a confirm-on-create admin method", () => {
    expect(ADMIN).toContain("signInWithOtp");
    expect(ADMIN).not.toContain("createUser");
    expect(ADMIN).not.toContain("updateUserById");
    expect(ADMIN).not.toContain("phone_confirm");
    expect(ADMIN).not.toContain("email_confirm");
    expect(ADMIN).not.toContain("signUp");
  });
});
