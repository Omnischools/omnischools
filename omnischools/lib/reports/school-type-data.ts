import "server-only";
import { eq } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import { schools } from "@/db/schema";

export type SchoolType = "BASIC" | "SENIOR" | "COMBINED";

/**
 * GOV-4 · the DB-AUTHORITATIVE school tier (R355) that drives the performance arm's per-sub-arm
 * tier-gating. Read under `withSchool` (tenant-scoped) straight off `ref_school.school_type` — NEVER
 * from `opts` / a URL / a session claim, so a school can't be talked into computing a tier it doesn't
 * run. Extracted into its own server-only reader so the rollup composes it and stays zero-SQL (R360).
 *
 * Defaults to BASIC if the row is somehow unreadable — the conservative fallback (senior arms then
 * report NOT_APPLICABLE rather than fabricating readiness for a tier that may not exist).
 */
export async function getSchoolType(schoolId: string): Promise<SchoolType> {
  const rows = await withSchool(schoolId, (tx) =>
    tx
      .select({ schoolType: schools.schoolType })
      .from(schools)
      .where(eq(schools.id, schoolId))
      .limit(1),
  );
  return rows[0]?.schoolType ?? "BASIC";
}
