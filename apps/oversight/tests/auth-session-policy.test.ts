import { describe, expect, it } from "vitest";
import {
  absoluteAgeExceeded,
  amrMethods,
  idleExceeded,
  lastMfaAtMs,
  loginAtMsFromClaims,
  mfaRequirementSatisfied,
  sessionExpiry,
  stepUpFresh,
} from "@/lib/auth/session-policy";

/**
 * SESSION POLICY — the decision matrix, unit-tested (Kofi R5/R6 · Lucy G6/G7).
 *
 * These are the predicates the whole session lifetime rests on, and every one of them has a
 * fail-direction that is invisible at runtime: a cap that never fires looks exactly like a cap that
 * is never reached, and a step-up window that is always fresh looks exactly like an officer who
 * keeps re-authenticating. That is why the matrix is tested here rather than only end-to-end.
 */

const NOW = 1_800_000_000_000; // a fixed "now" so no assertion depends on the clock
const seconds = (ms: number) => Math.floor(ms / 1000);

describe("loginAtMsFromClaims — the EARLIEST amr timestamp, not iat", () => {
  it("takes the earliest factor timestamp", () => {
    const claims = {
      iat: seconds(NOW),
      amr: [
        { method: "totp", timestamp: seconds(NOW - 60_000) },
        { method: "password", timestamp: seconds(NOW - 3_600_000) },
      ],
    };
    expect(loginAtMsFromClaims(claims)).toBe(NOW - 3_600_000);
  });

  it("IGNORES iat entirely — a refreshed token must not look like a new session", () => {
    // The regression this exists for: `iat` is rewritten on every hourly refresh, so an 8-hour cap
    // read off `iat` would never fire and nothing would ever fail.
    const refreshed = { iat: seconds(NOW), amr: [] };
    expect(loginAtMsFromClaims(refreshed)).toBeNull();
  });

  it("returns null for the RFC-8176 string form (no timestamps to read)", () => {
    expect(loginAtMsFromClaims({ amr: ["password", "totp"] })).toBeNull();
  });

  it("drops unusable entries rather than treating them as zero", () => {
    const claims = {
      amr: [
        { method: "password" },
        { method: "totp", timestamp: 0 },
        { method: "totp", timestamp: seconds(NOW - 120_000) },
        "password",
      ],
    };
    expect(loginAtMsFromClaims(claims)).toBe(NOW - 120_000);
  });
});

describe("mfaRequirementSatisfied — mandatory, with NO escape hatch", () => {
  it("accepts a totp/mfa factor in either amr shape", () => {
    expect(
      mfaRequirementSatisfied({
        aal: "aal2",
        amr: [{ method: "totp", timestamp: seconds(NOW) }],
      }),
    ).toBe(true);
    expect(mfaRequirementSatisfied({ aal: "aal2", amr: ["password", "totp"] })).toBe(
      true,
    );
  });

  it("REFUSES a password-only session", () => {
    expect(
      mfaRequirementSatisfied({
        aal: "aal1",
        amr: [{ method: "password", timestamp: seconds(NOW) }],
      }),
    ).toBe(false);
  });

  it("REFUSES an aal1 token even when an amr entry claims totp", () => {
    // Two signals, both from the verified token; the stricter one wins. A session GoTrue itself
    // considers aal1 is not an aal2 session, whatever the method list says.
    expect(
      mfaRequirementSatisfied({ aal: "aal1", amr: [{ method: "totp", timestamp: 1 }] }),
    ).toBe(false);
  });

  it("REFUSES an absent/unreadable amr — this is the NO-LOCKOUT inverse of apps/web", () => {
    // apps/web's `twoFactorStepUpRequired` fails SAFE (availability wins) because its worst case is
    // a bricked school with no recovery path. Oversight has a provisioning desk, so the worst case
    // here is a support call — and the strict direction is correct.
    expect(mfaRequirementSatisfied({})).toBe(false);
    expect(mfaRequirementSatisfied({ amr: "not-an-array" })).toBe(false);
    expect(mfaRequirementSatisfied(null)).toBe(false);
  });

  it("there is no claim that can switch the requirement off", () => {
    for (const bypass of [
      { mfa_required: false },
      { skip_mfa: true },
      { trusted_device: true },
      { app_metadata: { mfa_exempt: true } },
    ]) {
      expect(
        mfaRequirementSatisfied({
          aal: "aal1",
          amr: [{ method: "password", timestamp: 1 }],
          ...bypass,
        }),
      ).toBe(false);
    }
  });
});

