import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * INCR-254 — end-to-end proof that the "Session length" setting now GATES. `requireSchool()` must
 * bounce an over-age (or unreadable-age) live session to /login, and pass a fresh one through. Mocks
 * mirror board-gov2.test.ts: identity, redirect, headers and the school read are stubbed so the guard
 * runs with no database; the redirect is asserted from a thrown `REDIRECT:<url>` sentinel.
 */

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    getCurrentUser: vi.fn(),
    authIsLive: vi.fn(() => true), // pretend real Supabase auth for these cases
    sessionLoginAtMs: vi.fn(),
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
  sessionHours: 8 as number | null,
  districtName: null,
  regionName: null,
};
vi.mock("@/lib/db/rls", () => ({
  withoutTenantScope: vi.fn(async () => schoolRow),
  withSchool: vi.fn(),
}));

import { getCurrentUser, sessionLoginAtMs, type AppUser } from "@/lib/auth";
import { requireSchool } from "@/lib/auth/server";

const admin: AppUser = {
  id: "u-1",
  phone: "+233200000000",
  roles: ["ADMIN"],
  schoolId: "sch-1",
};

const HOUR = 3_600_000;

beforeEach(() => {
  vi.clearAllMocks();
  schoolRow.sessionHours = 8;
  vi.mocked(getCurrentUser).mockResolvedValue(admin);
});

describe("requireSchool enforces the session-length setting", () => {
  it("redirects an over-age session to re-authenticate", async () => {
    vi.mocked(sessionLoginAtMs).mockResolvedValue(Date.now() - 9 * HOUR);
    await expect(requireSchool()).rejects.toThrow("REDIRECT:/login?expired=1");
  });

  it("FAILS CLOSED: an unreadable login time under a set limit is bounced too", async () => {
    vi.mocked(sessionLoginAtMs).mockResolvedValue(null);
    await expect(requireSchool()).rejects.toThrow("REDIRECT:/login?expired=1");
  });

  it("lets a session within the limit through", async () => {
    vi.mocked(sessionLoginAtMs).mockResolvedValue(Date.now() - 1 * HOUR);
    const { school } = await requireSchool();
    expect(school.id).toBe("sch-1");
    expect(sessionLoginAtMs).toHaveBeenCalled();
  });

  it("no-op when the school set no limit — never reads the session age", async () => {
    schoolRow.sessionHours = null;
    const { school } = await requireSchool();
    expect(school.id).toBe("sch-1");
    expect(sessionLoginAtMs).not.toHaveBeenCalled();
  });
});
