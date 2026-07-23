import { describe, it, expect } from "vitest";
import { hasAnyRole, SICKBAY_CLINICAL_WRITE_ROLES } from "@/lib/access";
import { readCode, TENANT_READ } from "@/lib/test-utils/source-shape";

/**
 * 🔴 Chronic-register WRITES are MATRON-only (R39/R111 — the Headmaster READS the register but must
 * never author a care plan). This pins the app-layer half of the boundary; the DB `WITH CHECK`
 * (`chronic_clinical_role(...) = 'MATRON'`) is the other half, and on dev the app connects as a
 * superuser so the app gate is the only boundary a preview exercises.
 *
 * ADV-3 — ASSERT THE EXPRESSION, NEVER THE NAME. A bare `indexOf("authorizeChronicWrite")` also
 * matches a comment or a mis-shaped gate, so this file pins (a) the CALL as each mutator's first
 * statement, before any DB access, and (b) the DEFINITION's actual role check + refusal.
 */
const ACTIONS = "lib/actions/sickbay-chronic.ts";

const EXPORTED_FN =
  /^export (?:default\s+async function (\w+)|async function (\w+)|const (\w+)\s*=\s*async)/gm;
const EXPECTED = ["createChronicEntry", "editChronicEntry", "addChronicMed", "removeChronicMed"];

/** The gate CALL — a real invocation, not the identifier alone. */
const GATE_CALL = /\bconst auth = await authorizeChronicWrite\(\)/;

describe("every chronic-register mutator asserts the MATRON gate before touching the DB", () => {
  const src = () => readCode(ACTIONS);
  const exportsOf = (s: string) =>
    [...s.matchAll(EXPORTED_FN)].map((m) => ({ name: m[1] ?? m[2] ?? m[3], i: m.index! }));

  it("exposes no re-exports — a barrel would smuggle in a callable action this sweep never reads", () => {
    expect(src()).not.toMatch(/^export\s*(?:\{|\*)/m);
  });

  it("the mutator list is EXACT — a fifth action is a change to this file, not a silent addition", () => {
    expect(exportsOf(src()).map((e) => e.name).sort()).toEqual([...EXPECTED].sort());
  });

  it("no mutator reads the database before the gate call", () => {
    const s = src();
    const marks = exportsOf(s);
    const offenders: string[] = [];
    marks.forEach((m, i) => {
      const body = s.slice(m.i, i + 1 < marks.length ? marks[i + 1].i : s.length);
      const gate = body.search(GATE_CALL);
      const read = body.search(TENANT_READ);
      // Every action opens a withStaffScope tx; the gate must precede it. An unrecognised shape is an
      // OFFENDER, never a pass (the staff-authz `if (read === -1) return` hatch is deliberately absent).
      if (gate === -1 || read === -1 || gate > read) offenders.push(m.name);
    });
    expect(offenders, "these mutate without asserting the MATRON gate first").toEqual([]);
  });

  it("the gate is the mutator's FIRST statement, at base indent, nested inside nothing", () => {
    const s = src();
    const all = [...s.matchAll(new RegExp(GATE_CALL, "g"))];
    expect(all.length, "the gate must appear once per mutator").toBe(EXPECTED.length);
    for (const m of all) {
      const from = s.lastIndexOf("\n", m.index!) + 1;
      expect(
        s.slice(from, m.index! + m[0].length),
        "the gate must sit at the function's base indent (an `if`/flag wrapper would show a wider indent)",
      ).toMatch(/^ {2}const auth = await authorizeChronicWrite\(\)/);
    }
  });

  it("authorizeChronicWrite REFUSES on the ROLE EXPRESSION — not the name, and it must return ok:false", () => {
    const s = src();
    // The gate is defined in THIS file (not imported), so pin its body's actual logic.
    const decl = s.slice(s.indexOf("async function authorizeChronicWrite"));
    const body = decl.slice(0, decl.indexOf("\n}"));
    // The EXPRESSION: it tests the caller's roles against the MATRON-only write set…
    expect(body, "the gate must test roles against SICKBAY_CLINICAL_WRITE_ROLES").toMatch(
      /!\s*hasAnyRole\s*\(\s*user\.roles\s*,\s*SICKBAY_CLINICAL_WRITE_ROLES\s*\)/,
    );
    // …and the CONSEQUENCE: it refuses (returns ok:false), not merely evaluates a condition.
    expect(body, "the gate must REFUSE when the role check fails").toMatch(
      /if\s*\([\s\S]*?\)\s*\{[\s\S]*?return\s*\{[\s\S]*?ok:\s*false/,
    );
  });
});

describe("SICKBAY_CLINICAL_WRITE_ROLES has the MATRON-only polarity a clinical author needs", () => {
  it("admits the Matron and refuses the Headmaster and the Admin", () => {
    expect(hasAnyRole(["MATRON"], SICKBAY_CLINICAL_WRITE_ROLES)).toBe(true);
    expect(hasAnyRole(["HEADMASTER"], SICKBAY_CLINICAL_WRITE_ROLES)).toBe(false);
    expect(hasAnyRole(["ADMIN"], SICKBAY_CLINICAL_WRITE_ROLES)).toBe(false);
  });

  it("refuses a HOUSEMASTER, a plain staffer, and an empty session", () => {
    expect(hasAnyRole(["HOUSEMASTER"], SICKBAY_CLINICAL_WRITE_ROLES)).toBe(false);
    expect(hasAnyRole(["TEACHER"], SICKBAY_CLINICAL_WRITE_ROLES)).toBe(false);
    expect(hasAnyRole([], SICKBAY_CLINICAL_WRITE_ROLES)).toBe(false);
  });

  it("a matron who also teaches still authors", () => {
    expect(hasAnyRole(["TEACHER", "MATRON"], SICKBAY_CLINICAL_WRITE_ROLES)).toBe(true);
  });
});
