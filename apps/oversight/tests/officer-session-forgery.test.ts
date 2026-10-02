import { afterEach, describe, expect, it, vi } from "vitest";
import { JUR, OFFICER } from "./fixtures/ids";

/**
 * A FORGED TOKEN MUST NOT WIDEN SCOPE (increment G · Kofi "a forged JWT claim does NOT widen scope").
 *
 * The threat: an officer (or anyone who can get a token minted / substituted) adds claims —
 * `level: "NATIONAL"`, `jurisdiction_id: <national node>`, `officer_role: "NATIONAL_OVERSIGHT"`,
 * `app_metadata.*` — and the app believes them. That is the single most common way a
 * database-authoritative design is undone in the application layer: someone reads a convenient claim
 * because it is already in hand.
 *
 * ── HOW THIS IS TESTED WITHOUT A LIVE SUPABASE PROJECT ───────────────────────────────────────────
 * Only the SDK is substituted. `@/lib/supabase/server` is mocked to return a client whose
 * `getUser()`/`getClaims()` answer with attacker-chosen claims; everything after that is the REAL
 * code path — the real `lib/auth/index.ts` ordering, the real `ov_resolve_officer()` against the
 * real analytics database, the real RLS. So what is proven is not "the mock returned what we told
 * it to" but "given a maximally dishonest token, the resolved session is still exactly the row the
 * database holds".
 *
 * Every case therefore asserts the same thing from a different angle: the ONLY claim that changes
 * the outcome is `sub`.
 */

const SUPABASE_MODULE = "@/lib/supabase/server";

type Claims = Record<string, unknown>;

/** A plausible, fully-formed GoTrue claim set — honest except where a test makes it dishonest. */
function claimsFor(sub: string, overrides: Claims = {}): Claims {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return {
    sub,
    aud: "authenticated",
    role: "authenticated",
    email: "akua.mensah@ges.gov.gh",
    aal: "aal2",
    amr: [
      { method: "password", timestamp: nowSeconds - 60 },
      { method: "totp", timestamp: nowSeconds - 30 },
    ],
    user_metadata: { full_name: "Akua Mensah" },
    iat: nowSeconds,
    ...overrides,
  };
}

/**
 * Import `lib/auth` with the Supabase SDK replaced. `vi.resetModules()` + `vi.stubEnv` because
 * `lib/env.ts` parses `process.env` at import time and the auth module caches nothing else.
 */
async function authWithToken(sub: string | null, claims: Claims | null) {
  vi.resetModules();
  vi.stubEnv("AUTH_DEV_BYPASS", "false");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://analytics.example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key-for-test");

  vi.doMock(SUPABASE_MODULE, () => ({
    createClient: async () => ({
      auth: {
        getUser: async () =>
          sub
            ? { data: { user: { id: sub } }, error: null }
            : { data: { user: null }, error: null },
        getClaims: async () =>
          claims
            ? { data: { claims }, error: null }
            : { data: null, error: new Error("no claims") },
      },
    }),
  }));

  return import("@/lib/auth");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock(SUPABASE_MODULE);
  vi.resetModules();
});

describe("only `sub` is taken from the token", () => {
  it("a token claiming NATIONAL for a DISTRICT officer still resolves to DISTRICT", async () => {
    const auth = await authWithToken(
      OFFICER.districtId,
      claimsFor(OFFICER.districtId, {
        // Every forgery at once.
        level: "NATIONAL",
        jurisdiction_id: JUR.national,
        officer_role: "NATIONAL_OVERSIGHT",
        app_metadata: {
          level: "NATIONAL",
          jurisdiction_id: JUR.national,
          is_admin: true,
        },
        user_role: "NATIONAL_OVERSIGHT",
      }),
    );

    const session = await auth.getOfficerSession();
    expect(session).not.toBeNull();
    expect(session!.level).toBe("DISTRICT");
    expect(session!.jurisdictionId).toBe(JUR.district);
    expect(session!.officerRole).toBe("DISTRICT_OVERSIGHT");
    expect(session!.officerId).toBe(OFFICER.districtId);
  });

  it("the officer_role on the session is the DIRECTORY's value, not the token's", async () => {
    // Wells's expected cosmetic drift: the live value is `DISTRICT_OVERSIGHT`, while the §6 test
    // fixtures still carry the legacy `DISTRICT_DIRECTOR`. The session must follow the DIRECTORY,
    // because that string lands on `audit_access_log.officer_role`.
    const auth = await authWithToken(
      OFFICER.districtId,
      claimsFor(OFFICER.districtId, { officer_role: "SUPREME_OVERSIGHT" }),
    );
    const session = await auth.getOfficerSession();
    expect(session!.officerRole).toBe("DISTRICT_OVERSIGHT");
    expect(session!.officerRole).not.toBe("DISTRICT_DIRECTOR");
  });

  it("an UNPROVISIONED uid gets no session however decorated the token is", async () => {
    const auth = await authWithToken(
      "6fffffff-0000-4000-8000-0000000000ff",
      claimsFor("6fffffff-0000-4000-8000-0000000000ff", {
        level: "NATIONAL",
        jurisdiction_id: JUR.national,
      }),
    );
    const context = await auth.getAuthContext();
    expect(context.officer).toBeNull();
    expect(context.reason).toBe("unprovisioned");
    // …and the chrome still knows who signed in, which is what Lucy G4 renders.
    expect(context.authenticated).toBe(true);
    expect(context.authenticatedName).toBeTruthy();
  });

  it("a DEACTIVATED officer gets no session — the DB filters is_active, not the app", async () => {
    const uid = "60000000-0000-4000-8000-000000000005";
    const auth = await authWithToken(uid, claimsFor(uid));
    const context = await auth.getAuthContext();
    expect(context.officer).toBeNull();
    expect(context.reason).toBe("unprovisioned");
  });

  it("a token whose `sub` disagrees with the auth server's user id yields NO session", async () => {
    // Token substitution: the identity the auth server confirmed is not the one the JWT claims.
    const auth = await authWithToken(OFFICER.districtId, claimsFor(OFFICER.nationalId));
    expect(await auth.getOfficerSession()).toBeNull();
  });

  it("no verified user at all ⇒ anonymous, never a synthesised national session", async () => {
    const auth = await authWithToken(null, null);
    const context = await auth.getAuthContext();
    expect(context.officer).toBeNull();
    expect(context.reason).toBe("anonymous");
  });
});

