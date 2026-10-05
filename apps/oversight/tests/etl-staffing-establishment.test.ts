import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { adminDemoAnalytics } from "./helpers";
import {
  DEMO_TERMS,
  emisExtractFor,
  generateDemoDataset,
  loadDemoSource,
  type DemoDataset,
} from "@/scripts/seed-demo-data";
import { runOversightEtl, type EtlRunReport } from "@/lib/etl/pipeline";

/**
 * QA GATE ADDITION (Quinn) — THE THREE STAFFING PATHS `tests/etl-staffing.test.ts` CANNOT REACH,
 * because the demo's `ref_ges_teacher_establishment` is EMPTY and every school in it succeeds:
 *
 *  1 · `readCurrentEstablishment` — the REAL GES vintage, preferred over the generated establishment
 *      (ruling §4), and `MAX(as_of_date)` as the definition of "current" (`db/schema/ref.ts` AC-2.3).
 *      Nothing in the committed suite loads a single ref row, so the whole branch — the SQL, the
 *      `distinct on` tie-break, and the preference itself — was only covered by passing a literal to
 *      `deriveSchoolStaffing` in memory. A broken query would have left the demo looking identical.
 *  2 · The ruling's §4 NULL rule WINS OVER A LOADED REF ROW, end to end. A PRIVATE/MISSION school with
 *      a GES establishment row on file is the one input that could put an establishment figure on a
 *      non-GES school, and it must not: NULL means "GES sets no establishment here".
 *  3 · A STAFFING-ARM PER-SCHOOL FAILURE, through the real pipeline (Wells's plan §6 test 10, which
 *      the implementation tested only at the transform boundary). This is the test that proves the arm
 *      is actually wired through `computePerSchool`: ONE school fails BY NAME, the run still closes,
 *      the other 848 schools are written — and the failed school's PRIOR ROW SURVIVES, which pins
 *      stale-but-honest UNCONDITIONALLY. The committed idempotency test asserts that property only
 *      `if (stranded)` — i.e. only if the demo happens to produce a `noRoster` school — so on a demo
 *      that produces none it passes without testing anything.
 *
 * It also pins the VALUE-LEVEL NON-VACUITY the committed assertions assume: that PRIVATE **and**
 * MISSION rows (both named by the ruling) are actually present with NULL establishment, and that both
 * vacancy signs occur with enough rows on each side that "≥ 1" is not one lucky school.
 *
 * Sorts before `etl-staffing.test.ts` ('-' < '.'), and cleans up after itself: the injected ref rows
 * are deleted in `afterAll` (leaving them would make the next file's run close with a gap).
 */

let sql: postgres.Sql;
let dataset: DemoDataset;
let first: EtlRunReport;
let second: EtlRunReport;

const CURRENT_YEAR = DEMO_TERMS.find((t) => t.isCurrent)!.academicYear;

interface Row {
  jurisdiction_id: string;
  emis_school_id: string;
  ownership_type: string;
  teachers_on_roll: number;
  teaching_posts_established: number | null;
  enrolment_total: number;
  ptr: string;
  vacancies: number | null;
  etl_run_id: string;
}

/** A PUBLIC school whose establishment comes from TWO ref vintages — the newer one must win. */
let twoVintage: Row;
/** A non-PUBLIC school WITH a ref row on file — it must still come out NULL. */
let nonPublic: Row;
/** A PUBLIC school whose ref vintage is INVALID — it alone must fail. */
let poisoned: Row;

const OLD_VINTAGE = "2019-09-30";
const NEW_VINTAGE = "2024-09-30";
const NEW_POSTS = 77;
const OLD_POSTS = 999;

async function runEtl(): Promise<EtlRunReport> {
  return runOversightEtl(sql, {
    emisExtractText: JSON.stringify(emisExtractFor(dataset)),
    periods: DEMO_TERMS.map((t) => ({
      academicYear: t.academicYear,
      term: t.term,
      startsOn: t.startsOn,
      endsOn: t.endsOn,
      isCurrent: t.isCurrent,
    })),
    sourceSchema: "demo_source",
  });
}

