import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
import { isStaff } from "@/lib/access";
import {
  TENANT_READ,
  GUARD,
  filesUnder,
  guardBefore,
  readCode,
  stripComments,
} from "@/lib/test-utils/source-shape";

/**
 * `requireSchool()` is staff-only — a regression guard for a LIVE PII leak.
 *
 * It authenticated and resolved an active school but performed NO role check, and 62 of the 82 pages
 * under `app/(app)` are gated by nothing else. Accepting a PARENT invite creates a real
 * `role_assignment`, so a claimed parent held an active school, passed the gate, and could open
 * `students/[id]` — blood group, allergies, conditions, medications, emergency contact.
 *
 * Two findings are baked into these assertions, both learned by getting it wrong first:
 *
 *  1. THE GUARD CANNOT LIVE IN THE LAYOUT. A redirect thrown from a layout does not stop the page
 *     rendering — layouts and pages render in parallel. A production build served a 307 to /wassce
 *     whose body still carried the health data. The check must sit where each page's own render
 *     calls it, before its own queries.
 *  2. ASSERT THE EXPRESSION, NEVER THE NAME. An earlier version compared `indexOf("getSessionId")`,
 *     which matched the IMPORT and passed however late the gate ran — the same trap as INCR-22c's
 *     ADV-3, reproduced inside the test written to prevent it.
 *  3. ASSERT THE CONSEQUENCE, NOT ONLY THE CONDITION — and read code, never comments. Both found on
 *     PR #176 by gate review, and both are the SAME trap one level deeper than (1) and (2):
 *       · Quinn kept the pinned `if` and deleted its `redirect`. The leak reopens in full and all
 *         668 tests stay green. So `GATE` now spans the condition THROUGH the redirect it must cause.
 *       · Dex found the sweep below matching guard/read names inside PROSE. A file whose docblock
 *         mentions `requireSchool()` above a genuinely unguarded read would certify clean — a false
 *         PASS, the dangerous direction. Everything here now reads comment-stripped source.
 */
const SERVER = "lib/auth/server.ts";

