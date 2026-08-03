import { describe, it, expect, vi, beforeEach } from "vitest";
import { withSchool } from "@/lib/db/rls";
import { getPayrollLine } from "./payroll-line-data";

/**
 * GOV-3 · payroll-line data fn. `withSchool` is mocked to hand back a canned aggregate row (the query
 * callback never runs → no DB). Guards the money-string coercion and — critically — that school-paid,
 * GES and allowance stay SEPARATE figures (never folded together), plus the zero-row discriminator.
 */
vi.mock("@/lib/db/rls", () => ({ withSchool: vi.fn() }));

describe("getPayrollLine · coercion + memo separation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("coerces strings and keeps school-paid / GES / allowance as SEPARATE figures", async () => {
    vi.mocked(withSchool).mockResolvedValue([
      {
        schoolPaid: "24000",
        schoolPaidCount: 6,
        ges: "9000",
        gesCount: 3,
        allowance: "1500",
        allowanceCount: 2,
        rowCount: 11,
      },
    ]);
    expect(await getPayrollLine("s1")).toEqual({
      schoolPaidMonthlyTotal: 24000,
      schoolPaidStaffCount: 6,
      gesPaidMonthlyMemo: 9000,
      gesPaidStaffCount: 3,
      allowanceMonthlyMemo: 1500,
      allowanceStaffCount: 2,
      rowCount: 11,
    });
  });

  it("zero comp rows → all zeros incl rowCount 0 (the NOT_APPLICABLE discriminator)", async () => {
    vi.mocked(withSchool).mockResolvedValue([
      { schoolPaid: "0", schoolPaidCount: 0, ges: "0", gesCount: 0, allowance: "0", allowanceCount: 0, rowCount: 0 },
    ]);
    const r = await getPayrollLine("s1");
    expect(r.rowCount).toBe(0);
    expect(r.schoolPaidMonthlyTotal).toBe(0);
  });
});