describe("absoluteAgeExceeded — fails CLOSED", () => {
  it("admits a session inside the cap and refuses one past it", () => {
    expect(
      absoluteAgeExceeded({ maxHours: 8, loginAtMs: NOW - 7 * 3_600_000, now: NOW }),
    ).toBe(false);
    expect(
      absoluteAgeExceeded({ maxHours: 8, loginAtMs: NOW - 9 * 3_600_000, now: NOW }),
    ).toBe(true);
  });

  it("an UNREADABLE age is refused — there is no opt-out in Oversight", () => {
    expect(absoluteAgeExceeded({ maxHours: 8, loginAtMs: null, now: NOW })).toBe(true);
  });

  it("a missing or nonsense limit is a MISCONFIGURATION, and also refuses", () => {
    // The deliberate difference from apps/web, where `limitHours == null` means "the school never
    // opted in" and admits. There is no opt-in here: one tenant, always on.
    for (const maxHours of [null, undefined, 0, -1, Number.NaN]) {
      expect(absoluteAgeExceeded({ maxHours, loginAtMs: NOW - 1000, now: NOW })).toBe(
        true,
      );
    }
  });
});

describe("idleExceeded — the one check that is not pessimistic about absence", () => {
  it("fires after the idle window", () => {
    expect(
      idleExceeded({ idleMinutes: 30, lastSeenMs: NOW - 31 * 60_000, now: NOW }),
    ).toBe(true);
    expect(
      idleExceeded({ idleMinutes: 30, lastSeenMs: NOW - 29 * 60_000, now: NOW }),
    ).toBe(false);
  });

  it("an ABSENT stamp is 'not idle yet', not 'unknowable'", () => {
    // A brand-new session legitimately has no stamp; failing closed here would mean nobody could
    // get past their first page load. The absolute cap still bounds such a session.
    expect(idleExceeded({ idleMinutes: 30, lastSeenMs: null, now: NOW })).toBe(false);
  });
});

describe("sessionExpiry — absolute wins, because it cannot be reset by activity", () => {
  it("reports absolute when both limits are breached", () => {
    expect(
      sessionExpiry({
        maxHours: 8,
        idleMinutes: 30,
        loginAtMs: NOW - 9 * 3_600_000,
        lastSeenMs: NOW - 60 * 60_000,
        now: NOW,
      }),
    ).toBe("absolute");
  });

  it("reports idle when only the idle window is breached", () => {
    expect(
      sessionExpiry({
        maxHours: 8,
        idleMinutes: 30,
        loginAtMs: NOW - 60_000,
        lastSeenMs: NOW - 45 * 60_000,
        now: NOW,
      }),
    ).toBe("idle");
  });

  it("reports null for a live session", () => {
    expect(
      sessionExpiry({
        maxHours: 8,
        idleMinutes: 30,
        loginAtMs: NOW - 60_000,
        lastSeenMs: NOW - 60_000,
        now: NOW,
      }),
    ).toBeNull();
  });
});

describe("stepUpFresh — the §6 reuse window (Kofi R6)", () => {
  it("one assertion covers browse → pick → view → export inside 5 minutes", () => {
    expect(
      stepUpFresh({ lastMfaAtMs: NOW - 4 * 60_000, windowMinutes: 5, now: NOW }),
    ).toBe(true);
  });

  it("lapses after the window", () => {
    expect(
      stepUpFresh({ lastMfaAtMs: NOW - 6 * 60_000, windowMinutes: 5, now: NOW }),
    ).toBe(false);
  });

  it("is INDEPENDENT of the session clocks — a young session can still need a step-up", () => {
    const claims = {
      amr: [
        { method: "password", timestamp: seconds(NOW - 20 * 60_000) },
        { method: "totp", timestamp: seconds(NOW - 20 * 60_000) },
      ],
    };
    expect(
      absoluteAgeExceeded({
        maxHours: 8,
        loginAtMs: loginAtMsFromClaims(claims),
        now: NOW,
      }),
    ).toBe(false);
    expect(
      stepUpFresh({ lastMfaAtMs: lastMfaAtMs(claims), windowMinutes: 5, now: NOW }),
    ).toBe(false);
  });

  it("no assertion at all is never fresh", () => {
    expect(stepUpFresh({ lastMfaAtMs: null, windowMinutes: 5, now: NOW })).toBe(false);
  });

  it("a FUTURE-stamped assertion is refused, not treated as maximally fresh", () => {
    // Clock skew or a doctored claim. "Fresh" must mean recent, not merely close to now.
    expect(stepUpFresh({ lastMfaAtMs: NOW + 60_000, windowMinutes: 5, now: NOW })).toBe(
      false,
    );
  });

  it("takes the LATEST mfa assertion, so a re-assertion restarts the window", () => {
    const claims = {
      amr: [
        { method: "totp", timestamp: seconds(NOW - 30 * 60_000) },
        { method: "totp", timestamp: seconds(NOW - 60_000) },
      ],
    };
    expect(lastMfaAtMs(claims)).toBe(NOW - 60_000);
    expect(
      stepUpFresh({ lastMfaAtMs: lastMfaAtMs(claims), windowMinutes: 5, now: NOW }),
    ).toBe(true);
  });
});

describe("amrMethods handles both GoTrue shapes", () => {
  it("reads the object form and the string form, lower-cased", () => {
    expect(amrMethods({ amr: [{ method: "TOTP", timestamp: 1 }, "Password"] })).toEqual([
      "totp",
      "password",
    ]);
  });
});