const src = () => readCode(SERVER);
// Condition THROUGH consequence: a gate that tests the right thing and then does nothing is not a gate.
const GATE =
  /if\s*\(\s*!opts\?\.allowNonStaff\s*&&\s*!\s*isStaff\s*\(\s*user\.roles\s*\)\s*\)\s*\{\s*redirect\s*\(/;

describe("requireSchool is staff-only by default", () => {
  it("carries the isStaff gate", () => {
    expect(src()).toMatch(GATE);
  });

  it("the gate runs before requireSchool returns — not after the caller has its school", () => {
    const s = src();
    const body = s.slice(s.indexOf("export async function requireSchool"));
    const gate = body.search(GATE);
    expect(gate, "requireSchool must carry the staff gate").toBeGreaterThan(-1);
    // The CALL SITE / statement, never a bare identifier that would also match an import.
    expect(gate).toBeLessThan(body.indexOf("return { user, school };"));
  });

  it("never redirects into app/(app) — /dashboard would loop", () => {
    const s = src();
    const body = s.slice(
      s.indexOf("export async function requireSchool"),
      s.indexOf("export async function requireSchoolRole"),
    );
    // Pull every string literal out of every redirect(...) in this function. Deliberately not a
    // clever regex over the argument shape: `includes("PARENT")` contains a `)`.
    const targets = [...body.matchAll(/redirect\(([\s\S]*?)\);/g)].flatMap((m) =>
      [...m[1].matchAll(/"(\/[^"]*)"/g)].map((lit) => lit[1]),
    );
    expect(targets.length).toBeGreaterThan(0);
    const inAppShell = readdirSync(resolve(cwd(), "app/(app)"), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => `/${e.name}`);
    for (const t of targets) {
      expect(inAppShell, `redirect target ${t} is inside (app) and would loop`).not.toContain(t);
    }
  });

  it("EXACTLY ONE caller opts out, and it is the parent's own statement PDF", () => {
    // The opt-out is the shipped INCR-19b parent reader, which proves ownership under
    // withParentScope before rendering. A second one appearing silently is the regression.
    //
    // Match the BARE IDENTIFIER, not `allowNonStaff: true`. Quinn reproduced the gap: a second caller
    // written `{ allowNonStaff: OPEN }` (or spread from a config) passed every test here. To set the
    // flag at all the identifier must appear in source, so this closes essentially the whole gap —
    // and a non-literal RHS is strictly MORE suspicious than `true`, not less.
    const roots = ["app", "lib", "components", "features", "hooks", "middleware.ts"];
    const hits: string[] = [];
    const scan = (p: string) => {
      if (p === SERVER) return; // the definition itself
      if (!/\.tsx?$/.test(p) || /\.test\.tsx?$/.test(p)) return;
      if (stripComments(readFileSync(resolve(cwd(), p), "utf8")).includes("allowNonStaff")) hits.push(p);
    };
    const walk = (dir: string) => {
      for (const e of readdirSync(resolve(cwd(), dir), { withFileTypes: true })) {
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(p);
        else scan(p);
      }
    };
    for (const r of roots) {
      if (!existsSync(resolve(cwd(), r))) continue;
      statSync(resolve(cwd(), r)).isDirectory() ? walk(r) : scan(r);
    }
    expect(hits).toEqual(["app/api/senior/readiness-statement/[id]/route.ts"]);
  });
});

/**
 * 🔴 THE GUARD-ORDERING INVARIANT — the thing that actually keeps the other 81 pages safe.
 *
 * Sarah's ruling on PR #176: the residual risk was never "61 pages leak" — they do not, because a
 * redirect awaited in a page's OWN render stops that page before its own fetch. The risk is that
 * *nothing enforced* the property making them safe. Page 83, or one fetch hoisted above a guard,
 * silently reopens the hole that let a claimed parent read a child's medications.
 *
 * So: every page and API route that opens a tenant read must await a `require*` guard FIRST.
 *
 * 🔴 THE "NOTHING TO GUARD" SKIP IS GONE (PR #180). It used to say: a file with no recognised tenant
 * read passes trivially. Dex measured the cost of that on PR #176 — 28 of 91 targets passed without
 * being checked at all — and Quinn then PROVED it exploitable on the sibling guard by shipping a
 * `grantRoleBackdoor` that used `withoutTenantScope`: it typechecked, built, passed the whole suite,
 * and handed a TEACHER `ADMIN` on a production build. A file whose data access the sweep cannot
 * RECOGNISE is exactly the case a backdoor falls into, so it can no longer be the case that passes
 * silently.
 *
 * The rule now: reach the database ⇒ guard first. Appear not to reach it ⇒ STILL carry a guard, or be
 * named in `NO_DB_ACCESS` by a human who looked. Of the 28, 26 already carried a guard and pass
 * unchanged; the two that did not are named below with their reasons.
 */
describe("every tenant read is preceded by an auth guard", () => {
  const targets = [
    ...filesUnder("app/(app)", /^page\.tsx$/),
    ...filesUnder("app/api", /^route\.ts$/),
  ];

  it("finds the routes it claims to check (the sweep is not vacuous)", () => {
    // If a refactor moves these, this test must fail loudly rather than pass over an empty set.
    // 91 today; pinned close enough to notice a mass move rather than merely a total wipe-out.
    expect(targets.length).toBeGreaterThan(85);
  });

  /**
   * Machine-to-machine routes have no user session by design. They are exempt from the `require*`
   * rule and subject to a stricter one instead (below): the shared-secret check must be the FIRST
   * thing the handler does. The list is explicit so adding one is a deliberate act, not a drift.
   */
  const SECRET_AUTHED = ["app/api/inbox/inbound/route.ts"];

  /**
   * The two targets that reach no database AND hold no session guard. Named, not skipped — each has
   * to be justifiable out loud, and a third appearing is a diff line someone must defend.
   *  · the promotion page delegates to `previewPromotion()`, which calls `requireSchool()` itself
   *    (`lib/actions/promotion.ts`) — guarded, just not in the file.
   *  · the cron health check has no session and no tenant data by design.
   */
  const NO_DB_ACCESS = [
    "app/(app)/settings/academic/promotion/page.tsx",
    "app/api/cron/health/route.ts",
  ];

  it("no page or route touches the database before awaiting a guard", () => {
    const offenders: string[] = [];
    for (const p of targets) {
      if (SECRET_AUTHED.includes(p) || NO_DB_ACCESS.includes(p)) continue;
      const v = guardBefore(readCode(p));
      if (!v.ok) offenders.push(`${p} (${v.why})`);
    }
    expect(offenders, "these read tenant data before (or without) an auth guard").toEqual([]);
  });

  it("the NO_DB_ACCESS exemptions are still earned — none of them has grown a database read", () => {
    // An exemption that silently starts querying is the failure this list would otherwise cause.
    for (const p of NO_DB_ACCESS) {
      expect(targets, `${p} is exempted but no longer swept`).toContain(p);
      expect(
        readCode(p),
        `${p} now reaches the database — it must guard, or leave this list`,
      ).not.toMatch(TENANT_READ);
    }
  });

  it("every secret-authed exemption actually checks its secret, REFUSES, and does both before reading", () => {
    // The exemption must be earned. This is what stops the list becoming a way to opt out of the
    // invariant: an entry that stops verifying its secret fails here rather than passing silently.
    //
    // Deliberately NOT pinned to `!==`. The earlier version required that exact comparison, so
    // swapping in `crypto.timingSafeEqual` — strictly better — would have failed (Dex). A test that
    // penalises the safer implementation gets worked around instead of updated. What must hold is
    // only: the condition consults the secret, and the block REFUSES.
    for (const p of SECRET_AUTHED) {
      const src = readCode(p);
      const m = /if\s*\([\s\S]{0,200}?env\.\w*SECRET\w*[\s\S]{0,200}?\)\s*\{/.exec(src);
      expect(m, `${p}: expected a shared-secret check consulting env.*SECRET*`).not.toBeNull();
      const check = m!.index;
      // Quinn kept the `if` and deleted its 401: the webhook opened completely, suite stayed green.
      expect(
        src.slice(check, check + 300),
        `${p}: the secret check must FAIL CLOSED — refuse with 401/403`,
      ).toMatch(/\b40[13]\b/);
      const read = src.search(TENANT_READ);
      expect(read, `${p}: this route is exempted because it READS under a shared secret`).toBeGreaterThan(-1);
      expect(check, `${p}: secret check must precede the tenant read`).toBeLessThan(read);
    }
  });
});

describe("isStaff has the polarity a shell guard needs", () => {
  // Fail-OPEN for unknown roles, fail-CLOSED for the two known non-staff ones. Across 104 call sites
  // that is the safe direction: a newly-added staff role still works, rather than the bursar being
  // locked out on Monday morning.
  it("STUDENT-only and PARENT-only sessions are not staff", () => {
    expect(isStaff(["PARENT"])).toBe(false);
    expect(isStaff(["STUDENT"])).toBe(false);
    expect(isStaff(["STUDENT", "PARENT"])).toBe(false);
    expect(isStaff([])).toBe(false);
  });

  it("a staff member who is ALSO a parent passes — common, and must keep working", () => {
    expect(isStaff(["TEACHER", "PARENT"])).toBe(true);
    expect(isStaff(["PARENT", "MATRON"])).toBe(true);
  });

  it("every known staff role passes, and an unknown role is admitted rather than locked out", () => {
    for (const r of [
      "ADMIN",
      "HEADMASTER",
      "VICE_HEADMASTER_ACADEMIC",
      "TEACHER",
      "FORM_MASTER",
      "HOUSEMASTER",
      "BURSAR",
      "ACCOUNTANT",
      "DEAN_OF_BOARDING",
      "MATRON",
    ]) {
      expect(isStaff([r]), r).toBe(true);
    }
    expect(isStaff(["SOME_FUTURE_ROLE"])).toBe(true);
  });
});
