import { sql } from "drizzle-orm";
import { rowsOf, withJurisdiction, type JurisdictionScope } from "@/lib/db/rls";
import { childLevelFor, type ChildLevel } from "./breakdown";
import type { Exam } from "./performance";
import { ok, unavailable, type Reading } from "./reading";

/**
 * THE COMPARISON PICKER'S ENTITY LIST (increment I — comparison workspace).
 *
 * The one thing `getChildBreakdown` cannot serve the picker: the set of entities the officer MAY add,
 * including those that filed no facts, plus each school's LEVEL — which is the like-for-like key the
 * picker enforces (COMPARISON-WORKSPACE-DATA-PLAN §3). The breakdown is fact-driven, so a school that
 * filed nothing is simply absent from it; and a `BreakdownRow` carries no `school_type`. This read fills
 * both gaps with ONE plain dimension SELECT.
 *
 * ═══ RLS IS THE BOUNDARY, NOT A `parent_id` FILTER ═══════════════════════════════════════════════════
 * `where level = ${childLevel}` and NOTHING ELSE on the ceiling. `ov_in_subtree()` (db/sql/policies.sql)
 * already admits exactly the officer's own node and its descendants, so at `level = 'SCHOOL'` this
 * returns precisely the officer's own schools — a district officer's, never a sibling district's. Adding
 * `parent_id = scope.jurisdictionId` would be a SECOND, hand-written copy of the ceiling in app SQL (the
 * very thing lib/oversight/breakdown.ts and lib/db/rls.ts forbid), and `parent_id` is not even selected
 * into the payload — it is readable on a visible row but may NAME an invisible node. The child level is a
 * DISPLAY DEPTH derived from the officer's own tier, never a reach beyond it.
 *
 * ═══ NO REGISTER BRIDGE ══════════════════════════════════════════════════════════════════════════════
 * The school list comes from `dim_jurisdiction` (the spine), never from `ref_emis_school_register`:
 * bridging the register to the spine needs `ges_code = emis_school_id`, and `dim_jurisdiction(level,
 * ges_code)` has no UNIQUE index, so a duplicate code would fan the list out (Wells / SLICE-3 §3).
 *
 * ═══ SELECT-ONLY, NO NEW OBJECT ══════════════════════════════════════════════════════════════════════
 * A plain scoped SELECT on an existing table with its existing policy. Nothing created, nothing granted,
 * so prod-paste-0006 is NOT triggered.
 */

/** The officer's own node TYPE for the comparison. SHS↔SHS etc. at SCHOOL depth; all one type above. */
export type SchoolType = "KG" | "PRIMARY" | "JHS" | "SHS" | "COMBINED";
export type OwnershipType = "PUBLIC" | "PRIVATE" | "MISSION";

/**
 * ONE SELECTABLE ENTITY. For a SCHOOL-depth comparison `schoolType` is the like-for-like key and the
 * ownership/founded fields are the mock's "public · est. 1960" chrome. For a DISTRICT/REGION-depth
 * comparison those three are null (the column is populated on SCHOOL rows only) and are simply unused —
 * all districts are already like-for-like with one another.
 */
export interface ComparisonEntity {
  jurisdictionId: string;
  name: string;
  /** Null above SCHOOL depth, and on a school whose register row never carried a type. */
  schoolType: SchoolType | null;
  ownershipType: OwnershipType | null;
  foundedYear: number | null;
}

export interface ComparisonEntities {
  /** The depth these entities sit at — SCHOOL for a district officer, DISTRICT for a regional, etc. */
  childLevel: ChildLevel;
  entities: ComparisonEntity[];
}

/**
 * LIKE-FOR-LEVEL, ENFORCED ON EVERY PATH — the first valid pick pins the school level, and anything off
 * that level is dropped (Kofi R2.3: an out-of-scope comparison is impossible to BUILD, not refused at
 * the end). This runs on the URL-resolved selection, not just the picker's add links, so a hand-edited
 * `?e=<SHS>,<JHS>` cannot assemble a mixed-level set that would then be read against the wrong exam and
 * benchmark. Above SCHOOL depth every child is one type already, so nothing is pinned or dropped.
 */
export function pinSelectionToLevel(
  requested: readonly ComparisonEntity[],
  childLevel: ChildLevel,
): { pinnedType: SchoolType | null; selected: ComparisonEntity[] } {
  const pinnedType = requested.find((e) => e.schoolType !== null)?.schoolType ?? null;
  const selected =
    childLevel === "SCHOOL" && pinnedType !== null
      ? requested.filter((e) => e.schoolType === pinnedType)
      : [...requested];
  return { pinnedType, selected };
}

/**
 * The terminal exam a school LEVEL sits — the real like-for-like guard, pinned at assembly rather than
 * suppressed at render (Wells §3). SHS→WASSCE, JHS→BECE. KG/PRIMARY sit none; COMBINED straddles both,
 * so slice 1 shows it no exam row rather than asserting one of two (its own-group handling is an owner
 * call, not invented here). Null ⇒ the comparison omits the performance section entirely.
 */
export function examForSchoolType(type: SchoolType | null): Exam | null {
  switch (type) {
    case "SHS":
      return "WASSCE";
    case "JHS":
      return "BECE";
    default:
      return null;
  }
}

/**
 * The entities one level below the officer, name-sorted. Fail-soft (`Reading`): a picker that cannot
 * load degrades to its empty state, it never throws the page.
 */
export async function getComparisonEntities(
  scope: JurisdictionScope,
): Promise<Reading<ComparisonEntities>> {
  const childLevel = childLevelFor(scope.level);
  try {
    return await withJurisdiction(scope, async (tx) => {
      const result = await tx.execute(sql`
        select dj.jurisdiction_id::text   as jurisdiction_id,
               dj.name                     as name,
               dj.school_type::text        as school_type,
               dj.ownership_type::text     as ownership_type,
               dj.founded_year             as founded_year
          from dim_jurisdiction dj
         where dj.level = ${childLevel}::jurisdiction_level
         order by dj.name asc
      `);
      const entities: ComparisonEntity[] = rowsOf(result).map((row) => ({
        jurisdictionId: row.jurisdiction_id as string,
        name: row.name as string,
        schoolType: (row.school_type as SchoolType | null) ?? null,
        ownershipType: (row.ownership_type as OwnershipType | null) ?? null,
        foundedYear: row.founded_year === null ? null : Number(row.founded_year),
      }));
      return ok<ComparisonEntities>({ childLevel, entities });
    });
  } catch {
    return unavailable<ComparisonEntities>();
  }
}
