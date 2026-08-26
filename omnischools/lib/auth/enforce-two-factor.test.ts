import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * INCR-254 (deferred half) — end-to-end proof that `requireSchool()` enforces the "Require two-factor
 * for administrators" setting (ref_school.require_2fa): a password-only ADMIN is bounced to
 * `/login?stepup=1` ONLY when OTP is deliverable; otherwise (the NO-LOCKOUT case) it is admitted. Mocks
 * mirror enforce-session-age.test.ts — identity/redirect/headers/school-read stubbed, redirect asserted
 * from a thrown `REDIRECT:<url>` sentinel. session_hours is null throughout so session-age never fires.
 */

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    getCurrentUser: vi.fn(),
    authIsLive: vi.fn(() => true),
    sessionLoginAtMs: vi.fn(async () => Date.now()), // fresh — session-age inert (sessionHours null anyway)
    sessionAuthMethods: vi.fn(),
    otpLoginRequired: vi.fn(),
  };
});
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Map([["x-pathname", "/dashboard"]])),
}));

const schoolRow = {
  id: "sch-1",
  name: "Test SHS",
  shortName: null,
  gesCode: "WR-X-001",
  schoolType: "SENIOR",
  sessionHours: null as number | null,
  require2fa: true as boolean | null,
  districtName: null,
  regionName: null,
};
vi.mock("@/lib/db/rls", () => ({
  withoutTenantScope: vi.fn(async () => schoolRow),
  withSchool: vi.fn(),
}));

import {
  getCurrentUser,
  sessionAuthMethods,
  otpLoginRequired,
  type AppUser,
} from "@/lib/auth";
import { requireSchool } from "@/lib/auth/server";

const admin: AppUser = { id: "u-1", phone: "+233200000000", roles: ["ADMIN"], schoolId: "sch-1" };
const teacher: AppUser = { id: "u-2", phone: "+233200000001", roles: ["TEACHER"], schoolId: "sch-1" };

beforeEach(() => {
  vi.clearAllMocks();
  schoolRow.require2fa = true;
  schoolRow.sessionHours = null;
  vi.mocked(getCurrentUser).mockResolvedValue(admin);
  vi.mocked(otpLoginRequired).mockReturnValue(true);
  vi.mocked(sessionAuthMethods).mockResolvedValue(["password"]);
});

describe("requireSchool enforces require-2FA-for-admins", () => {
  it("redirects a password-only admin to step-up when OTP is deliverable", async () => {
    await expect(requireSchool()).rejects.toThrow("REDIRECT:/login?stepup=1");
  });

  it("passes an admin whose session already completed OTP", async () => {
    vi.mocked(sessionAuthMethods).mockResolvedValue(["otp"]);
    const { school } = await requireSchool();
    expect(school.id).toBe("sch-1");
  });

  it("🔴 NO-LOCKOUT: a password-only admin is NOT blocked when OTP is undeliverable", async () => {
    vi.mocked(otpLoginRequired).mockReturnValue(false);
    const { school } = await requireSchool();
    expect(school.id).toBe("sch-1");
    // fail-safe won BEFORE touching the session (short-circuit is fine, but the point is: no redirect)
  });

  it("never enforces a non-admin (teacher passes even password-only) — and skips the amr read", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(teacher);
    const { school } = await requireSchool();
    expect(school.id).toBe("sch-1");
    expect(sessionAuthMethods).not.toHaveBeenCalled();
  });

  it("no enforcement when the setting is off — never reads the session amr", async () => {
    schoolRow.require2fa = false;
    const { school } = await requireSchool();
    expect(school.id).toBe("sch-1");
    expect(sessionAuthMethods).not.toHaveBeenCalled();
  });
});
