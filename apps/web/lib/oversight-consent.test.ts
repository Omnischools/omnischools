import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
import { deriveConsentState, highestRankedRole } from "./oversight-consent";

const ALLOWED = ["ADMIN", "HEADMASTER"] as const;

describe("deriveConsentState", () => {
  it("no row ⇒ NONE", () => {
    expect(deriveConsentState(null)).toBe("NONE");
    expect(deriveConsentState(undefined)).toBe("NONE");
  });
  it("GRANTED with no revoked_at ⇒ GRANTED", () => {
    expect(deriveConsentState({ state: "GRANTED", revokedAt: null })).toBe("GRANTED");
  });
  it("REVOKED ⇒ REVOKED", () => {
    expect(deriveConsentState({ state: "REVOKED", revokedAt: new Date() })).toBe("REVOKED");
  });
  it("belt-and-braces: a revoked_at present forces REVOKED even if state reads GRANTED", () => {
    expect(deriveConsentState({ state: "GRANTED", revokedAt: new Date() })).toBe("REVOKED");
  });
});

describe("highestRankedRole (granted_by_role stamp)", () => {
  it("picks the only matched allow-list role", () => {
    expect(highestRankedRole(["ADMIN"], ALLOWED)).toBe("ADMIN");
    expect(highestRankedRole(["HEADMASTER"], ALLOWED)).toBe("HEADMASTER");
  });
  it("ADMIN & HEADMASTER are rank peers ⇒ allow-list order breaks the tie (ADMIN first)", () => {
    expect(highestRankedRole(["ADMIN", "HEADMASTER"], ALLOWED)).toBe("ADMIN");
    expect(highestRankedRole(["HEADMASTER", "ADMIN"], ALLOWED)).toBe("ADMIN");
  });
  it("never returns a bare roles[0]: a non-allowed first role is ignored for the matched one", () => {
    expect(highestRankedRole(["TEACHER", "HEADMASTER"], ALLOWED)).toBe("HEADMASTER");
  });
  it("no matched role ⇒ null (assertAnyRole precludes this at the action)", () => {
    expect(highestRankedRole(["TEACHER"], ALLOWED)).toBeNull();
  });
});

describe("single-source guard: version imported by BOTH panel and action", () => {
  const importsVersion = (rel: string) => {
    const src = readFileSync(resolve(cwd(), rel), "utf8");
    // an import from the single-source module that pulls CONSENT_STATEMENT_VERSION
    const importRe = /import\s*{[^}]*\bCONSENT_STATEMENT_VERSION\b[^}]*}\s*from\s*["']@\/lib\/oversight-consent["']/;
    return importRe.test(src);
  };
  it("the server action imports CONSENT_STATEMENT_VERSION from the single source", () => {
    expect(importsVersion("lib/actions/oversight-consent.ts")).toBe(true);
  });
  it("the client panel imports CONSENT_STATEMENT_VERSION from the single source", () => {
    expect(importsVersion("components/settings/oversight-consent-panel.tsx")).toBe(true);
  });
});