async function readStaffing(): Promise<Row[]> {
  return sql<Row[]>`
    select fs.jurisdiction_id::text as jurisdiction_id,
           r.emis_school_id,
           r.ownership_type::text   as ownership_type,
           fs.teachers_on_roll,
           fs.teaching_posts_established,
           fs.enrolment_total,
           fs.ptr::text             as ptr,
           fs.vacancies,
           fs.etl_run_id::text      as etl_run_id
      from fact_staffing fs
      join dim_jurisdiction j on j.jurisdiction_id = fs.jurisdiction_id
      join ref_emis_school_register r on r.emis_school_id = j.ges_code
     order by r.emis_school_id`;
}

beforeAll(async () => {
  sql = adminDemoAnalytics();
  dataset = generateDemoDataset();
  await loadDemoSource(sql, dataset);

  // RUN ONE — the ordinary demo: an EMPTY ref table, so every row's establishment is generated.
  first = await runEtl();
  expect(first.status).toBe("SUCCESS");
  const before = await readStaffing();
  expect(before.length).toBeGreaterThan(100);

  const publics = before.filter((r) => r.ownership_type === "PUBLIC");
  const nonPublics = before.filter((r) => r.ownership_type !== "PUBLIC");
  expect(publics.length).toBeGreaterThan(2);
  expect(nonPublics.length).toBeGreaterThan(0);
  twoVintage = publics[0]!;
  poisoned = publics[1]!;
  // MISSION by preference — it is the ownership the ruling names beside PRIVATE and the one a reader
  // is most likely to assume is "sort of public" and therefore on the establishment.
  nonPublic = nonPublics.find((r) => r.ownership_type === "MISSION") ?? nonPublics[0]!;

  await sql`
    insert into ref_ges_teacher_establishment
      (emis_school_id, teaching_posts_established, source, as_of_date)
    values
      -- The SAME school twice: the current vintage is MAX(as_of_date), so 77 must win over 999. If
      -- readCurrentEstablishment picked the first/min row instead, the written row would say 999.
      (${twoVintage.emis_school_id}, ${OLD_POSTS}, 'GES_ESTABLISHMENT', ${OLD_VINTAGE}::date),
      (${twoVintage.emis_school_id}, ${NEW_POSTS}, 'GES_ESTABLISHMENT', ${NEW_VINTAGE}::date),
      -- A non-GES school WITH a GES row on file. Ruling §4 still says NULL.
      (${nonPublic.emis_school_id}, 50, 'GES_ESTABLISHMENT', ${NEW_VINTAGE}::date),
      -- A NEGATIVE authorised-post count: not a staffing figure, so this school must fail BY NAME
      -- rather than being quietly replaced by a generated guess.
      (${poisoned.emis_school_id}, -1, 'GES_ESTABLISHMENT', ${NEW_VINTAGE}::date)`;

  // RUN TWO — same source, same roster, the ref table now loaded.
  second = await runEtl();
}, 900_000);

afterAll(async () => {
  if (sql) {
    await sql`delete from ref_ges_teacher_establishment`;
    await sql`delete from fact_staffing`;
    await sql.end({ timeout: 5 });
  }
});

describe("the REAL GES establishment vintage (ruling §4) — the branch the empty demo never reaches", () => {
  it("uses MAX(as_of_date), so the NEWER vintage wins and the older one is ignored", async () => {
    const after = await readStaffing();
    const row = after.find((r) => r.emis_school_id === twoVintage.emis_school_id)!;
    expect(row).toBeDefined();
    expect(row.teaching_posts_established).toBe(NEW_POSTS);
    expect(row.teaching_posts_established).not.toBe(OLD_POSTS);
    // The signed vacancy is computed against the LOADED figure, not the generated one.
    expect(row.vacancies).toBe(NEW_POSTS - row.teachers_on_roll);
    // …and the real figure actually DISPLACED a generated one, so the preference is observable rather
    // than a coincidence of two equal numbers.
    expect(twoVintage.teaching_posts_established).not.toBe(NEW_POSTS);
  });

  it("still gives a PRIVATE/MISSION school NULL, even with a GES row on file (ruling §4)", async () => {
    const after = await readStaffing();
    const row = after.find((r) => r.emis_school_id === nonPublic.emis_school_id)!;
    expect(row.ownership_type).not.toBe("PUBLIC");
    expect(row.teaching_posts_established).toBeNull();
    expect(row.vacancies).toBeNull();
    // It still has the two measures that do apply to it.
    expect(row.teachers_on_roll).toBeGreaterThanOrEqual(1);
    expect(Number(row.ptr)).toBeGreaterThan(0);
  });
});

