import { describe, it, expect, vi, beforeEach } from "vitest";
import { requireSchool, assertAnyRole } from "@/lib/auth/server";
import { MAX_PERCENT, parseCategoryCell } from "@/lib/score-ledger/compute";

/**
 * Issue #273 — regression: the single 0–999.99 bonus-mark bound is enforced IDENTICALLY across
 * the three score-capture paths. The bound lives in ONE shared clamp, parseCategoryCell
 * (lib/score-ledger/compute.ts): "" → null, a 0–MAX_PERCENT (999.99) number → round2, anything
 * else (negative / non-numeric / >999.99) → "invalid". A bonus mark >100 (e.g. 11/10 → 110)
 * commits; the 999.99 ceiling is the numeric(5,2) overflow guard.
 *
 * All three server actions inline that same clamp and REJECT the whole batch — before any DB
 * write — on an out-of-range cell:
 *   • Path A  = saveAssessmentScores   (parseCategoryCell(s.raw))
 *   • Path B  = commitScanLedger       (parseCategoryCell over the 5 category cells)
 *   • Path C  = saveDirectLedgerScores (parseCategoryCell over the 5 category cells)
 *
 * The boundary math itself is unit-pinned in compute.test.ts; the first block below re-pins it so
 * this regression file stands alone, and the three per-path blocks prove each path actually routes
 * user input through the clamp — a future path that bypasses it (or tightens/loosens the bound on
 * one path) reds here. Uses the same mocked-boundary + fake-tx harness as terminal-results-guards.
 */

// ── the one shared bound (every path calls THIS) ────────────────────────────────────────────────
describe("#273 · the single shared clamp — parseCategoryCell (compute.ts)", () => {
  it("bonus >100 commits; >999.99 / negative / non-numeric reject; blank → null", () => {
    expect(parseCategoryCell("150")).toBe(150); // bonus mark (over 100) is allowed
    expect(parseCategoryCell("110")).toBe(110); // 11/10 portfolio → 110, commits
    expect(parseCategoryCell(String(MAX_PERCENT))).toBe(MAX_PERCENT); // 999.99 ceiling ok
    expect(parseCategoryCell("1000")).toBe("invalid"); // over numeric(5,2)
    expect(parseCategoryCell("-1")).toBe("invalid");
    expect(parseCategoryCell("abc")).toBe("invalid");
    expect(parseCategoryCell("")).toBeNull();
  });
});

// ── mocked boundaries so the three "use server" actions run in the node test env ─────────────────
vi.mock("@/lib/auth/server", () => ({
  requireSchool: vi.fn(),
  assertAnyRole: vi.fn(async () => {}),
  resolveActor: vi.fn(async () => ({ id: "u1", role: "ADMIN" })),
}));
vi.mock("@/lib/db/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/revalidate", () => ({ safeRevalidate: vi.fn() }));

// A fake tx: every select resolves []; any score write is spied so "rejected → no DB write" is
// provable. With no closed period, no roster and no chosen path, an accepted (in-bound) value
// falls through to the path-not-set message — never the range reject — which is exactly what we
// assert distinguishes "bonus accepted" from "out-of-range rejected".
const insertSpy = vi.fn(() => ({
  values: () => ({
    onConflictDoUpdate: async () => {},
    returning: async () => [{ id: "x" }],
  }),
}));
const fakeTx = {
  select: () => ({ from: () => ({ where: async () => [] as unknown[] }) }),
  insert: insertSpy,
  delete: () => ({ where: async () => {} }),
};
const withSchoolMock = vi.fn(async (_id: string, fn: (tx: unknown) => unknown) => fn(fakeTx));
vi.mock("@/lib/db/rls", () => ({
  withSchool: (id: string, fn: (tx: unknown) => unknown) => withSchoolMock(id, fn),
}));

const { saveAssessmentScores, saveDirectLedgerScores, commitScanLedger } = await import(
  "./score-ledger"
);

