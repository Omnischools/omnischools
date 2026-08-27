import { describe, it, expect } from "vitest";
import { readCode } from "@/lib/test-utils/source-shape";
import { hashRsvpToken, DOB_ATTEMPT_CAP } from "@/lib/boarding/rsvp-token";

/**
 * INCR #298 (B) — public tokenised parent RSVP link. The issue/submit actions are DB-imperative under a
 * tenant tx / the `withoutTenantScope` bypass, which a pure suite can't stage; the seam that CAN be run
 * behaviourally (the token hash) is proven directly, and the security-critical invariants are pinned
 * structurally (expression, not name): hashed-at-rest, scope-resolved-from-token-only, DOB fail-closed +
 * attempt-capped, no-oracle, and idempotency via the token's own visit link.
 */

function fnBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}`);
  if (start === -1) throw new Error(`fn ${name} not found`);
  const rest = src.slice(start + 1);
  const next = rest.search(/\nexport (?:async function|const|default|type)/);
  return rest.slice(0, next === -1 ? undefined : next);
}
const action = () => readCode("lib/actions/boarding-rsvp.ts");

describe("hashRsvpToken · the only persisted form of the token", () => {
  it("is a deterministic 64-char SHA-256 hex, distinct per token", () => {
    const a = hashRsvpToken("abc123");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRsvpToken("abc123")).toBe(a); // deterministic → usable as the lookup key
    expect(hashRsvpToken("abc124")).not.toBe(a);
  });
});

describe("issueRsvpToken · hashed at rest, stored-phone delivery, gated", () => {
  const b = () => fnBody(action(), "issueRsvpToken");
  it("stores only the HASH — the raw 192-bit token is never a column, only the SMS link carries it", () => {
    const s = b();
    expect(s).toMatch(/randomBytes\(24\)/); // 192-bit CSPRNG
    expect(s).toContain("hashRsvpToken(raw)"); // the raw is hashed…
    expect(s).toMatch(/tokenHash,/); // …and only the hash is inserted (property shorthand)
    expect(s, "the raw token must never be stored as the token column").not.toMatch(/tokenHash:\s*raw\b/);
    // the raw exists only in the SMS link.
    expect(s).toContain("/rsvp/${raw}");
  });
  it("delivers ONLY to the stored primary guardian phone (never a request-supplied number)", () => {
    const s = b();
    expect(s).toMatch(/eq\(studentGuardians\.isPrimary,\s*true\)/);
    expect(s).toContain("issuedToPhone: g.phone");
    expect(s).toContain("to: g.phone");
  });
  it("gates BOARDING_ROLES + own-House and requires an ACTIVE boarder with a DOB on file", () => {
    const s = b();
    expect(s).toMatch(/hasAnyRole\(user\.roles,\s*BOARDING_ROLES\)/);
    expect(s).toContain("canAccessHouse(");
    expect(s).toMatch(/status !== "ACTIVE"/);
    expect(s).toMatch(/residency !== "BOARDER"/);
    expect(s).toMatch(/if \(!stu\.dob\)/); // no DOB ⇒ refuse to issue (the factor can never be met)
  });
});

describe("submitParentRsvp · scope-from-token-only, DOB fail-closed, no-oracle, idempotent", () => {
  const b = () => fnBody(action(), "submitParentRsvp");
  it("resolves the token under withoutTenantScope and derives school/student from the ROW, not input", () => {
    const s = b();
    expect(s).toContain("withoutTenantScope(");
    expect(s).toContain("hashRsvpToken(token)"); // hashes the submitted token…
    expect(s).toMatch(/eq\(boardingVisitRsvpToken\.tokenHash,\s*tokenHash\)/); // …and looks up by that hash
    // the ward is read scoped to the TOKEN's school+student — never a request-supplied id.
    expect(s).toMatch(/eq\(students\.schoolId,\s*t\.schoolId\)/);
    expect(s).toMatch(/eq\(students\.id,\s*t\.studentId\)/);
    // and the write is scoped to the token's school.
    expect(s).toMatch(/schoolId:\s*t\.schoolId/);
  });
  it("fails CLOSED on missing ward / null DOB / mismatch — bumps the counter, writes no visit", () => {
    const s = b();
    // one guard covers all three fail-closed cases and increments attempts.
    expect(s).toMatch(/if \(!stu \|\| !stu\.dob \|\| !stu\.houseId \|\| stu\.dob !== dob\)/);
    const guardAt = s.indexOf("stu.dob !== dob");
    const bumpAt = s.indexOf("attempts} + 1", guardAt);
    expect(bumpAt, "the fail path increments attempts").toBeGreaterThan(guardAt);
  });
  it("caps DOB attempts (brute-force fence on the low-entropy factor)", () => {
    expect(DOB_ATTEMPT_CAP).toBeGreaterThan(0);
    expect(action()).toMatch(/t\.attempts >= DOB_ATTEMPT_CAP/);
  });
  it("no oracle — bad/expired/revoked all return the SAME generic message", () => {
    const s = b();
    expect(s).toMatch(/if \(!t \|\| t\.revokedAt \|\| t\.expiresAt\.getTime\(\) < Date\.now\(\)\)/);
    expect(s).toContain("GENERIC_SUBMIT_ERROR");
  });
  it("idempotent via the token's own visit link — updates the same visit, never a second row", () => {
    const s = b();
    const branch = s.indexOf("if (t.visitId)");
    expect(branch, "branches on the token's stored visitId").toBeGreaterThan(-1);
    // first submit inserts then stores the visit id back on the token; repeat submits update it.
    expect(s).toMatch(/set\(\{ visitId: row\.id \}\)/);
    expect(s).toContain('status: "RSVP"');
    expect(s).toContain('verification: "FLAGGED"');
    expect(s).toMatch(/rsvpByUserId:\s*null/); // parent origin — never a staff actor
  });
});
