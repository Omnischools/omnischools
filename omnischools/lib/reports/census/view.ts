import type {
  CensusSnapshot,
  CensusSectionKey,
  CensusArm,
  CensusCoverage,
} from "@/lib/reports/census/schema";
import type { CensusEnrolment } from "@/lib/reports/census-enrolment-data";
import type { CensusStaffGroup, CensusSalaryStatus } from "@/lib/reports/census/census-staff-data";
import type {
  CensusMovement,
  CensusPtr,
  CensusAttendance,
  CensusAgeSummary,
  CensusTerminal,
} from "@/lib/reports/census/schema";
import type { FacilitiesSnapshotRow } from "@/lib/reports/facilities-data";

/**
 * GOV-8 · the PURE census view — the surface's Auto/Partial/Manual tags and its "% auto-filled" are DERIVED
 * here from live section coverage, NEVER the surface's static demo numbers (Lucy §2 / GOV8-17: the surface's
 * "71% · 16 rows · 20 minutes" are demo literals from before GOV-3/6/7 shipped; carry NONE of them). No DB,
 * no React — unit-tested directly, and safe to feed the client drawer as plain pre-formatted strings (the
 * client never imports a `*-data` module).
 *
 * Cadence gates ABOVE coverage: an annual-only section in a mid-year run is greyed `Annual` and EXCLUDED from
 * the fill % (Lucy §5). Everything in the checklist is one section's coverage reduced to a tag.
 */

export type Cadence = "MID_YEAR" | "ANNUAL";
export type RowTag = "Auto" | "Partial" | "Manual" | "Annual" | "N/A";
export type SectionNature = "AUTO" | "AUTO_WHEN_CAPTURED" | "HAND";

type SectionGroup = "A" | "B" | "C" | "D" | "E";
const GROUP_TITLES: Record<SectionGroup, string> = {
  A: "Enrolment & demographics",
  B: "Staff",
  C: "Attendance & academic",
  D: "Infrastructure",
  E: "Programmes & resources",
};

type RowDef = {
  id: string;
  group: SectionGroup;
  source: CensusSectionKey;
  name: string;
  cadences: Cadence[];
  nature: SectionNature;
  /** Static descriptor shown when the row is annual-only in a mid-year run — so the admin sees the fuller
   *  census exists (Lucy §5: do not hide the greyed rows). */
  annualHint: string;
};

const MID: Cadence[] = ["MID_YEAR", "ANNUAL"];
const ANNUAL: Cadence[] = ["ANNUAL"];

/**
 * The GES census checklist (Lucy §3.4), grouped A–E. Multiple rows may share one snapshot `source` (the three
 * infrastructure rows all read the one facilities row). PTR + Ownership are added as explicit mid-year Auto
 * rows (Lucy §5 recommendation) so the admin sees them auto-filled.
 */
export const CENSUS_ROWS: RowDef[] = [
  // Section A · Enrolment & demographics
  { id: "enrolmentByClassGender", group: "A", source: "enrolment", name: "Enrolment by class & gender", cadences: MID, nature: "AUTO", annualHint: "Enrolment by class & sex" },
  { id: "ageByClassGender", group: "A", source: "ageDistribution", name: "Age-by-class distribution", cadences: MID, nature: "AUTO", annualHint: "Computed from student DOBs" },
  { id: "ownership", group: "A", source: "ownership", name: "School ownership", cadences: MID, nature: "AUTO", annualHint: "Public / private / mission" },
  { id: "movementAdmissions", group: "A", source: "movement", name: "Admissions this period (by sex)", cadences: MID, nature: "AUTO", annualHint: "Movement — admissions, withdrawals, transfers" },
  { id: "specialNeeds", group: "A", source: "specialNeeds", name: "Special needs enrolment", cadences: ANNUAL, nature: "HAND", annualHint: "Count by category, split by sex · hand-fill (annual)" },
  { id: "repetition", group: "A", source: "repetition", name: "Repetition by class", cadences: ANNUAL, nature: "HAND", annualHint: "Repeaters by class & sex · hand-fill (annual)" },
  // Section B · Staff
  { id: "teachingStaff", group: "B", source: "teachingStaff", name: "Teaching staff (count & sex)", cadences: MID, nature: "AUTO", annualHint: "Teaching staff list, roles, sex" },
  { id: "ptr", group: "B", source: "ptr", name: "Pupil–teacher ratio", cadences: MID, nature: "AUTO", annualHint: "Pupils ÷ teaching staff" },
  { id: "nonTeachingStaff", group: "B", source: "nonTeachingStaff", name: "Non-teaching staff (count & sex)", cadences: MID, nature: "AUTO", annualHint: "Non-teaching staff, sex" },
  { id: "qualifications", group: "B", source: "qualifications", name: "Staff qualifications & training", cadences: ANNUAL, nature: "AUTO_WHEN_CAPTURED", annualHint: "Trained / untrained split · captured on staff profiles (annual)" },
  { id: "salaryStatus", group: "B", source: "salaryStatus", name: "Salary status (GES / private / allowance)", cadences: ANNUAL, nature: "AUTO_WHEN_CAPTURED", annualHint: "From staff compensation records (annual)" },
  // Section C · Attendance & academic
  { id: "attendanceRate", group: "C", source: "attendance", name: "Attendance rate", cadences: MID, nature: "AUTO", annualHint: "Attendance rate for the period" },
  { id: "terminalResults", group: "C", source: "terminalResults", name: "BECE / WASSCE results", cadences: ANNUAL, nature: "AUTO_WHEN_CAPTURED", annualHint: "Terminal-exam pass rates by sex (annual)" },
  { id: "academicPerformance", group: "C", source: "academicPerformance", name: "Academic performance", cadences: ANNUAL, nature: "AUTO_WHEN_CAPTURED", annualHint: "End-of-term averages by class (annual)" },
  // Section D · Infrastructure (annual)
  { id: "infrastructureClassrooms", group: "D", source: "infrastructure", name: "Classrooms (count & condition)", cadences: ANNUAL, nature: "AUTO_WHEN_CAPTURED", annualHint: "Count + condition · from the facilities snapshot (annual)" },
  { id: "infrastructureUtilities", group: "D", source: "infrastructure", name: "Water, electricity, sanitation", cadences: ANNUAL, nature: "AUTO_WHEN_CAPTURED", annualHint: "Source, status, latrines by sex (annual)" },
  { id: "infrastructureFacilities", group: "D", source: "infrastructure", name: "Library, ICT lab, kitchen", cadences: ANNUAL, nature: "AUTO_WHEN_CAPTURED", annualHint: "Presence, equipment counts (annual)" },
  // Section E · Programmes & resources (annual, genuinely hand)
  { id: "feedingGSFP", group: "E", source: "feeding", name: "School feeding programme", cadences: ANNUAL, nature: "HAND", annualHint: "Participation, meals, supplier · hand-fill (annual)" },
  { id: "textbooks", group: "E", source: "textbooks", name: "Textbook availability", cadences: ANNUAL, nature: "HAND", annualHint: "Inventory by subject & class · hand-fill (annual)" },
];

