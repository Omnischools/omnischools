import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";

/**
 * GOV-2 · the read-only BOARD_MEMBER role + confinement + `/board` landing — AC GOV2-1..17.
 *
 * The board is a NON-STAFF, read-only persona (R333 — parent-shaped, stricter than finance): `isStaff`
 * is false for it, it lives entirely behind `requireBoard()` over the `(board)` route group, and it is
 * INERT (rank-0, in no write/management group, `assertWriteAccess` throws for it). This file proves:
 *   • confinement — `pathAllowedForBoard` policy (GOV2-1..4/6) + `requireBoard` runtime redirects;
 *   • the non-staff shape — `isStaff`/`isBoardOnly` (GOV2-5/7);
 *   • the inert invariant — no-group membership (GOV2-8), rank-0 (GOV2-11), grant/manage matrix
 *     (GOV2-9/12), and `assertWriteAccess` throwing behaviourally (GOV2-10, mutation-red);
 *   • seating — the picker + KNOWN_APP_ROLES + label (GOV2-12/13);
 *   • landing honesty — the pure `boardTile` helper (GOV2-14/15).
 *
 * `getCurrentUser` (identity), `next/navigation` (redirect), `next/headers` (x-pathname) and
 * `@/lib/db/rls` (school resolution) are mocked so the guard runs with NO database — the redirect
 * targets are asserted from a thrown `REDIRECT:<url>` sentinel.
 */

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getCurrentUser: vi.fn() };
});
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
const headerStore = { path: "" as string };
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Map([["x-pathname", headerStore.path]])),
}));
vi.mock("@/lib/db/rls", () => ({
  // getActiveSchool wraps its select in withoutTenantScope; return a canned school row (the callback is
  // never run, so no DB). Shape matches getActiveSchool's `cols` (district/region → location).
  withoutTenantScope: vi.fn(async () => ({
    id: "sch-1",
    name: "Test SHS",
    shortName: null,
    gesCode: "WR-X-001",
    schoolType: "SENIOR",
    districtName: "Wassa",
    regionName: "Western",
  })),
  withSchool: vi.fn(),
}));

import { getCurrentUser, KNOWN_APP_ROLES, type AppUser } from "@/lib/auth";
import * as access from "@/lib/access";
import {
  isStaff,
  isBoardOnly,
  rankOf,
  canGrantRole,
  canManageTarget,
  pathAllowedForBoard,
  BOARD_ROLES,
  BOARD_HOME,
  BOARD_SECTIONS,
} from "@/lib/access";
import { STAFF_ROLES, roleLabel } from "@/lib/staff-roles";
import { boardTile, boardGhs } from "@/lib/board/tiles";
import { requireBoard, assertWriteAccess } from "@/lib/auth/server";

const boardUser = (over: Partial<AppUser> = {}): AppUser => ({
  id: "u-board-1",
  phone: "+233200000009",
  roles: ["BOARD_MEMBER"],
  schoolId: "sch-1",
  ...over,
});

beforeEach(() => {
  vi.mocked(getCurrentUser).mockReset();
  headerStore.path = "";
});

// ── GOV2-1..4/6 · confinement policy (pathAllowedForBoard) ──────────────────────────────────────
describe("GOV2-1..6 · pathAllowedForBoard confines to /board only", () => {
  it("GOV2-1/2 · admits /board and /board/account (the account page is under the /board prefix)", () => {
    expect(pathAllowedForBoard("/board")).toBe(true);
    expect(pathAllowedForBoard("/board/account")).toBe(true);
    expect(pathAllowedForBoard("/board/anything")).toBe(true);
  });

  it("GOV2-3/4/6 · refuses every staff / non-board path", () => {
    for (const p of [
      "/students",
      "/dashboard",
      "/settings",
      "/staff",
      "/billing",
      "/senior",
      "/senior/vlc/setup",
      "/senior/sickbay",
      "/account", // the PARENT portal's account — NOT the board's
      "/wassce",
      "/",
    ]) {
      expect(pathAllowedForBoard(p), p).toBe(false);
    }
  });

  it("prefix-matching does not leak a sibling like /boardroom", () => {
    expect(pathAllowedForBoard("/boardroom")).toBe(false);
    expect(BOARD_SECTIONS).toEqual(["/board"]);
    expect(BOARD_HOME).toBe("/board");
  });
});

// ── GOV2-5/7 · non-staff shape ──────────────────────────────────────────────────────────────────
describe("GOV2-5/7 · BOARD_MEMBER is non-staff", () => {
  it("GOV2-5 · isStaff is false for BOARD_MEMBER alone, true when combined with a staff role", () => {
    expect(isStaff(["BOARD_MEMBER"])).toBe(false);
    expect(isStaff(["BOARD_MEMBER", "TEACHER"])).toBe(true);
  });

  it("GOV2-7 · isBoardOnly is true only when every held role is a board role", () => {
    expect(isBoardOnly(["BOARD_MEMBER"])).toBe(true);
    expect(isBoardOnly(["BOARD_MEMBER", "TEACHER"])).toBe(false);
    expect(isBoardOnly(["ADMIN"])).toBe(false);
    expect(isBoardOnly([])).toBe(false);
    expect(BOARD_ROLES).toEqual(["BOARD_MEMBER"]);
  });
});

