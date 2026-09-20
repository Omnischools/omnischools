import { describe, it, expect } from "vitest";
import { loginAtMsFromClaims, sessionAgeExceeded } from "./session-age";

/**
 * INCR-254 — the "Session length" security setting (ref_school.session_hours), which used to be stored
 * and shown but read by no enforcement path. These cover the pure decision surface: decoding the true
 * login time from a GoTrue JWT's `amr` timestamps, and the FAIL-CLOSED age gate. The guard wiring is
 * proven end-to-end in enforce-session-age.test.ts.
 */

const HOUR = 3_600_000;

describe("loginAtMsFromClaims — the true (refresh-proof) login time", () => {
  it("uses the EARLIEST amr timestamp, in ms (amr timestamps are unix seconds)", () => {
    const login = 1_700_000_000; // seconds
    const claims = {
      iat: login + 7200, // an hourly-refreshed token — must be ignored
      amr: [
        { method: "password", timestamp: login + 60 },
        { method: "otp", timestamp: login }, // earliest
      ],
    };
    expect(loginAtMsFromClaims(claims)).toBe(login * 1000);
  });

  it("tolerates a single-factor amr", () => {
    const claims = { amr: [{ method: "password", timestamp: 1_700_000_000 }] };
    expect(loginAtMsFromClaims(claims)).toBe(1_700_000_000_000);
  });

  it("returns null when amr is missing / empty / has no numeric timestamp", () => {
    expect(loginAtMsFromClaims({})).toBeNull();
    expect(loginAtMsFromClaims({ amr: [] })).toBeNull();
    expect(loginAtMsFromClaims({ amr: [{ method: "password" }] })).toBeNull();
    expect(loginAtMsFromClaims({ amr: "password" })).toBeNull();
    expect(loginAtMsFromClaims(null)).toBeNull();
  });
});

describe("sessionAgeExceeded — fail-closed age gate", () => {
  const now = 1_700_000_000_000;

  it("no-op when the school set no limit (null/undefined)", () => {
    expect(sessionAgeExceeded({ limitHours: null, isLive: true, loginAtMs: 0, now })).toBe(false);
    expect(sessionAgeExceeded({ limitHours: undefined, isLive: true, loginAtMs: 0, now })).toBe(false);
  });

  it("no-op under dev-bypass (no real session age)", () => {
    // Even a comically old "login" and a tight limit: dev has no session-age concept.
    expect(sessionAgeExceeded({ limitHours: 1, isLive: false, loginAtMs: 0, now })).toBe(false);
  });

  it("FAILS CLOSED: a set limit + an unreadable login time ⇒ over-age", () => {
    expect(sessionAgeExceeded({ limitHours: 8, isLive: true, loginAtMs: null, now })).toBe(true);
  });

  it("rejects a session older than the limit", () => {
    expect(
      sessionAgeExceeded({ limitHours: 8, isLive: true, loginAtMs: now - 9 * HOUR, now }),
    ).toBe(true);
  });

  it("admits a session within the limit", () => {
    expect(
      sessionAgeExceeded({ limitHours: 8, isLive: true, loginAtMs: now - 1 * HOUR, now }),
    ).toBe(false);
  });

  it("is a strict boundary (exactly at the limit is still valid)", () => {
    expect(
      sessionAgeExceeded({ limitHours: 8, isLive: true, loginAtMs: now - 8 * HOUR, now }),
    ).toBe(false);
    expect(
      sessionAgeExceeded({ limitHours: 8, isLive: true, loginAtMs: now - 8 * HOUR - 1, now }),
    ).toBe(true);
  });
});
