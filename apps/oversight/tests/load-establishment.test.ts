import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { adminAnalytics } from "./helpers";
import {
  EstablishmentFileError,
  loadEstablishmentFile,
  parseEstablishmentFile,
} from "@/scripts/load-establishment";

/**
 * #2 — GES establishment file loader.
 *
 * The loader writes analytics `ref_ges_teacher_establishment`, whose `emis_school_id` FKs the EMIS
 * register, so the two register rows the sample file targets are created first (as the owner, which
 * is the privileged writer the loader connects as in prod). All probe rows use dedicated ETL-EST-*
 * ids so nothing collides with the §6 gate fixtures.
 */

const SAMPLE_PATH = join(process.cwd(), "tests/fixtures/establishment-sample.json");
const SAMPLE = readFileSync(SAMPLE_PATH, "utf8");

let sql: postgres.Sql;

async function establishmentText(emisSchoolId: string): Promise<string> {
  const rows = await sql<{ t: string }[]>`
    select establishment_teachers::text as t
    from ref_ges_teacher_establishment
    where emis_school_id = ${emisSchoolId}
    order by as_of_date desc
    limit 1`;
  return rows[0]!.t;
}

/** Membership-by-NTC over the MAX vintage — the exact existence test lib/oversight/classify.ts runs. */
async function onRegister(emisSchoolId: string, ntc: string): Promise<boolean> {
  const rows = await sql<{ on_register: boolean }[]>`
    select exists (
      select 1 from jsonb_array_elements(coalesce(establishment_teachers, '[]'::jsonb)) e
      where e->>'ntc_licence_number' = ${ntc}
    ) as on_register
    from ref_ges_teacher_establishment
    where emis_school_id = ${emisSchoolId}
    order by as_of_date desc
    limit 1`;
  return rows[0]?.on_register ?? false;
}

beforeAll(async () => {
  sql = adminAnalytics();
  await sql`
    insert into ref_emis_school_register (emis_school_id, name, on_schoolup, as_of_date)
    values ('ETL-EST-1', 'ETL Sample Basic 1', true, current_date),
           ('ETL-EST-2', 'ETL Sample Basic 2', true, current_date)
    on conflict (emis_school_id) do nothing`;
});

afterAll(async () => {
  await sql`delete from ref_ges_teacher_establishment where emis_school_id in ('ETL-EST-1','ETL-EST-2')`;
  await sql`delete from ref_emis_school_register where emis_school_id in ('ETL-EST-1','ETL-EST-2')`;
  await sql.end({ timeout: 5 });
});

describe("load-establishment (#2)", () => {
  it("loads the sample file and membership-by-NTC over the max vintage returns the right rows", async () => {
    const result = await loadEstablishmentFile(sql, SAMPLE);
    expect(result).toEqual({ schools: 2, teachers: 4 });

    // AC-2.4 provenance: every row stamped GES_ESTABLISHMENT + the file's as_of_date.
    const rows = await sql<{ emis: string; posts: number; source: string; as_of: string }[]>`
      select emis_school_id as emis, teaching_posts_established as posts, source::text as source,
             as_of_date::text as as_of
      from ref_ges_teacher_establishment
      where emis_school_id in ('ETL-EST-1','ETL-EST-2')
      order by emis_school_id`;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ emis: "ETL-EST-1", posts: 42, source: "GES_ESTABLISHMENT", as_of: "2026-09-01" });
    expect(rows[1]).toMatchObject({ emis: "ETL-EST-2", posts: 17, source: "GES_ESTABLISHMENT", as_of: "2026-09-01" });

    // Membership: a loaded NTC is on the register, an unknown one is not.
    expect(await onRegister("ETL-EST-1", "NTC-2019-004417")).toBe(true);
    expect(await onRegister("ETL-EST-1", "NTC-2018-004410")).toBe(true); // the name-less row still binds
    expect(await onRegister("ETL-EST-1", "NTC-NOPE-000000")).toBe(false);
    expect(await onRegister("ETL-EST-2", "NTC-2021-556677")).toBe(true);
  });

  it("AC-2.2 re-loading the same vintage is byte-identical (idempotent, one row per vintage)", async () => {
    await loadEstablishmentFile(sql, SAMPLE);
    const before = await establishmentText("ETL-EST-1");
    await loadEstablishmentFile(sql, SAMPLE);
    const after = await establishmentText("ETL-EST-1");
    expect(after).toBe(before);

    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int n from ref_ges_teacher_establishment where emis_school_id = 'ETL-EST-1'`;
    expect(n).toBe(1);
  });

  it("AC-2.2 array order in the file does not change the stored bytes (sorted by NTC)", async () => {
    const shuffled = JSON.stringify({
      as_of_date: "2026-09-01",
      rows: [...(JSON.parse(SAMPLE).rows as unknown[])].reverse(),
    });
    const expected = await establishmentText("ETL-EST-1");
    await loadEstablishmentFile(sql, shuffled);
    expect(await establishmentText("ETL-EST-1")).toBe(expected);
  });

  describe("AC-2.4 / AC-2.8 — bad files are rejected loudly", () => {
    it("rejects a row missing its NTC licence number", () => {
      const bad = JSON.stringify({
        as_of_date: "2026-09-01",
        rows: [{ emis_school_id: "ETL-EST-1", teaching_posts_established: 42, teacher_name: "No Licence" }],
      });
      expect(() => parseEstablishmentFile(bad)).toThrow(/ntc_licence_number/i);
    });

    it("rejects a row missing its emis_school_id", () => {
      const bad = JSON.stringify({
        as_of_date: "2026-09-01",
        rows: [{ ntc_licence_number: "NTC-x", teaching_posts_established: 42 }],
      });
      expect(() => parseEstablishmentFile(bad)).toThrow(/emis_school_id/i);
    });

    it("rejects a file/row with no as_of_date anywhere", () => {
      const bad = JSON.stringify({
        rows: [{ emis_school_id: "ETL-EST-1", ntc_licence_number: "NTC-x", teaching_posts_established: 42 }],
      });
      expect(() => parseEstablishmentFile(bad)).toThrow(/as_of_date/i);
    });

    it("AC-2.8 rejects the WHOLE file when it carries GES staff ids but no NTC numbers", () => {
      const bad = JSON.stringify({
        as_of_date: "2026-09-01",
        rows: [
          { emis_school_id: "ETL-EST-1", ges_staff_id: "GES-000123", teaching_posts_established: 42 },
          { emis_school_id: "ETL-EST-1", ges_staff_id: "GES-000124", teaching_posts_established: 42 },
        ],
      });
      expect(() => parseEstablishmentFile(bad)).toThrow(EstablishmentFileError);
      expect(() => parseEstablishmentFile(bad)).toThrow(/GES staff ids but no NTC/i);
    });

    it("rejects rows that disagree on a school's teaching_posts_established", () => {
      const bad = JSON.stringify({
        as_of_date: "2026-09-01",
        rows: [
          { emis_school_id: "ETL-EST-1", ntc_licence_number: "NTC-a", teaching_posts_established: 42 },
          { emis_school_id: "ETL-EST-1", ntc_licence_number: "NTC-b", teaching_posts_established: 40 },
        ],
      });
      expect(() => parseEstablishmentFile(bad)).toThrow(/teaching_posts_established/i);
    });
  });
});
