import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
import { isStaff } from "@/lib/access";

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
 */
const SERVER = "lib/auth/server.ts";
const src = () => readFileSync(resolve(cwd(), SERVER), "utf8");
const GATE = /if\s*\(\s*!opts\?\.allowNonStaff\s*&&\s*!\s*isStaff\s*\(\s*user\.roles\s*\)\s*\)/;

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
    const roots = ["app", "lib", "components", "features"];
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(resolve(cwd(), dir), { withFileTypes: true })) {
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
          if (readFileSync(resolve(cwd(), p), "utf8").includes("allowNonStaff: true")) hits.push(p);
        }
      }
    };
    for (const r of roots) walk(r);
    expect(hits).toEqual(["app/api/senior/readiness-statement/[id]/route.ts"]);
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
