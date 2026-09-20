import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import { students, classes } from "@/db/schema";
import { compareLevelLabel } from "./level-order";

/**
 * GOV-8 · the census enrolment reader — the ONE net-new reader the GES census needs (Kofi §2). Server-only,
 * `withSchool`-scoped, aggregate-only, and STANDALONE (not a rollup arm — the board never needs age×sex×level,
 * and threading it through the rollup would pollute every board consumer). It answers the disaggregation the
 * GES census mandates: enrolment by class & level, split by sex; an age histogram by level; and the
 * "enrolment by approved age" (under / on / over the GES official age) the EMIS census reports.
 *
 * HONESTY (GOV8-05): a student with a NULL date_of_birth is NEVER coerced to a real age — they fall in the
 * `dobUnknown` total and the per-level `unknown` bucket. Age is whole years from DOB to the frozen
 * `censusDate` (not "now"): passing `opts.censusDate` at generation freezes the disaggregation as-of that
 * point-in-time (GOV8-02), so a later roll change cannot shift a filed census.
 *
 * ACTIVE-only. The heavy lifting is the pure `aggregateCensusEnrolment` below (unit-tested with no DB).
 */

/** GES official starting age per level (EMIS "enrolment by approved age"): KG1=4 … Primary1=6 … JHS1=12 …
 *  SHS/Form1=15 … SHS3=17. A level with no mapping (nursery/creche, or an unparseable label) is omitted
 *  from `approvedAge` — you cannot assess "approved age" without an official reference. */
export function officialAgeForLevel(level: string | null | undefined): number | null {
  if (!level) return null;
  const s = level.toUpperCase();
  const num = s.match(/\d+/);
  if (!num) return null;
  const n = parseInt(num[0], 10);
  if (!Number.isFinite(n) || n < 1) return null;
  let base: number | null = null;
  if (/NURSERY|CRECHE|CRÈCHE|PRE-?SCHOOL|PRE-?K/.test(s)) base = null; // pre-primary — no GES census age
  else if (/KG|KINDER/.test(s)) base = 4; // KG1=4, KG2=5
  else if (/JHS|JSS|J\.?H\.?S/.test(s)) base = 12; // JHS1=12 … JHS3=14
  else if (/SHS|SSS|FORM|S\.?H\.?S/.test(s)) base = 15; // SHS/Form1=15 … SHS3=17
  else if (/PRIMARY|BASIC|CLASS|PRI|\bP\b|\bB\b/.test(s)) base = 6; // Primary/Basic 1=6 … 6=11
  if (base == null) return null;
  const age = base + (n - 1);
  return age >= 4 && age <= 20 ? age : null; // sanity fence against a stray number in a label
}

/** Whole years from DOB to the census date. NULL DOB → null (never a fabricated age). */
export function ageAsOf(dateOfBirth: string | null | undefined, censusDate: Date): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(`${dateOfBirth}T00:00:00.000Z`);
  if (Number.isNaN(dob.getTime())) return null;
  let age = censusDate.getUTCFullYear() - dob.getUTCFullYear();
  const m = censusDate.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && censusDate.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}

export type SexSplit = { female: number; male: number; total: number };

export type CensusClassRow = { classId: string; name: string; level: string | null } & SexSplit;
export type CensusLevelRow = { level: string } & SexSplit;
export type CensusAgeBucket = { age: number } & SexSplit;
export type CensusAgeByLevel = { level: string; byAge: CensusAgeBucket[]; dobUnknown: number };
export type CensusApprovedAge = {
  level: string;
  officialAge: number;
  under: number;
  on: number;
  over: number;
  unknown: number; // students in this level with no DOB (never a coerced age)
};

export type CensusEnrolment = {
  /** The frozen point-in-time the ages/roll are computed as-of (ISO "YYYY-MM-DD"). */
  censusDate: string;
  roll: number;
  gender: SexSplit;
  byClass: CensusClassRow[];
  byLevel: CensusLevelRow[];
  ageByLevel: CensusAgeByLevel[];
  approvedAge: CensusApprovedAge[];
  dobUnknown: number;
};

/** The minimal student/class shapes the aggregate needs — kept narrow so the pure fn is trivially testable. */
export type CensusStudentInput = { sex: string; dateOfBirth: string | null; classId: string | null };
export type CensusClassInput = { classId: string; name: string; level: string | null };

const UNASSIGNED = "__unassigned__";
const UNSPECIFIED = "Unspecified";
const emptySplit = (): { female: number; male: number } => ({ female: 0, male: 0 });
const totalOf = (s: { female: number; male: number }): SexSplit => ({ ...s, total: s.female + s.male });

/**
 * The pure census disaggregation — no DB, so unit-tested directly (GOV8-03/04/05/06). Every ACTIVE student
 * is counted in `roll`/`gender`; a student whose class is missing from `classList` (or has none) lands in an
 * "Unassigned" class row and an "Unspecified" level so the by-class/by-level tallies still sum to `roll`
 * (honest — an unassigned pupil is a real gap, not dropped). NULL DOB is bucketed as unknown, never aged.
 */
