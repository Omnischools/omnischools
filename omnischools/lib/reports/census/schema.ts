import { z } from "zod";
import type { CensusEnrolment, SexSplit } from "@/lib/reports/census-enrolment-data";
import type { CensusStaffGroup, CensusSalaryStatus } from "@/lib/reports/census/census-staff-data";
import type { TerminalResultSummary } from "@/lib/reports/terminal-results-data";
import type { FacilitiesSnapshotRow } from "@/lib/reports/facilities-data";

/**
 * GOV-8 · the census `auto_snapshot` SHAPE — owned here, at the app boundary, NOT in the DDL (the DB stores
 * plain jsonb because a GES filing document drifts 50+ heterogeneous fields per revision — Kofi / the schema
 * note). This is the VERSIONED contract: bump `CENSUS_SNAPSHOT_VERSION` when the envelope changes so a stored
 * snapshot can be read against the version it was frozen under.
 *
 * The ENVELOPE (version, cadence, academic year, the frozen census_date, identification, and — critically —
 * every section's honesty tag) is strongly validated; each section's `data` payload is `z.unknown()` (the
 * jsonb drift boundary). The typed `CensusSnapshot` below gives the app typed access to those payloads while
 * the persisted/re-read shape is validated by the Zod schema.
 *
 * GOV-9 (annual) EXTENDS this: it widens the in-scope section set and adds the print PDF — it does NOT change
 * the envelope, so an annual snapshot validates against the same v1 schema.
 */
export const CENSUS_SNAPSHOT_VERSION = 1 as const;

/** The honesty tag frozen per section (Kofi §2 / GOV8-07). CAPTURED→FULL; some→PARTIAL; none→NONE (a hatched
 *  hand-fill blank, never a fabricated 0); tier/no-payroll→NOT_APPLICABLE. */
export const CENSUS_COVERAGE = ["FULL", "PARTIAL", "NONE", "NOT_APPLICABLE"] as const;
export type CensusCoverage = (typeof CENSUS_COVERAGE)[number];

/** A tagged section result — narrow on `coverage` before touching `data`, so a fabricated figure for an
 *  un-captured section is a compile error (the RollupArm honesty convention, carried into the census). */
export type CensusArm<T> =
  | { coverage: "FULL"; data: T; captured?: number; total?: number }
  | { coverage: "PARTIAL"; data: T; reason: string; captured?: number; total?: number }
  | { coverage: "NONE"; reason: string }
  | { coverage: "NOT_APPLICABLE"; reason: string };

export type CensusIdentification = {
  schoolName: string;
  gesCode: string;
  schoolType: string;
  district: string | null;
  region: string | null;
  circuit: string | null; // NOT stored on ref_school → always null → hatched blank in the PDF (GOV-9)
  ownership: string | null;
  yearFounded: string | null;
};

export type CensusMovement = {
  hasPeriod: boolean;
  admissionsThisPeriod: number | null;
  intakeFemale: number | null;
  intakeMale: number | null;
};
export type CensusPtr = { ratio: number | null; teachingStaff: number; roll: number };
export type CensusAttendance = { schoolRate: number | null; totalMarked: number };
export type CensusTerminal = { bece?: TerminalResultSummary; wassce?: TerminalResultSummary };
export type CensusPerformance = {
  basic?: { overallAverage: number | null; passRate: number | null; gradedClasses: number };
  seniorSubjectsReady?: number;
};
export type CensusAgeSummary = { roll: number; dobUnknown: number; levelsWithAge: number };

/** Every section key → its typed payload. The generator fills these; the view reads them (post-validation). */
export type CensusSections = {
  enrolment: CensusArm<CensusEnrolment>;
  ageDistribution: CensusArm<CensusAgeSummary>;
  ownership: CensusArm<{ ownership: string }>;
  specialNeeds: CensusArm<never>;
  movement: CensusArm<CensusMovement>;
  repetition: CensusArm<never>;
  teachingStaff: CensusArm<CensusStaffGroup>;
  ptr: CensusArm<CensusPtr>;
  qualifications: CensusArm<never>;
  nonTeachingStaff: CensusArm<CensusStaffGroup>;
  salaryStatus: CensusArm<CensusSalaryStatus>;
  attendance: CensusArm<CensusAttendance>;
  terminalResults: CensusArm<CensusTerminal>;
  academicPerformance: CensusArm<CensusPerformance>;
  infrastructure: CensusArm<FacilitiesSnapshotRow>;
  feeding: CensusArm<never>;
  textbooks: CensusArm<never>;
};
export type CensusSectionKey = keyof CensusSections;

export type CensusSnapshot = {
  version: typeof CENSUS_SNAPSHOT_VERSION;
  cadence: "MID_YEAR" | "ANNUAL";
  academicYear: string;
  censusDate: string; // frozen ISO "YYYY-MM-DD" (GOV8-02)
  generatedAt: string; // ISO datetime
  period: { periodId: string; label: string; academicYear: string } | null;
  identification: CensusIdentification;
  sections: CensusSections;
};

export type { SexSplit };

// ── Zod: the persisted/re-read validation (envelope strict, section data = jsonb-drift-tolerant) ──────────
// FULL/PARTIAL MUST carry `data` — GOV-9 renders a stored snapshot via `dataOf(arm)!`, so a data-less FULL
// arm would crash it (LOW-3). NONE/NOT_APPLICABLE carry only a hand-fill `reason` (never a fabricated 0). The
// payload itself stays `z.unknown()` (the jsonb-drift boundary); only its PRESENCE is enforced per coverage.
const presentData = z.unknown().refine((v) => v !== undefined, { message: "data is required" });
const armSchema = z.discriminatedUnion("coverage", [
  z.object({ coverage: z.literal("FULL"), data: presentData, captured: z.number().optional(), total: z.number().optional() }),
  z.object({ coverage: z.literal("PARTIAL"), data: presentData, reason: z.string(), captured: z.number().optional(), total: z.number().optional() }),
  z.object({ coverage: z.literal("NONE"), reason: z.string() }),
  z.object({ coverage: z.literal("NOT_APPLICABLE"), reason: z.string() }),
]);

const identificationSchema = z.object({
  schoolName: z.string(),
  gesCode: z.string(),
  schoolType: z.string(),
  district: z.string().nullable(),
  region: z.string().nullable(),
  circuit: z.string().nullable(),
  ownership: z.string().nullable(),
  yearFounded: z.string().nullable(),
});

export const censusSnapshotSchema = z.object({
  version: z.literal(CENSUS_SNAPSHOT_VERSION),
  cadence: z.enum(["MID_YEAR", "ANNUAL"]),
  academicYear: z.string().min(1),
  censusDate: z.string().min(1),
  generatedAt: z.string().min(1),
  period: z
    .object({ periodId: z.string(), label: z.string(), academicYear: z.string() })
    .nullable(),
  identification: identificationSchema,
  // Every section carries a coverage tag; the exact key set is the app's (view registry), so a record keeps
  // the schema tolerant of adding/removing a section without a version bump when the envelope is unchanged.
  sections: z.record(z.string(), armSchema),
});

/** Parse a stored/generated snapshot against the versioned schema, returning the app-typed shape. */
export function parseCensusSnapshot(raw: unknown): CensusSnapshot {
  censusSnapshotSchema.parse(raw);
  return raw as CensusSnapshot;
}