// ── GOV2-8/11 · the inert invariant ─────────────────────────────────────────────────────────────
describe("GOV2-8/11 · BOARD_MEMBER is inert", () => {
  it("GOV2-8 · appears in NO exported *_ROLES access group except BOARD_ROLES (self-maintaining sweep)", () => {
    const groups = Object.entries(access).filter(
      ([name, value]) =>
        name !== "BOARD_ROLES" &&
        Array.isArray(value) &&
        (value as unknown[]).every((v) => typeof v === "string"),
    ) as [string, readonly string[]][];
    // Guard against a vacuous sweep — the well-known groups must be present.
    const names = groups.map(([n]) => n);
    for (const g of [
      "FINANCE_ROLES",
      "STAFF_ADMIN_ROLES",
      "USER_ADMIN_ROLES",
      "SENIOR_LEDGER_ROLES",
      "SENIOR_MANAGEMENT_ROLES",
      "BOARDING_ROLES",
      "SICKBAY_ROLES",
      "SICKBAY_CLINICAL_WRITE_ROLES",
      "VLC_CONFIG_WRITE_ROLES",
      "VLC_PASTORAL_WRITE_ROLES",
      "PLC_CONFIG_WRITE_ROLES",
      "PLC_DASHBOARD_READ_ROLES",
      "PTA_CONFIG_WRITE_ROLES",
    ]) {
      expect(names, `sweep must cover ${g}`).toContain(g);
    }
    for (const [name, group] of groups) {
      expect(group.includes("BOARD_MEMBER"), `must be inert in ${name}`).toBe(false);
    }
  });

  it("GOV2-11 · rankOf is 0 — outranks nobody", () => {
    expect(rankOf(["BOARD_MEMBER"])).toBe(0);
    expect(rankOf(["BOARD_MEMBER", "STUDENT"])).toBe(0);
  });
});

// ── GOV2-9/12 · grant + manage matrix ───────────────────────────────────────────────────────────
describe("GOV2-9/12 · grant + manage matrix", () => {
  it("GOV2-12 · an admin/headmaster may seat BOARD_MEMBER; a board member may mint nobody", () => {
    expect(canGrantRole(["ADMIN"], "BOARD_MEMBER")).toBe(true); // 0 <= 2
    expect(canGrantRole(["HEADMASTER"], "BOARD_MEMBER")).toBe(true);
    expect(canGrantRole(["BOARD_MEMBER"], "TEACHER")).toBe(false); // 1 > 0
    expect(canGrantRole(["BOARD_MEMBER"], "ADMIN")).toBe(false); // 2 > 0
    expect(canGrantRole(["BOARD_MEMBER"], "PROPRIETOR")).toBe(false); // 3 > 0
  });

  it("GOV2-9 · a manager outranks a board member; a board member manages no one", () => {
    expect(canManageTarget(["ADMIN"], ["BOARD_MEMBER"], "a", "b")).toBe(true); // 2 > 0
    expect(canManageTarget(["BOARD_MEMBER"], ["STUDENT"], "a", "b")).toBe(false); // 0 not > 0
    expect(canManageTarget(["BOARD_MEMBER"], ["TEACHER"], "a", "b")).toBe(false); // 0 not > 1
    expect(canManageTarget(["BOARD_MEMBER"], ["BOARD_MEMBER"], "a", "a")).toBe(false); // self
  });
});

// ── GOV2-12/13 · seating catalogue ──────────────────────────────────────────────────────────────
describe("GOV2-12/13 · BOARD_MEMBER is known + assignable with a label, no enum change", () => {
  it("is in KNOWN_APP_ROLES and the assignable STAFF_ROLES picker with a display label", () => {
    expect((KNOWN_APP_ROLES as readonly string[]).includes("BOARD_MEMBER")).toBe(true);
    expect(STAFF_ROLES.some((r) => r.code === "BOARD_MEMBER")).toBe(true);
    expect(roleLabel("BOARD_MEMBER")).toBe("Board member");
  });

  it("the pg app_role enum is NOT touched (free-text role, no migration)", () => {
    const enums = readFileSync(resolve(cwd(), "db/schema/_enums.ts"), "utf8");
    const start = enums.indexOf('pgEnum("app_role"');
    const block = enums.slice(start, enums.indexOf("]", start));
    expect(block).not.toContain("BOARD_MEMBER");
  });
});

