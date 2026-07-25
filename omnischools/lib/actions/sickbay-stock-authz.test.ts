import { describe, it, expect } from "vitest";
import { hasAnyRole, SICKBAY_STOCK_WRITE_ROLES } from "@/lib/access";
import { readCode, TENANT_READ } from "@/lib/test-utils/source-shape";

/**
 * 🔴 §3 WRITES (standing orders / stock / the controlled ledger) are [ADMIN, MATRON] (R165 — the ONE
 * gate the MATRON gains and the HEADMASTER loses). This pins the app-layer boundary; on dev the app
 * connects as a superuser, so the app gate is the only boundary a preview exercises.
 *
 * ADV-3 — ASSERT THE EXPRESSION, NEVER THE NAME. This pins (a) the gate CALL as each mutator's first
 * statement, before any DB access, and (b) the DEFINITION's actual role check + refusal.
 */
const ACTIONS = "lib/actions/sickbay-stock.ts";

const EXPORTED_FN =
  /^export (?:default\s+async function (\w+)|async function (\w+)|const (\w+)\s*=\s*async)/gm;
const EXPECTED = [
  "createStandingOrder",
  "editStandingOrder",
  "setStandingOrderActive",
  "createStockItem",
  "editStockItem",
  "recordControlledMovement",
];
const GATE_CALL = /\bconst auth = await authorizeStockWrite\(\)/;

describe("every §3 mutator asserts the [ADMIN, MATRON] gate before touching the DB", () => {
  const src = () => readCode(ACTIONS);
  const exportsOf = (s: string) =>
    [...s.matchAll(EXPORTED_FN)].map((m) => ({ name: m[1] ?? m[2] ?? m[3], i: m.index! }));

  it("exposes no re-exports — a barrel would smuggle in a callable action this sweep never reads", () => {
    expect(src()).not.toMatch(/^export\s*(?:\{|\*)/m);
  });

  it("the mutator list is EXACT — a seventh action is a change to this file, not a silent addition", () => {
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
      if (gate === -1 || read === -1 || gate > read) offenders.push(m.name);
    });
    expect(offenders, "these mutate without asserting the §3 gate first").toEqual([]);
  });

  it("the gate is each mutator's FIRST statement, at base indent, nested inside nothing", () => {
    const s = src();
    const all = [...s.matchAll(new RegExp(GATE_CALL, "g"))];
    expect(all.length, "the gate must appear once per mutator").toBe(EXPECTED.length);
    for (const m of all) {
      const from = s.lastIndexOf("\n", m.index!) + 1;
      expect(s.slice(from, m.index! + m[0].length)).toMatch(
        /^ {2}const auth = await authorizeStockWrite\(\)/,
      );
    }
  });

  it("authorizeStockWrite REFUSES on the ROLE EXPRESSION (SICKBAY_STOCK_WRITE_ROLES), returning ok:false", () => {
    const s = src();
    const decl = s.slice(s.indexOf("async function authorizeStockWrite"));
    const body = decl.slice(0, decl.indexOf("\n}"));
    expect(body).toMatch(/!\s*hasAnyRole\s*\(\s*user\.roles\s*,\s*SICKBAY_STOCK_WRITE_ROLES\s*\)/);
    expect(body).toMatch(/if\s*\([\s\S]*?\)\s*\{[\s\S]*?return\s*\{[\s\S]*?ok:\s*false/);
  });
});

describe("R152 · controlled movements — witness rule + append-only, in the ACTION not just the UI", () => {
  const src = () => readCode(ACTIONS);

  it("a controlled WASTAGE requires a witness, and the witness passes assertSchoolClinician{requireNmc}", () => {
    const s = src();
    expect(s).toMatch(/movementType === "WASTAGE"/);
    expect(s).toMatch(/assertSchoolClinician\(\s*auth\.schoolId,\s*witnessId,\s*\{\s*requireNmc:\s*true\s*\}\s*\)/);
  });

  it("the witness cannot be the recorder (self-witness refused — the diversion premise)", () => {
    expect(src()).toMatch(/witnessId === auth\.actor\.id/);
  });

  it("🔴 APPEND-ONLY — no movement is ever updated or deleted (a correction is a new ADJUSTMENT)", () => {
    const s = src();
    expect(s, "no movement UPDATE").not.toMatch(/\.update\(\s*sickbayControlledMovement/);
    expect(s, "no movement DELETE").not.toMatch(/\.delete\(\s*sickbayControlledMovement/);
  });
});

describe("🔴 Risk 4 (R162) — NO student anywhere on the §3 write path or readers", () => {
  it("the §3 actions carry no student column", () => {
    expect(readCode(ACTIONS), "a student on a §3 write is a re-identification").not.toMatch(/student/i);
  });

  it("the §3 readers select no student column, and the balance JOINs the MAR (not a stored count)", () => {
    const s = readCode("lib/sickbay/stock-reads.ts");
    expect(s, "the readers must never select a student").not.toMatch(/student/i);
    expect(s, "the derived balance reads the MAR").toContain("sickbayMedAdmin");
  });
});

describe("SICKBAY_STOCK_WRITE_ROLES admits [ADMIN, MATRON] and refuses the rest", () => {
  it("admits the Admin and the Matron; refuses the Headmaster, Housemaster and empty session", () => {
    expect(hasAnyRole(["ADMIN"], SICKBAY_STOCK_WRITE_ROLES)).toBe(true);
    expect(hasAnyRole(["MATRON"], SICKBAY_STOCK_WRITE_ROLES)).toBe(true);
    expect(hasAnyRole(["HEADMASTER"], SICKBAY_STOCK_WRITE_ROLES)).toBe(false);
    expect(hasAnyRole(["HOUSEMASTER"], SICKBAY_STOCK_WRITE_ROLES)).toBe(false);
    expect(hasAnyRole([], SICKBAY_STOCK_WRITE_ROLES)).toBe(false);
  });
});
