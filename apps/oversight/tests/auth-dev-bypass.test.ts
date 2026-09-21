import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * S3 — `AUTH_DEV_BYPASS` must be a HARD STOP in production.
 *
 * The shim does not merely skip a login: it returns a NATIONAL officer, the tier with no
 * jurisdiction filter, without authenticating anyone. `.env.example` ships it `true` because that
 * is right for local development — which is precisely why a deployment that inherits it must fail
 * to boot rather than quietly serving unauthenticated national access to every named record.
 *
 * Each case re-imports the module under `vi.resetModules()` because `lib/env.ts` parses
 * `process.env` once at import, and the guard is evaluated at module load.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function importAuth(bypass: string, nodeEnv: string) {
  vi.resetModules();
  vi.stubEnv("AUTH_DEV_BYPASS", bypass);
  vi.stubEnv("NODE_ENV", nodeEnv);
  return import("@/lib/auth");
}

describe("AUTH_DEV_BYPASS in production", () => {
  it("refuses to load the auth module at all", async () => {
    await expect(importAuth("true", "production")).rejects.toThrowError(
      /AUTH_DEV_BYPASS=true with NODE_ENV=production/i,
    );
  });

  it("names the actual danger — a NATIONAL, unauthenticated session — not just 'misconfigured'", async () => {
    // The message is the only thing the operator sees at 2am; it has to say what it prevented.
    const err = await importAuth("true", "production").catch((e: unknown) => e);
    expect(String(err)).toMatch(/NATIONAL/);
    expect(String(err)).toMatch(/unauthenticated/i);
    expect(String(err)).toMatch(/Set AUTH_DEV_BYPASS=false/);
  });
});

describe("the dev default keeps working", () => {
  it("issues the dev officer in development", async () => {
    const auth = await importAuth("true", "development");
    const session = await auth.getOfficerSession();
    expect(session).not.toBeNull();
    expect(session!.officerId).toBe(auth.DEV_OFFICER_ID);
    expect(session!.level).toBe("NATIONAL");
  });

  it("issues the dev officer under test", async () => {
    const auth = await importAuth("true", "test");
    expect(await auth.getOfficerSession()).not.toBeNull();
  });

  it("with the bypass OFF in production it loads and FAILS CLOSED (no session)", async () => {
    // The production posture: the module loads, and every gated surface refuses for want of an
    // officer to log the access against. Real GES-staff auth is separate, unbuilt work.
    const auth = await importAuth("false", "production");
    expect(await auth.getOfficerSession()).toBeNull();
    await expect(auth.requireOfficerSession()).rejects.toThrowError(
      /No GES officer session/,
    );
  });
});
