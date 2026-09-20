import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import { facilitiesSnapshot, academicPeriod } from "@/db/schema";

/**
 * GOV-7 · the facilities-snapshot reader (school-level per-term infrastructure census) — server-only,
 * `withSchool`-scoped, so the shared rollup composes it and stays zero-SQL (R381). Returns the RAW row
 * (every column) so the GOV-8 census can read the full field list; the board's projection is a SEPARATE
 * pure derive (`deriveInfrastructureSummary`) that DROPS the census-only fields (R378).
 *
 * `pctGood` and `latrinesTotal` are DERIVED at read (R377), never stored — a stored total would drift
 * from its own leaves. The board shows the LATEST snapshot regardless of the selected period (R380), so
 * the no-periodId path picks the newest term's row.
 */

/** The raw snapshot row + its term's label/year (joined). All columns — the GOV-8 census reads this. */
export type FacilitiesSnapshotRow = typeof facilitiesSnapshot.$inferSelect & {
  periodLabel: string;
  academicYear: string;
};

/**
 * The board projection (R377). DELIBERATELY has NO field for `catererName`, `libraryStaffFte`, furniture
 * (desks/boards/projectors) or the per-sex latrine split — those are census-only (R378), so their absence
 * from this type makes putting one on the board a COMPILE ERROR. `pctGood` / `latrinesTotal` are derived.
 */
export type InfrastructureSummary = {
  capturedFor: { periodLabel: string; academicYear: string };
  capturedAt: Date;
  classrooms: { total: number; good: number; needingRepair: number; pctGood: number | null };
  utilities: {
    waterSource: string;
    electricitySource: string;
    latrineType: string;
    latrinesTotal: number;
    handwashing: boolean;
  };
  ict: { hasLab: boolean; computers: number | null; working: number | null; internet: boolean };
  library: { has: boolean; bookCount: number | null };
  feeding: { hasKitchen: boolean; gsfpParticipating: boolean; pupilsFedDaily: number | null };
  textbooks: { availability: string | null };
};

/** The intra-tenant term join, shared by every read here. */
const periodJoin = and(
  eq(academicPeriod.schoolId, facilitiesSnapshot.schoolId),
  eq(academicPeriod.periodId, facilitiesSnapshot.periodId),
);

const flatten = (r: {
  snapshot: typeof facilitiesSnapshot.$inferSelect;
  periodLabel: string;
  academicYear: string;
}): FacilitiesSnapshotRow => ({ ...r.snapshot, periodLabel: r.periodLabel, academicYear: r.academicYear });

const selectShape = {
  snapshot: facilitiesSnapshot,
  periodLabel: academicPeriod.periodLabel,
  academicYear: academicPeriod.academicYear,
} as const;

/**
 * One captured snapshot. No `periodId` → the LATEST snapshot (newest academicYear, then periodNumber). A
 * `periodId` → THAT term's raw row (for the GOV-8 census — GOV7-15). Null when the school has captured none.
 */
export async function getFacilitiesSnapshot(
  schoolId: string,
  opts?: { periodId?: string },
): Promise<FacilitiesSnapshotRow | null> {
  const rows = await withSchool(schoolId, (tx) => {
    const base = tx
      .select(selectShape)
      .from(facilitiesSnapshot)
      .innerJoin(academicPeriod, periodJoin);
    return opts?.periodId
      ? base
          .where(
            and(
              eq(facilitiesSnapshot.schoolId, schoolId),
              eq(facilitiesSnapshot.periodId, opts.periodId),
            ),
          )
          .limit(1)
      : base
          .where(eq(facilitiesSnapshot.schoolId, schoolId))
          // Latest term first — text academicYear "2025/26" sorts lexically (matches listAcademicTerms).
          .orderBy(desc(academicPeriod.academicYear), desc(academicPeriod.periodNumber))
          .limit(1);
  });
  return rows[0] ? flatten(rows[0]) : null;
}

/**
 * The pure board projection (R377). `pctGood` = good ÷ total (null when no classrooms recorded), and
 * `latrinesTotal` = boys + girls + staff — both DERIVED here, never stored. Census-only fields are
 * structurally dropped (R378): if `InfrastructureSummary` ever grew one, the board would compile it in.
 */
export function deriveInfrastructureSummary(row: FacilitiesSnapshotRow): InfrastructureSummary {
  return {
    capturedFor: { periodLabel: row.periodLabel, academicYear: row.academicYear },
    capturedAt: row.capturedAt,
    classrooms: {
      total: row.classroomsTotal,
      good: row.classroomsGood,
      needingRepair: row.classroomsRepair,
      pctGood:
        row.classroomsTotal > 0 ? Math.round((row.classroomsGood / row.classroomsTotal) * 100) : null,
    },
    utilities: {
      waterSource: row.waterSource,
      electricitySource: row.electricitySource,
      latrineType: row.latrineType,
      latrinesTotal: row.latrinesBoys + row.latrinesGirls + row.latrinesStaff,
      handwashing: row.handwashing,
    },
    ict: {
      hasLab: row.hasIctLab,
      computers: row.computersTotal,
      working: row.computersWorking,
      internet: row.internet,
    },
    library: { has: row.hasLibrary, bookCount: row.libraryBookCount },
    feeding: {
      hasKitchen: row.hasKitchen,
      gsfpParticipating: row.gsfpParticipating,
      pupilsFedDaily: row.pupilsFedDailyAvg,
    },
    textbooks: { availability: row.textbookAvailability },
  };
}

/** One captured snapshot for the management list — the derived board summary + its term id. */
export type FacilitiesListing = InfrastructureSummary & { periodId: string };

/**
 * ALL captured snapshots for the management capture surface's list, newest term first. Derives each row's
 * summary through the SAME `deriveInfrastructureSummary` the rollup uses.
 */
export async function listFacilitiesSnapshots(schoolId: string): Promise<FacilitiesListing[]> {
  const rows = await withSchool(schoolId, (tx) =>
    tx
      .select(selectShape)
      .from(facilitiesSnapshot)
      .innerJoin(academicPeriod, periodJoin)
      .where(eq(facilitiesSnapshot.schoolId, schoolId))
      .orderBy(desc(academicPeriod.academicYear), desc(academicPeriod.periodNumber)),
  );
  return rows.map((r) => {
    const flat = flatten(r);
    return { ...deriveInfrastructureSummary(flat), periodId: flat.periodId };
  });
}
