import { describe, it, expect } from "vitest";
import { readCode } from "@/lib/test-utils/source-shape";

/**
 * R167(b)/(d) — the two carried TOCTOU fixes. A behavioural proof needs two concurrent DB transactions
 * a pure suite cannot stage, so this pins the STRUCTURE the fix is (ADV-3, the expression not the name):
 * the read that a validation depends on now happens INSIDE the write transaction, under a row lock, so
 * a second actor cannot commit against a set the first has already changed.
 */

/** Slice a named `export async function` body out to the next top-level export. */
function fnBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}`);
  if (start === -1) throw new Error(`fn ${name} not found`);
  const rest = src.slice(start + 1);
  const nextExport = rest.search(/\nexport (?:async function|const|default)/);
  return rest.slice(0, nextExport === -1 ? undefined : nextExport);
}

describe("R167(b) · slot-edit validation reads FOR UPDATE inside the tx (was read stale, outside)", () => {
  const src = () => readCode("lib/actions/sickbay-config.ts");

  it("the shared in-tx reader locks the slot set with FOR UPDATE", () => {
    const s = src();
    const at = s.indexOf("function lockSlotsForUpdate");
    expect(at, "lockSlotsForUpdate is defined").toBeGreaterThan(-1);
    expect(s.slice(at, at + 1200), "the reader must take a row lock").toContain('.for("update")');
  });

  for (const fn of ["updateScheduleSlot", "toggleScheduleSlot"] as const) {
    it(`${fn} validates ordering INSIDE withSchool, on the locked read`, () => {
      const body = fnBody(src(), fn);
      const tx = body.indexOf("withSchool(");
      const lock = body.indexOf("lockSlotsForUpdate(");
      const validate = body.indexOf("validateRoundOrdering(");
      const update = body.indexOf(".update(sickbayScheduleSlot)");
      expect(tx, "opens a withSchool tx").toBeGreaterThan(-1);
      // the locked read, then the validation, then the write — all after the tx opens, in order.
      expect(lock, "reads the slot set inside the tx").toBeGreaterThan(tx);
      expect(validate, "validates AFTER the locked read").toBeGreaterThan(lock);
      expect(update, "writes AFTER validating").toBeGreaterThan(validate);
    });

    it(`${fn} no longer reads getScheduleSlots before validating (the stale-read bug)`, () => {
      const body = fnBody(src(), fn);
      const stale = body.indexOf("getScheduleSlots(");
      const validate = body.indexOf("validateRoundOrdering(");
      // either no getScheduleSlots at all, or it does not precede the validation.
      expect(stale === -1 || stale > validate).toBe(true);
    });
  }
});

describe("R167(d) · admitPatient reads the admissions capability + the bed inside the tx, bed FOR UPDATE", () => {
  const src = () => readCode("lib/actions/sickbay-visit.ts");

  it("the mode read and the bed read sit INSIDE withSchool, and the bed is locked", () => {
    const body = fnBody(src(), "admitPatient");
    const tx = body.indexOf("withSchool(");
    const mode = body.indexOf("sickbaySettings");
    const bedLock = body.indexOf('.for("update")');
    expect(tx).toBeGreaterThan(-1);
    expect(mode, "the admissions capability is derived from an in-tx mode read").toBeGreaterThan(tx);
    expect(bedLock, "the bed row is locked FOR UPDATE inside the tx").toBeGreaterThan(tx);
  });

  it("admitPatient no longer reads getSickbayConfig outside the tx (it is gone from the file)", () => {
    expect(src(), "the outside-tx config read is removed").not.toContain("getSickbayConfig");
  });
});
