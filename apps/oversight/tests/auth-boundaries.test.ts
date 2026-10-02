import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { scopeFor, withJurisdiction } from "@/lib/db/rls";
import { openNamedStaffRecord } from "@/lib/oversight/gate-step-up";
import { districtOfficer, stepUpFixture } from "./helpers";

/**
 * THE STRUCTURAL GUARDS of increment G — the properties that are about the SHAPE of the codebase
 * rather than about a value, and therefore cannot be asserted any other way.
 *
 * Same family as tests/readback-isolation.test.ts, and for the same reason: each of these holds today
 * because a human arranged it, and would be undone by a plausible, well-intentioned edit that no
 * other test would notice.
 *
 *   1. the jurisdiction SCOPE can only be built from a resolved session (compile-time + textual)
 *   2. an OfficerSession can only be minted in three named places
 *   3. the §6 STEP-UP ASSERTION can only be minted by the resolver (Dex B1)
 *   4. `supabase.auth.*` appears only inside lib/auth + lib/supabase, and `getSession()` NOWHERE
 *   5. the service-role key is not read anywhere in the app
 *   6. the §6 server actions reach the gate only through the step-up choke point
 *
 * All three brands (session, scope, step-up assertion) are guarded the SAME way on purpose: a
 * compile-time `@ts-expect-error` that proves the literal does not typecheck, plus a named importer
 * allow-list for the mint. A reviewer who has read one of these blocks has read all three.
 */

const ROOT = process.cwd();
const rel = (f: string): string => relative(ROOT, f).replaceAll("\\", "/");

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const APP_SOURCES = ["lib", "app", "components", "middleware.ts"].flatMap((d) => {
  const full = join(ROOT, d);
  try {
    return statSync(full).isDirectory() ? walk(full) : [full];
  } catch {
    return [];
  }
});

const ALL_SOURCES = [
  ...APP_SOURCES,
  ...walk(join(ROOT, "tests")),
  ...walk(join(ROOT, "scripts")),
];

/** This file itself, which necessarily NAMES every pattern it forbids. */
const SELF = "tests/auth-boundaries.test.ts";

/**
 * Source with COMMENTS AND STRING LITERALS REMOVED.
 *
 * Every scan below looks for a pattern that this codebase also DISCUSSES at length — the comments
 * explain why `getSession()` must not appear, why the service-role key is absent, why the old
 * field-copying idiom was a hand-written ceiling. A naive text scan flags the explanation as the
 * violation, and the usual fix for that is to delete the explanation. So the scans read CODE only:
 * a guard that punishes documentation gets documentation deleted.
 */
function read(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments
    .replace(/(^|[^:])\/\/.*$/gm, "$1") // line comments (not the // in a URL)
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""') // double-quoted strings
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''"); // single-quoted strings
}

/** Raw text, for the few assertions that are ABOUT the prose or about an import specifier. */
function readRaw(file: string): string {
  return readFileSync(file, "utf8");
}

/**
 * Comments stripped, STRINGS KEPT. For patterns that live INSIDE a SQL string — `set_config('app.
 * current_jurisdiction', …)` is quoted SQL inside a template literal, so the string-blanking in
 * `read()` erases exactly the thing being looked for.
 */