/** Minutes-of-manual-entry estimate per section that still needs a hand (Lucy §3.3 flags the constant). */
export const CENSUS_MINUTES_PER_SECTION = 5;

export type CensusRowView = {
  id: string;
  name: string;
  meta: string;
  tag: RowTag;
  coverage: CensusCoverage;
  cadenceGated: boolean; // annual-only in this run → greyed, excluded from %
  inScope: boolean; // counts toward the fill %
  /** For a NONE in-scope row, where "Fill by hand" routes (a real capture module), else null (print & pen). */
  captureHref: string | null;
};
export type CensusGroupView = { group: SectionGroup; title: string; rows: CensusRowView[] };
export type CensusView = {
  fillPct: number;
  fullCount: number;
  inScopeCount: number;
  needHand: number;
  minutes: number;
  groups: CensusGroupView[];
  summary: string; // "{full} of {inScope} sections auto-filled"
};

const armOf = (snapshot: CensusSnapshot, key: CensusSectionKey): CensusArm<unknown> =>
  snapshot.sections[key] as CensusArm<unknown>;

const dataOf = <T>(arm: CensusArm<unknown>): T | null =>
  arm.coverage === "FULL" || arm.coverage === "PARTIAL" ? (arm.data as T) : null;

const reasonOf = (arm: CensusArm<unknown>): string =>
  "reason" in arm && arm.reason ? arm.reason : "Not captured — fill by hand.";

/** Where a NONE mid-year row's "Fill by hand" routes — the durable in-app capture path (Lucy §4.1). */
const CAPTURE_HREF: Partial<Record<string, string>> = {
  attendanceRate: "/attendance",
  terminalResults: "/reports/terminal-results",
  infrastructureClassrooms: "/reports/facilities",
  infrastructureUtilities: "/reports/facilities",
  infrastructureFacilities: "/reports/facilities",
};

