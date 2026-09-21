import { describe, expect, it } from "vitest";
import { adminAnalytics } from "./helpers";

/**
 * Kofi group K — the structural half of "students are not individually reachable".
 *
 * The application-level assertion (field-scope.ts throws on STUDENT) is necessary but not
 * sufficient: an app rule can be changed by whoever writes the next feature. The durable version of
 * the promise is that the analytics database CANNOT hold an individual — §9's "no raw student
 * records", checked here against the live schema rather than against the schema file, so a
 * hand-applied prod migration that added one would be caught too.
 *
 * The one permitted exception is `ref_ges_teacher_establishment.staff_ids`: a GES-supplied JSON
 * array of establishment numbers, which is reference data about POSTS, not a person record. It
 * carries no name, no contact detail and no per-person row, and it is the lookup key the statutory
 * branch is checked against — without it there is no way to tell a GES teacher from anyone else.
 */
describe("the analytics DB holds no individual-grain table", () => {
  it("has no person-identifying column anywhere except the establishment staff-id list", async () => {
    const sql = adminAnalytics();
    try {
      const rows = (await sql`
        select table_name, column_name
        from information_schema.columns
        where table_schema = 'public'
          and (
            column_name in (
              'student_id','pupil_id','person_id','user_id','staff_profile_id',
              'full_name','first_name','last_name','surname','date_of_birth','dob',
              'phone','email','address','emergency_contact','national_id','ghana_card'
            )
            or column_name like '%_full_name'
          )
        order by table_name, column_name
      `) as unknown as { table_name: string; column_name: string }[];
      expect(rows).toEqual([]);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("keeps the establishment staff-id list as reference data about posts, not people", async () => {
    const sql = adminAnalytics();
    try {
      const rows = (await sql`
        select column_name, data_type
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'ref_ges_teacher_establishment'
        order by column_name
      `) as unknown as { column_name: string; data_type: string }[];
      const names = rows.map((r) => r.column_name);
      expect(names).toContain("staff_ids");
      expect(rows.find((r) => r.column_name === "staff_ids")!.data_type).toBe("jsonb");
      // No name, no contact detail, no per-person row: the table's grain is the SCHOOL.
      for (const forbidden of ["full_name", "phone", "email", "date_of_birth"]) {
        expect(names).not.toContain(forbidden);
      }
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("no table in the analytics DB is named for an individual", async () => {
    const sql = adminAnalytics();
    try {
      const rows = (await sql`
        select table_name
        from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'
        order by table_name
      `) as unknown as { table_name: string }[];
      const names = rows.map((r) => r.table_name);
      for (const name of names) {
        expect(
          /student|pupil|learner|staff_profile|person|guardian/.test(name),
          `table ${name} looks individual-grain`,
        ).toBe(false);
      }
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
