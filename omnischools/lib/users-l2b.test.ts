import { describe, it, expect } from "vitest";
import { readCode } from "@/lib/test-utils/source-shape";
import { rankOf, canManageTarget, USER_ADMIN_ROLES } from "@/lib/access";
import { scopeRolesToActiveSchool } from "@/lib/auth/roles";
import { isRedactedAuditEntity } from "@/lib/audit/redaction";

/**
 * INCR-35 · Module L / L2b — admin user-management (Kofi R262/R265/R266, AC L2-6..L2-27). The rank ladder,
 * the privilege-inversion guard, and the block enforcement are PURE functions → real runtime tests (the
 * strongest coverage). The action gating + reason-channel safety are source-shape.
 */

describe("L2b · rank ladder (rankOf) — R265", () => {
  it("L2-11 · PROPRIETOR 3 > {ADMIN,HEADMASTER} 2 > staff 1 > {PARENT,STUDENT} 0 > none -1; multi-role = MAX", () => {
    expect(rankOf(["PROPRIETOR"])).toBe(3);
    expect(rankOf(["ADMIN"])).toBe(2);
    expect(rankOf(["HEADMASTER"])).toBe(2);
    expect(rankOf(["TEACHER"])).toBe(1);
    expect(rankOf(["MATRON"])).toBe(1);
    expect(rankOf(["PARENT"])).toBe(0);
    expect(rankOf(["STUDENT"])).toBe(0);
    expect(rankOf([])).toBe(-1);
    expect(rankOf(["TEACHER", "HEADMASTER"])).toBe(2);
    expect(rankOf(["TEACHER", "PARENT"])).toBe(1);
    expect(rankOf(["PROPRIETOR", "ADMIN"])).toBe(3);
  });
});

describe("L2b · privilege-inversion guard (canManageTarget) — R265, THE crux", () => {
  const A = "actor-id";
  const T = "target-id";
  it("L2-6 🔴 · an ADMIN CANNOT block/reset a PROPRIETOR", () => {
    expect(canManageTarget(["ADMIN"], ["PROPRIETOR"], A, T)).toBe(false);
    expect(canManageTarget(["HEADMASTER"], ["PROPRIETOR"], A, T)).toBe(false);
  });
  it("L2-7 · peers cannot act on peers (ADMIN↔HEADMASTER, ADMIN↔ADMIN)", () => {
    expect(canManageTarget(["ADMIN"], ["HEADMASTER"], A, T)).toBe(false);
    expect(canManageTarget(["ADMIN"], ["ADMIN"], A, T)).toBe(false);
    expect(canManageTarget(["HEADMASTER"], ["ADMIN"], A, T)).toBe(false);
  });
  it("L2-8 · no self-action (same id), even for a PROPRIETOR", () => {
    expect(canManageTarget(["PROPRIETOR"], ["PROPRIETOR"], A, A)).toBe(false);
    expect(canManageTarget(["PROPRIETOR"], ["TEACHER"], A, A)).toBe(false); // same id short-circuits
  });
  it("L2-9 · multi-role target uses MAX rank", () => {
    expect(canManageTarget(["ADMIN"], ["TEACHER", "HEADMASTER"], A, T)).toBe(false); // target max 2
    expect(canManageTarget(["ADMIN"], ["TEACHER", "PARENT"], A, T)).toBe(true); // target max 1
  });
  it("L2-10 · PROPRIETOR outranks Admin/Headmaster/Teacher/Parent; not a co-PROPRIETOR", () => {
    for (const t of [["ADMIN"], ["HEADMASTER"], ["TEACHER"], ["PARENT"]]) {
      expect(canManageTarget(["PROPRIETOR"], t, A, T)).toBe(true);
    }
    expect(canManageTarget(["PROPRIETOR"], ["PROPRIETOR"], A, T)).toBe(false);
    // a roleless target (-1) is never actioned even by a proprietor via a valid > check, but is guarded upstream
    expect(canManageTarget(["ADMIN"], [], A, T)).toBe(true); // rank 2 > -1 (gate also refuses non-members)
  });
  it("USER_ADMIN_ROLES = PROPRIETOR + ADMIN + HEADMASTER", () => {
    expect([...USER_ADMIN_ROLES].sort()).toEqual(["ADMIN", "HEADMASTER", "PROPRIETOR"]);
  });
});

describe("L2b · block enforcement in scopeRolesToActiveSchool — R262 / L2-19", () => {
  const ra = (schoolId: string, code: string) => ({ code, schoolId });
  it("L2-19 · a blocked school is dropped BEFORE the active school is chosen", () => {
    const assignments = [ra("A", "ADMIN"), ra("B", "TEACHER")]; // A earliest (index 0)
    expect(scopeRolesToActiveSchool(assignments, "2026-01-01")).toEqual({
      schoolId: "A",
      roles: ["ADMIN"],
    });
    // blocked at A → falls through to B
    expect(scopeRolesToActiveSchool(assignments, "2026-01-01", new Set(["A"]))).toEqual({
      schoolId: "B",
      roles: ["TEACHER"],
    });
    // blocked at the only school → authenticated but powerless (no active school, no roles)
    expect(scopeRolesToActiveSchool([ra("A", "ADMIN")], "2026-01-01", new Set(["A"]))).toEqual({
      roles: [],
    });
  });
});

describe("L2b · actions double-gated, reset-as-flow, reason-channel safe (source-shape)", () => {
  const USERS = readCode("lib/actions/users.ts");
  const AUTH = readCode("lib/auth/index.ts");

  it("L2-12 · every mutation gates assertAnyRole(USER_ADMIN_ROLES); the target gate uses canManageTarget", () => {
    expect((USERS.match(/assertAnyRole\(USER_ADMIN_ROLES\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(USERS).toContain("canManageTarget(");
  });

  it("L2-22/L2-23 · reset sends an OTP to the STORED phone, sets/reveals NO password, no caller-supplied dest", () => {
    expect(USERS).toContain("signInWithPhone(gated.phone)");
    expect(USERS).not.toContain("createPasswordUser");
    expect(USERS).not.toContain("updatePassword");
    expect(USERS).not.toMatch(/input\.(phone|email|destination)/);
  });

  it("L2-26 / R240 · the block free-text reason never reaches the audit (fixed neutral reason)", () => {
    expect(USERS).toContain('reason: "Account blocked"');
    // the admin's free-text is stored on the block table only
    expect(USERS).toContain("blockedBy: actor.id ?? undefined, reason");
  });

  it("L2-20 · activate DELETES the block row; role_assignment is never written by L2b", () => {
    expect(USERS).toContain(".delete(userSchoolBlock)");
    expect(USERS).not.toMatch(/\.(insert|update|delete)\(roleAssignments/);
  });

  it("L2-16/L2-17 · getCurrentUser reads user_school_block and passes the set to the pure authority", () => {
    expect(AUTH).toContain("userSchoolBlock");
    expect(AUTH).toContain("blockedSchoolIds");
    expect(AUTH).toContain("scopeRolesToActiveSchool(ra, today, blockedSchoolIds)");
  });

  it("user_block audit entity is classified SHOWN (INCR-31 guard)", () => {
    expect(isRedactedAuditEntity("user_block")).toBe(false);
  });
});
