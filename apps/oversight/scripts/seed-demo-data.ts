import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import {
  GHANA_REGIONS,
  MISSION_PATRONS,
  SCHOOL_NAME_STEMS,
  type DemoDistrict,
  type DemoRegion,
} from "@/db/seed/demo/ghana";

/**
 * DEMO DATA GENERATOR — grounded, deterministic, self-contained (Increment H first slice).
 *
 * WHY THIS EXISTS. The `fact_infrastructure` slice is a real pipeline, but the real inputs do not
 * exist yet: there is no EMIS extract (scope §5 blocker 2) and no cross-tenant operational read role
 * (blocker 1, task H1). A demo for MoE/GES therefore needs inputs that are (a) shaped exactly like
 * the real ones, so the ETL does real work, and (b) grounded in Ghana's actual administrative
 * structure, so a regional roll-up is recognisable rather than obviously synthetic.
 *
 * WHAT IT PRODUCES — two artefacts, matching the two real inputs one-for-one:
 *
 *   1. AN EMIS SCHOOL-REGISTER EXTRACT FILE (JSON, on disk). This is the external GES EMIS extract
 *      (scope §2 loader #1), the Y in every "X of Y schools" coverage figure. A FILE, not a table,
 *      because that is the real artefact's shape and because `lib/etl/register.ts` must be a real
 *      file loader — the same posture as the already-built `load-establishment.ts`.
 *
 *   2. OPERATIONAL-SHAPED `facilities_snapshot` ROWS in the `demo_source` schema (see
 *      db/seed/demo/demo-source-schema.sql for why that schema and not the real operational DB).
 *      ONE row per on-Schoolup school per term, with the operational column names, types and CHECK
 *      allow-lists. The ETL then does the decomposition. NOTHING HERE WRITES A FACT ROW — if the
 *      transform is wrong, the demo numbers are wrong, which is the only honest arrangement.
 *
 * DETERMINISM. One fixed seed (`DEFAULT_SEED`) through one small PRNG (mulberry32) drives every
 * choice, and every generated uuid is derived from an index rather than `gen_random_uuid()`. So two
 * runs produce byte-identical artefacts, a reviewer can reason about specific schools, and the
 * idempotency test ("a re-run is byte-identical") is testing the ETL rather than the generator.
 *
 * GROUNDING — the three things that make the output look like Ghana rather than like noise:
 *   · the 16 real regions and real MMDA district names (db/seed/demo/ghana.ts);
 *   · a school-type / ownership mix weighted to the real basic-heavy, ~70% public shape;
 *   · an URBAN/RURAL FACILITIES GRADIENT driven by the district's MMDA class, so rural districts are
 *     likelier to have water_source NONE/WELL, electricity NONE/SOLAR, latrine PIT/KVIP and no
 *     library / ICT lab / internet. That gradient is the thing a regional dashboard is FOR; a
 *     uniformly-sampled dataset would make every region look identical and prove nothing.
 *
 * Two deliberate imperfections, because both exercise logic that must be exercised:
 *   · ~12.5% of registered schools are NOT on Schoolup → coverage is below 100% and the
 *     excluded-from-facts-but-counted-in-the-register asymmetry (scope §3) is real.
 *   · the nullable optional-detail columns (computers, library books, furniture) are answered by
 *     only SOME schools → the *_reporting_count honest denominators are genuinely < schools_reporting.
 */

// ── deterministic RNG ───────────────────────────────────────────────────────────────────────────

/** The one seed. Changing it changes every demo figure, so it is a deliberate, reviewable edit. */
export const DEFAULT_SEED = 0x4845_4d49; // "HEMI" — Increment H EMIS

/** mulberry32 — 32-bit, seedable, no dependency, identical across platforms and Node versions. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Rng {
  next: () => number;
  /** Uniform integer in [lo, hi]. */
  int: (lo: number, hi: number) => number;
  bool: (p: number) => boolean;
  pick: <T>(items: readonly T[]) => T;
  /** Weighted pick: `[["A", 0.7], ["B", 0.3]]`. Weights need not be normalised. */
  weighted: <T>(items: readonly (readonly [T, number])[]) => T;
}

