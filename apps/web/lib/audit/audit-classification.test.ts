import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
import { REDACTED_AUDIT_ENTITIES, SHOWN_AUDIT_ENTITIES, isRedactedAuditEntity } from "./redaction";

/**
 * INCR-30 follow-up — the classify-at-creation audit CI guard (Sarah's standing mitigation for the
 * hybrid deny-list's future-non-namespaced-entity residual, R239/R244).
 *
 * `/settings/audit` renders to ALL staff. The redaction posture is a HYBRID deny-list (the `sickbay_`
 * prefix + 9 enumerated). Its residual: a FUTURE non-namespaced sensitive audited entity could ship
 * SHOWN by omission. This sweep enumerates EVERY audited `entityType` literal in the app source and
 * FAILS the build if one is neither redacted (`isRedactedAuditEntity`) nor explicitly in
 * `SHOWN_AUDIT_ENTITIES` — forcing every new audited entity to be classified at creation.
 *
 * No production behaviour change: a registry + this guard. `isRedactedAuditEntity` is untouched.
 */

// Comments are NOT code: an entityType NAMED in prose (this repo documents entity names constantly)
// must not be mistaken for a real audit write. Strip block + trailing `//` comments; `[^:]` spares
// `https://`.
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * The whole-repo sweep. Reuse the visit-copy.test.ts source walker: every `.ts`/`.tsx` under the app
 * roots, TEST FILES EXCLUDED (so this file's and the AC feed test's synthetic `entityType` literals
 * never pollute the discovered set). Match the audit-write key form `entityType: "<name>"` only —
 * SELECT reads (`entityType: auditLog.entityType`) and type decls (`entityType: string`) don't match.
 */
const discovered = (() => {
  const set = new Set<string>();
  const walk = (dir: string) => {
    for (const e of readdirSync(resolve(cwd(), dir), { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
        const code = stripComments(readFileSync(resolve(cwd(), p), "utf8"));
        for (const m of code.matchAll(/entityType:\s*"([a-z_0-9]+)"/g)) set.add(m[1]);
      }
    }
  };
  for (const root of ["app", "components", "db", "features", "hooks", "lib", "scripts"]) walk(root);
  return set;
})();

describe("audit classify-at-creation guard · every audited entityType is redact-or-show", () => {
  it("the sweep found the audited entities (self-check — not an empty/broken run)", () => {
    expect(discovered.size).toBeGreaterThan(50);
    // A known-redacted and a known-shown one are both really present, or the sweep is lying.
    expect(discovered.has("sickbay_visit")).toBe(true);
    expect(discovered.has("student")).toBe(true);
  });

  it("🔴 every discovered entityType is REDACTED or SHOWN — a new one FAILS actionably", () => {
    const unclassified = [...discovered].filter(
      (e) => !isRedactedAuditEntity(e) && !SHOWN_AUDIT_ENTITIES.has(e),
    );
    // One failure lists ALL offenders, each with the fix.
    expect(
      unclassified,
      unclassified
        .map(
          (e) =>
            `Audited entityType '${e}' is not classified — add it to REDACTED_AUDIT_ENTITIES ` +
            `(clinical/pay/discipline/marks — read-gated narrower than all-staff) or ` +
            `SHOWN_AUDIT_ENTITIES (operational), per R237/INCR-30.`,
        )
        .join("\n"),
    ).toEqual([]);
  });

  it("🔴 REDACTED ∩ SHOWN = ∅, and no SHOWN entry is a `sickbay_*` (shown ≠ redacted)", () => {
    for (const e of SHOWN_AUDIT_ENTITIES) {
      expect(REDACTED_AUDIT_ENTITIES.has(e), `${e} is in BOTH sets`).toBe(false);
      expect(e.startsWith("sickbay_"), `${e} is a redacted sickbay_* — cannot be SHOWN`).toBe(false);
      // The strongest form of the invariant: the predicate itself must not redact a SHOWN entity.
      expect(isRedactedAuditEntity(e), `${e} is SHOWN yet the predicate redacts it`).toBe(false);
    }
  });

  it("🔴 the guard BITES: a hypothetical new non-sickbay entityType is UNCLASSIFIED (fail-safe proof)", () => {
    const fake = "brand_new_unclassified_thing";
    // Neither side claims it → the forward gate above would red the build if it were ever written.
    expect(isRedactedAuditEntity(fake)).toBe(false);
    expect(SHOWN_AUDIT_ENTITIES.has(fake)).toBe(false);
  });

  it("no stale SHOWN entries (soft — a removed entity is harmless, so warn, never fail)", () => {
    const stale = [...SHOWN_AUDIT_ENTITIES].filter((e) => !discovered.has(e));
    if (stale.length) {
      // A stale SHOWN entry is over-permissive on a non-existent entity — no leak. Do NOT hard-fail:
      // that would break on a legitimately-removed entity. The FORWARD gate is the hard one.
      // eslint-disable-next-line no-console
      console.warn(`SHOWN_AUDIT_ENTITIES has stale entr(ies) no longer audited: ${stale.join(", ")}`);
    }
    expect(stale.every((e) => typeof e === "string")).toBe(true);
  });
});
