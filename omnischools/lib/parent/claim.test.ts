import { describe, it, expect } from "vitest";
import { isParentRole, parentInviteError, PARENT_ROLE } from "./claim";

describe("PARENT invite rules (AC C1)", () => {
  it("rejects a PARENT invite with no student", () => {
    expect(parentInviteError("PARENT", null, "g1")).toBeTruthy();
    expect(parentInviteError("PARENT", "", "g1")).toBeTruthy();
    expect(parentInviteError("PARENT", undefined, "g1")).toBeTruthy();
  });
  it("rejects a PARENT invite with no guardian row identified", () => {
    expect(parentInviteError("PARENT", "s1", null)).toBeTruthy();
    expect(parentInviteError("PARENT", "s1", "")).toBeTruthy();
  });
  it("accepts a well-formed PARENT invite (student + guardian both named)", () => {
    expect(parentInviteError("PARENT", "s1", "g1")).toBeNull();
  });
  it("is a no-op for staff/teacher invites — they carry no student", () => {
    expect(parentInviteError("TEACHER", null, null)).toBeNull();
    expect(parentInviteError("ADMIN", undefined, undefined)).toBeNull();
  });
  it("recognises the parent role case-insensitively", () => {
    expect(isParentRole("parent")).toBe(true);
    expect(isParentRole(" PARENT ")).toBe(true);
    expect(isParentRole(PARENT_ROLE)).toBe(true);
    expect(isParentRole("TEACHER")).toBe(false);
  });
});
