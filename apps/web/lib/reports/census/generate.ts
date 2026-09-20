import "server-only";
import { eq } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import { schools, districts, regions } from "@/db/schema";
import { getSchoolRollup } from "@/lib/rollup/school-rollup";
import { getCensusEnrolment } from "@/lib/reports/census-enrolment-data";
import { getFacilitiesSnapshot } from "@/lib/reports/facilities-data";
import { getCensusStaff } from "@/lib/reports/census/census-staff-data";
import { getCensusSpecialNeeds, type CensusSpecialNeeds } from "@/lib/reports/census/sen-data";
import {
  CENSUS_SNAPSHOT_VERSION,
  type CensusSnapshot,
  type CensusSections,
  type CensusIdentification,
} from "@/lib/reports/census/schema";

/**
 * GOV-8 · the census GENERATOR — composes the live readers into a FROZEN `auto_snapshot` (Kofi §3 / the task).
 * Server-only. It reuses the shipped GOV-1..7 rollup arms (enrolment / attendance / performance /
 * terminalResults + the raw facilities row for infrastructure), the net-new `getCensusEnrolment` (sex×age×
 * level), and `getCensusStaff` (teaching/non-teaching×sex + salary status). It NEVER reads the finance arm
 * (`netPositionFinance` / `feeCollections`) — the census excludes finance by design.
 *
 * Honesty is FROZEN INTO THE RECORD (GOV8-07): each section is narrowed on the reader's `status` →
 * CAPTURED becomes a FULL section carrying the figure; NOT_CAPTURED/NOT_APPLICABLE become a NONE/NA section
 * carrying the reader's `reason` as the hand-fill prompt — NEVER a fabricated 0. `census_date` is frozen at
 * generation and threaded into `getCensusEnrolment` so the age/roll disaggregation is point-in-time (GOV8-02):
 * a later roll change cannot move a filed census.
 *
 * GOV-9 (annual) EXTENDS this — same composition, plus the annual-only auto-fills it activates and the PDF.
 */

