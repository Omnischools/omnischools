import { describe, it, expect, vi, beforeEach } from "vitest";
import { withSchool } from "@/lib/db/rls";
import { getBooksFinanceLine } from "./books-finance-data";

/**
 * GOV-3 · books-finance data fn. `withSchool` is mocked to hand back a canned aggregate row (the
 * query callback is never run → no DB), so this exercises the real logic worth guarding: the
 * numeric-STRING → number coercion (money path) and the row-count discriminator field.
 */
vi.mock("@/lib/db/rls", () => ({ withSchool: vi.fn() }));

describe("getBooksFinanceLine · coercion + shape", () => {
  beforeEach(() => vi.clearAllMocks());

  it("coerces the numeric STRINGS the pg driver returns into numbers", async () => {
    vi.mocked(withSchool).mockResolvedValue([{ income: "30000.00", expense: "18000.50", rowCount: 12 }]);
    const r = await getBooksFinanceLine("s1", { startsOn: "2025-09-01", endsOn: "2025-12-19" });
    expect(r).toEqual({ income: 30000, expense: 18000.5, rowCount: 12 });
  });

  it("defaults to zeros when the aggregate row is absent (never NaN)", async () => {
    vi.mocked(withSchool).mockResolvedValue([undefined]);
    expect(await getBooksFinanceLine("s1", { startsOn: "a", endsOn: "b" })).toEqual({
      income: 0,
      expense: 0,
      rowCount: 0,
    });
  });
});