describe("a staffing-arm failure costs ONE SCHOOL — the arm is really under computePerSchool", () => {
  it("names the school, closes the run, writes everyone else, and KEEPS the failed school's prior row", async () => {
    // The run still closes (1 school out of ~849 is inside the 1% policy), which is the whole point of
    // per-school isolation: 848 schools' staffing figures are not lost to one bad establishment row.
    expect(second.status).toBe("SUCCESS");
    const period = second.periods.find((p) => p.academicYear === CURRENT_YEAR)!;
    const named = period.staffing.failures.filter(
      (f) => f.emisSchoolId === poisoned.emis_school_id,
    );
    expect(named).toHaveLength(1);
    expect(period.staffing.failures).toHaveLength(1);
    expect(named[0]!.message).toMatch(/ref_ges_teacher_establishment/);
    expect(named[0]!.message).toMatch(/-1/);

    const after = await readStaffing();
    // STALE-BUT-HONEST, unconditionally: the school is out of the delete scope, so run one's row is
    // still there — stamped with run one's id, which is what makes "stale" visible rather than silent.
    const kept = after.find((r) => r.emis_school_id === poisoned.emis_school_id)!;
    expect(kept).toBeDefined();
    expect(kept.etl_run_id).toBe(first.runId);
    expect(kept.teachers_on_roll).toBe(poisoned.teachers_on_roll);
    expect(kept.teaching_posts_established).toBe(poisoned.teaching_posts_established);

    // …and every OTHER school was refreshed by run two, so the failure did not quietly abort the arm.
    const others = after.filter((r) => r.emis_school_id !== poisoned.emis_school_id);
    expect(others.length).toBeGreaterThan(100);
    expect(others.every((r) => r.etl_run_id === second.runId)).toBe(true);
    expect(after.length).toBe(period.staffing.inserted + 1);
  });
});

describe("the demo really does exercise both nullable and both signed cases (non-vacuity)", () => {
  it("has PRIVATE and MISSION rows, every one of them NULL on both establishment columns", async () => {
    const after = await readStaffing();
    for (const ownership of ["PRIVATE", "MISSION"] as const) {
      const set = after.filter((r) => r.ownership_type === ownership);
      expect(set.length, `no ${ownership} school has a staffing row`).toBeGreaterThan(0);
      expect(set.filter((r) => r.teaching_posts_established !== null)).toEqual([]);
      expect(set.filter((r) => r.vacancies !== null)).toEqual([]);
    }
    const publics = after.filter((r) => r.ownership_type === "PUBLIC");
    expect(publics.length).toBeGreaterThan(0);
    expect(publics.filter((r) => r.teaching_posts_established === null)).toEqual([]);
  });

  it("has a SUBSTANTIAL population on BOTH sides of zero, not one lucky surplus school", async () => {
    const after = await readStaffing();
    const withPosts = after.filter((r) => r.vacancies !== null);
    const surplus = withPosts.filter((r) => r.vacancies! < 0);
    const shortage = withPosts.filter((r) => r.vacancies! > 0);
    // A floor at max(0, …) would make `surplus` empty. Requiring a double-digit count on each side is
    // what makes the signed-ness a PROPERTY OF THE DISTRIBUTION rather than an edge case that could
    // vanish on the next re-roll of the seed and leave the ruling's §4 half-tested.
    expect(surplus.length).toBeGreaterThan(10);
    expect(shortage.length).toBeGreaterThan(10);
    // Every one of them is exactly the subtraction, including the negatives.
    for (const r of withPosts)
      expect(r.vacancies).toBe(r.teaching_posts_established! - r.teachers_on_roll);
  });
});
