import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";

/**
 * Shared primitives for the repo's SOURCE-SHAPE security guards.
 *
 * These tests assert that code has a given *shape* — a guard call before a tenant read — rather than
 * a behaviour. That is the right instrument for an invariant about ordering across ~90 files (a
 * behavioural version needs a fixture, a DB and a session per role, and gets abandoned within two
 * increments), but it only works if every guard reads the source the same way.
 *
 * It exists because they did NOT. Three copies of `stripComments` drifted, and `TENANT_READ` was
 * defined twice with the WIDER one on the SMALLER sweep: `staff-authz.test.ts` (9 actions) learned
 * from Quinn's `withoutTenantScope` backdoor and widened; `app-shell-guard.test.ts` (91 pages) kept
 * the narrow one and the `if (read === -1) continue` hatch that backdoor walked through. A hardening
 * has to land once, in one place, or the guard with ten times the blast radius is the one left stale.
 *
 * `lib/sickbay/board-copy.test.ts` deliberately keeps its own stripper: it strips MARKUP from surface
 * HTML for a copy-fidelity check, which is a different job with different edge cases.
 */

/**
 * Strip comments so an assertion matches CODE.
 *
 * Two lessons are baked in, both from real false passes:
 *  · Dex found `app/api/senior/readiness-statement/[id]/route.ts` matching `withParentScope` inside
 *    PROSE. A file whose docblock names a guard above a genuinely unguarded read certified clean —
 *    a false PASS, the dangerous direction.
 *  · `(?<!:)` keeps `https://…` inside a string literal from swallowing the rest of its line. Without
 *    it the stripper erases a real `withSchool(` and turns "no tenant read here" into exactly the
 *    silent skip this module exists to remove.
 */
export const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\/|(?<!:)\/\/.*$/gm, "");

/** Read a repo-relative path as comment-stripped source. */
export const readCode = (p: string): string =>
  stripComments(readFileSync(resolve(cwd(), p), "utf8"));

/**
 * Anything that reaches the database.
 *
 * Deliberately wider than the four `with*` helpers, and matching `.` as well as `(`. Quinn shipped a
 * `grantRoleBackdoor` using `withoutTenantScope` that typechecked, built, passed the whole suite and
 * handed a TEACHER `ADMIN` on a production build — `withoutTenantScope` is not a strawman, it is the
 * idiom `invites.ts` and `onboarding.ts` already use for the `role_assignment` writes that ARE the
 * escalation. `db` catches nothing today (measured: 0 of 91); it is there so a page reaching past the
 * RLS helpers to the raw driver — which would be UNTENANTED, worse than merely unguarded — is visible
 * the day someone writes one.
 */
export const TENANT_READ =
  /\b(withSchool|withParentScope|withoutTenantScope|withStaffScope|db)\s*[.(]/;

/** The session guards. Every one of them resolves identity before returning. */
export const GUARD = /\b(requireSchool|requireSchoolRole|requireParent|requireUser)\s*\(/;

/** Walk a directory, returning repo-relative paths whose basename matches. */
export function filesUnder(dir: string, match: RegExp): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(resolve(cwd(), d), { withFileTypes: true })) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (match.test(e.name)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

export type GuardVerdict =
  | { ok: true; why: "guarded" | "no-db-access-but-guarded" }
  | { ok: false; why: "reads-before-guard" | "reads-unguarded" | "no-guard-at-all" };

/**
 * Does this source prove a guard runs before it touches the database?
 *
 * 🔴 THERE IS NO "NOTHING TO GUARD" SKIP, and that absence is the whole point. The previous form —
 * `if (read === -1) continue` — meant a file whose data access the sweep could not RECOGNISE passed
 * silently, which is precisely the case a new backdoor falls into. A file that reaches the database
 * must guard first; a file that appears not to reach it must STILL carry a guard, or be named in an
 * explicit exemption list by a human who looked at it.
 */
export function guardBefore(code: string): GuardVerdict {
  const read = code.search(TENANT_READ);
  const guard = code.search(GUARD);
  if (guard === -1) return { ok: false, why: read === -1 ? "no-guard-at-all" : "reads-unguarded" };
  if (read === -1) return { ok: true, why: "no-db-access-but-guarded" };
  return guard < read ? { ok: true, why: "guarded" } : { ok: false, why: "reads-before-guard" };
}