export function aggregateCensusEnrolment(
  studentList: CensusStudentInput[],
  classList: CensusClassInput[],
  censusDate: Date,
): CensusEnrolment {
  const classById = new Map(classList.map((c) => [c.classId, c]));
  const levelOf = (classId: string | null): string => {
    const c = classId ? classById.get(classId) : undefined;
    return c?.level ?? UNSPECIFIED;
  };

  const gender = emptySplit();
  const byClassAcc = new Map<string, { name: string; level: string | null; female: number; male: number }>();
  const byLevelAcc = new Map<string, { female: number; male: number }>();
  // level → (age → split) + null-DOB count
  const ageAcc = new Map<string, { ages: Map<number, { female: number; male: number }>; dobUnknown: number }>();
  // level → approved-age tallies (only levels with an official age)
  const apprAcc = new Map<string, { under: number; on: number; over: number; unknown: number }>();
  let dobUnknown = 0;

  // Seed by-class with every provided class (so zero-student classes still list, GES-style).
  for (const c of classList) byClassAcc.set(c.classId, { name: c.name, level: c.level, ...emptySplit() });

  for (const s of studentList) {
    const isF = s.sex === "FEMALE";
    const isM = s.sex === "MALE";
    if (!isF && !isM) continue; // sex is a NOT NULL enum (MALE|FEMALE); guard defends a widened domain
    const bump = (o: { female: number; male: number }) => (isF ? o.female++ : o.male++);

    bump(gender);

    const classKey = s.classId && classById.has(s.classId) ? s.classId : UNASSIGNED;
    const cls = byClassAcc.get(classKey) ?? { name: "Unassigned", level: null, ...emptySplit() };
    bump(cls);
    byClassAcc.set(classKey, cls);

    const level = levelOf(s.classId);
    const lvl = byLevelAcc.get(level) ?? emptySplit();
    bump(lvl);
    byLevelAcc.set(level, lvl);

    const ageEntry = ageAcc.get(level) ?? { ages: new Map(), dobUnknown: 0 };
    const age = ageAsOf(s.dateOfBirth, censusDate);
    if (age == null) {
      ageEntry.dobUnknown++;
      dobUnknown++;
    } else {
      const bucket = ageEntry.ages.get(age) ?? emptySplit();
      bump(bucket);
      ageEntry.ages.set(age, bucket);
    }
    ageAcc.set(level, ageEntry);

    const official = officialAgeForLevel(level === UNSPECIFIED ? null : level);
    if (official != null) {
      const a = apprAcc.get(level) ?? { under: 0, on: 0, over: 0, unknown: 0 };
      if (age == null) a.unknown++;
      else if (age < official) a.under++;
      else if (age === official) a.on++;
      else a.over++;
      apprAcc.set(level, a);
    }
  }

  // byClass: provided-class order first (query already sorts by name), Unassigned last.
  const byClass: CensusClassRow[] = classList.map((c) => {
    const acc = byClassAcc.get(c.classId)!;
    return { classId: c.classId, name: acc.name, level: acc.level, ...totalOf(acc) };
  });
  const unassigned = byClassAcc.get(UNASSIGNED);
  if (unassigned && unassigned.female + unassigned.male > 0) {
    byClass.push({ classId: UNASSIGNED, name: "Unassigned", level: null, ...totalOf(unassigned) });
  }

  const byLevel: CensusLevelRow[] = [...byLevelAcc.entries()]
    .map(([level, s]) => ({ level, ...totalOf(s) }))
    .sort((a, b) => compareLevelLabel(a.level, b.level));

  const ageByLevel: CensusAgeByLevel[] = [...ageAcc.entries()]
    .map(([level, e]) => ({
      level,
      byAge: [...e.ages.entries()].map(([age, s]) => ({ age, ...totalOf(s) })).sort((a, b) => a.age - b.age),
      dobUnknown: e.dobUnknown,
    }))
    .sort((a, b) => compareLevelLabel(a.level, b.level));

  const approvedAge: CensusApprovedAge[] = [...apprAcc.entries()]
    .map(([level, a]) => ({ level, officialAge: officialAgeForLevel(level)!, ...a }))
    .sort((a, b) => compareLevelLabel(a.level, b.level));

  return {
    censusDate: censusDate.toISOString().slice(0, 10),
    roll: gender.female + gender.male,
    gender: totalOf(gender),
    byClass,
    byLevel,
    ageByLevel,
    approvedAge,
    dobUnknown,
  };
}

/**
 * The census enrolment disaggregation for a school, ACTIVE-only, as-of `opts.censusDate` (default now).
 * `withSchool`-scoped — the FORCE-RLS `tenant_isolation` policy is the real cross-tenant boundary (GOV8-16);
 * the pure aggregate above does the maths. One classes read + one students read, aggregated in memory (rolls
 * are hundreds, not millions).
 */
export async function getCensusEnrolment(
  schoolId: string,
  opts?: { censusDate?: Date },
): Promise<CensusEnrolment> {
  const censusDate = opts?.censusDate ?? new Date();
  return withSchool(schoolId, async (tx) => {
    const classRows = await tx
      .select({ classId: classes.id, name: classes.name, level: classes.level })
      .from(classes)
      .where(and(eq(classes.schoolId, schoolId), eq(classes.active, true)))
      .orderBy(asc(classes.name));
    const studentRows = await tx
      .select({ sex: students.sex, dateOfBirth: students.dateOfBirth, classId: students.classId })
      .from(students)
      .where(and(eq(students.schoolId, schoolId), eq(students.status, "ACTIVE")));
    return aggregateCensusEnrolment(studentRows, classRows, censusDate);
  });
}