function metaFor(def: RowDef, arm: CensusArm<unknown>): string {
  if (arm.coverage === "NONE" || arm.coverage === "NOT_APPLICABLE") return reasonOf(arm);
  switch (def.id) {
    case "enrolmentByClassGender": {
      const d = dataOf<CensusEnrolment>(arm)!;
      const classCount = d.byClass.filter((c) => c.classId !== "__unassigned__").length;
      return `${d.roll} students · ${classCount} classes · ${d.gender.male} boys, ${d.gender.female} girls`;
    }
    case "ageByClassGender": {
      const d = dataOf<CensusAgeSummary>(arm)!;
      const known = d.roll - d.dobUnknown;
      return d.dobUnknown > 0
        ? `${known} of ${d.roll} students have a DOB · ${d.dobUnknown} missing (left blank, never a guessed age)`
        : `Computed from student DOBs · all ${d.roll} have a DOB`;
    }
    case "ownership": {
      const d = dataOf<{ ownership: string }>(arm)!;
      return d.ownership;
    }
    case "movementAdmissions": {
      const d = dataOf<CensusMovement>(arm)!;
      return `This period · +${d.admissionsThisPeriod ?? 0} admissions · ${d.intakeMale ?? 0} boys, ${d.intakeFemale ?? 0} girls`;
    }
    case "teachingStaff":
    case "nonTeachingStaff": {
      const d = dataOf<CensusStaffGroup>(arm)!;
      const base = `${d.total} · ${d.male} men, ${d.female} women`;
      return d.unknown > 0 ? `${base} · ${d.unknown} sex not recorded` : base;
    }
    case "ptr": {
      const d = dataOf<CensusPtr>(arm)!;
      return `1 : ${d.ratio} · ${d.roll} pupils ÷ ${d.teachingStaff} teaching staff`;
    }
    case "salaryStatus": {
      const d = dataOf<CensusSalaryStatus>(arm)!;
      return `${d.schoolPaid} school-paid · ${d.gesPaid} GES-paid · ${d.allowance} allowance`;
    }
    case "attendanceRate": {
      const d = dataOf<CensusAttendance>(arm)!;
      return `Current period to date: ${d.schoolRate}% · ${d.totalMarked} marks`;
    }
    case "terminalResults": {
      const d = dataOf<CensusTerminal>(arm)!;
      const parts: string[] = [];
      if (d.bece) parts.push(`BECE ${d.bece.year}: ${d.bece.passRate}% (${d.bece.passedCount}/${d.bece.totalCandidates})`);
      if (d.wassce) parts.push(`WASSCE ${d.wassce.year}: ${d.wassce.passRate}% (${d.wassce.passedCount}/${d.wassce.totalCandidates})`);
      return parts.join(" · ") || def.annualHint;
    }
    case "infrastructureClassrooms": {
      const d = dataOf<FacilitiesSnapshotRow>(arm)!;
      return `${d.classroomsGood}/${d.classroomsTotal} classrooms in good condition`;
    }
    case "infrastructureUtilities": {
      const d = dataOf<FacilitiesSnapshotRow>(arm)!;
      const latrines = d.latrinesBoys + d.latrinesGirls + d.latrinesStaff;
      return `${d.waterSource} · ${d.electricitySource} · ${latrines} latrines`;
    }
    case "infrastructureFacilities": {
      const d = dataOf<FacilitiesSnapshotRow>(arm)!;
      return `Library ${d.hasLibrary ? "yes" : "no"} · ICT lab ${d.hasIctLab ? "yes" : "no"} · kitchen ${d.hasKitchen ? "yes" : "no"}`;
    }
    default:
      return def.annualHint;
  }
}

function tagFor(coverage: CensusCoverage): RowTag {
  switch (coverage) {
    case "FULL":
      return "Auto";
    case "PARTIAL":
      return "Partial";
    case "NONE":
      return "Manual";
    case "NOT_APPLICABLE":
      return "N/A";
  }
}

/** Build the whole drawer view from a frozen snapshot + the run's cadence. All four headline numbers and
 *  every tag are computed here (GOV8-17). */
export function computeCensusView(snapshot: CensusSnapshot, cadence: Cadence): CensusView {
  const rowViews: CensusRowView[] = CENSUS_ROWS.map((def) => {
    const arm = armOf(snapshot, def.source);
    const cadenceIncluded = def.cadences.includes(cadence);
    if (!cadenceIncluded) {
      return {
        id: def.id,
        name: def.name,
        meta: def.annualHint,
        tag: "Annual",
        coverage: arm.coverage,
        cadenceGated: true,
        inScope: false,
        captureHref: null,
      };
    }
    const inScope = arm.coverage !== "NOT_APPLICABLE";
    return {
      id: def.id,
      name: def.name,
      meta: metaFor(def, arm),
      tag: tagFor(arm.coverage),
      coverage: arm.coverage,
      cadenceGated: false,
      inScope,
      captureHref: arm.coverage === "NONE" ? (CAPTURE_HREF[def.id] ?? null) : null,
    };
  });

  const inScopeRows = rowViews.filter((r) => r.inScope);
  const fullCount = inScopeRows.filter((r) => r.coverage === "FULL").length;
  const inScopeCount = inScopeRows.length;
  const needHand = inScopeCount - fullCount;
  const fillPct = inScopeCount > 0 ? Math.round((100 * fullCount) / inScopeCount) : 100;
  const minutes = needHand * CENSUS_MINUTES_PER_SECTION;

  const groups: CensusGroupView[] = (["A", "B", "C", "D", "E"] as SectionGroup[]).map((g) => ({
    group: g,
    title: GROUP_TITLES[g],
    rows: rowViews.filter((r) => CENSUS_ROWS.find((d) => d.id === r.id)!.group === g),
  }));

  return {
    fillPct,
    fullCount,
    inScopeCount,
    needHand,
    minutes,
    groups,
    summary: `${fullCount} of ${inScopeCount} sections auto-filled`,
  };
}

/** The rows a mid-year run still needs a hand for (Lucy §4/§6 — normally empty; the exception path). */
export function handFillRows(view: CensusView): CensusRowView[] {
  return view.groups.flatMap((g) => g.rows).filter((r) => r.inScope && r.coverage !== "FULL");
}
