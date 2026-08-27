import { describe, it, expect } from "vitest";
import { readCode } from "@/lib/test-utils/source-shape";

/**
 * INCR #298 (A) — prefect appointment workflow. The appoint/revoke/carry logic is imperative DB
 * mutation (clear-prior, set-tag, move-tag) a pure suite cannot stage two concurrent transactions to
 * prove behaviourally, so this pins the STRUCTURE the correctness rests on (the expression, not the
 * name): every mutation happens inside the withSchool tx; the appointment SETS the existing
 * boarding_bunk.prefect_role tag (Kofi's zero-schema ruling) so the two existing readers stay the sole
 * source of truth; and the sickbay-prefect derived read + the strip builder keep reading that tag.
 */

/** Slice a named `export async function` body out to the next top-level export/const. */
function fnBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}`);
  if (start === -1) throw new Error(`fn ${name} not found`);
  const rest = src.slice(start + 1);
  const next = rest.search(/\nexport (?:async function|const|default)/);
  return rest.slice(0, next === -1 ? undefined : next);
}
/** Slice an internal (non-exported) `async function` body. */
function helperBody(src: string, name: string): string {
  const start = src.indexOf(`async function ${name}`);
  if (start === -1) throw new Error(`helper ${name} not found`);
  const rest = src.slice(start + 1);
  const next = rest.search(/\n(?:export )?(?:async function|function|const) /);
  return rest.slice(0, next === -1 ? undefined : next);
}

const boarding = () => readCode("lib/actions/boarding.ts");

describe("appointPrefect · gate is identical to a bunk move (AC-A5, no widening)", () => {
  it("checks BOARDING_ROLES on the caller and defers house scope to the shared gate", () => {
    const b = fnBody(boarding(), "appointPrefect");
    expect(b).toMatch(/hasAnyRole\(user\.roles,\s*BOARDING_ROLES\)/);
    expect(b, "delegates the own-house check to the shared loader").toContain("loadGatedBoarder(");
  });
  it("the shared loader enforces canAccessHouse (so a plain HOUSEMASTER stays in their House)", () => {
    expect(helperBody(boarding(), "loadGatedBoarder")).toContain("canAccessHouse(");
  });
});

describe("appointPrefect · eligibility + one-holder-per-role (AC-A2/A3/A7)", () => {
  const b = () => fnBody(boarding(), "appointPrefect");
  it("rejects a non-ACTIVE, non-BOARDER, or un-allocated boarder before any write", () => {
    const s = b();
    expect(s).toContain('stu.status !== "ACTIVE"');
    expect(s).toContain('stu.residency !== "BOARDER"');
    expect(s).toMatch(/if\s*\(!bunkId\)/);
  });
  it("clears the prior holder of the role in-tx BEFORE tagging the appointee (AC-A2)", () => {
    const s = b();
    const tx = s.indexOf("withSchool(");
    const clear = s.indexOf("prefectRole: null"); // the prior-holder clear
    const set = s.indexOf("prefectRole: role"); // the appointee's new tag
    expect(tx, "mutations run inside the tenant tx").toBeGreaterThan(-1);
    expect(clear, "clears a prior holder").toBeGreaterThan(tx);
    expect(set, "then sets the appointee's tag").toBeGreaterThan(clear);
    // the clear is scoped to the role within the House (never a blanket wipe).
    expect(s).toMatch(/eq\(boardingDormitory\.houseId/);
    expect(s).toMatch(/eq\(boardingBunk\.prefectRole,\s*role\)/);
  });
});

describe("appoint/revoke audit dodges the GOV-10 classify-at-creation trap (entityType student)", () => {
  it("both audit writes use the already-SHOWN 'student' entityType, not a new unclassified one", () => {
    const s = boarding();
    expect(s).toContain('actionType: "BOARDING_PREFECT_APPOINTED"');
    expect(s).toContain('actionType: "BOARDING_PREFECT_REVOKED"');
    // no BOARDING_PREFECT_* audit may carry an entityType other than "student" (else next build fails
    // the audit-classification guard — an unclassified entity is REDACTED-or-SHOWN by omission).
    for (const m of s.matchAll(/actionType:\s*"BOARDING_PREFECT_[A-Z]+"[\s\S]{0,120}?entityType:\s*"([a-z_]+)"/g)) {
      expect(m[1], "prefect audit entityType").toBe("student");
    }
  });
});

describe("reassignBunk · carries the prefect tag with its holder (AC-A8)", () => {
  it("moves the tag from source to target bunk inside the same move tx (never strands it)", () => {
    const s = fnBody(boarding(), "reassignBunk");
    const move = s.indexOf("currentBunkId: targetBunkId"); // the student move
    const readSrc = s.indexOf("src?.role"); // read the source bunk's tag
    const carry = s.indexOf("prefectRole: src.role"); // stamp it onto the target
    expect(move).toBeGreaterThan(-1);
    expect(readSrc, "reads the source bunk's tag after the move").toBeGreaterThan(move);
    expect(carry, "stamps the tag onto the target bunk").toBeGreaterThan(readSrc);
    // and clears the vacated source bunk so the title is not duplicated.
    expect(s.slice(carry)).toContain("prefectRole: null");
  });
});

describe("the two readers my zero-schema model depends on still read the bunk tag (AC-A9/A10)", () => {
  it("getHealthPrefects still derives the sickbay roster from boarding_bunk.prefect_role='SICKBAY'", () => {
    const s = readCode("lib/sickbay/config.ts");
    const body = s.slice(s.indexOf("function getHealthPrefects"));
    expect(body).toMatch(/eq\(boardingBunk\.prefectRole,\s*"SICKBAY"\)/);
  });
  it("buildPrefectStrip still keys the strip off the bunk's prefectRole tag", () => {
    const s = readCode("lib/boarding/roster.ts");
    const body = s.slice(s.indexOf("function buildPrefectStrip"));
    expect(body).toMatch(/b\.prefectRole/);
  });
});