function readSql(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// ─── 1 · the scope is unforgeable ───────────────────────────────────────────────────────────────

describe("a jurisdiction scope can only come from a resolved session", () => {
  it("a bare literal does not typecheck", () => {
    // These assertions are checked by `pnpm typecheck`, not at runtime: if either literal became
    // assignable, `@ts-expect-error` would itself become an error and the build would fail. That is
    // the strongest form this property can take — the forgery is not refused at runtime, it cannot
    // be written.
    const noop = async () => null;
    // Built OUTSIDE the call, so each `@ts-expect-error` stays on the one line the error is
    // reported from however prettier reflows the call. (It bit once: the directive drifted off its
    // line and typecheck failed with "unused '@ts-expect-error' directive".)
    const bare = () => ({ level: "NATIONAL" as const });
    const populated = () => ({
      jurisdictionId: null,
      level: "NATIONAL" as const,
      officerId: "00000000-0000-4000-8000-000000000001",
    });
    const refuse = () => {
      // @ts-expect-error a literal NATIONAL scope must never typecheck
      void withJurisdiction(bare(), noop);
      // …nor the fully-populated shape every call site used before the brand:
      // @ts-expect-error a hand-written scope must never typecheck either
      void withJurisdiction(populated(), noop);
    };
    expect(typeof refuse).toBe("function");
  });

  it("scopeFor(session) produces the officer's own ceiling, whole", () => {
    const scope = scopeFor(districtOfficer);
    expect(scope.jurisdictionId).toBe(districtOfficer.jurisdictionId);
    expect(scope.level).toBe(districtOfficer.level);
    expect(scope.officerId).toBe(districtOfficer.officerId);
  });

  it("the raw scope interface is NOT exported from lib/db/rls.ts", () => {
    const source = readRaw(join(ROOT, "lib/db/rls.ts"));
    expect(source).toMatch(/interface RawJurisdictionScope/);
    expect(source).not.toMatch(/export interface RawJurisdictionScope/);
    // The exported name is the branded alias; nothing can construct it.
    expect(source).toMatch(/export type JurisdictionScope/);
  });

  it("the SCOPE GUCs are written in exactly one place", () => {
    // `app.current_jurisdiction` and `app.current_officer` are the two values every RLS policy in
    // db/sql/policies.sql trusts. Exactly one module may write them, and it can only be handed a
    // scope that came from a resolved session.
    const scopeWriters = APP_SOURCES.filter((f) =>
      /set_config\('app\.current_(jurisdiction|officer)'/.test(readSql(f)),
    )
      .map(rel)
      .sort();
    expect(scopeWriters).toEqual(["lib/db/rls.ts"]);
  });

  it("every other set_config call is accounted for, by name", () => {
    const writers = APP_SOURCES.filter((f) => /set_config\(/.test(readSql(f)))
      .map(rel)
      .sort();
    expect(writers).toEqual([
      "lib/db/readback.ts", // app.current_school — the operational tenant GUC, one school per tx
      "lib/db/rls.ts", // the three jurisdiction GUCs — the chokepoint
      // app.current_level = 'NATIONAL' so the PROVISIONER can read dim_jurisdiction for the node
      // picker (Wells's note). It is a READ convenience and no guard depends on it: every
      // provisioning guard derives the tier through a SECURITY DEFINER function that ignores GUCs,
      // so deleting that line would empty a dropdown, not permit anything.
      "lib/provisioning/officers.ts",
    ]);
  });

  it("no app module builds a scope by copying fields off an officer any more", () => {
    // The pre-G idiom (`{ jurisdictionId: officer.jurisdictionId, level: officer.level, ... }`) is
    // what made a hand-written ceiling possible. It must not come back.
    const offenders = APP_SOURCES.filter(
      (f) =>
        // `scopeFor()` itself is the ONE place that reads those fields off a session — it is the
        // constructor the rule exists to funnel everyone through.
        rel(f) !== "lib/db/rls.ts" &&
        /jurisdictionId:\s*\w+\.jurisdictionId,\s*\n?\s*level:\s*\w+\.level/.test(
          read(f),
        ),
    ).map(rel);
    expect(offenders).toEqual([]);
  });
});

// ─── 2 · the session mint is an allow-list ──────────────────────────────────────────────────────

describe("an OfficerSession can only be minted in three named places", () => {
  const ALLOWED_MINTERS = [
    "lib/auth/index.ts", // the AUTH_DEV_BYPASS shim (hard-stopped in production)
    "lib/auth/officer-directory.ts", // the ov_resolve_officer read — the real session
    "tests/helpers.ts", // the suite's fixture officers
  ].sort();

  it("the importers of sealOfficerSession match the allow-list exactly", () => {
    const importers = ALL_SOURCES.filter(
      (f) =>
        rel(f) !== "lib/oversight/officer.ts" &&
        rel(f) !== SELF &&
        // `read()` (comments stripped), not the raw text: lib/auth/step-up.ts legitimately NAMES
        // this function in a comment explaining that its own brand follows the same pattern. A scan
        // that counted prose would be a guard that punishes documentation — and the cheap way to
        // satisfy it would be to delete the explanation.
        /sealOfficerSession/.test(read(f)),
    )
      .map(rel)
      .sort();
    expect(importers).toEqual(ALLOWED_MINTERS);
  });

  it("nobody casts their way around the brand", () => {
    // The brand stops an honest mistake; `as unknown as OfficerSession` would walk straight past it.
    // There is no legitimate use, so the correct count is zero and a reviewer never has to judge.
    const offenders = ALL_SOURCES.filter(
      (f) => rel(f) !== SELF && /as\s+unknown\s+as\s+(Gate)?OfficerSession/.test(read(f)),
    ).map(rel);
    expect(offenders).toEqual([]);
  });
});

// ─── 3 · the §6 step-up assertion is unforgeable (Dex B1) ───────────────────────────────────────

describe("a §6 step-up assertion can only come from the resolver", () => {
  it("a literal assertion does not typecheck at the choke point", () => {
    // THE DEFECT THIS LOCKS SHUT. Before the brand, both server actions called the choke point with
    // `{ fresh: true }` — so the guard in front of the single irreversible action in the product (a
    // named record released, a GRANTED row written to an append-only log under an officer's name)
    // was reading a value the caller had typed. A future action could have done the same, with no
    // call to the resolver at all, and passed every runtime test in this suite.
    //
    // Checked by `pnpm typecheck`, not at runtime: if the literal ever became assignable,
    // `@ts-expect-error` would itself turn into an error and the build would fail.
    const request = () => ({
      officer: districtOfficer,
      school: { emisSchoolId: "EMIS-PUB-001" },
      reasonCode: "STATUTORY_AUDIT",
      caseReference: "typecheck-only — never executed",
      subject: { operationalStaffId: "50000000-0000-4000-8000-000000000001" },
      rosterBrowsed: false,
      exportFormat: null,
    });
    const literal = () => ({ fresh: true as const });
    const refuse = () => {
      // @ts-expect-error a hand-written step-up assertion must never typecheck
      void openNamedStaffRecord(request(), literal());
    };
    // Never invoked: the assertion above is about the TYPE, and calling it would open a record.
    expect(typeof refuse).toBe("function");
  });

  it("the raw shape is NOT exported, so it cannot be named and satisfied either", () => {
    const source = readRaw(join(ROOT, "lib/auth/step-up.ts"));
    expect(source).toMatch(/interface RawStepUpAssertion/);
    expect(source).not.toMatch(/export interface RawStepUpAssertion/);
    expect(source).toMatch(/export type StepUpAssertion/);
  });

  it("the importers of sealStepUpAssertion are the test helpers and nothing else", () => {
    // The production mint is `resolveStepUpAssertion()` in the same module; the seal exists only so
    // the suite can build a STALE assertion, which is what proves a refused step-up writes no audit
    // row. A production module appearing here fails the suite.
    const importers = ALL_SOURCES.filter(
      (f) =>
        rel(f) !== "lib/auth/step-up.ts" &&
        rel(f) !== SELF &&
        /sealStepUpAssertion/.test(read(f)),
    )
      .map(rel)
      .sort();
    expect(importers).toEqual(["tests/helpers.ts"]);
  });

  it("the §6 server actions MINT the assertion rather than describing one", () => {
    const actions = read(join(ROOT, "app/(oversight)/compliance-records/actions.ts"));
    expect(actions).toMatch(/resolveStepUpAssertion/);
    // No `fresh:` anywhere in the actions' CODE: the file no longer has an opinion about freshness,
    // it reads FormData and passes the minted assertion through.
    expect(actions).not.toMatch(/fresh\s*:/);
    // And it hands the choke point the minted object, by name.
    expect(actions).toMatch(/stepUp\.assertion/);
  });

  it("nobody casts their way around the brand", () => {
    const offenders = ALL_SOURCES.filter(
      (f) => rel(f) !== SELF && /as\s+unknown\s+as\s+StepUpAssertion/.test(read(f)),
    ).map(rel);
    expect(offenders).toEqual([]);
  });

  it("a sealed STALE assertion is still refused by the guard — the check is not vacuous", () => {
    // Presence must not be taken for freshness: the brand says "this was resolved", the boolean says
    // "and it was fresh". tests/gate-step-up.test.ts proves the consequence (no audit row); this
    // asserts the distinction exists at all, so a future constructor cannot mint a stale assertion
    // and have it silently accepted.
    expect(stepUpFixture(false).fresh).toBe(false);
    expect(stepUpFixture(true).fresh).toBe(true);
  });
});

// ─── 4 · the auth SDK boundary ──────────────────────────────────────────────────────────────────

describe("supabase.auth.* is confined to lib/auth + lib/supabase", () => {
  /**
   * The three modules that may CALL the auth SDK. `lib/supabase/{server,client}.ts` are not on the
   * list because they only CONSTRUCT a client — they never call `auth.*` themselves, which is the
   * division that keeps the cookie plumbing separate from the auth policy.
   */
  const ALLOWED_SDK_USERS = [
    "lib/auth/index.ts", // session resolution (getUser + getClaims)
    "lib/auth/mfa.ts", // sign-in, MFA enrol/challenge, sign-out
    "lib/provisioning/admin-auth.ts", // the admin console's own role gate (getUser, same rules)
    "middleware.ts", // the deny-by-default route guard
  ].sort();

  it("no feature module calls the auth SDK directly", () => {
    const users = APP_SOURCES.filter((f) =>
      /\.auth\.(getUser|getClaims|signIn|signOut|mfa)\b/.test(read(f)),
    )
      .map(rel)
      .sort();
    expect(users).toEqual(ALLOWED_SDK_USERS);
  });

  it("`getSession()` is used NOWHERE — it returns an unverified cookie", () => {
    // Supabase documents `getSession()` as untrustworthy on a server: it reads the cookie store
    // without checking it. Using it to establish an officer identity would mean a forged cookie is
    // an officer.
    const offenders = ALL_SOURCES.filter(
      (f) => rel(f) !== SELF && /auth\.getSession\s*\(/.test(read(f)),
    ).map(rel);
    expect(offenders).toEqual([]);
  });

  it("the verification call in lib/auth is getUser, not getSession", () => {
    const source = read(join(ROOT, "lib/auth/index.ts"));
    expect(source).toMatch(/auth\.getUser\(\)/);
    expect(source).not.toMatch(/auth\.getSession/);
  });
});

// ─── 5 · the service-role key is absent ─────────────────────────────────────────────────────────

describe("SUPABASE_SERVICE_ROLE_KEY is not part of this runtime", () => {
  it("no source file reads it", () => {
    // The key bypasses RLS and every auth check in the project. Oversight's authorisation model is
    // "the database decides", so a runtime holding that key holds a credential that can read every
    // named record and mint any officer. The only durable way to say it is not used is that it is
    // not read, and the only durable way to keep that true is this assertion.
    const offenders = ALL_SOURCES.filter(
      (f) => rel(f) !== SELF && /SUPABASE_SERVICE_ROLE_KEY/.test(read(f)),
    ).map(rel);
    expect(offenders).toEqual([]);
  });

  it("it is absent from the validated env schema", () => {
    const source = readRaw(join(ROOT, "lib/env.ts"));
    // The comment explaining the absence is expected; a schema entry is not.
    expect(source).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY:\s*z\./);
  });

  it("no service-role client module exists (apps/web has one; Oversight must not)", () => {
    const offenders = APP_SOURCES.map(rel).filter((f) =>
      /lib\/supabase\/admin\.ts$/.test(f),
    );
    expect(offenders).toEqual([]);
  });
});

// ─── 6 · the §6 step-up choke point ─────────────────────────────────────────────────────────────

describe("the §6 server actions reach the gate only through the step-up choke point", () => {
  const ACTIONS = "app/(oversight)/compliance-records/actions.ts";

  it("the actions file does not import the raw gate entry points", () => {
    const source = read(join(ROOT, ACTIONS));
    // `requestNamedStaffRecord` / `requestStaffListBrowse` write the audit row and open the
    // read-back. Calling either directly would place the step-up assertion in front of nothing.
    expect(source).not.toMatch(/\brequestNamedStaffRecord\b/);
    expect(source).not.toMatch(/\brequestStaffListBrowse\b/);
    expect(source).toMatch(/openNamedStaffRecord/);
    expect(source).toMatch(/browseStaffListGated/);
  });

  it("only the choke point and the gate's own tests call the raw entry points", () => {
    const callers = ALL_SOURCES.filter(
      (f) =>
        rel(f) !== "lib/oversight/named-record-access.ts" &&
        rel(f) !== SELF &&
        /\brequest(NamedStaffRecord|StaffListBrowse)\b/.test(read(f)),
    )
      .map(rel)
      .filter((f) => !f.startsWith("tests/"))
      .sort();
    expect(callers).toEqual(["lib/oversight/gate-step-up.ts"]);
  });
});
