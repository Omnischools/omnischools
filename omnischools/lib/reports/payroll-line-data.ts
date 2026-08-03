import { eq, sql } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import { staffCompensation } from "@/db/schema";

/**
 * GOV-3 · payroll run-rate for the net-position finance arm (R345/R346).
 *
 * Point-in-time over `staff_compensation` — a current MONTHLY figure, NOT multiplied over the term
 * (period-INDEPENDENT). `schoolPaidMonthlyTotal` is the GROSS Σ monthly_amount for SCHOOL_PAID staff
 * (the compensation page's hero shows NET — this is deliberately gross, disambiguated in the board
 * label). GES-paid and allowance-only are SEPARATE memos: never folded into the school-paid total
 * (OC-GOV3-ALLOWANCE).
 *
 * `rowCount` is the arm discriminator: zero rows → NOT_APPLICABLE (the school runs no payroll here);
 * ≥1 row → CAPTURED, INCLUDING an all-GES school (then `schoolPaidMonthlyTotal` is a real 0 shown
 * alongside a GES memo > 0).
 */
export async function getPayrollLine(schoolId: string): Promise<{
  schoolPaidMonthlyTotal: number;
  schoolPaidStaffCount: number;
  gesPaidMonthlyMemo: number;
  gesPaidStaffCount: number;
  allowanceMonthlyMemo: number;
  allowanceStaffCount: number;
  rowCount: number;
}> {
  const amt = (status: string) =>
    sql<string>`coalesce(sum(${staffCompensation.monthlyAmount}) filter (where ${staffCompensation.salaryStatus} = ${status}), 0)`;
  const cnt = (status: string) =>
    sql<number>`count(*) filter (where ${staffCompensation.salaryStatus} = ${status})`;

  const [row] = await withSchool(schoolId, (tx) =>
    tx
      .select({
        schoolPaid: amt("SCHOOL_PAID"),
        schoolPaidCount: cnt("SCHOOL_PAID"),
        ges: amt("GES_PAID"),
        gesCount: cnt("GES_PAID"),
        allowance: amt("ALLOWANCE"),
        allowanceCount: cnt("ALLOWANCE"),
        rowCount: sql<number>`count(*)`,
      })
      .from(staffCompensation)
      .where(eq(staffCompensation.schoolId, schoolId)),
  );
  // sum() → numeric STRING from the pg driver; coerce with Number().
  return {
    schoolPaidMonthlyTotal: Number(row?.schoolPaid ?? 0),
    schoolPaidStaffCount: Number(row?.schoolPaidCount ?? 0),
    gesPaidMonthlyMemo: Number(row?.ges ?? 0),
    gesPaidStaffCount: Number(row?.gesCount ?? 0),
    allowanceMonthlyMemo: Number(row?.allowance ?? 0),
    allowanceStaffCount: Number(row?.allowanceCount ?? 0),
    rowCount: Number(row?.rowCount ?? 0),
  };
}