function rngOf(seed: number): Rng {
  const next = makeRng(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  return {
    next,
    int,
    bool: (p) => next() < p,
    pick: (items) => items[int(0, items.length - 1)]!,
    weighted: (items) => {
      const total = items.reduce((s, [, w]) => s + w, 0);
      let r = next() * total;
      for (const [value, w] of items) {
        r -= w;
        if (r <= 0) return value;
      }
      return items[items.length - 1]![0];
    },
  };
}

// ── shapes ──────────────────────────────────────────────────────────────────────────────────────

export type DemoSchoolType = "KG" | "PRIMARY" | "JHS" | "SHS" | "COMBINED";
export type DemoOwnership = "PUBLIC" | "PRIVATE" | "MISSION";

export interface DemoSchool {
  emisSchoolId: string;
  name: string;
  regionName: string;
  districtName: string;
  schoolType: DemoSchoolType;
  ownershipType: DemoOwnership;
  /** Registered AND live on Omnischools. Only these get facilities rows → only these get facts. */
  onSchoolup: boolean;
  /** The operational tenant uuid (apps/web ref_school.id). NULL when not on Schoolup. */
  operationalSchoolId: string | null;
  asOfDate: string;
  /** Not part of the register — a generator-internal driver of the facilities gradient. */
  urban: boolean;
}

export interface DemoTerm {
  academicYear: string;
  term: number;
  startsOn: string;
  endsOn: string;
  isCurrent: boolean;
}

/** Operational-shaped census row, exactly the columns of apps/web `facilities_snapshot`. */
export interface DemoFacilitiesRow {
  schoolId: string;
  periodId: string;
  classroomsTotal: number;
  classroomsGood: number;
  classroomsRepair: number;
  waterSource: "BOREHOLE" | "PIPE" | "WELL" | "NONE";
  electricitySource: "GRID" | "SOLAR" | "GENERATOR" | "NONE";
  latrinesBoys: number;
  latrinesGirls: number;
  latrinesStaff: number;
  latrineType: "WC" | "KVIP" | "PIT" | "NONE";
  handwashing: boolean;
  hasLibrary: boolean;
  hasIctLab: boolean;
  internet: boolean;
  hasKitchen: boolean;
  gsfpParticipating: boolean;
  libraryBookCount: number | null;
  libraryStaffFte: number | null;
  computersTotal: number | null;
  computersWorking: number | null;
  internetType: string | null;
  mealsServedLastTerm: number | null;
  pupilsFedDailyAvg: number | null;
  catererName: string | null;
  textbookAvailability: "ADEQUATE" | "INADEQUATE" | null;
  studentDesksUsable: number | null;
  studentDesksBroken: number | null;
  teacherDesks: number | null;
  chalkboards: number | null;
  whiteboards: number | null;
  projectors: number | null;
  note: string | null;
  capturedAt: string;
}

export interface DemoOperationalPeriod {
  schoolId: string;
  periodId: string;
  academicYear: string;
  term: number;
  startsOn: string;
  endsOn: string;
}

export interface DemoDataset {
  seed: number;
  terms: DemoTerm[];
  schools: DemoSchool[];
  periods: DemoOperationalPeriod[];
  facilities: DemoFacilitiesRow[];
}

/** The EMIS extract file format — the same `{ as_of_date, rows }` shape as the establishment file. */
export interface EmisExtractFile {
  as_of_date: string;
  rows: {
    emis_school_id: string;
    name: string;
    region: string;
    district: string;
    school_type: DemoSchoolType;
    ownership_type: DemoOwnership;
    on_schoolup: boolean;
    operational_school_id: string | null;
    as_of_date?: string;
  }[];
}

// ── the two demo terms ──────────────────────────────────────────────────────────────────────────

/**
 * TWO terms, not one. A single term cannot demonstrate the stock-not-flow rule (scope §1: sum
 * infrastructure spatially, NEVER across periods), and that rule is the one `fact_infrastructure`
 * invariant a reader can break while every number still looks internally consistent. Term 2 is the
 * current one; Term 1 is last term's census of the SAME classrooms.
 */
export const DEMO_TERMS: readonly DemoTerm[] = Object.freeze([
  {
    academicYear: "2025/26",
    term: 1,
    startsOn: "2025-09-15",
    endsOn: "2025-12-19",
    isCurrent: false,
  },
  {
    academicYear: "2025/26",
    term: 2,
    startsOn: "2026-01-12",
    endsOn: "2026-04-02",
    isCurrent: true,
  },
]);

/** The register's vintage. Fixed, not `today`, so the artefact is byte-stable across days. */
export const DEMO_REGISTER_AS_OF = "2026-09-01";

// ── deterministic ids ───────────────────────────────────────────────────────────────────────────

function pad12(n: number): string {
  return String(n).padStart(12, "0");
}

/** The operational tenant uuid for school #n. Index-derived, so it is stable across runs. */
export function demoOperationalSchoolId(index: number): string {
  return `a1000000-0000-4000-8000-${pad12(index)}`;
}

/** The school's OWN period uuid for a term — per-school, as operational periods really are. */
export function demoOperationalPeriodId(index: number, term: number): string {
  return `b100000${term}-0000-4000-8000-${pad12(index)}`;
}

// ── generation ──────────────────────────────────────────────────────────────────────────────────

const SCHOOL_TYPE_MIX: readonly (readonly [DemoSchoolType, number])[] = Object.freeze([
  // Basic-heavy, as Ghana's register is: KG + PRIMARY + JHS are the overwhelming majority.
  ["PRIMARY", 0.4],
  ["JHS", 0.25],
  ["KG", 0.15],
  ["SHS", 0.1],
  ["COMBINED", 0.1],
]);

const OWNERSHIP_MIX: readonly (readonly [DemoOwnership, number])[] = Object.freeze([
  ["PUBLIC", 0.7],
  ["PRIVATE", 0.25],
  ["MISSION", 0.05],
]);

/** P(a registered school is live on Omnischools). Below 1 on purpose — see the header. */
const ON_SCHOOLUP_RATE = 0.875;

/** Schools generated per district. A few hundred total: enough for real roll-ups, fast to load. */
const SCHOOLS_PER_DISTRICT_MIN = 5;
const SCHOOLS_PER_DISTRICT_MAX = 7;

function schoolName(
  rng: Rng,
  type: DemoSchoolType,
  ownership: DemoOwnership,
  used: Set<string>,
): string {
  const stem = rng.pick(SCHOOL_NAME_STEMS);
  const suffix =
    type === "KG"
      ? "KG"
      : type === "PRIMARY"
        ? "Primary School"
        : type === "JHS"
          ? "JHS"
          : type === "SHS"
            ? "Senior High School"
            : "Basic School";
  const qualifier =
    ownership === "MISSION"
      ? `${rng.pick(MISSION_PATRONS)} `
      : ownership === "PRIVATE"
        ? rng.pick(["", "", "Academy ", "International "])
        : rng.pick(["", "", "Community ", "Model "]);
  let name = `${stem} ${qualifier}${suffix}`.replace(/\s+/g, " ").trim();
  // Names are display data; a collision is cosmetic, but an unambiguous register reads better.
  let n = 2;
  while (used.has(name))
    name = `${stem} ${qualifier}${suffix} ${n++}`.replace(/\s+/g, " ");
  used.add(name);
  return name;
}

/**
 * THE URBAN/RURAL FACILITIES GRADIENT. Every distribution below is conditioned on `urban`, and the
 * direction is the one Ghana's own EMIS/GSS reporting shows: urban schools are far likelier to have
 * piped water, grid power, WC/KVIP sanitation, a library, an ICT lab and internet; rural schools lean
 * to boreholes and wells (or nothing), solar or nothing, pit latrines, and no ICT at all.
 *
 * `previous` makes the second term a RE-CENSUS OF THE SAME SCHOOL rather than a fresh draw. That is
 * not cosmetic: infrastructure is a STOCK, and if each term were sampled independently the demo would
 * imply a country that rebuilds itself every twelve weeks — and the stock-not-flow test would be
 * asserting against noise instead of against a stable stock that moves a little. So term 2 carries term
 * 1's buildings forward, repairs a few classrooms, occasionally adds a borehole / handwashing station /
 * grid connection, and re-answers the optional-detail questions independently (a school that skipped
 * the computer count last term may answer it this term, which is exactly what makes the
 * `*_reporting_count` denominators move).
 */
function facilitiesFor(
  rng: Rng,
  school: DemoSchool,
  term: DemoTerm,
  capturedAt: string,
  previous: DemoFacilitiesRow | null,
): DemoFacilitiesRow {
  if (previous) return nextTermCensus(rng, school, term, capturedAt, previous);
  const urban = school.urban;
  const big = school.schoolType === "SHS" || school.schoolType === "COMBINED";

  const classroomsTotal = big ? rng.int(12, 34) : urban ? rng.int(6, 18) : rng.int(3, 12);
  // Good + repair ≤ total (the operational CHECK). A few classrooms are neither — condemned or
  // under construction — which is why the two do not have to sum to the total.
  const good = rng.int(
    Math.floor(classroomsTotal * (urban ? 0.5 : 0.25)),
    classroomsTotal,
  );
  const repair = rng.int(0, classroomsTotal - good);

  const waterSource = urban
    ? rng.weighted([
        ["PIPE", 0.45],
        ["BOREHOLE", 0.35],
        ["WELL", 0.12],
        ["NONE", 0.08],
      ] as const)
    : rng.weighted([
        ["BOREHOLE", 0.4],
        ["WELL", 0.22],
        ["NONE", 0.28],
        ["PIPE", 0.1],
      ] as const);

  const electricitySource = urban
    ? rng.weighted([
        ["GRID", 0.78],
        ["GENERATOR", 0.08],
        ["SOLAR", 0.06],
        ["NONE", 0.08],
      ] as const)
    : rng.weighted([
        ["GRID", 0.34],
        ["SOLAR", 0.16],
        ["GENERATOR", 0.04],
        ["NONE", 0.46],
      ] as const);

  const latrineType = urban
    ? rng.weighted([
        ["WC", 0.34],
        ["KVIP", 0.44],
        ["PIT", 0.17],
        ["NONE", 0.05],
      ] as const)
    : rng.weighted([
        ["KVIP", 0.32],
        ["PIT", 0.45],
        ["NONE", 0.17],
        ["WC", 0.06],
      ] as const);

  const hasLatrines = latrineType !== "NONE";
  const latrinesBoys = hasLatrines ? rng.int(1, urban ? 8 : 4) : 0;
  const latrinesGirls = hasLatrines ? rng.int(1, urban ? 8 : 4) : 0;
  const latrinesStaff = hasLatrines ? rng.int(0, urban ? 3 : 1) : 0;

  const handwashing = rng.bool(urban ? 0.72 : 0.38);
  const hasLibrary = rng.bool(urban ? 0.46 : 0.14);
  const hasIctLab = rng.bool(urban ? 0.38 : 0.07);
  // Internet is gated on power: a school with no electricity source has no internet.
  const internet = electricitySource !== "NONE" && rng.bool(urban ? 0.44 : 0.09);
  const hasKitchen = rng.bool(urban ? 0.52 : 0.41);
  // GSFP is a public-basic programme: private schools are not on it.
  const gsfpParticipating =
    school.ownershipType === "PUBLIC" &&
    school.schoolType !== "SHS" &&
    rng.bool(urban ? 0.55 : 0.78);

  // ---- optional detail: answered by SOME schools only (the *_reporting_count denominators) ----
  // Reporting propensity is itself urban-skewed, which is realistic AND makes the honest denominator
  // visibly different per region rather than uniformly ~60%.
  const reportsComputers = rng.bool(urban ? 0.72 : 0.42);
  const computersTotal = reportsComputers
    ? hasIctLab
      ? rng.int(8, 60)
      : rng.int(0, 6)
    : null;
  const computersWorking =
    computersTotal === null
      ? null
      : rng.int(Math.floor(computersTotal * 0.4), computersTotal);

  const reportsLibraryBooks = rng.bool(urban ? 0.6 : 0.3);
  const libraryBookCount = reportsLibraryBooks
    ? hasLibrary
      ? rng.int(180, 4200)
      : rng.int(0, 120)
    : null;

  const reportsFurniture = rng.bool(urban ? 0.68 : 0.47);
  const studentDesksUsable = reportsFurniture
    ? rng.int(classroomsTotal * 8, classroomsTotal * 26)
    : null;
  const studentDesksBroken = reportsFurniture ? rng.int(0, classroomsTotal * 6) : null;
  const teacherDesks = reportsFurniture ? rng.int(0, classroomsTotal) : null;
  const chalkboards = reportsFurniture ? rng.int(0, classroomsTotal) : null;
  const whiteboards = reportsFurniture ? rng.int(0, urban ? 4 : 1) : null;
  const projectors = reportsFurniture ? rng.int(0, urban ? 3 : 1) : null;

  return {
    schoolId: school.operationalSchoolId!,
    periodId: demoOperationalPeriodId(
      Number(school.operationalSchoolId!.slice(-12)),
      term.term,
    ),
    classroomsTotal,
    classroomsGood: good,
    classroomsRepair: repair,
    waterSource,
    electricitySource,
    latrinesBoys,
    latrinesGirls,
    latrinesStaff,
    latrineType,
    handwashing,
    hasLibrary,
    hasIctLab,
    internet,
    hasKitchen,
    gsfpParticipating,
    libraryBookCount,
    libraryStaffFte: hasLibrary && reportsLibraryBooks ? rng.int(0, 2) : null,
    computersTotal,
    computersWorking,
    internetType: internet ? rng.pick(["FIBRE", "MOBILE_BROADBAND", "VSAT"]) : null,
    mealsServedLastTerm: gsfpParticipating ? rng.int(2_000, 38_000) : null,
    pupilsFedDailyAvg: gsfpParticipating ? rng.int(40, 520) : null,
    // Person-identifying third-party name. Present in the SOURCE on purpose: the transform must be
    // seen NOT to carry it across (lib/oversight/infrastructure.ts's hard exclusion).
    catererName: gsfpParticipating
      ? `${rng.pick(SCHOOL_NAME_STEMS)} Catering Services`
      : null,
    textbookAvailability: rng.bool(urban ? 0.55 : 0.3) ? "ADEQUATE" : "INADEQUATE",
    studentDesksUsable,
    studentDesksBroken,
    teacherDesks,
    chalkboards,
    whiteboards,
    projectors,
    note: null,
    capturedAt,
  };
}

/**
 * THE SECOND TERM: the same school, re-censused. The physical stock carries forward; a handful of
 * schools improve. Every optional-detail answer is re-rolled independently, because reporting is a
 * behaviour of the person filling in the form, not a property of the building.
 */
function nextTermCensus(
  rng: Rng,
  school: DemoSchool,
  term: DemoTerm,
  capturedAt: string,
  prev: DemoFacilitiesRow,
): DemoFacilitiesRow {
  const urban = school.urban;
  // A classroom is occasionally built; a few needing repair are repaired.
  const classroomsTotal = prev.classroomsTotal + (rng.bool(0.06) ? 1 : 0);
  const repaired =
    prev.classroomsRepair > 0 && rng.bool(0.35) ? rng.int(1, prev.classroomsRepair) : 0;
  const classroomsGood = Math.min(prev.classroomsGood + repaired, classroomsTotal);
  const classroomsRepair = Math.min(
    prev.classroomsRepair - repaired,
    classroomsTotal - classroomsGood,
  );

  // Infrastructure upgrades are rare and one-directional: nothing un-builds a borehole mid-year.
  const waterSource =
    prev.waterSource === "NONE" && rng.bool(0.05) ? "BOREHOLE" : prev.waterSource;
  const electricitySource =
    prev.electricitySource === "NONE" && rng.bool(0.04)
      ? rng.bool(0.5)
        ? "SOLAR"
        : "GRID"
      : prev.electricitySource;
  const latrineType =
    prev.latrineType === "NONE" && rng.bool(0.06) ? "KVIP" : prev.latrineType;
  const hasLatrines = latrineType !== "NONE";

  const handwashing = prev.handwashing || rng.bool(0.07);
  const hasLibrary = prev.hasLibrary || rng.bool(0.02);
  const hasIctLab = prev.hasIctLab || rng.bool(0.02);
  const internet = electricitySource !== "NONE" && (prev.internet || rng.bool(0.03));
  const gsfpParticipating = prev.gsfpParticipating;

  const reportsComputers = rng.bool(urban ? 0.72 : 0.42);
  const computersTotal = reportsComputers
    ? (prev.computersTotal ?? (hasIctLab ? rng.int(8, 60) : rng.int(0, 6)))
    : null;
  const computersWorking =
    computersTotal === null
      ? null
      : rng.int(Math.floor(computersTotal * 0.4), computersTotal);
  const reportsLibraryBooks = rng.bool(urban ? 0.6 : 0.3);
  const libraryBookCount = reportsLibraryBooks
    ? (prev.libraryBookCount ?? (hasLibrary ? rng.int(180, 4200) : rng.int(0, 120)))
    : null;
  const reportsFurniture = rng.bool(urban ? 0.68 : 0.47);

  return {
    ...prev,
    periodId: demoOperationalPeriodId(Number(prev.schoolId.slice(-12)), term.term),
    classroomsTotal,
    classroomsGood,
    classroomsRepair,
    waterSource,
    electricitySource,
    latrinesBoys: hasLatrines ? Math.max(prev.latrinesBoys, 1) : 0,
    latrinesGirls: hasLatrines ? Math.max(prev.latrinesGirls, 1) : 0,
    latrinesStaff: prev.latrinesStaff,
    latrineType,
    handwashing,
    hasLibrary,
    hasIctLab,
    internet,
    gsfpParticipating,
    libraryBookCount,
    computersTotal,
    computersWorking,
    internetType: internet ? (prev.internetType ?? "MOBILE_BROADBAND") : null,
    studentDesksUsable: reportsFurniture
      ? (prev.studentDesksUsable ?? rng.int(classroomsTotal * 8, classroomsTotal * 26))
      : null,
    studentDesksBroken: reportsFurniture
      ? (prev.studentDesksBroken ?? rng.int(0, classroomsTotal * 6))
      : null,
    teacherDesks: reportsFurniture
      ? (prev.teacherDesks ?? rng.int(0, classroomsTotal))
      : null,
    chalkboards: reportsFurniture
      ? (prev.chalkboards ?? rng.int(0, classroomsTotal))
      : null,
    whiteboards: reportsFurniture
      ? (prev.whiteboards ?? rng.int(0, urban ? 4 : 1))
      : null,
    projectors: reportsFurniture ? (prev.projectors ?? rng.int(0, urban ? 3 : 1)) : null,
    capturedAt,
  };
}

/**
 * Build the whole dataset in memory. PURE (given a seed) — no DB, no filesystem — so a test can
 * assert hand-computed sums against exactly the rows the loader is about to write.
 */
export function generateDemoDataset(seed: number = DEFAULT_SEED): DemoDataset {
  const rng = rngOf(seed);
  const schools: DemoSchool[] = [];
  const usedNames = new Set<string>();
  let index = 0;

  for (const region of GHANA_REGIONS as readonly DemoRegion[]) {
    for (const district of region.districts as readonly DemoDistrict[]) {
      const n = rng.int(SCHOOLS_PER_DISTRICT_MIN, SCHOOLS_PER_DISTRICT_MAX);
      for (let i = 0; i < n; i++) {
        index += 1;
        const schoolType = rng.weighted(SCHOOL_TYPE_MIX);
        const ownershipType = rng.weighted(OWNERSHIP_MIX);
        const onSchoolup = rng.bool(ON_SCHOOLUP_RATE);
        schools.push({
          emisSchoolId: `GH-${region.code}-${String(index).padStart(4, "0")}`,
          name: schoolName(rng, schoolType, ownershipType, usedNames),
          regionName: region.name,
          districtName: district.name,
          schoolType,
          ownershipType,
          onSchoolup,
          operationalSchoolId: onSchoolup ? demoOperationalSchoolId(index) : null,
          asOfDate: DEMO_REGISTER_AS_OF,
          // MMDA class × region urbanisation (see DemoRegion.urbanisation). Capped below 1 so even
          // Accra Metropolitan keeps a handful of peri-urban schools — a region in which EVERY school
          // is urban would hide the within-region inequality a regional director is looking for.
          urban: rng.bool(Math.min(0.95, district.urbanShare * region.urbanisation)),
        });
      }
    }
  }

  const periods: DemoOperationalPeriod[] = [];
  const facilities: DemoFacilitiesRow[] = [];
  for (const school of schools) {
    if (!school.onSchoolup) continue; // no tenant → no operational census → no fact row
    const schoolIndex = Number(school.operationalSchoolId!.slice(-12));
    let previous: DemoFacilitiesRow | null = null;
    for (const term of DEMO_TERMS) {
      const periodId = demoOperationalPeriodId(schoolIndex, term.term);
      periods.push({
        schoolId: school.operationalSchoolId!,
        periodId,
        academicYear: term.academicYear,
        term: term.term,
        startsOn: term.startsOn,
        endsOn: term.endsOn,
      });
      // captured_at is the census VINTAGE and becomes the fact row's as_of_date, so it must be
      // deterministic: a wall-clock value here would make a re-run differ in provenance and turn the
      // idempotency test into a test of the clock.
      previous = facilitiesFor(
        rng,
        school,
        term,
        `${term.endsOn}T12:00:00+00:00`,
        previous,
      );
      facilities.push(previous);
    }
  }

  return { seed, terms: [...DEMO_TERMS], schools, periods, facilities };
}

/** The EMIS extract artefact, exactly as the register loader will read it back off disk. */
export function emisExtractFor(dataset: DemoDataset): EmisExtractFile {
  return {
    as_of_date: DEMO_REGISTER_AS_OF,
    rows: dataset.schools.map((s) => ({
      emis_school_id: s.emisSchoolId,
      name: s.name,
      region: s.regionName,
      district: s.districtName,
      school_type: s.schoolType,
      ownership_type: s.ownershipType,
      on_schoolup: s.onSchoolup,
      operational_school_id: s.operationalSchoolId,
    })),
  };
}

// ── loading ─────────────────────────────────────────────────────────────────────────────────────

/** Where the generated EMIS extract lands. Committed, so the demo runs without the generator. */
export const DEMO_EMIS_EXTRACT_PATH = join(
  process.cwd(),
  "db/seed/demo/emis-register-extract.json",
);

const DEMO_SOURCE_SCHEMA_SQL = join(process.cwd(), "db/seed/demo/demo-source-schema.sql");

/**
 * (Re)create `demo_source` and load the operational-shaped rows. DROP-and-CREATE, not upsert: this
 * is a demo fixture, and a half-migrated stand-in source is a worse failure than a slow reload.
 */
export async function loadDemoSource(
  sql: postgres.Sql,
  dataset: DemoDataset,
  schemaSqlPath: string = DEMO_SOURCE_SCHEMA_SQL,
): Promise<{ periods: number; facilities: number }> {
  const { readFileSync } = await import("node:fs");
  await sql.unsafe(readFileSync(schemaSqlPath, "utf8"));

  const CHUNK = 500;
  for (let i = 0; i < dataset.periods.length; i += CHUNK) {
    const chunk = dataset.periods.slice(i, i + CHUNK);
    await sql`insert into demo_source.academic_period ${sql(
      chunk.map((p) => ({
        school_id: p.schoolId,
        period_id: p.periodId,
        academic_year: p.academicYear,
        term: p.term,
        starts_on: p.startsOn,
        ends_on: p.endsOn,
      })),
    )}`;
  }

  for (let i = 0; i < dataset.facilities.length; i += CHUNK) {
    const chunk = dataset.facilities.slice(i, i + CHUNK);
    await sql`insert into demo_source.facilities_snapshot ${sql(
      chunk.map((f) => ({
        school_id: f.schoolId,
        period_id: f.periodId,
        classrooms_total: f.classroomsTotal,
        classrooms_good: f.classroomsGood,
        classrooms_repair: f.classroomsRepair,
        water_source: f.waterSource,
        electricity_source: f.electricitySource,
        latrines_boys: f.latrinesBoys,
        latrines_girls: f.latrinesGirls,
        latrines_staff: f.latrinesStaff,
        latrine_type: f.latrineType,
        handwashing: f.handwashing,
        has_library: f.hasLibrary,
        has_ict_lab: f.hasIctLab,
        internet: f.internet,
        has_kitchen: f.hasKitchen,
        gsfp_participating: f.gsfpParticipating,
        library_book_count: f.libraryBookCount,
        library_staff_fte: f.libraryStaffFte,
        computers_total: f.computersTotal,
        computers_working: f.computersWorking,
        internet_type: f.internetType,
        meals_served_last_term: f.mealsServedLastTerm,
        pupils_fed_daily_avg: f.pupilsFedDailyAvg,
        caterer_name: f.catererName,
        textbook_availability: f.textbookAvailability,
        student_desks_usable: f.studentDesksUsable,
        student_desks_broken: f.studentDesksBroken,
        teacher_desks: f.teacherDesks,
        chalkboards: f.chalkboards,
        whiteboards: f.whiteboards,
        projectors: f.projectors,
        note: f.note,
        captured_at: f.capturedAt,
      })),
    )}`;
  }

  return { periods: dataset.periods.length, facilities: dataset.facilities.length };
}

/** Write the EMIS extract artefact to disk. Stable bytes for a given seed. */
export function writeEmisExtract(dataset: DemoDataset, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(emisExtractFor(dataset), null, 2)}\n`, "utf8");
}

async function main(): Promise<void> {
  const seed = process.env.DEMO_SEED ? Number(process.env.DEMO_SEED) : DEFAULT_SEED;
  const dataset = generateDemoDataset(seed);

  writeEmisExtract(dataset, DEMO_EMIS_EXTRACT_PATH);
  console.log(
    `✓ EMIS extract → ${DEMO_EMIS_EXTRACT_PATH} (${dataset.schools.length} registered schools, ` +
      `${dataset.schools.filter((s) => s.onSchoolup).length} on Schoolup)`,
  );

  // The demo stand-in source lives in the ANALYTICS database (see db/seed/demo/demo-source-schema.sql
  // for why). This connection must be the PRIVILEGED owner/writer, exactly like db:migrate and
  // load-establishment — never the app runtime's read-scoped role.
  const url =
    process.env.ANALYTICS_DATABASE_URL ??
    "postgresql://omnischools:omnischools@localhost:55432/omnischools_analytics_dev";
  const sql = postgres(url, { max: 1, prepare: false });
  try {
    const loaded = await loadDemoSource(sql, dataset);
    console.log(
      `✓ demo_source → ${loaded.facilities} facilities_snapshot rows across ` +
        `${loaded.periods} school-periods (${dataset.terms.length} terms)`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
