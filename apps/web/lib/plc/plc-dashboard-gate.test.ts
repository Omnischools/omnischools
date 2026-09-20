import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
import {
  PLC_DASHBOARD_READ_ROLES,
  PLC_CONFIG_WRITE_ROLES,
  PLC_SESSION_BREAKGLASS_ROLES,
  hasAnyRole,
} from "@/lib/access";

/**
 * INCR-49 (Quinn) — the CPD school-dashboard READ-gate (R405). RLS alone lets any same-school staffer
 * SELECT the SHOWN plc_cpd_ledger, so WHO SEES the school-wide rollup is an APP-LAYER gate on
 * PLC_DASHBOARD_READ_ROLES. Two failure modes to red:
 *   1. widening the SET (adding TEACHER etc. — or the READ⊋WRITE asymmetry collapsing);
 *   2. the /dashboard page swapping the gate for the broad `isStaff` (the [[builds-widen-ratified-authz-and-self-bless]]
 *      shape — a green suite that never touches the real boundary). The source guard below reds that swap.
 */
describe("PLC dashboard READ-gate role set (R405)", () => {
  it("= the config-write set + VHA (read ⊋ write), exact membership", () => {
    expect([...PLC_DASHBOARD_READ_ROLES].sort()).toEqual(
      ["ADMIN", "HEADMASTER", "PD_COORDINATOR", "VICE_HEADMASTER_ACADEMIC"].sort(),
    );
  });

  it("VHA reads the dashboard but is NOT in the write/break-glass sets (no regression)", () => {
    expect((PLC_DASHBOARD_READ_ROLES as readonly string[]).includes("VICE_HEADMASTER_ACADEMIC")).toBe(true);
    expect((PLC_CONFIG_WRITE_ROLES as readonly string[]).includes("VICE_HEADMASTER_ACADEMIC")).toBe(false);
    expect((PLC_SESSION_BREAKGLASS_ROLES as readonly string[]).includes("VICE_HEADMASTER_ACADEMIC")).toBe(false);
  });

  it("management roles pass, non-management (TEACHER/FORM_MASTER/HoD-alone/STUDENT/PARENT) get 0", () => {
    for (const r of ["PD_COORDINATOR", "HEADMASTER", "VICE_HEADMASTER_ACADEMIC", "ADMIN"]) {
      expect(hasAnyRole([r], PLC_DASHBOARD_READ_ROLES)).toBe(true);
    }
    for (const r of ["TEACHER", "FORM_MASTER", "HEAD_OF_DEPARTMENT", "STUDENT", "PARENT"]) {
      expect(hasAnyRole([r], PLC_DASHBOARD_READ_ROLES)).toBe(false);
    }
  });
});

describe("PLC dashboard route wires the READ-gate (source guard — swap to isStaff reds)", () => {
  const page = readFileSync(resolve(cwd(), "app/(app)/senior/plc/dashboard/page.tsx"), "utf8");
  it("🔴 redirects unless hasAnyRole(user.roles, PLC_DASHBOARD_READ_ROLES)", () => {
    expect(page).toMatch(/hasAnyRole\(\s*user\.roles,\s*PLC_DASHBOARD_READ_ROLES\s*\)/);
    expect(page).toMatch(/redirect\(/);
  });
});
