import { and, eq, gte, lte, sql } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import { bookEntries } from "@/db/schema";

/**
 * GOV-3 · term-windowed books totals for the net-position finance arm (R348).
 *
 * The `/books/reports` page computes income/expense BY CATEGORY over a CALENDAR-YEAR filter; the
 * rollup needs a plain income/expense/row-count total over the resolved TERM window
 * [startsOn, endsOn] INCLUSIVE — a distinct query (no category grouping, date-window not year), so
 * this is not a duplication of that page. `entry_date` is a plain `date`, compared as "YYYY-MM-DD"
 * strings against the term bounds, so an entry dated on the last day of term IS included (inclusive
 * both ends). Uses book_entry_school_date_idx (school_id, entry_date).
 *
 * `rowCount` is the ARM's captured/not-captured discriminator: absence is drawn at row-count == 0,
 * NEVER at net === 0 (income == expense with ≥1 entry is a real, CAPTURED zero).
 */
export async function getBooksFinanceLine(
  schoolId: string,
  window: { startsOn: string; endsOn: string },
): Promise<{ income: number; expense: number; rowCount: number }> {
  const [row] = await withSchool(schoolId, (tx) =>
    tx
      .select({
        income: sql<string>`coalesce(sum(${bookEntries.amount}) filter (where ${bookEntries.kind} = 'INCOME'), 0)`,
        expense: sql<string>`coalesce(sum(${bookEntries.amount}) filter (where ${bookEntries.kind} = 'EXPENSE'), 0)`,
        rowCount: sql<number>`count(*)`,
      })
      .from(bookEntries)
      .where(
        and(
          eq(bookEntries.schoolId, schoolId),
          gte(bookEntries.entryDate, window.startsOn),
          lte(bookEntries.entryDate, window.endsOn),
        ),
      ),
  );
  // sum() returns a numeric → the pg driver hands it back as a STRING; coerce with Number().
  return {
    income: Number(row?.income ?? 0),
    expense: Number(row?.expense ?? 0),
    rowCount: Number(row?.rowCount ?? 0),
  };
}