/** Derive a "2025/26" academic-year label from a date when no term is configured (Ghana year starts Sept). */
function deriveYearLabel(d: Date): string {
  const y = d.getUTCFullYear();
  const startYear = d.getUTCMonth() >= 8 ? y : y - 1; // Sept (month 8) onward is the new academic year
  return `${startYear}/${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/** Read-only identification preview from the school profile (Lucy §3.2). `circuit` is NOT stored on
 *  `ref_school` → always null → the PDF prints a hatched blank (GOV-9); never blocks generation. */
async function getCensusIdentification(schoolId: string): Promise<CensusIdentification> {
  const rows = await withSchool(schoolId, (tx) =>
    tx
      .select({
        schoolName: schools.name,
        gesCode: schools.gesCode,
        schoolType: schools.schoolType,
        ownership: schools.ownership,
        yearFounded: schools.yearFounded,
        district: districts.name,
        region: regions.name,
      })
      .from(schools)
      .leftJoin(districts, eq(schools.districtId, districts.id))
      .leftJoin(regions, eq(schools.regionId, regions.id))
      .where(eq(schools.id, schoolId))
      .limit(1),
  );
  const r = rows[0];
  return {
    schoolName: r?.schoolName ?? "",
    gesCode: r?.gesCode ?? "",
    schoolType: r?.schoolType ?? "",
    district: r?.district ?? null,
    region: r?.region ?? null,
    circuit: null,
    ownership: r?.ownership ?? null,
    yearFounded: r?.yearFounded ?? null,
  };
}

/** GOV-10 R413 — narrow the de-identified SEN aggregate into the §5 arm. `adopted` → FULL (a captured 0 is
 *  a truth the school is entitled to state, not a fabrication); not-adopted → NONE with a hand-fill reason
 *  (NEVER a zeros payload). Only called in an ANNUAL run — the DB is never read at mid-year. */
function senArm(sn: CensusSpecialNeeds): CensusSections["specialNeeds"] {
  return sn.adopted
    ? { coverage: "FULL", data: sn }
    : {
        coverage: "NONE",
        reason:
          "SEN register not adopted — special-needs enrolment is hand-filled (annual). Enable the SEN register to auto-fill §5.",
      };
}

export type GenerateCensusOpts = { cadence: "MID_YEAR" | "ANNUAL"; censusDate: Date; periodId?: string };

export async function generateCensusSnapshot(
  schoolId: string,
  opts: GenerateCensusOpts,
): Promise<CensusSnapshot> {
  const { cadence, censusDate, periodId } = opts;

  const [rollup, enrolment, staff, facilitiesRow, identification] = await Promise.all([
    getSchoolRollup(schoolId, { periodId }),
    getCensusEnrolment(schoolId, { censusDate }),
    getCensusStaff(schoolId),
    getFacilitiesSnapshot(schoolId),
    getCensusIdentification(schoolId),
  ]);

  const academicYear = rollup.period?.academicYear ?? deriveYearLabel(censusDate);
  const period = rollup.period
    ? { periodId: rollup.period.periodId, label: rollup.period.label, academicYear: rollup.period.academicYear }
    : null;

  // ── Section A · enrolment / age / ownership / movement / SEN / repetition ──────────────────────────
  const enrolmentSection: CensusSections["enrolment"] =
    enrolment.roll > 0
      ? { coverage: "FULL", data: enrolment }
      : { coverage: "NONE", reason: "No students currently enrolled." };

  const known = enrolment.roll - enrolment.dobUnknown;
  const ageDistribution: CensusSections["ageDistribution"] =
    enrolment.roll === 0
      ? { coverage: "NONE", reason: "No students currently enrolled." }
      : known === 0
        ? { coverage: "NONE", reason: "No student dates of birth captured — ages are left blank, never guessed." }
        : enrolment.dobUnknown > 0
          ? {
              coverage: "PARTIAL",
              data: { roll: enrolment.roll, dobUnknown: enrolment.dobUnknown, levelsWithAge: enrolment.approvedAge.length },
              reason: `${enrolment.dobUnknown} of ${enrolment.roll} students have no DOB — those age cells stay blank.`,
              captured: known,
              total: enrolment.roll,
            }
          : {
              coverage: "FULL",
              data: { roll: enrolment.roll, dobUnknown: 0, levelsWithAge: enrolment.approvedAge.length },
            };

  const ownership: CensusSections["ownership"] = identification.ownership
    ? { coverage: "FULL", data: { ownership: identification.ownership } }
    : { coverage: "NONE", reason: "School ownership is not set in the school profile." };

  const movement: CensusSections["movement"] =
    rollup.enrolment.status !== "CAPTURED"
      ? { coverage: "NONE", reason: "No students enrolled — no admissions to report." }
      : rollup.enrolment.data.admissionsThisTerm == null
        ? { coverage: "NONE", reason: "No academic period configured — admissions cannot be windowed." }
        : {
            coverage: "FULL",
            data: {
              hasPeriod: true,
              admissionsThisPeriod: rollup.enrolment.data.admissionsThisTerm,
              intakeFemale: rollup.enrolment.data.intakeFemale,
              intakeMale: rollup.enrolment.data.intakeMale,
            },
          };

  // SEN §5 (GOV-10, R413/R418) — ANNUAL only. Adopted → FULL even at a captured zero; not-adopted → NONE
  // (hand-fill), NEVER a fabricated zeros payload. The DB is never touched in a mid-year run.
  const specialNeeds: CensusSections["specialNeeds"] =
    cadence === "ANNUAL"
      ? senArm(await getCensusSpecialNeeds(schoolId))
      : {
          coverage: "NONE",
          reason: "Special-needs enrolment is an annual census field (SEN register).",
        };
  const repetition: CensusSections["repetition"] = {
    coverage: "NONE",
    reason: "Promotion history is not tracked in Omnischools — repeaters are hand-filled (annual).",
  };

  // ── Section B · staff ──────────────────────────────────────────────────────────────────────────────
  const staffGroupArm = (
    g: typeof staff.teaching,
    noneReason: string,
  ): CensusSections["teachingStaff"] =>
    g.total === 0
      ? { coverage: "NONE", reason: noneReason }
      : g.unknown > 0
        ? {
            coverage: "PARTIAL",
            data: g,
            reason: `${g.unknown} of ${g.total} staff have no sex recorded on their profile.`,
            captured: g.total - g.unknown,
            total: g.total,
          }
        : { coverage: "FULL", data: g };

  const teachingStaff = staffGroupArm(staff.teaching, "No teaching staff on record.");
  const nonTeachingStaff = staffGroupArm(staff.nonTeaching, "No non-teaching staff on record.");

  // Single-source the teaching-staff count (LOW-1): the SAME number feeds the teachingStaff row (above) and
  // this PTR denominator, so a filing can never show "14 teachers" and "PTR = roll ÷ 13" at once. 0 teachers
  // → ptrRatio null → the arm is NONE (honest hand-fill), never a divide-by-zero.
  const teachingCount = staff.teaching.total;
  const ptrRatio =
    teachingCount > 0 && enrolment.roll > 0 ? Math.round(enrolment.roll / teachingCount) : null;
  const ptr: CensusSections["ptr"] =
    ptrRatio == null
      ? { coverage: "NONE", reason: "No teaching staff (or no roll) to compute a pupil–teacher ratio." }
      : { coverage: "FULL", data: { ratio: ptrRatio, teachingStaff: teachingCount, roll: enrolment.roll } };

  const qualifications: CensusSections["qualifications"] = {
    coverage: "NONE",
    reason: "Trained/untrained split is not yet captured on staff profiles — hand-fill (annual).",
  };

  const salaryStatus: CensusSections["salaryStatus"] =
    staff.salaryStatus.total === 0
      ? { coverage: "NOT_APPLICABLE", reason: "This school does not run payroll in Omnischools." }
      : { coverage: "FULL", data: staff.salaryStatus };

  // ── Section C · attendance & academic ──────────────────────────────────────────────────────────────
  const attendance: CensusSections["attendance"] =
    rollup.attendance.status === "CAPTURED"
      ? {
          coverage: "FULL",
          data: { schoolRate: rollup.attendance.data.schoolRate, totalMarked: rollup.attendance.data.totalMarked },
        }
      : { coverage: "NONE", reason: rollup.attendance.reason };

  const bece =
    rollup.terminalResults.bece.status === "CAPTURED" ? rollup.terminalResults.bece.data : undefined;
  const wassce =
    rollup.terminalResults.wassce.status === "CAPTURED" ? rollup.terminalResults.wassce.data : undefined;
  const terminalApplicable =
    rollup.terminalResults.bece.status !== "NOT_APPLICABLE" ||
    rollup.terminalResults.wassce.status !== "NOT_APPLICABLE";
  const terminalResults: CensusSections["terminalResults"] =
    bece || wassce
      ? { coverage: "FULL", data: { bece, wassce } }
      : terminalApplicable
        ? { coverage: "NONE", reason: "No BECE/WASSCE results captured yet." }
        : { coverage: "NOT_APPLICABLE", reason: "This school sits no terminal examination." };

  const perfBasic =
    rollup.performance.basic.status === "CAPTURED"
      ? {
          overallAverage: rollup.performance.basic.data.overallAverage,
          passRate: rollup.performance.basic.data.passRate,
          gradedClasses: rollup.performance.basic.data.gradedClasses,
        }
      : undefined;
  const perfSeniorReady =
    rollup.performance.senior.status === "CAPTURED"
      ? rollup.performance.senior.data.subjectsReady
      : undefined;
  const academicPerformance: CensusSections["academicPerformance"] =
    perfBasic || perfSeniorReady != null
      ? { coverage: "FULL", data: { basic: perfBasic, seniorSubjectsReady: perfSeniorReady } }
      : { coverage: "NONE", reason: "No end-of-term academic performance recorded yet." };

  // ── Section D · infrastructure (raw facilities row; AUTO-when-captured supersedes the surface's Manual,
  //    GOV8-08) ─────────────────────────────────────────────────────────────────────────────────────────
  const infrastructure: CensusSections["infrastructure"] = facilitiesRow
    ? { coverage: "FULL", data: facilitiesRow }
    : { coverage: "NONE", reason: "No facilities snapshot captured yet — capture one at /reports/facilities." };

  // ── Section E · programmes (genuinely hand) ─────────────────────────────────────────────────────────
  const feeding: CensusSections["feeding"] = {
    coverage: "NONE",
    reason: "GSFP participation is hand-filled (annual) — no feeding register integration exists.",
  };
  const textbooks: CensusSections["textbooks"] = {
    coverage: "NONE",
    reason: "Textbook inventory is hand-filled from the stockroom (annual).",
  };

  const sections: CensusSections = {
    enrolment: enrolmentSection,
    ageDistribution,
    ownership,
    specialNeeds,
    movement,
    repetition,
    teachingStaff,
    ptr,
    qualifications,
    nonTeachingStaff,
    salaryStatus,
    attendance,
    terminalResults,
    academicPerformance,
    infrastructure,
    feeding,
    textbooks,
  };

  return {
    version: CENSUS_SNAPSHOT_VERSION,
    cadence,
    academicYear,
    censusDate: censusDate.toISOString().slice(0, 10),
    generatedAt: new Date().toISOString(),
    period,
    identification,
    sections,
  };
}
