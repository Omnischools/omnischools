import type postgres from "postgres";

/**
 * EMIS SCHOOL-REGISTER LOADER (scope §2 loader #1, task H4).
 *
 * `ref_emis_school_register` is the **Y** in every "X of Y schools" figure. It is deliberately
 * independent of who has synced: a school that is recognised by GES but not live on Omnischools is
 * STILL A REGISTER ROW, and that asymmetry *is* the coverage figure (scope §3). So this loader writes
 * every row in the extract, `on_schoolup` true or false, and never filters.
 *
 * FILE-BASED, like `scripts/load-establishment.ts`, because the real artefact is a file GES hands over
 * — not a table anyone can query. Format (`{ as_of_date, rows }`), per row:
 *   emis_school_id · name · region · district · school_type · ownership_type · on_schoolup ·
 *   operational_school_id (nullable) · as_of_date (optional per-row override of the file vintage)
 *
 * `district_id` / `region_id` are NOT in the file — they are analytics jurisdiction uuids, resolved
 * from the region/district NAMES by `lib/etl/dimensions.ts`. That is why the dimension refresh runs
 * BEFORE this loader in the run sequence even though the register is the refresh's own input: the
 * extract is parsed once, the spine is built from the parsed names, and the register rows are then
 * written with resolved ids. Parse → dims → register, one read of the file.
 */

export type RegisterSchoolType = "KG" | "PRIMARY" | "JHS" | "SHS" | "COMBINED";
export type RegisterOwnership = "PUBLIC" | "PRIVATE" | "MISSION";

const SCHOOL_TYPES: readonly string[] = ["KG", "PRIMARY", "JHS", "SHS", "COMBINED"];
const OWNERSHIPS: readonly string[] = ["PUBLIC", "PRIVATE", "MISSION"];

/** One validated register row. */
export interface RegisterRow {
  emisSchoolId: string;
  name: string;
  regionName: string;
  districtName: string;
  schoolType: RegisterSchoolType;
  ownershipType: RegisterOwnership;
  onSchoolup: boolean;
  operationalSchoolId: string | null;
  asOfDate: string;
}

export class EmisExtractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmisExtractError";
  }
}

function nonEmpty(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/**
 * Parse + validate the extract. PURE — no DB. Rejects LOUDLY and names the offending row, the same
 * posture as `parseEstablishmentFile`: a register is the denominator of every coverage figure in the
 * product, so a silently-dropped row understates nothing visibly and overstates coverage invisibly.
 *
 * `school_type` and `ownership_type` are checked against the analytics enums HERE rather than being
 * left to the INSERT, so the error names the row and the field instead of surfacing as
 * `invalid input value for enum ov_school_type`.
 */
export function parseEmisExtract(text: string): RegisterRow[] {
  let parsed: { as_of_date?: unknown; rows?: unknown };
  try {
    parsed = JSON.parse(text) as { as_of_date?: unknown; rows?: unknown };
  } catch (err) {
    throw new EmisExtractError(
      `Extract is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.rows)) {
    throw new EmisExtractError('Extract must be a JSON object with a "rows" array.');
  }
  const fileAsOf = nonEmpty(parsed.as_of_date);
  const rows = parsed.rows as Record<string, unknown>[];
  if (rows.length === 0) throw new EmisExtractError("Extract carries no rows.");

  const seen = new Set<string>();
  return rows.map((row, i) => {
    const emis = nonEmpty(row.emis_school_id);
    if (!emis) throw new EmisExtractError(`Row ${i}: missing/empty "emis_school_id".`);
    if (seen.has(emis))
      throw new EmisExtractError(
        `Row ${i}: duplicate "emis_school_id" ${emis} — the register is the coverage denominator and ` +
          "a duplicate would double-count it.",
      );
    seen.add(emis);

    const name = nonEmpty(row.name);
    if (!name) throw new EmisExtractError(`Row ${i} (${emis}): missing/empty "name".`);
    const regionName = nonEmpty(row.region);
    if (!regionName)
      throw new EmisExtractError(`Row ${i} (${emis}): missing/empty "region".`);
    const districtName = nonEmpty(row.district);
    if (!districtName)
      throw new EmisExtractError(`Row ${i} (${emis}): missing/empty "district".`);

    const schoolType = nonEmpty(row.school_type);
    if (!schoolType || !SCHOOL_TYPES.includes(schoolType))
      throw new EmisExtractError(
        `Row ${i} (${emis}): "school_type" must be one of ${SCHOOL_TYPES.join("|")}, got ${String(row.school_type)}.`,
      );
    const ownershipType = nonEmpty(row.ownership_type);
    if (!ownershipType || !OWNERSHIPS.includes(ownershipType))
      throw new EmisExtractError(
        `Row ${i} (${emis}): "ownership_type" must be one of ${OWNERSHIPS.join("|")}, got ${String(row.ownership_type)}.`,
      );

    if (typeof row.on_schoolup !== "boolean")
      throw new EmisExtractError(
        `Row ${i} (${emis}): "on_schoolup" must be a boolean — coverage cannot be inferred from an absent flag.`,
      );

    const asOf = nonEmpty(row.as_of_date) ?? fileAsOf;
    if (!asOf)
      throw new EmisExtractError(
        `Row ${i} (${emis}): no as_of_date — set a file-level "as_of_date" or a per-row one.`,
      );

    return {
      emisSchoolId: emis,
      name,
      regionName,
      districtName,
      schoolType: schoolType as RegisterSchoolType,
      ownershipType: ownershipType as RegisterOwnership,
      onSchoolup: row.on_schoolup,
      operationalSchoolId: nonEmpty(row.operational_school_id),
      asOfDate: asOf,
    };
  });
}

/**
 * Upsert by `emis_school_id` (the PK), stamped `source = 'EMIS_EXTRACT'` with the row's OWN
 * `as_of_date` — a per-school vintage, because a register is assembled district by district and a
 * single file-level date would overstate the freshness of the oldest rows in it.
 *
 * `jurisdictionFor` resolves the district/region uuids built by the dimension refresh. A school whose
 * district did not resolve is a BUG in the refresh, not a tolerable gap, so it throws.
 */
export async function loadEmisRegister(
  sql: postgres.Sql,
  rows: RegisterRow[],
  jurisdictionFor: (row: RegisterRow) => { districtId: string; regionId: string },
): Promise<{ rows: number }> {
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK).map((r) => {
      const { districtId, regionId } = jurisdictionFor(r);
      return {
        emis_school_id: r.emisSchoolId,
        name: r.name,
        district_id: districtId,
        region_id: regionId,
        school_type: r.schoolType,
        ownership_type: r.ownershipType,
        on_schoolup: r.onSchoolup,
        operational_school_id: r.operationalSchoolId,
        source: "EMIS_EXTRACT" as const,
        as_of_date: r.asOfDate,
      };
    });
    await sql`
      insert into ref_emis_school_register ${sql(chunk)}
      on conflict (emis_school_id) do update set
        name                  = excluded.name,
        district_id           = excluded.district_id,
        region_id             = excluded.region_id,
        school_type           = excluded.school_type,
        ownership_type        = excluded.ownership_type,
        on_schoolup           = excluded.on_schoolup,
        operational_school_id = excluded.operational_school_id,
        source                = excluded.source,
        as_of_date            = excluded.as_of_date`;
  }
  return { rows: rows.length };
}
