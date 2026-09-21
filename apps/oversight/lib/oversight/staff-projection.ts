import type { ReadbackTx } from "@/lib/db/readback";
import { isNeverReleased, NEVER_RELEASE_FIELDS } from "@/lib/oversight/field-scope";

/**
 * THE SCOPED PROJECTION — turning a field-scope list into a SELECT column list (§6 step 3).
 *
 * This module is the only place in the app that names an operational staff column, and it names
 * each one exactly once, in a frozen map keyed by the canonical field ids from field-scope.ts.
 *
 * WHY A PROJECTION AND NOT A REDACTION. `select *` followed by deleting keys would mean every
 * never-released value is read out of the operational database, crosses the network, sits in this
 * process's heap, and is one careless `console.log`, error serialiser, or React server-component
 * payload away from leaving. Selecting only the allowed columns means the values never exist here
 * at all. The difference is not stylistic: a redaction bug is a disclosure, a projection bug is a
 * missing column.
 *
 * THREE LAYERS, DELIBERATELY REDUNDANT:
 *   1. the database role has no SELECT on `staff_compensation` at all (PROVISIONING §4a);
 *   2. this map contains no entry for any never-released field, and `assertProjectionIntegrity()`
 *      proves it at module load;
 *   3. `buildStaffProjection()` re-checks every requested field against `isNeverReleased` before it
 *      will emit a column.
 * Any one of the three is sufficient. All three are cheap, and they fail in different ways, which
 * is the property you want from a control on the one query that reads a named person's record.
 *
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠ PROVISIONING NOTE — this query reads `ref_user` and `ref_school`, which are NOT in the current
 * PROVISIONING §4a grant list. They are unavoidable: the identity spine requires `full_name`
 * (operational `staff_profile` carries no name — it hangs off the global `ref_user` login
 * identity), and the school's name and GES code live on `ref_school`. Both must be added to the
 * read-back role's per-table SELECT allow-list, and a note has been added to §4a saying so. They
 * are narrow additions (identity + tenant header), not a widening toward compensation.
 * ───────────────────────────────────────────────────────────────────────────────────────────────
 */

/** A value the reason code DOES unlock but Omnischools has no operational source for. */
export const UNAVAILABLE_NO_SOURCE = "UNAVAILABLE_NO_SOURCE" as const;

/**
 * Canonical field id → SQL expression, evaluated against the FROM clause in `STAFF_RECORD_FROM`.
 *
 * Fields NOT in this map are not operational: they are filled in by the orchestrator from the
 * analytics-side classification (`is_on_ges_establishment`, `establishment_*`) or are explicitly
 * sourceless (`staff_attendance_facts` — see the sourcing gate on `fact_teacher_attendance` in
 * db/schema/fact.ts: Omnischools records PLC/PD attendance, not a daily staff register).
 */
const OPERATIONAL_COLUMN_EXPR: Readonly<Record<string, string>> = Object.freeze({
  full_name: "u.full_name",
  staff_id: "sp.id::text",
  post_role_label: "ra.role_label",
  assigned_school: "s.name",
  gender: "sp.gender",
  appointment_start_date: "ra.start_date::text",
  appointment_end_date: "ra.end_date::text",
  assignment_scope: "ra.scope_ref::text",
  ntc_licence_number: "sp.ntc_licence_number",
  ntc_licence_expiry: "sp.ntc_licence_expiry::text",
  nmc_licence_number: "sp.nmc_licence_number",
  nmc_licence_expiry: "sp.nmc_licence_expiry::text",
  qualification_level: "sp.qualification_level",
  highest_qualification: "sp.highest_qualification",
  undergraduate: "sp.undergraduate",
  specialisations: "sp.specialisations",
  date_of_birth: "sp.date_of_birth::text",
  address: "sp.address",
  emergency_contact: "sp.emergency_contact",
  phone: "u.phone",
});

/** Fields the scope can grant that are filled server-side rather than selected. */
export const SERVER_DERIVED_FIELDS = Object.freeze([
  "is_on_ges_establishment",
  "establishment_post_count",
  "establishment_as_of_date",
]);

/** Fields in scope with no operational source at all (honest third state — never "withheld"). */
export const SOURCELESS_FIELDS = Object.freeze(["staff_attendance_facts"]);