describe("the session-policy gates run BEFORE the directory is consulted", () => {
  it("an aal1 token is refused even for a real, active officer", async () => {
    const auth = await authWithToken(
      OFFICER.districtId,
      claimsFor(OFFICER.districtId, {
        aal: "aal1",
        amr: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) - 10 }],
      }),
    );
    const context = await auth.getAuthContext();
    expect(context.officer).toBeNull();
    expect(context.reason).toBe("mfa-required");
  });

  it("an 9-hour-old session is refused on the absolute cap, measured from amr not iat", async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const auth = await authWithToken(
      OFFICER.districtId,
      claimsFor(OFFICER.districtId, {
        // `iat` is FRESH — the access token was refreshed a minute ago — while the amr timestamps
        // show the session itself began nine hours back. Reading `iat` would admit this session.
        iat: nowSeconds - 60,
        amr: [
          { method: "password", timestamp: nowSeconds - 9 * 3600 },
          { method: "totp", timestamp: nowSeconds - 9 * 3600 + 30 },
        ],
      }),
    );
    const context = await auth.getAuthContext();
    expect(context.officer).toBeNull();
    expect(context.reason).toBe("expired-absolute");
  });

  it("an unreadable session age FAILS CLOSED (no amr timestamps at all)", async () => {
    const auth = await authWithToken(
      OFFICER.districtId,
      // The RFC-8176 string form: the methods are known, the timestamps are not. MFA is satisfied,
      // the age is unmeasurable ⇒ refuse.
      claimsFor(OFFICER.districtId, { amr: ["password", "totp"] }),
    );
    const context = await auth.getAuthContext();
    expect(context.officer).toBeNull();
    expect(context.reason).toBe("expired-absolute");
  });

  it("claims that cannot be read at all ⇒ no session, even with a verified user", async () => {
    const auth = await authWithToken(OFFICER.districtId, null);
    const context = await auth.getAuthContext();
    expect(context.officer).toBeNull();
    expect(context.authenticated).toBe(true);
  });
});

describe("the §6 step-up window is read from the token, not from a flag", () => {
  it("a TOTP assertion 30 seconds ago is fresh; one 10 minutes ago is not", async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);

    const fresh = await authWithToken(
      OFFICER.districtId,
      claimsFor(OFFICER.districtId, {
        amr: [
          { method: "password", timestamp: nowSeconds - 600 },
          { method: "totp", timestamp: nowSeconds - 30 },
        ],
      }),
    );
    expect((await fresh.getAuthContext()).stepUpFresh).toBe(true);

    const stale = await authWithToken(
      OFFICER.districtId,
      claimsFor(OFFICER.districtId, {
        amr: [
          { method: "password", timestamp: nowSeconds - 1200 },
          { method: "totp", timestamp: nowSeconds - 600 },
        ],
      }),
    );
    const staleContext = await stale.getAuthContext();
    // Still a perfectly good SESSION — the 8h/30m clocks are nowhere near — but the §6 gate will
    // require a fresh assertion. Two independent clocks, exactly as Lucy G7 specifies.
    expect(staleContext.officer).not.toBeNull();
    expect(staleContext.stepUpFresh).toBe(false);
  });
});
