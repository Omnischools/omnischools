import "server-only";
import { and, eq } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import { censusReturn } from "@/db/schema";

export type CensusFilingStatus = "COMPLETED" | "DRAFT" | "NONE";

/**
 * Cheap one-row lookup: is THIS year's ANNUAL GES census filed? (INS §17-D nudge signal.)
 *   COMPLETED → filed + locked (the print-and-sign PDF is the official return)
 *   DRAFT     → generated, not yet completed
 *   NONE      → no return row for this (school × ANNUAL × academic_year)
 *
 * ANNUAL only — the annual GES return is the statutory filing directors answer for (the MID_YEAR return is
 * out of scope for the nudge). `withSchool`-scoped (RLS applies); reads the EXISTING `census_return` table
 * that GOV-8/GOV-9 write — no new schema. The `academicYear` comes from the caller's resolved rollup period.
 */
export async function getAnnualCensusStatus(
  schoolId: string,
  academicYear: string,
): Promise<CensusFilingStatus> {
  const rows = await withSchool(schoolId, (tx) =>
    tx
      .select({ status: censusReturn.status })
      .from(censusReturn)
      .where(
        and(
          eq(censusReturn.schoolId, schoolId),
          eq(censusReturn.cadence, "ANNUAL"),
          eq(censusReturn.academicYear, academicYear),
        ),
      )
      .limit(1),
  );
  return (rows[0]?.status as CensusFilingStatus | undefined) ?? "NONE";
}