// ── GOV2-10 · assertWriteAccess throws for a board session (mutation-red) ────────────────────────
describe("GOV2-10 · assertWriteAccess is read-only for a board session", () => {
  it("THROWS for a board-only session (removing the isBoardOnly clause reds this)", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(boardUser());
    await expect(assertWriteAccess()).rejects.toThrow(/read-only/i);
  });

  it("also throws for finance-only, and does NOT throw for staff or an unauthenticated session", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(boardUser({ roles: ["BURSAR"] }));
    await expect(assertWriteAccess()).rejects.toThrow(/read-only/i);

    vi.mocked(getCurrentUser).mockResolvedValue(boardUser({ roles: ["ADMIN"] }));
    await expect(assertWriteAccess()).resolves.toBeUndefined();

    vi.mocked(getCurrentUser).mockResolvedValue(null);
    await expect(assertWriteAccess()).resolves.toBeUndefined();
  });
});

// ── requireBoard runtime confinement ────────────────────────────────────────────────────────────
describe("requireBoard · runtime confinement (airtight)", () => {
  it("redirects an unauthenticated session to /login", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    await expect(requireBoard()).rejects.toThrow("REDIRECT:/login");
  });

  it("redirects a non-board (staff) session to /dashboard", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(boardUser({ roles: ["TEACHER"] }));
    await expect(requireBoard()).rejects.toThrow("REDIRECT:/dashboard");
  });

  it("redirects a board session hitting a non-/board path to BOARD_HOME", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(boardUser());
    headerStore.path = "/students";
    await expect(requireBoard()).rejects.toThrow("REDIRECT:/board");
  });

  it("admits a board session on an allowed /board path (returns the session-resolved school)", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(boardUser());
    headerStore.path = "/board/account";
    const { user, school } = await requireBoard();
    expect(user.roles).toContain("BOARD_MEMBER");
    expect(school.id).toBe("sch-1");
  });
});

// ── requireSchool wiring · a board session hitting the staff shell lands on /board ──────────────
describe("requireSchool · non-staff branch routes a board-only session to /board first", () => {
  const server = readFileSync(resolve(cwd(), "lib/auth/server.ts"), "utf8");
  const strip = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const code = strip(server);

  it("requireSchool's non-staff redirect checks isBoardOnly → BOARD_HOME BEFORE the PARENT case", () => {
    const body = code.slice(
      code.indexOf("export async function requireSchool"),
      code.indexOf("export async function assertWriteAccess"),
    );
    const board = body.search(/isBoardOnly\s*\(\s*user\.roles\s*\)\s*\?\s*BOARD_HOME/);
    const parent = body.indexOf('includes("PARENT")');
    expect(board, "isBoardOnly?BOARD_HOME present in requireSchool").toBeGreaterThan(-1);
    expect(board).toBeLessThan(parent); // board case comes FIRST (R334)
  });

  it("requireBoard composes pathAllowedForBoard → redirect(BOARD_HOME) as its confinement", () => {
    const body = code.slice(code.indexOf("export async function requireBoard"));
    expect(body).toMatch(/!\s*pathAllowedForBoard\s*\([\s\S]*?\)\s*\)\s*redirect\s*\(\s*BOARD_HOME\s*\)/);
  });
});

// ── GOV2-14/15 · landing honesty (pure boardTile helper) ────────────────────────────────────────
describe("GOV2-14/15 · boardTile honours the omit-not-fake convention", () => {
  it("GOV2-14 · a NOT_CAPTURED arm renders its reason and NEVER a number (value fn is not called)", () => {
    const valueFn = vi.fn(() => "GHS 999");
    const t = boardTile({ status: "NOT_CAPTURED", reason: "No fees billed for Term 1 · 2025/26." }, valueFn);
    expect(t).toEqual({ status: "NOT_CAPTURED", reason: "No fees billed for Term 1 · 2025/26." });
    expect(valueFn).not.toHaveBeenCalled();
  });

  it("a NOT_APPLICABLE arm also collapses to a reason with no number", () => {
    const t = boardTile({ status: "NOT_APPLICABLE", reason: "Not applicable for this tier." }, () => "1");
    expect(t.status).toBe("NOT_CAPTURED");
    if (t.status === "CAPTURED") throw new Error("unreachable");
    expect(t.reason).toBe("Not applicable for this tier.");
  });

  it("GOV2-15 · a CAPTURED arm with a real zero renders 'GHS 0' — a true zero, not a NOT_CAPTURED tile", () => {
    const t = boardTile({ status: "CAPTURED", data: { collected: 0 } }, (d) => boardGhs(d.collected));
    expect(t).toEqual({ status: "CAPTURED", value: "GHS 0" });
  });

  it("boardGhs groups en-GH and never forces decimals", () => {
    expect(boardGhs(0)).toBe("GHS 0");
    expect(boardGhs(42000)).toBe("GHS 42,000");
  });
});
