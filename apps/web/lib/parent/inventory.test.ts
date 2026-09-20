import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

describe("the parent portal is READ-ONLY (Kofi R4 · AC A1)", () => {
  it("19b ships the app/(parent) route group with its own layout (never the staff app/(app) shell)", () => {
    expect(existsSync(join(root, "app", "(parent)", "layout.tsx"))).toBe(true);
    expect(existsSync(join(root, "app", "(parent)", "wassce", "page.tsx"))).toBe(true);
  });

  it("the portal surface has NO write path — no form/input/textarea/select/button/submit/server action", () => {
    const files = [
      join(root, "app", "(parent)", "layout.tsx"),
      join(root, "app", "(parent)", "wassce", "page.tsx"),
    ];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src, `${f} must not contain <form>`).not.toMatch(/<form\b/);
      expect(src, `${f} must not contain <input>`).not.toMatch(/<input\b/);
      expect(src, `${f} must not contain <textarea>`).not.toMatch(/<textarea\b/);
      expect(src, `${f} must not contain <select>`).not.toMatch(/<select\b/);
      expect(src, `${f} must not contain <button>`).not.toMatch(/<button\b/);
      expect(src, `${f} must not contain a submit control`).not.toMatch(/type=["']submit["']/);
      expect(src, `${f} must not declare a server action`).not.toMatch(/["']use server["']/);
    }
  });

  it("the parent data LOADERS run under withParentScope, never withoutTenantScope (AC D10)", () => {
    const src = readFileSync(join(root, "lib", "parent", "parent-data.ts"), "utf8");
    // The public loader wrapper must scope via withParentScope (the RLS boundary), not bypass it.
    expect(src).toContain(
      "return withParentScope(schoolId, userId, (tx) => loadParentChildrenTx(tx, schoolId, userId));",
    );
    // The 19b portal loader is likewise scoped, and never reaches for withoutTenantScope on a child path.
    const portal = readFileSync(join(root, "lib", "parent", "parent-portal-data.ts"), "utf8");
    expect(portal).toContain("withParentScope(schoolId, userId, (tx) => loadParentPortalTx(tx, schoolId, userId))");
    expect(portal).not.toMatch(/withoutTenantScope\s*\(/);
  });
});
