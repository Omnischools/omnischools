import { describe, it, expect, vi, afterEach } from "vitest";

// INCR-AUTH-CAPTCHA — the captcha config helper is the on-switch: inert when NEXT_PUBLIC_TURNSTILE_SITE_KEY
// is unset/empty, active when set. `env` is parsed once at module load, so each case stubs then re-imports.
vi.setConfig({ testTimeout: 20_000 });

async function load(siteKey?: string) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", siteKey);
  return import("@/lib/captcha");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("captcha config (INCR-AUTH-CAPTCHA)", () => {
  it("inert when the site key is unset — no widget, no token", async () => {
    const { captchaEnabled, captchaSiteKey } = await load(undefined);
    expect(captchaEnabled()).toBe(false);
    expect(captchaSiteKey()).toBeUndefined();
  });

  it("inert when the site key is an empty string", async () => {
    const { captchaEnabled, captchaSiteKey } = await load("");
    expect(captchaEnabled()).toBe(false);
    expect(captchaSiteKey()).toBeUndefined();
  });

  it("active when a site key is set", async () => {
    const { captchaEnabled, captchaSiteKey } = await load("0x_test_sitekey");
    expect(captchaEnabled()).toBe(true);
    expect(captchaSiteKey()).toBe("0x_test_sitekey");
  });
});
