import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
import { canFacilitatePlcSession, PLC_SESSION_BREAKGLASS_ROLES } from "@/lib/access";

/**
 * INCR-48 (Quinn/Sarah) — the module's ONE IDOR fence (R384). Two guards:
 *   1. A LIVE behavioural assert that `canFacilitatePlcSession` admits NO bare role alone (the
 *      [[builds-widen-ratified-authz-and-self-bless]] trap) — only the identity match or a break-glass role.
 *   2. A SOURCE guard (the shape of audit-classification.test.ts / plc-write-gate.test.ts) proving every
 *      session write action actually WIRES the gate: facilitator writes re-check `canFacilitatePlcSession`
 *      with a SERVER-loaded facilitator id (never from the request), attendance/agenda refuse-after-lock,
 *      and the member reflection submit derives its identity from the actor + is window-bound. A mutation
 *      that drops any of these reds the build.
 */

describe("canFacilitatePlcSession (R384) — no role alone satisfies the facilitator arm", () => {
  const facilitator = "user-1";
  const other = "user-2";

  it("TRUE only for the identity match or a break-glass role", () => {
    expect(canFacilitatePlcSession(["TEACHER"], facilitator, facilitator)).toBe(true); // identity
    expect(canFacilitatePlcSession(["PD_COORDINATOR"], other, facilitator)).toBe(true); // break-glass
    expect(canFacilitatePlcSession(["HEADMASTER"], other, facilitator)).toBe(true); // break-glass
  });

  it("🔴 NO bare role (TEACHER/FORM_MASTER/VHA/ADMIN, no identity) is admitted", () => {
    for (const role of ["TEACHER", "FORM_MASTER", "VICE_HEADMASTER_ACADEMIC", "ADMIN"]) {
      expect(canFacilitatePlcSession([role], other, facilitator)).toBe(false);
    }
    // a null facilitator id never lets a non-break-glass caller through (both-null guard)
    expect(canFacilitatePlcSession(["TEACHER"], facilitator, null)).toBe(false);
    // break-glass is exactly [PD_COORDINATOR, HEADMASTER] — VHA & ADMIN excluded
    expect([...PLC_SESSION_BREAKGLASS_ROLES]).toEqual(["PD_COORDINATOR", "HEADMASTER"]);
  });
});

const src = readFileSync(resolve(cwd(), "lib/actions/plc-session.ts"), "utf8");

function bodyOf(name: string): string {
  const start = src.search(new RegExp(`(export )?async function ${name}\\(`));
  if (start < 0) throw new Error(`action ${name} not found`);
  // slice to the next function declaration (exported or internal), or EOF
  const rest = src.slice(start + 1);
  const nextRel = rest.search(/\n(export )?async function /);
  return nextRel < 0 ? src.slice(start) : src.slice(start, start + 1 + nextRel);
}

describe("PLC session write-gate is wired into EVERY session action (R384)", () => {
  const FACILITATOR_WRITES = ["openSession", "markAttendance", "editAgenda", "confirmReflection"];

  it("the shared gate loads the facilitator id from the plc join (server-loaded, not request-supplied)", () => {
    const gate = bodyOf("authorizeFacilitatorWrite");
    expect(gate).toMatch(/facilitatorUserId:\s*plc\.facilitatorUserId/); // joined from plc, not input
    expect(gate).toMatch(/canFacilitatePlcSession\(roles, actorId, row\.facilitatorUserId\)/);
  });

  it("🔴 every facilitator write re-checks the gate (canFacilitatePlcSession ∥ authorizeFacilitatorWrite)", () => {
    for (const name of FACILITATOR_WRITES) {
      const body = bodyOf(name);
      const checks =
        body.includes("authorizeFacilitatorWrite(") || body.includes("canFacilitatePlcSession(");
      expect(checks, `${name} never re-checks the facilitator gate`).toBe(true);
    }
  });

  it("🔴 attendance + agenda writes refuse-after-lock (isPlcSessionWriteLocked)", () => {
    for (const name of ["markAttendance", "editAgenda"]) {
      expect(bodyOf(name), `${name} skips the write-lock`).toMatch(/isPlcSessionWriteLocked\(/);
    }
  });

  it("🔴 NO action reads a facilitator/author id from the request (identity is server-loaded)", () => {
    // the request schemas never carry a facilitatorUserId, and the actions never read one off parsed.data
    expect(src).not.toMatch(/facilitatorUserId:\s*z\./);
    expect(src).not.toMatch(/parsed\.data\.(facilitatorUserId|authorId)/);
  });

  it("🔴 submitReflection derives the author from the actor (not the request) + is window-bound", () => {
    const body = bodyOf("submitReflection");
    expect(body).toMatch(/const authorId = actor\.id/); // server-derived identity
    expect(body).toMatch(/isPlcReflectionWindowOpen\(/); // window-bound (R388)
    expect(body).not.toMatch(/authorId\s*=\s*parsed/); // never from the request
  });
});
