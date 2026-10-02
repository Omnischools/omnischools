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

async function importAuth(
  bypass: string,
  nodeEnv: string,
  supabase?: { url: string; key: string },
) {
  vi.resetModules();
  vi.stubEnv("AUTH_DEV_BYPASS", bypass);
  vi.stubEnv("NODE_ENV", nodeEnv);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", supabase?.url ?? "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", supabase?.key ?? "");
  return import("@/lib/auth");
}

const REAL_SUPABASE = {
  url: "https://analytics.example.supabase.co",
  key: "anon-key-for-test",
};

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
    // officer to log the access against.
    //
    // ⚠ WHAT CHANGED IN INCREMENT G, AND WHAT DID NOT. Real GES-staff auth is now BUILT, so "no
    // session" here is no longer "unbuilt" — it is the Supabase vars being absent (they are stubbed
    // empty above). The ASSERTION is unchanged on purpose: with the bypass off and auth
    // unconfigured, the module must still LOAD and must still yield nothing. Both halves matter.
    // Loading matters because `next build` imports every route module with NODE_ENV=production and
    // no deploy secrets, so a module-load throw here would mean the app could not be built on a
    // machine without production credentials — which is why lib/env.ts keeps the Supabase pair
    // `.optional()` and enforces it per request instead. Yielding nothing matters because the
    // alternative is a surface that opens without an identity to log the access against.
    const auth = await importAuth("false", "production");
    expect(await auth.getOfficerSession()).toBeNull();
    await expect(auth.requireOfficerSession()).rejects.toThrowError(
      /No GES officer session/,
    );
  });

  it("names the missing configuration as the reason, so it is not mistaken for a sign-in problem", async () => {
    const auth = await importAuth("false", "test");
    const context = await auth.getAuthContext();
    expect(context.officer).toBeNull();
    expect(context.reason).toBe("auth-unavailable");
    expect(context.authenticated).toBe(false);
  });

  it("a BLANK Supabase var is treated as unset, not as a validation error", async () => {
    // The shape of a half-configured deployment: the variable exists and is empty. It must produce
    // the fail-closed "unavailable" state, NOT a zod throw at module load that takes every page down
    // with it.
    const auth = await importAuth("false", "production", { url: "", key: "" });
    expect(await auth.getOfficerSession()).toBeNull();
  });
});

describe("precedence when the bypass AND real Supabase credentials are both configured", () => {
  it("the BYPASS WINS outside production — one flag, one answer", async () => {
    // The rejected alternative was "real auth wins when its vars happen to be set", which makes
    // local behaviour depend on whether a developer's .env.local still has a stale Supabase pair:
    // the same command would sign you in as the NATIONAL shim on one machine and demand a GES
    // credential on another. The shim is the one that then gets debugged.
    const auth = await importAuth("true", "development", REAL_SUPABASE);
    const session = await auth.getOfficerSession();
    expect(session).not.toBeNull();
    expect(session!.officerId).toBe(auth.DEV_OFFICER_ID);
    expect(session!.level).toBe("NATIONAL");
  });

  it("…and is STILL a hard stop in production, credentials or not", async () => {
    // The precedence rule is only safe to state in writing because the flag is inert in production.
    await expect(importAuth("true", "production", REAL_SUPABASE)).rejects.toThrowError(
      /AUTH_DEV_BYPASS=true with NODE_ENV=production/i,
    );
  });

  it("the shim declares the §6 step-up satisfied, which only the hard stop makes safe", async () => {
    const auth = await importAuth("true", "development", REAL_SUPABASE);
    const context = await auth.getAuthContext();
    expect(context.stepUpFresh).toBe(true);
  });
});
