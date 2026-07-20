import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

describe("no parent write path / route in 19a (AC A1)", () => {
  it("has NO app/(parent) route group — the portal surface is 19b", () => {
    expect(existsSync(join(root, "app", "(parent)"))).toBe(false);
  });

  it("the parent data LOADER runs under withParentScope, never withoutTenantScope (AC D10)", () => {
    const src = readFileSync(join(root, "lib", "parent", "parent-data.ts"), "utf8");
    // The public loader wrapper must scope via withParentScope (the RLS boundary), not bypass it.
    expect(src).toContain(
      "return withParentScope(schoolId, userId, (tx) => loadParentChildrenTx(tx, schoolId, userId));",
    );
  });
});
