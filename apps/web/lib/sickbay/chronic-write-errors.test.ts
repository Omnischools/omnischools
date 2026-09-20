import { describe, it, expect } from "vitest";
import { chronicWriteError, R102_REFUSAL, PRN_XOR_SLOT } from "./chronic-write-errors";

/**
 * The chronic-register write path surfaces its constraints as FRIENDLY errors, never a raw pg failure.
 * These are the constraints the writer catches; the error shape mirrors what postgres.js throws
 * (Drizzle wraps the real `PostgresError` on `.cause`, so the fields sit one hop down — see pg-error).
 */
const pg = (code: string, constraint_name: string) => ({
  message: "Failed query: …",
  cause: { code, constraint_name },
});

describe("chronicWriteError surfaces the three CHECKs + the collision as friendly text", () => {
  it("R96 — the MENTAL_HEALTH ⇒ referral-managed CHECK (23514)", () => {
    const msg = chronicWriteError(pg("23514", "chronic_mental_health_referral_managed"), "fallback");
    expect(msg).toMatch(/mental-health/i);
    expect(msg).toMatch(/referral-managed/i);
    expect(msg).not.toBe("fallback");
  });

  it("R99 — the is_prn XOR slot CHECK (23514) maps to the shared PRN message", () => {
    expect(chronicWriteError(pg("23514", "chronic_med_prn_xor_slot"), "fallback")).toBe(PRN_XOR_SLOT);
  });

  it("the per-(school, student, condition) partial-unique collision (23505)", () => {
    const msg = chronicWriteError(pg("23505", "uniq_sickbay_chronic_entry_condition"), "fallback");
    expect(msg).toMatch(/already has a live plan/i);
  });

  it("the per-(entry, drug, round) med collision (23505)", () => {
    const msg = chronicWriteError(pg("23505", "uniq_sickbay_chronic_med_dose"), "fallback");
    expect(msg).toMatch(/already scheduled/i);
  });

  it("an unrecognised failure returns the caller's fallback, never the raw pg text", () => {
    expect(chronicWriteError(pg("23514", "some_other_check"), "fallback")).toBe("fallback");
    expect(chronicWriteError(new Error("Failed query: boom"), "fallback")).toBe("fallback");
    expect(chronicWriteError(null, "fallback")).toBe("fallback");
  });

  it("R102 is a distinct app-layer refusal (cross-row, not a DB CHECK) and is non-empty", () => {
    // The writer throws this NAMED refusal for on_site_treatable=false + a med insert; it never routes
    // through chronicWriteError and must not collide with the PRN message.
    expect(R102_REFUSAL).toMatch(/referral-managed/i);
    expect(R102_REFUSAL).not.toBe(PRN_XOR_SLOT);
    expect(PRN_XOR_SLOT.length).toBeGreaterThan(0);
  });
});
