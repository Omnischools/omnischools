import { describe, it, expect } from "vitest";
import { readCode } from "@/lib/test-utils/source-shape";

/**
 * R225.1/R225.2 (INCR-28a) — the WIRING guards for the boarding in-House headcount + sick-bay tile.
 * daily-data.ts imports the DB driver via withSchool, so (like medical-hold.test.ts) these are
 * source-shape assertions: the connection-ordering and disclosure properties are structural, not
 * observable from a superuser DB. The pure formula lives in daily-life.test.ts (offCampusBoarders).
 */
const DATA = "lib/boarding/daily-data.ts";
const PAGE = "app/(app)/senior/boarding/houses/[houseId]/today/page.tsx";

describe("🔴 R225.1 · in-House subtracts off-campus via a SET union, admissions excluded", () => {
  const src = () => readCode(DATA);

  it("computes inHouse from offCampusBoarders — the SET union, NOT `−size−size`", () => {
    const s = src();
    expect(s).toMatch(/offCampus = offCampusBoarders\(boarderIds, outStudentIds, referredOut\)/);
    expect(s).toMatch(/inHouse = boarders\.length - offCampus\.size/);
    // The double-subtract that goes negative on an overlap must never appear.
    expect(s, "must not double-subtract referredOut.size").not.toMatch(
      /boarders\.length - outStudentIds\.size - referredOut\.size/,
    );
  });

  // AC-R225-7 — referredOutStudentIds opens its OWN withSchool; calling it INSIDE the outer tx is the
  // e08c042 nested-connection hazard. It must be fetched BEFORE `return withSchool(`.
  it("AC-R225-7 · referredOutStudentIds is fetched BEFORE the outer withSchool tx", () => {
    const s = src();
    const fetchAt = s.indexOf("referredOutStudentIds(schoolId, now)");
    const txAt = s.indexOf("return withSchool(schoolId");
    expect(fetchAt).toBeGreaterThan(-1);
    expect(txAt).toBeGreaterThan(-1);
    expect(fetchAt, "the school-wide referral fetch must precede the outer tx").toBeLessThan(txAt);
  });

  it("the sick-bay admissions reader runs on the OUTER tx (no nested connection)", () => {
    // Passing `tx` (not opening a fresh withSchool) is what keeps the tile off a second connection.
    expect(src()).toMatch(/boardingSickbayAdmissions\(tx, schoolId,/);
  });

  // AC-R225-4 — admissions are NOT subtracted; the inHouse line references only the offCampus set.
  it("AC-R225-4 · the inHouse formula references no admission/sickbay set", () => {
    const s = src();
    const line = s.split("\n").find((l) => l.includes("const inHouse = boarders.length")) ?? "";
    expect(line).not.toMatch(/sickbay|admission/i);
  });
});

describe("🔴 R225.2 · the today page — gloss survives, admissions named, condition withheld", () => {
  const src = () => readCode(PAGE);

  // AC-R225-4 (OQ5) — the "· sick-bay not subtracted" gloss STAYS on the featured card.
  it("AC-R225-4 · keeps the `· sick-bay not subtracted` gloss", () => {
    expect(src()).toContain("· sick-bay not subtracted");
  });

  // AC-R225-5 — the sick-bay block renders ALL admissions (name-all), pre-formatted, condition-free.
  it("AC-R225-5 · maps over every admission (name-all), no condition token in the block", () => {
    const s = src();
    expect(s).toMatch(/view\.sickbay\.admissions\.map/);
    expect(s).toMatch(/a\.studentName/);
    expect(s).toMatch(/a\.admittedLabel/);
    // No clinical value is rendered — the block prints location + time only.
    expect(s).not.toMatch(/a\.condition|a\.complaint|a\.bedNumber|a\.diagnosis/);
  });

  it("the header + summary tiles bind to the derived sick-bay count", () => {
    expect(src()).toMatch(/view\.sickbay\.count/);
  });
});