/**
 * `ra` is a LATERAL pick of the CURRENT posting — the most recently started assignment that has not
 * ended. A staff member can hold several role assignments over time (and several at once); the
 * record screen shows "current post", so the projection must choose one deterministically rather
 * than multiply the row and silently show whichever the planner returned first.
 */
const STAFF_RECORD_FROM = `
  from staff_profile sp
  join ref_user u   on u.id = sp.user_id
  join ref_school s on s.id = sp.school_id
  left join lateral (
    select rr.label as role_label, ra0.start_date, ra0.end_date, ra0.scope_ref
    from role_assignment ra0
    join ref_role rr on rr.id = ra0.role_id
    where ra0.user_id = sp.user_id
      and ra0.school_id = sp.school_id
      and (ra0.end_date is null or ra0.end_date >= current_date)
    order by ra0.start_date desc
    limit 1
  ) ra on true
  where sp.school_id = $1::uuid
    and sp.id = $2::uuid
  limit 1
`;

export class ProjectionError extends Error {
  readonly code: "NEVER_RELEASED" | "UNKNOWN_FIELD" | "INTEGRITY";
  constructor(code: ProjectionError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "ProjectionError";
  }
}

export interface StaffProjection {
  /** The full SQL text. Column list is built from frozen constants — never from request input. */
  text: string;
  /** The operational field ids this query actually selects, in order. */
  selectedFields: readonly string[];
}

/**
 * Build the SELECT for exactly the allowed fields.
 *
 * Column identifiers come from `OPERATIONAL_COLUMN_EXPR`, keyed by ids that originate in
 * field-scope.ts constants, so nothing a request can influence ever reaches the SQL text; the two
 * request-supplied values (school uuid, staff uuid) are bound parameters.
 */
export function buildStaffProjection(allowedFields: readonly string[]): StaffProjection {
  const selected: string[] = [];
  const columns: string[] = [];

  for (const field of allowedFields) {
    if (isNeverReleased(field)) {
      throw new ProjectionError(
        "NEVER_RELEASED",
        `Refusing to project never-released field "${field}".`,
      );
    }
    if (SERVER_DERIVED_FIELDS.includes(field) || SOURCELESS_FIELDS.includes(field))
      continue;
    const expr = OPERATIONAL_COLUMN_EXPR[field];
    if (!expr) {
      throw new ProjectionError(
        "UNKNOWN_FIELD",
        `No operational source mapped for field "${field}". A field in scope with no mapping must be declared server-derived or sourceless, never silently dropped.`,
      );
    }
    selected.push(field);
    // The alias is the canonical field id, so the row keys ARE the fields_released list.
    columns.push(`${expr} as "${field}"`);
  }

  if (columns.length === 0) {
    throw new ProjectionError(
      "UNKNOWN_FIELD",
      "A scoped projection with no operational columns would be a query that proves nothing; the identity spine guarantees at least one.",
    );
  }

  return {
    text: `select ${columns.join(", ")}${STAFF_RECORD_FROM}`,
    selectedFields: selected,
  };
}

/** Run the projection inside the read-back transaction. Returns null when the subject is absent. */
export async function fetchScopedStaffRecord(
  tx: ReadbackTx,
  operationalSchoolId: string,
  operationalStaffId: string,
  allowedFields: readonly string[],
): Promise<Record<string, unknown> | null> {
  const projection = buildStaffProjection(allowedFields);
  const rows = (await tx.unsafe(projection.text, [
    operationalSchoolId,
    operationalStaffId,
  ])) as unknown as Record<string, unknown>[];
  return rows[0] ?? null;
}

/**
 * Staff-LIST browse projection (Lucy C4). Deliberately minimal — name, operational id and current
 * post label, and nothing else. A browse is a navigation step, not a record: it must not become a
 * way to read a field the reason code did not unlock by reading it off a list instead.
 *
 * ⚠ REGISTER STATUS IS NOT COMPUTABLE HERE. Lucy C4 wants a "GES establishment / Not on register"
 * column as the branch signal, but operational `staff_profile` carries NO GES establishment id (no
 * column in apps/web/db/schema/*.ts holds one), so there is no key to join the analytics register
 * on. The list therefore reports `NOT_LINKED` for every row, and picking any row routes to the
 * CONSENT branch — which is the fail-closed direction. Restoring Lucy's signal needs a
 * `ges_staff_id` column on `staff_profile` (an apps/web change; escalated, not assumed).
 */
