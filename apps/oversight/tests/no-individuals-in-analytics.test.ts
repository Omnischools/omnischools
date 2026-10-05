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
 * The one permitted exception is `ref_ges_teacher_establishment.establishment_teachers`: a
 * GES-supplied JSON array of `{ ntc_licence_number, name? }`, which is reference data about POSTS,
 * not a person record. It has no name/contact COLUMN and no per-person row — the optional `name`
 * inside the jsonb is a GES-supplied display aid on establishment reference data, not an
 * Omnischools person record — and the NTC licence is the lookup key the statutory branch is checked
 * against; without it there is no way to tell a GES teacher from anyone else.
 *
 * ⚠ THE SECOND EXCEPTION, ADDED BY INCREMENT G (officer auth) — `ref_oversight_officer.full_name`
 * and `.work_email`. Recorded as an explicit allow-list below rather than dodged by choosing
 * column names the query does not happen to match, because an exception you can read is a decision
 * and an exception you cannot is an erosion.
 *
 * Why it is a different kind of row. §9's promise is about the SUBJECTS of oversight — the children
 * and school staff whose data flows in through the ETL, who did not choose to be in this database
 * and for whom aggregate-only is the protection. A GES oversight officer is not a subject; they are
 * an OPERATOR of the system, and the directory is its auth table. Every system that authenticates
 * anyone has one, and the alternative to holding the officer's name is not holding less data — it is
 * being unable to say who performed a named-record access, which is strictly worse for exactly the
 * people §9 protects.
 *
 * What keeps the exception narrow (and why it is not a hole in the same wall):
 *   · Neither column is reachable by the Oversight app credential AT ALL. The table is RLS-enabled
 *     with NO select policy, and the one read path — `ov_resolve_officer()` — returns only
 *     (officer_id, jurisdiction_id, derived level, officer_role). No name, no email, by construction.
 *     The columns are owner/provisioner-only.
 *   · The grain is the OFFICER, a few dozen rows of staff directory, not a population.
 *   · It is a closed set, not a feed: rows arrive by hand-provisioning with a two-person rule, never
 *     from the nightly ETL.
 * A third entry in this list should be argued for on the same terms or refused.
 */
/**
 * The complete set of person-identifying columns permitted in the analytics DB, as
 * `table_name.column_name`. Adding to this list is a privacy decision — justify it in the module
 * comment above, not here.
 */
const PERMITTED_PERSON_COLUMNS = [
  // Increment G, officer auth: operator identity, owner/provisioner-readable only. See above.
  "ref_oversight_officer.full_name",
  "ref_oversight_officer.work_email",
] as const;

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
            -- Widened with increment G: the officer directory introduced the first contact column in
            -- this database (work_email), which the exact-match list above would have missed. Any
            -- future '%email%' column now has to be argued for in PERMITTED_PERSON_COLUMNS.
            or column_name like '%email%'
          )
        order by table_name, column_name
      `) as unknown as { table_name: string; column_name: string }[];
      const offending = rows
        .map((r) => `${r.table_name}.${r.column_name}`)
        .filter((qualified) => !PERMITTED_PERSON_COLUMNS.includes(qualified as never));
      expect(offending).toEqual([]);
      // The exceptions must still EXIST — a typo in the allow-list must not silently disarm the
      // check, and a column dropped from the directory should fail here so the list is cleaned up.
      expect(rows.map((r) => `${r.table_name}.${r.column_name}`).sort()).toEqual(
        [...PERMITTED_PERSON_COLUMNS].sort(),
      );
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("exposes NEITHER officer-directory PII column through the app credential's only read path", async () => {
    // The structural half of the exception above: ov_resolve_officer() is the sole read path into the
    // directory for the app role (the table is RLS-enabled with no select policy), and its result
    // type must carry no name and no email. Asserted against the LIVE function signature, so a
    // future edit that helpfully adds full_name to the session fails here.
    const sql = adminAnalytics();
    try {
      const rows = (await sql`
        select pg_get_function_result(p.oid) as result_type
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'ov_resolve_officer'
      `) as unknown as { result_type: string }[];
      expect(rows).toHaveLength(1);
      expect(rows[0].result_type).not.toMatch(/full_name|email/i);
      // …and it does return what a session needs, so the assertion above cannot pass vacuously.
      for (const column of ["officer_id", "jurisdiction_id", "level", "officer_role"]) {
        expect(rows[0].result_type).toContain(column);
      }
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("keeps the establishment teacher list as reference data about posts, not people", async () => {
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
      expect(names).toContain("establishment_teachers");
      expect(
        rows.find((r) => r.column_name === "establishment_teachers")!.data_type,
      ).toBe("jsonb");
      // The old opaque `staff_ids` column is gone. And no name/contact/per-person COLUMN exists:
      // the table's grain is the SCHOOL (the optional name lives inside the jsonb, as reference data).
      expect(names).not.toContain("staff_ids");
      for (const forbidden of ["full_name", "phone", "email", "date_of_birth"]) {
        expect(names).not.toContain(forbidden);
      }
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("keeps fact_staffing a count of POSTS — no person column, and in particular NO sex", async () => {
    // The staffing arm (`lib/etl/staffing.ts`) publishes `teachers_on_roll` as ONE integer: a count of
    // teachers, never a teacher. Two properties are pinned here against the LIVE schema rather than
    // against the schema file, so a hand-applied prod migration that "helpfully" added either would be
    // caught too:
    //   · NO person-identifying column, so the gated §6 named-staff path stays the only way to reach a
    //     person and this table can never become a shortcut around it;
    //   · NO `sex` column. That absence is why the sexed-staff small-cell helper in
    //     `lib/oversight/suppression.ts` does not apply to `fact_staffing` (Kofi's staffing ruling §7) —
    //     there is no sex split here to disclose an individual through. A sexed teacher breakdown on a
    //     two-teacher school is a disclosure vector, so growing the column would silently invalidate
    //     that reasoning. This test is what makes a "small addition" trip a wire.
    const sql = adminAnalytics();
    try {
      const names = (
        (await sql`
          select column_name
          from information_schema.columns
          where table_schema = 'public' and table_name = 'fact_staffing'
          order by column_name
        `) as unknown as { column_name: string }[]
      ).map((r) => r.column_name);
      expect(names.length).toBeGreaterThan(0);
      expect(names).not.toContain("sex");
      for (const forbidden of [
        "full_name",
        "staff_profile_id",
        "ntc_licence_number",
        "teacher_id",
        "person_id",
        "date_of_birth",
        "phone",
        "email",
      ]) {
        expect(names).not.toContain(forbidden);
      }
      // …and it still carries the measures, so the assertion above cannot pass vacuously.
      for (const measure of ["teachers_on_roll", "enrolment_total", "ptr", "vacancies"]) {
        expect(names).toContain(measure);
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
