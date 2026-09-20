import { describe, it, expect } from "vitest";
import { twoFactorStepUpRequired, hasOtpFactor } from "./two-factor";

/**
 * INCR-254 (deferred half) — the pure decision surface for the "Require two-factor for administrators"
 * setting (ref_school.require_2fa). The guard wiring is proven end-to-end in enforce-two-factor.test.ts.
 * The load-bearing case is the NO-LOCKOUT / FAIL-SAFE one: an admin with no OTP is NOT blocked when OTP
 * can't be delivered.
 */

describe("hasOtpFactor", () => {
  it("true when the session completed a phone-OTP factor", () => {
    expect(hasOtpFactor(["otp"])).toBe(true);
    expect(hasOtpFactor(["password", "otp"])).toBe(true);
    expect(hasOtpFactor(["OTP"])).toBe(true); // case-insensitive
    expect(hasOtpFactor(["totp"])).toBe(true); // tolerant of a future MFA factor
  });
  it("false for a password-only session", () => {
    expect(hasOtpFactor(["password"])).toBe(false);
    expect(hasOtpFactor([])).toBe(false);
  });
});

describe("twoFactorStepUpRequired — fail-SAFE 2FA gate", () => {
  const base = { require2fa: true, isAdmin: true, otpDeliverable: true, amr: ["password"] };

  it("no-op when the setting is off (off / null / undefined) — any user", () => {
    expect(twoFactorStepUpRequired({ ...base, require2fa: false })).toBe(false);
    expect(twoFactorStepUpRequired({ ...base, require2fa: null })).toBe(false);
    expect(twoFactorStepUpRequired({ ...base, require2fa: undefined })).toBe(false);
  });

  it("no-op for a non-admin, even with the setting on and no OTP", () => {
    expect(twoFactorStepUpRequired({ ...base, isAdmin: false })).toBe(false);
  });

  it("🔴 NO-LOCKOUT: an admin with no OTP is NOT blocked when OTP is undeliverable", () => {
    // The whole safety mechanism — forcing an OTP that can't arrive would brick the school.
    expect(twoFactorStepUpRequired({ ...base, otpDeliverable: false })).toBe(false);
  });

  it("blocks: setting on + admin + OTP deliverable + password-only session", () => {
    expect(twoFactorStepUpRequired(base)).toBe(true);
  });

  it("passes: setting on + admin + OTP deliverable + session already did OTP", () => {
    expect(twoFactorStepUpRequired({ ...base, amr: ["otp"] })).toBe(false);
    expect(twoFactorStepUpRequired({ ...base, amr: ["password", "otp"] })).toBe(false);
  });

  it("blocks an unreadable amr when OTP is deliverable (safe — recoverable via the very step-up)", () => {
    expect(twoFactorStepUpRequired({ ...base, amr: [] })).toBe(true);
  });
});
