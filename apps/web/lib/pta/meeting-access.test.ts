import { describe, it, expect } from "vitest";
import { computePtaWriteAccess } from "./meeting-access";
import { PTA_MEETING_BREAKGLASS_ROLES } from "@/lib/access";

const SEC = "u-secretary";
const CT = "u-classteacher";
const HM = "u-housemaster";

const base = {
  tierType: "FORM" as const,
  classTeacherUserId: CT,
  hmUserId: null as string | null,
  tierSettings: {} as Record<string, string>,
  heldOffices: [] as string[],
};

describe("PTA_MEETING_BREAKGLASS_ROLES (R433)", () => {
  it("is exactly [ADMIN, HEADMASTER]", () => {
    expect([...PTA_MEETING_BREAKGLASS_ROLES]).toEqual(["ADMIN", "HEADMASTER"]);
  });
});

describe("computePtaWriteAccess (R439 — the officer IDOR fence)", () => {
  it("🔴 NO bare role satisfies the officer arm — a TEACHER / FORM_MASTER with no office is refused", () => {
    for (const role of ["TEACHER", "FORM_MASTER", "VICE_HEADMASTER_ACADEMIC", "DEAN_OF_STUDENTS"]) {
      const { canWrite } = computePtaWriteAccess({ ...base, viewer: { userId: "u-x", roles: [role] } });
      expect(canWrite).toBe(false);
    }
  });

  it("the Form class-teacher writes ex-officio (the Secretary slot), no stored row needed", () => {
    const { canWrite } = computePtaWriteAccess({ ...base, viewer: { userId: CT, roles: ["FORM_MASTER"] } });
    expect(canWrite).toBe(true);
  });

  it("the House housemaster writes ex-officio", () => {
    const { canWrite } = computePtaWriteAccess({
      ...base,
      tierType: "HOUSE",
      classTeacherUserId: null,
      hmUserId: HM,
      viewer: { userId: HM, roles: ["HOUSEMASTER"] },
    });
    expect(canWrite).toBe(true);
  });

  it("a stored Secretary (heldOffices includes the Secretary office) writes", () => {
    const { canWrite } = computePtaWriteAccess({
      ...base,
      tierType: "GENERAL",
      classTeacherUserId: null,
      heldOffices: ["Secretary"],
      viewer: { userId: SEC, roles: ["PARENT"] }, // a parent-Secretary — identity, not role
    });
    expect(canWrite).toBe(true);
  });

  it("🔴 a stored CHAIR is NOT the Secretary → refused (Chair-write deferred, R433)", () => {
    const { canWrite } = computePtaWriteAccess({
      ...base,
      heldOffices: ["Chair"],
      viewer: { userId: "u-chair", roles: ["PARENT"] },
    });
    expect(canWrite).toBe(false);
  });

  it("🔴 a Secretary of PTA-A cannot write PTA-B — for the target PTA their heldOffices are empty", () => {
    // The caller holds "Secretary" in ANOTHER pta; against THIS pta the server loads heldOffices = [] and
    // they are not this class's teacher → refused.
    const { canWrite } = computePtaWriteAccess({
      ...base,
      heldOffices: [], // server-loaded for THIS pta only
      classTeacherUserId: "someone-else",
      viewer: { userId: SEC, roles: ["FORM_MASTER"] },
    });
    expect(canWrite).toBe(false);
  });

  it("break-glass ADMIN / HEADMASTER writes any register regardless of office", () => {
    for (const role of ["ADMIN", "HEADMASTER"]) {
      const { canWrite } = computePtaWriteAccess({
        ...base,
        classTeacherUserId: "someone-else",
        viewer: { userId: "u-admin", roles: [role] },
      });
      expect(canWrite).toBe(true);
    }
  });

  it("honours a school-configured ex_officio_office name (not hard-coded 'Secretary')", () => {
    const { canWrite, secretaryOffice } = computePtaWriteAccess({
      ...base,
      tierSettings: { ex_officio_office: "Scribe" },
      heldOffices: ["Scribe"],
      classTeacherUserId: "someone-else",
      viewer: { userId: SEC, roles: ["TEACHER"] },
    });
    expect(secretaryOffice).toBe("Scribe");
    expect(canWrite).toBe(true);
  });

  it("an unauthenticated viewer (no userId) is refused", () => {
    const { canWrite } = computePtaWriteAccess({ ...base, viewer: { userId: null, roles: ["TEACHER"] } });
    expect(canWrite).toBe(false);
  });
});
