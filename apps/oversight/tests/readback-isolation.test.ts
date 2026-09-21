import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Kofi group A — THE ISOLATION GUARD.
 *
 * The operational read-back must be reachable from the gated path and from nowhere else. This is
 * the property that keeps "the analytics DB holds no individuals" true in practice rather than in
 * principle: it does not matter that the aggregates database contains no names if any aggregate
 * route can open a connection to the database that does.
 *
 * Two checks, because one is not enough:
 *   1. DIRECT IMPORTS must match an explicit allow-list. A new importer fails the suite and has to
 *      be argued for in review, which is the point.
 *   2. TRANSITIVE REACHABILITY from every App-Router entry point (`page.tsx`, `route.ts`,
 *      `layout.tsx`, `actions.ts`). Direct-import checks miss the interesting case — an aggregate
 *      page importing an innocuous-looking helper that imports the gate three hops down.
 *
 * ESLint's `no-restricted-imports` (see .eslintrc.json) catches case 1 in the editor. This test
 * catches it when someone adds an `eslint-disable`, and it is the only one of the two that can see
 * case 2 at all.
 */

const ROOT = process.cwd();
const READBACK_SPECIFIERS = [
  "@/lib/db/readback",
  "lib/db/readback",
  "./readback",
  "../db/readback",
];

/** Modules permitted to touch the read-back — the gated path, and nothing else. */
const ALLOWED_DIRECT_IMPORTERS = [
  "lib/oversight/named-record-access.ts", // the choke point
  "lib/oversight/consent.ts", // type-only: the transaction handle
  "lib/oversight/staff-projection.ts", // type-only: the transaction handle
  "app/(oversight)/compliance-records/actions.ts", // the gate's server actions
].sort();

/**
 * App-Router entry points that ARE allowed to reach the read-back transitively.
 *
 * `[accessId]/page.tsx` is DELIBERATELY NOT HERE. The audit-entry view renders the logged entry
 * from the analytics DB; if it ever reached the read-back it would be re-opening the record it
 * describes, which is either an unlogged fetch or an audit row per page view.
 */
const GATED_ENTRY_POINTS = [
  "app/(oversight)/compliance-records/actions.ts",
  "app/(oversight)/compliance-records/new/page.tsx",
  "app/(oversight)/compliance-records/staff-list/page.tsx",
];

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".next" || entry === "tests") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const SOURCE_DIRS = ["lib", "app", "components"].map((d) => join(ROOT, d));
const ALL_SOURCES = SOURCE_DIRS.flatMap((d) => walk(d));

function importSpecifiers(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const specs: string[] = [];
  const re = /(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) specs.push(m[1]!);
  return specs;
}

function isReadbackSpecifier(spec: string): boolean {
  return READBACK_SPECIFIERS.includes(spec) || /(^|\/)lib\/db\/readback$/.test(spec);
}

/** Resolve an import specifier to a project file, or null for a package / unresolvable path. */
function resolveSpecifier(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null;
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      /* not this one */
    }
  }
  return null;
}

function reachesReadback(entry: string, seen = new Set<string>()): boolean {
  if (seen.has(entry)) return false;
  seen.add(entry);
  for (const spec of importSpecifiers(entry)) {
    if (isReadbackSpecifier(spec)) return true;
    const resolved = resolveSpecifier(entry, spec);
    if (resolved && reachesReadback(resolved, seen)) return true;
  }
  return false;
}

describe("no aggregate code may import the operational read-back", () => {
  it("direct importers match the allow-list exactly", () => {
    const importers = ALL_SOURCES.filter(
      (f) =>
        relative(ROOT, f) !== "lib/db/readback.ts" &&
        importSpecifiers(f).some(isReadbackSpecifier),
    )
      .map((f) => relative(ROOT, f))
      .sort();
    expect(importers).toEqual(ALLOWED_DIRECT_IMPORTERS);
  });

  it("no App-Router entry point outside the gate reaches it, even transitively", () => {
    const entries = ALL_SOURCES.filter((f) =>
      /(^|\/)(page|layout|route|actions)\.(ts|tsx)$/.test(relative(ROOT, f)),
    );
    const offenders = entries
      .map((f) => relative(ROOT, f))
      .filter((rel) => !GATED_ENTRY_POINTS.includes(rel))
      .filter((rel) => reachesReadback(join(ROOT, rel)));
    expect(offenders).toEqual([]);
  });

  it("the NON-gated facilities surface does not reach it", () => {
    // Lucy C5 is school infrastructure read across the analytics boundary. If it ever imported the
    // read-back, the "not gated" claim would become "not gated, but touching operational data".
    expect(reachesReadback(join(ROOT, "lib/oversight/infrastructure.ts"))).toBe(false);
  });

  it("the suppression helper and the field-scope map are pure — no DB import at all", () => {
    for (const pure of ["lib/oversight/suppression.ts", "lib/oversight/field-scope.ts"]) {
      const specs = importSpecifiers(join(ROOT, pure));
      expect(
        specs.filter((s) => /db|postgres|drizzle/i.test(s)),
        `${pure}`,
      ).toEqual([]);
    }
  });
});
