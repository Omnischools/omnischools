import { describe, it, expect } from "vitest";
import { pgError, isUniqueViolation } from "./pg-error";

/**
 * These tests pin the REAL shapes observed from drizzle-orm + postgres.js against the dev DB, because
 * this bug class was silently live across six call sites for months and is invisible to `next build`,
 * typecheck, and lint — the broken checks compile and read plausibly, they just never fire.
 *
 * Observed by probing an actual duplicate insert:
 *   thrown ctor            : DrizzleQueryError
 *   thrown .code           : undefined
 *   thrown .message        : 'Failed query: INSERT INTO probe_uk VALUES (1)\nparams: '
 *   cause  ctor            : PostgresError
 *   cause  .code           : '23505'
 *   cause  .constraint_name: 'probe_uk_name'
 */

/** The exact wrapper shape drizzle throws — the regression that made six call sites dead code. */
function drizzleWrapped(code: string, constraint?: string): Error {
  const pgErr = Object.assign(new Error(`duplicate key value violates unique constraint "${constraint}"`), {
    code,
    constraint_name: constraint,
  });
  return Object.assign(new Error("Failed query: INSERT INTO x VALUES (1)\nparams: "), { cause: pgErr });
}

describe("pgError — unwrapping Drizzle's wrapped driver errors", () => {
  it("finds a unique violation through the wrapper (THE regression)", () => {
    const err = drizzleWrapped("23505", "uniq_student_current_bunk");
    // What the six broken call sites read, and why they never fired:
    expect((err as { code?: string }).code).toBeUndefined();
    expect(String(err.message)).not.toContain("duplicate key");
    // What the helper reads:
    expect(isUniqueViolation(err)).toBe(true);
    expect(pgError(err)).toEqual({ code: "23505", constraint: "uniq_student_current_bunk" });
  });

  it("still works if the driver error is NOT wrapped (degrades gracefully both directions)", () => {
    const bare = Object.assign(new Error("dupe"), { code: "23505", constraint_name: "uniq_x" });
    expect(isUniqueViolation(bare)).toBe(true);
    expect(pgError(bare).constraint).toBe("uniq_x");
  });

  it("survives an extra wrapping layer", () => {
    const deeper = Object.assign(new Error("outer"), { cause: drizzleWrapped("23505", "uniq_y") });
    expect(isUniqueViolation(deeper)).toBe(true);
  });

  it("does NOT misreport other Postgres errors as unique violations", () => {
    const fk = drizzleWrapped("23503", "some_fk"); // foreign-key violation
    expect(isUniqueViolation(fk)).toBe(false);
    expect(pgError(fk).code).toBe("23503"); // still classified, just not as 23505
  });

  it("returns a unique violation with no constraint name when the driver omits it", () => {
    const noConstraint = Object.assign(new Error("outer"), {
      cause: Object.assign(new Error("dupe"), { code: "23505" }),
    });
    expect(isUniqueViolation(noConstraint)).toBe(true);
    expect(pgError(noConstraint).constraint).toBeUndefined();
  });

  it("is safe on non-errors and never throws", () => {
    for (const junk of [null, undefined, "23505", 42, {}, new Error("plain"), []]) {
      expect(() => pgError(junk)).not.toThrow();
      expect(isUniqueViolation(junk)).toBe(false);
    }
  });

  it("terminates on a cyclic cause chain", () => {
    const a = new Error("a") as Error & { cause?: unknown };
    const b = new Error("b") as Error & { cause?: unknown };
    a.cause = b;
    b.cause = a; // cycle
    expect(() => pgError(a)).not.toThrow();
    expect(isUniqueViolation(a)).toBe(false);
  });

  it("stops at the documented depth cap rather than walking unbounded", () => {
    // 6 hops deep — beyond the cap of 5, so deliberately NOT found.
    let err: unknown = Object.assign(new Error("pg"), { code: "23505" });
    for (let i = 0; i < 6; i++) err = Object.assign(new Error(`wrap${i}`), { cause: err });
    expect(isUniqueViolation(err)).toBe(false);
  });
});