// Real v4 uuids — the Zod schemas validate the shape (strict variant bits) before the parse gate,
// so placeholder all-same-digit ids would fail on "Invalid UUID" and never exercise the bound. The
// fake tx ignores the values themselves.
const CLASS = crypto.randomUUID();
const SUBJ = crypto.randomUUID();
const PERIOD = crypto.randomUUID();
const STU = crypto.randomUUID();
const ASMT = crypto.randomUUID();

const OUT_OF_RANGE = ["1000", "-5", "abc"]; // >999.99, negative, non-numeric — all "invalid"

beforeEach(() => {
  vi.mocked(requireSchool).mockResolvedValue({
    school: { id: "s1", name: "Demo", schoolType: "SENIOR" },
    user: { roles: ["ADMIN"] },
  } as never);
  vi.mocked(assertAnyRole).mockReset();
  vi.mocked(assertAnyRole).mockResolvedValue(undefined);
  withSchoolMock.mockClear();
  insertSpy.mockClear();
});

// ── Path A — saveAssessmentScores (raw assessment marks) ─────────────────────────────────────────
describe("#273 · Path A (saveAssessmentScores) enforces the bound", () => {
  const marks = (raw: string) => ({
    classId: CLASS,
    subjectId: SUBJ,
    periodId: PERIOD,
    scores: [{ assessmentId: ASMT, studentId: STU, raw }],
  });

  it("rejects any out-of-range mark with the 999.99 error and writes nothing", async () => {
    for (const bad of OUT_OF_RANGE) {
      const res = await saveAssessmentScores(marks(bad));
      expect(res.ok).toBe(false);
      if (res.ok) throw new Error("unreachable");
      expect(res.error).toMatch(/999\.99/);
    }
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("accepts a bonus mark >100 (150) — never the range reject", async () => {
    const res = await saveAssessmentScores(marks("150"));
    // Passes the bound and reaches the (empty-roster) compile → ok, saved 0. The reject is gone.
    expect(res.ok).toBe(true);
  });
});

// ── Path B — commitScanLedger (scan verify & commit) ─────────────────────────────────────────────
describe("#273 · Path B (commitScanLedger) enforces the bound", () => {
  const scan = (over: Record<string, string>) => ({
    classId: CLASS,
    subjectId: SUBJ,
    periodId: PERIOD,
    origin: "SCAN_EXTRACT" as const,
    scores: [
      { studentId: STU, asgn: "50", midSem: "50", endSem: "50", project: "50", portfolio: "50", ...over },
    ],
  });

  it("rejects any out-of-range category cell with the 999.99 error and writes nothing", async () => {
    for (const bad of OUT_OF_RANGE) {
      const res = await commitScanLedger(scan({ project: bad }));
      expect(res.ok).toBe(false);
      if (res.ok) throw new Error("unreachable");
      expect(res.error).toMatch(/999\.99/);
    }
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("accepts a bonus mark >100 (150) — falls through on path, not on the bound", async () => {
    const res = await commitScanLedger(scan({ project: "150" }));
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.error).not.toMatch(/999\.99/); // the "switch to Path B" message, not the range reject
  });
});

// ── Path C — saveDirectLedgerScores (direct digital entry) ───────────────────────────────────────
describe("#273 · Path C (saveDirectLedgerScores) enforces the bound", () => {
  const direct = (over: Record<string, string>) => ({
    classId: CLASS,
    subjectId: SUBJ,
    periodId: PERIOD,
    scores: [
      { studentId: STU, asgn: "50", midSem: "50", endSem: "50", project: "50", portfolio: "50", ...over },
    ],
  });

  it("rejects any out-of-range category cell with the 999.99 error and writes nothing", async () => {
    for (const bad of OUT_OF_RANGE) {
      const res = await saveDirectLedgerScores(direct({ endSem: bad }));
      expect(res.ok).toBe(false);
      if (res.ok) throw new Error("unreachable");
      expect(res.error).toMatch(/999\.99/);
    }
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("accepts a bonus mark >100 (150) — falls through on path, not on the bound", async () => {
    const res = await saveDirectLedgerScores(direct({ endSem: "150" }));
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.error).not.toMatch(/999\.99/); // the "switch to Path C" message, not the range reject
  });
});
