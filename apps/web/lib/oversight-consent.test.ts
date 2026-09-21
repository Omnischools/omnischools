import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { deriveConsentState, highestRankedRole } from "./oversight-consent";
import { schoolStaffOversightConsent } from "@/db/schema/oversight-consent";

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
  it("a HIGHER-ranked but NON-allowed role is never stamped (PROPRIETOR outranks ADMIN yet ADMIN is stamped)", () => {
    // rankOf(PROPRIETOR)=3 > rankOf(ADMIN)=2, but PROPRIETOR is not in the allow-list, so it can never be
    // matched — the stamp is the allowed role the caller actually holds, never the highest role overall.
    expect(highestRankedRole(["PROPRIETOR", "ADMIN"], ALLOWED)).toBe("ADMIN");
    expect(highestRankedRole(["PROPRIETOR", "HEADMASTER"], ALLOWED)).toBe("HEADMASTER");
  });
  it("no matched role ⇒ null (assertAnyRole precludes this at the action)", () => {
    expect(highestRankedRole(["TEACHER"], ALLOWED)).toBeNull();
    // a PROPRIETOR-only session holds no allowed role → null (assertAnyRole would already have thrown).
    expect(highestRankedRole(["PROPRIETOR"], ALLOWED)).toBeNull();
  });
});

/**
 * A4 — the load-bearing read-contract guard (source-shape, always-run, no DB).
 *
 * apps/oversight/lib/oversight/consent.ts SELECTs these 5 columns (`id::text, state::text,
 * revoked_at::text, granted_at::text, consent_statement_version`) and binds `school_id`/`scope` in
 * its WHERE, LIVE inside its read-back transaction, against THIS operational table. That reader is a
 * FIXED contract (do NOT edit apps/oversight). A rename or type-change of ANY of these columns in
 * db/schema/oversight-consent.ts silently breaks the already-merged §6 drill-down — so it must fail
 * HERE, in the always-run suite, not only in the DB-bound db:rls-test A4 probe. This is a hand-mirror
 * of the fixed reader contract; keep it exact.
 */
describe("A4 — Oversight read-contract column guard (load-bearing)", () => {
  const READ_CONTRACT: Record<string, string> = {
    id: "uuid", // id::text
    state: "oversight_consent_state", // state::text
    revoked_at: "timestamp with time zone", // revoked_at::text
    granted_at: "timestamp with time zone", // granted_at::text
    consent_statement_version: "text", // selected raw (no cast) → must stay text
    school_id: "uuid", // WHERE school_id = $::uuid
    scope: "oversight_consent_scope", // WHERE scope::text = 'NON_GES_STAFF'
  };
  const bySqlName = new Map(
    Object.values(getTableColumns(schoolStaffOversightConsent)).map((c) => [c.name, c.getSQLType()]),
  );
  for (const [name, sqlType] of Object.entries(READ_CONTRACT)) {
    it(`column "${name}" exists and keeps SQL type ${sqlType}`, () => {
      expect(bySqlName.has(name)).toBe(true);
      expect(bySqlName.get(name)).toBe(sqlType);
    });
  }
  it("(school_id, scope) is UNIQUE so the reader's WHERE + LIMIT 1 returns at most one row", () => {
    const { uniqueConstraints } = getTableConfig(schoolStaffOversightConsent);
    expect(uniqueConstraints.length).toBe(1);
    expect(uniqueConstraints[0].columns.map((c) => c.name).sort()).toEqual(["school_id", "scope"]);
  });
});

/**
 * D1/D2 — the dual-fence source guard (mutation-check). The page fences with requireSchoolRole and the
 * server action re-fences INDEPENDENTLY with assertAnyRole, so a hand-crafted POST that never loaded
 * the page is still refused. This proves BOTH exported write actions carry that independent fence and
 * that the allow-list is EXACTLY ADMIN+HEADMASTER (no PROPRIETOR). Deleting an action's
 * `assertAnyRole(CONSENT_ROLES)` line, or widening CONSENT_ROLES, turns one of these RED.
 */
describe("D1/D2 — action dual-fence + no-PROPRIETOR allow-list (source guard)", () => {
  const actionSrc = readFileSync(resolve(cwd(), "lib/actions/oversight-consent.ts"), "utf8");
  // Split the file at the two exported action declarations so each is checked in isolation.
  const grantIdx = actionSrc.indexOf("export async function grantOversightConsent");
  const revokeIdx = actionSrc.indexOf("export async function revokeOversightConsent");
  const grantBody = actionSrc.slice(grantIdx, revokeIdx);
  const revokeBody = actionSrc.slice(revokeIdx);

  it("both action declarations are present", () => {
    expect(grantIdx).toBeGreaterThanOrEqual(0);
    expect(revokeIdx).toBeGreaterThan(grantIdx);
  });
  it("grantOversightConsent independently calls assertAnyRole(CONSENT_ROLES)", () => {
    expect(grantBody).toMatch(/assertAnyRole\(\s*CONSENT_ROLES\s*\)/);
  });
  it("revokeOversightConsent independently calls assertAnyRole(CONSENT_ROLES)", () => {
    expect(revokeBody).toMatch(/assertAnyRole\(\s*CONSENT_ROLES\s*\)/);
  });
  it("CONSENT_ROLES is EXACTLY [ADMIN, HEADMASTER] — no PROPRIETOR, no widening", () => {
    const m = actionSrc.match(/const CONSENT_ROLES\s*=\s*\[([^\]]*)\]/);
    expect(m).not.toBeNull();
    const roles = (m![1].match(/"([A-Z_]+)"/g) ?? []).map((s) => s.replace(/"/g, ""));
    expect(roles).toEqual(["ADMIN", "HEADMASTER"]);
  });
  it("PROPRIETOR appears in no CODE (comments may explain its deliberate absence)", () => {
    // Strip block + line comments, then assert the token is nowhere in executable source: a comment
    // saying "NOT widened to PROPRIETOR" is correct; PROPRIETOR reaching the code is the defect.
    const codeOnly = actionSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(codeOnly.includes("PROPRIETOR")).toBe(false);
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
