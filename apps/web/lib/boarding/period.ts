/**
 * SERVER-ONLY canonical academic-period resolver (SHS module 4.2 / INCR-11 tweak #2). ONE place
 * every boarding increment (9 exeat / 10 daily / 11 resumption / 12 visiting) resolves "the current
 * SHS semester" and "the year the calendar keys on" — previously duplicated in exeat-data.ts. Kept
 * beside config.ts so the frozen contract + its period source live together.
 *
 * Scoped to product_line='SENIOR' (Kofi OQ6 / tweak #1): after 0048 each SHS school ALSO carries a
 * SENIOR_F3 academic_period row (Form 3's early post-WASSCE vacation). Scoping to SENIOR keeps this
 * resolver's result byte-identical to its pre-0048 behaviour (there were no SENIOR_F3 rows then) and
 * stops the F3 row leaking into the resolved semester — the arrival records against the SENIOR
 * period_id, never the SENIOR_F3 one (AC J2, and the resumption's "resolved SENIOR semester" FK).
 */
import "server-only";
import { and, desc, eq } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { academicPeriod } from "@/db/schema";

export interface CurrentPeriod {
  periodId: string;
  academicYear: string;
  periodLabel: string;
}

/**
 * The school's current SHS semester (SENIOR product line) — the period covering today, else the
 * latest that has begun, else the last configured. Null when the school has no SENIOR period
 * (a day-only / not-yet-configured school — the callers all handle null coherently, never throw).
 */
export async function getCurrentPeriod(tx: Tx, schoolId: string): Promise<CurrentPeriod | null> {
  const rows = await tx
    .select({
      periodId: academicPeriod.periodId,
      academicYear: academicPeriod.academicYear,
      periodLabel: academicPeriod.periodLabel,
      startsOn: academicPeriod.startsOn,
      endsOn: academicPeriod.endsOn,
    })
    .from(academicPeriod)
    .where(and(eq(academicPeriod.schoolId, schoolId), eq(academicPeriod.productLine, "SENIOR")))
    .orderBy(desc(academicPeriod.startsOn));
  if (rows.length === 0) return null;
  const today = new Date().toISOString().slice(0, 10);
  const cur =
    rows.find((r) => r.startsOn <= today && r.endsOn >= today) ??
    rows.find((r) => r.startsOn <= today) ??
    rows[rows.length - 1];
  return { periodId: cur.periodId, academicYear: cur.academicYear, periodLabel: cur.periodLabel };
}
