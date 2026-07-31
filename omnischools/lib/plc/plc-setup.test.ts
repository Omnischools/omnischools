import { describe, it, expect } from "vitest";
import {
  coalescePlcProgramme,
  PLC_TYPE_SEMANTICS,
  plcTypeOf,
  type PlcProgrammeRow,
} from "./defaults";
import {
  PLC_CONFIG_WRITE_ROLES,
  PLC_SESSION_BREAKGLASS_ROLES,
  canFacilitatePlcSession,
  canGrantRole,
  rankOf,
} from "@/lib/access";
import { KNOWN_APP_ROLES } from "@/lib/auth";
import { STAFF_ROLES, STAFF_ROLE_LABEL } from "@/lib/staff-roles";
import { formatClockRange, addMinutes } from "@/lib/senior/time";

describe("coalescePlcProgramme (R370/R371)", () => {
  it("a MISSING row → the frozen Friday defaults + configured:false, never null/throw", () => {
    const p = coalescePlcProgramme(null);
    expect(p.sessionDay).toBe(5);
    expect(p.dayName).toBe("Friday");
    expect(p.sessionStart).toBe("15:30");
    expect(p.sessionLengthMin).toBe(60);
    expect(p.weeksPerSemester).toBe(12);
    expect(p.configured).toBe(false);
    // DERIVED, never stored:
    expect(p.startLabel).toBe("3:30 PM");
    expect(p.endLabel).toBe("4:30 PM");
    expect(p.windowLabel).toBe("3:30 PM to 4:30 PM");
    expect(p.maxPtsPerSession).toBe(1); // 0.5 + 0.5
  });

  it("coerces numeric() strings + derives the end time from start + length", () => {
    const row: PlcProgrammeRow = {
      sessionDay: 3,
      sessionStart: "14:00",
      sessionLengthMin: 90,
      weeksPerSemester: 10,
      ptsPerAttendedSession: "0.75",
      ptsPerReflection: "0.25",
      reflectionWindowHours: 24,
      annualPlcTarget: "8",
      configuredAt: new Date(),
    };
    const p = coalescePlcProgramme(row);
    expect(p.configured).toBe(true);
    expect(p.dayName).toBe("Wednesday");
    expect(p.endLabel).toBe("3:30 PM"); // 14:00 + 90m
    expect(p.ptsPerAttendedSession).toBe(0.75);
    expect(p.maxPtsPerSession).toBe(1); // 0.75 + 0.25
  });
});

describe("PLC type semantics DERIVE from type (R376 — no stored columns)", () => {
  it("subject = mandatory/weekly/navy, cross-cutting = voluntary, new-teacher = mandatory/green", () => {
    expect(PLC_TYPE_SEMANTICS.subject).toMatchObject({ mandatory: true, accent: "navy" });
    expect(PLC_TYPE_SEMANTICS["cross-cutting"]).toMatchObject({
      mandatory: false,
      cadence: "weekly-or-biweekly",
      accent: "gold",
    });
    expect(PLC_TYPE_SEMANTICS["new-teacher"]).toMatchObject({ mandatory: true, accent: "green" });
  });
  it("plcTypeOf narrows an unknown string to a safe default", () => {
    expect(plcTypeOf("cross-cutting")).toBe("cross-cutting");
    expect(plcTypeOf("garbage")).toBe("subject");
  });
});

describe("PD_COORDINATOR RBAC (R366/R367) — inert & escalation-safe", () => {
  it("is registered everywhere DEAN_OF_STUDENTS is (known role + staff picker + label)", () => {
    expect(KNOWN_APP_ROLES).toContain("PD_COORDINATOR");
    expect(STAFF_ROLES.some((r) => r.code === "PD_COORDINATOR")).toBe(true);
    expect(STAFF_ROLE_LABEL.PD_COORDINATOR).toBeTruthy();
  });
  it("is rank-1 (rankOf) and can grant NOTHING above rank-1", () => {
    expect(rankOf(["PD_COORDINATOR"])).toBe(1);
    expect(canGrantRole(["PD_COORDINATOR"], "ADMIN")).toBe(false);
    expect(canGrantRole(["PD_COORDINATOR"], "HEADMASTER")).toBe(false);
    expect(canGrantRole(["PD_COORDINATOR"], "PROPRIETOR")).toBe(false);
  });
  it("ADMIN & HEADMASTER CAN grant PD_COORDINATOR (rank-1 ≤ their rank)", () => {
    expect(canGrantRole(["ADMIN"], "PD_COORDINATOR")).toBe(true);
    expect(canGrantRole(["HEADMASTER"], "PD_COORDINATOR")).toBe(true);
  });
  it("config write set = [PD_COORDINATOR, ADMIN, HEADMASTER] — VHA deliberately excluded", () => {
    expect([...PLC_CONFIG_WRITE_ROLES]).toEqual(["PD_COORDINATOR", "ADMIN", "HEADMASTER"]);
    expect((PLC_CONFIG_WRITE_ROLES as readonly string[]).includes("VICE_HEADMASTER_ACADEMIC")).toBe(
      false,
    );
  });
});

describe("canFacilitatePlcSession (R377) — the ONE IDOR fence, inert in 47", () => {
  const me = "user-1";
  const facilitator = "user-1";
  const other = "user-2";

  it("TRUE when the caller IS the assigned facilitator (identity match)", () => {
    expect(canFacilitatePlcSession(["TEACHER"], me, facilitator)).toBe(true);
  });

  it("break-glass roles (PD_COORDINATOR, HEADMASTER) satisfy the role arm", () => {
    expect([...PLC_SESSION_BREAKGLASS_ROLES]).toEqual(["PD_COORDINATOR", "HEADMASTER"]);
    expect(canFacilitatePlcSession(["PD_COORDINATOR"], other, facilitator)).toBe(true);
    expect(canFacilitatePlcSession(["HEADMASTER"], other, facilitator)).toBe(true);
  });

  it("NO bare role alone (TEACHER/FORM_MASTER/VHA/ADMIN, no identity match) satisfies it", () => {
    for (const role of ["TEACHER", "FORM_MASTER", "VICE_HEADMASTER_ACADEMIC", "ADMIN"]) {
      expect(canFacilitatePlcSession([role], other, facilitator)).toBe(false);
    }
    // and a null facilitator id never lets a non-break-glass caller through
    expect(canFacilitatePlcSession(["TEACHER"], me, null)).toBe(false);
  });
});

describe("shared senior time helpers (Dex-directed extraction stays byte-identical)", () => {
  it("addMinutes + formatClockRange match the PLC cadence idiom", () => {
    expect(addMinutes("15:30", 60)).toBe("16:30");
    expect(formatClockRange("15:30", "16:30")).toBe("3:30 PM to 4:30 PM");
  });
});