const STAFF_LIST_SQL = `
  select
    sp.id::text     as "operational_staff_id",
    u.full_name     as "full_name",
    ra.role_label   as "post_role_label"
  from staff_profile sp
  join ref_user u on u.id = sp.user_id
  left join lateral (
    select rr.label as role_label
    from role_assignment ra0
    join ref_role rr on rr.id = ra0.role_id
    where ra0.user_id = sp.user_id
      and ra0.school_id = sp.school_id
      and (ra0.end_date is null or ra0.end_date >= current_date)
    order by ra0.start_date desc
    limit 1
  ) ra on true
  where sp.school_id = $1::uuid
  order by u.full_name asc
  limit $2::int
`;

export interface StaffListRow {
  operational_staff_id: string;
  full_name: string | null;
  post_role_label: string | null;
  /** Always NOT_LINKED today — see the note above. */
  register_status: "NOT_LINKED";
}

/** Hard ceiling. A browse must never be able to become a full-school staff export. */
export const STAFF_LIST_MAX_ROWS = 200;

export async function fetchStaffList(
  tx: ReadbackTx,
  operationalSchoolId: string,
  limit = 50,
): Promise<StaffListRow[]> {
  const capped = Math.max(1, Math.min(limit, STAFF_LIST_MAX_ROWS));
  const rows = (await tx.unsafe(STAFF_LIST_SQL, [
    operationalSchoolId,
    capped,
  ])) as unknown as Omit<StaffListRow, "register_status">[];
  return rows.map((r) => ({ ...r, register_status: "NOT_LINKED" as const }));
}

/**
 * Resolve the operational tenant uuid the caller claims, and prove it is the school the officer
 * actually picked, by reading back its GES/EMIS code.
 *
 * The analytics DB holds no operational school uuid (no column on `ref_emis_school_register` or
 * `dim_jurisdiction`), so the uuid necessarily arrives with the request — and a request-supplied
 * tenant key is exactly the kind of value that must be checked rather than trusted. The check is
 * possible because operational `ref_school.ges_code` is UNIQUE and equals the EMIS id, and the EMIS
 * id itself was validated against the officer's jurisdiction on the analytics side. Passing both
 * checks means the two agree on one school inside the officer's ceiling; failing either is a denial.
 *
 * (`ref_school` RLS keys on `id = app.current_school`, so this read only succeeds once the GUC is
 * set — i.e. it can confirm the claimed uuid but can never enumerate other schools.)
 */
export async function confirmSchoolIdentity(
  tx: ReadbackTx,
  operationalSchoolId: string,
  expectedEmisSchoolId: string,
): Promise<{ ok: boolean; gesCode: string | null; name: string | null }> {
  const rows = (await tx.unsafe(
    `select ges_code, name from ref_school where id = $1::uuid limit 1`,
    [operationalSchoolId],
  )) as unknown as { ges_code: string; name: string }[];
  const row = rows[0];
  if (!row) return { ok: false, gesCode: null, name: null };
  return {
    ok: row.ges_code === expectedEmisSchoolId,
    gesCode: row.ges_code,
    name: row.name,
  };
}

/** Module-load integrity check: the column map must never name a never-released field. */
export function assertProjectionIntegrity(): void {
  for (const field of Object.keys(OPERATIONAL_COLUMN_EXPR)) {
    if (isNeverReleased(field)) {
      throw new ProjectionError(
        "INTEGRITY",
        `Projection maps never-released field "${field}".`,
      );
    }
  }
  const sqlBlobs = [
    STAFF_RECORD_FROM,
    STAFF_LIST_SQL,
    ...Object.values(OPERATIONAL_COLUMN_EXPR),
  ];
  for (const blob of sqlBlobs) {
    if (/staff_compensation/i.test(blob)) {
      throw new ProjectionError(
        "INTEGRITY",
        "Read-back SQL references staff_compensation.",
      );
    }
    for (const field of NEVER_RELEASE_FIELDS) {
      // `effective_from` and friends are generic words; match them as whole identifiers only.
      if (new RegExp(`\\b${field}\\b`, "i").test(blob)) {
        throw new ProjectionError(
          "INTEGRITY",
          `Read-back SQL references never-released column "${field}".`,
        );
      }
    }
  }
}

assertProjectionIntegrity();
