import { and, desc, eq, isNotNull } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { wassceCohort } from "@/db/schema";

/**
 * The ACTIVE WASSCE cohort for a school (SHS module 4.3 / INCR-16 — fixes Dex MINOR-1). The active
 * cohort is the FROZEN cohort with the greatest exam year: `WHERE setup_frozen_at IS NOT NULL ORDER BY
 * exam_year DESC LIMIT 1`. With F3-2026 frozen + F2-2027 in-flight this resolves to F3-2026 — the
 * cohort the setup surface centres on and the one whose mocks/results the subject-teacher surface reads.
 *
 * The INCR-15 loader selected the cohort via `asc(exam_year)` first-row (right only by accident with a
 * single cohort; wrong once INCR-16 seeds F2-2027). A naive `asc → desc` flip is ALSO wrong — it would
 * pick the unfrozen F2-2027. Frozen-state IS the selector. Call inside `withSchool(...)`. Returns null
 * when no cohort has been frozen yet.
 */
export async function getActiveCohort(
  tx: Tx,
  schoolId: string,
): Promise<typeof wassceCohort.$inferSelect | null> {
  const [cohort] = await tx
    .select()
    .from(wassceCohort)
    .where(and(eq(wassceCohort.schoolId, schoolId), isNotNull(wassceCohort.setupFrozenAt)))
    .orderBy(desc(wassceCohort.examYear))
    .limit(1);
  return cohort ?? null;
}
