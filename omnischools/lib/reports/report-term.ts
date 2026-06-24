import { asc, eq } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import { academicPeriod } from "@/db/schema";
import type { TermInfo } from "./period";

/**
 * The school's "current" academic term — the window containing today, else the
 * latest term that has started, else the last configured term. Powers the PERIOD
 * filter's "This term" option and pill label. Returns null when no term is set.
 */
export async function getReportTerm(schoolId: string): Promise<TermInfo> {
  const rows = await withSchool(schoolId, (tx) =>
    tx
      .select({
        label: academicPeriod.periodLabel,
        academicYear: academicPeriod.academicYear,
        startsOn: academicPeriod.startsOn,
        endsOn: academicPeriod.endsOn,
      })
      .from(academicPeriod)
      .where(eq(academicPeriod.schoolId, schoolId))
      .orderBy(asc(academicPeriod.startsOn)),
  );
  if (!rows.length) return null;
  const today = new Date().toISOString().slice(0, 10);
  const cur =
    rows.find((r) => r.startsOn <= today && r.endsOn >= today) ??
    [...rows].reverse().find((r) => r.startsOn <= today) ??
    rows[rows.length - 1];
  return {
    label: cur.label,
    academicYear: cur.academicYear,
    start: new Date(`${cur.startsOn}T00:00:00.000Z`),
    end: new Date(`${cur.endsOn}T00:00:00.000Z`),
  };
}
