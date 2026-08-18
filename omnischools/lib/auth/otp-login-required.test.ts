import { describe, it, expect, afterEach, vi } from "vitest";

// Each test does vi.resetModules() + a fresh dynamic re-import of the module graph; under full-suite
// loader contention that occasionally exceeds the 5s default. Raise the file's timeout (no DB work here).
vi.setConfig({ testTimeout: 20_000 });

/**
 * INCR-AUTH-OTP · AUTH-OTP-11 (+ notes for S5) — the OTP-first gate `otpLoginRequired()` and the
 * fail-closed `AUTH_OTP_LIVE` env flag. `env` is parsed once at `@/lib/env` load from `process.env`,
 * so each case stubs the three inputs, `vi.resetModules()`, then dynamically re-imports a fresh
 * `@/lib/auth` (which pulls a fresh `@/lib/env`). No DB is touched — the helper is pure config logic.
 *
 * The gate is `authIsLive() && env.AUTH_OTP_LIVE`, i.e. `!AUTH_DEV_BYPASS && !!SUPABASE_URL && OTP_LIVE`.
 * The ONLY combination that is true: bypass off + URL set + flag "true". Everything else is false —
 * that is the "fail closed" guarantee: a forgotten/misset flag can never turn OTP-first ON.
 */
async function loadAuth(vars: { bypass?: string; url?: string; otp?: string }) {
  vi.resetModules();
  // undefined ⇒ unset the var ⇒ the zod `.default("false")` (or `.optional()`) governs.
  vi.stubEnv("AUTH_DEV_BYPASS", vars.bypass);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", vars.url);
  vi.stubEnv("AUTH_OTP_LIVE", vars.otp);
  const auth = await import("@/lib/auth");
  const { env } = await import("@/lib/env");
  return { ...auth, env };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const LIVE_URL = "https://project.supabase.co";

describe("AUTH-OTP-11 · AUTH_OTP_LIVE defaults false (fail closed)", () => {
  it("absent flag ⇒ env.AUTH_OTP_LIVE === false", async () => {
    const { env } = await loadAuth({ bypass: "false", url: LIVE_URL, otp: undefined });
    expect(env.AUTH_OTP_LIVE).toBe(false);
  });

  it('flag "false" ⇒ env.AUTH_OTP_LIVE === false', async () => {
    const { env } = await loadAuth({ bypass: "false", url: LIVE_URL, otp: "false" });
    expect(env.AUTH_OTP_LIVE).toBe(false);
  });

  it('flag "true" ⇒ env.AUTH_OTP_LIVE === true', async () => {
    const { env } = await loadAuth({ bypass: "false", url: LIVE_URL, otp: "true" });
    expect(env.AUTH_OTP_LIVE).toBe(true);
  });
});

describe("AUTH-OTP-11 · otpLoginRequired() is true ONLY under live-auth + flag on", () => {
  it("the single TRUE case: bypass off + URL set + flag true", async () => {
    const { otpLoginRequired, authIsLive } = await loadAuth({
      bypass: "false",
      url: LIVE_URL,
      otp: "true",
    });
    expect(authIsLive()).toBe(true);
    expect(otpLoginRequired()).toBe(true);
  });

  it("flag off (default) with live auth ⇒ false", async () => {
    const { otpLoginRequired } = await loadAuth({ bypass: "false", url: LIVE_URL, otp: undefined });
    expect(otpLoginRequired()).toBe(false);
  });

  it('flag explicitly "false" with live auth ⇒ false', async () => {
    const { otpLoginRequired } = await loadAuth({ bypass: "false", url: LIVE_URL, otp: "false" });
    expect(otpLoginRequired()).toBe(false);
  });

  it("no Supabase URL ⇒ authIsLive false ⇒ otpLoginRequired false even with flag true", async () => {
    const { otpLoginRequired, authIsLive } = await loadAuth({
      bypass: "false",
      url: undefined,
      otp: "true",
    });
    expect(authIsLive()).toBe(false);
    expect(otpLoginRequired()).toBe(false);
  });
});

describe("AUTH-OTP-11 / S5 · inert under dev-bypass", () => {
  it("AUTH_DEV_BYPASS=true ⇒ authIsLive false ⇒ otpLoginRequired false (flag & URL ignored)", async () => {
    const { otpLoginRequired, authIsLive } = await loadAuth({
      bypass: "true",
      url: LIVE_URL,
      otp: "true",
    });
    expect(authIsLive()).toBe(false);
    expect(otpLoginRequired()).toBe(false);
  });

  it("all three unset (bare default) ⇒ everything false", async () => {
    const { otpLoginRequired, authIsLive, env } = await loadAuth({});
    expect(env.AUTH_OTP_LIVE).toBe(false);
    expect(authIsLive()).toBe(false);
    expect(otpLoginRequired()).toBe(false);
  });
});
