import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";

/**
 * INCR-47 (Quinn) — proves the AC "every PLC config-write action re-checks PLC_CONFIG_WRITE_ROLES
 * server-side, not just the page". The page hides the controls for a read-only staffer, but a
 * hand-crafted POST that never touched the UI must still be refused. The existing plc-setup.test.ts
 * proves the CONTENTS of the write set (PD_COORDINATOR/ADMIN/HEADMASTER, VHA excluded) but NOT that
 * each mutation is actually wired to it — that gap is exactly the [[builds-widen-ratified-authz-and-self-bless]]
 * failure mode (a green suite that never touches the real boundary). This is a source guard (the same
 * shape as audit-classification.test.ts): a mutation that drops the gate reds the build.
 */
const src = readFileSync(resolve(cwd(), "lib/actions/plc.ts"), "utf8");

// Every exported PLC config-write server action shares the `(input: unknown): Promise<Result>` shape.
const ACTIONS = [
  ...src.matchAll(/export async function (\w+)\(input: unknown\): Promise<Result>/g),
].map((m) => ({ name: m[1], start: m.index ?? -1 }));

describe("PLC config write gate is re-checked in EVERY server action (R367)", () => {
  it("found the exported write actions (self-check — not an empty/broken sweep)", () => {
    expect(ACTIONS.length).toBeGreaterThanOrEqual(10);
    const names = ACTIONS.map((a) => a.name);
    expect(names).toContain("updatePlcCadence");
    expect(names).toContain("createPlc");
    expect(names).toContain("setPlcTermFocus");
  });

  it("🔴 the shared gate calls assertAnyRole(PLC_CONFIG_WRITE_ROLES) — the real server boundary", () => {
    expect(src).toMatch(/await assertAnyRole\(PLC_CONFIG_WRITE_ROLES\)/);
  });

  it("🔴 EVERY write action gates via authorizePlcWrite() BEFORE any DB work (withSchool)", () => {
    const sorted = [...ACTIONS].sort((a, b) => a.start - b.start);
    for (let i = 0; i < sorted.length; i++) {
      const start = sorted[i].start;
      const end = i + 1 < sorted.length ? sorted[i + 1].start : src.length;
      const body = src.slice(start, end);
      const gateAt = body.indexOf("await authorizePlcWrite()");
      const dbAt = body.indexOf("withSchool(");
      expect(gateAt, `${sorted[i].name} never calls authorizePlcWrite()`).toBeGreaterThan(-1);
      if (dbAt > -1) {
        expect(gateAt, `${sorted[i].name} opens a DB tx before the gate`).toBeLessThan(dbAt);
      }
    }
  });
});
