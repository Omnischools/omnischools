import "server-only";
import { and, eq } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import { senRegister, senModuleAdoption, students } from "@/db/schema";

/**
 * GOV-10 · the DE-IDENTIFIED SEN census reader (Kofi R412). Server-only, `withSchool`-scoped, aggregate-only.
 * Its return type is COUNTS ONLY — it structurally CANNOT carry a name / student-id / severity / diagnosis
 * (mirrors `getCensusEnrolment`'s SexSplit-only shape). It reads ONLY (category, sex) to bucket the 6×2 grid,
 * counting GRANTED + PENDING alike — consent gates the DETAIL, not the COUNT (R410) — over ACTIVE students.
 *
 * THE HONESTY CRUX (R413): `adopted` comes from the EXPLICIT `sen_module_adoption` marker, NEVER bare
 * `sen_register` row-existence — a non-adopting school and an adopted-but-genuinely-zero school BOTH have
 * zero rows, so only the marker distinguishes "§5 = hand-fill (NONE)" from "captured zero (FULL-zero)".
 *
 * SOLE-CONTENT-PATH (R409): this reader may read `category` (the census DIMENSION) but NEVER a confidential
 * DETAIL column (severity / diagnosis* / support_notes / accommodations) nor a student-identifying
 * projection — that would turn the SEN sole-content-path sweep RED. Only `lib/sen/register-data.ts` projects
 * the confidential record (behind the SEN_REGISTER_ROLES gate).
 */

export type SenCategory = "VISUAL" | "HEARING" | "PHYSICAL" | "INTELLECTUAL" | "SPEECH" | "OTHER";
export const SEN_CATEGORIES = [
  "VISUAL",
  "HEARING",
  "PHYSICAL",
  "INTELLECTUAL",
  "SPEECH",
  "OTHER",
] as const satisfies readonly SenCategory[];

export type SenSexCount = { male: number; female: number };
/** The de-identified §5 payload — 6 category keys × {male,female} = the 12 census cells, plus the totals.
 *  NO field can hold PII (the de-identification is at the type level, exactly like `SexSplit`). */
export type CensusSpecialNeeds = {
  adopted: boolean;
  byCategory: Record<SenCategory, SenSexCount>;
  total: number;
};

export const emptySenByCategory = (): Record<SenCategory, SenSexCount> =>
  Object.fromEntries(SEN_CATEGORIES.map((c) => [c, { male: 0, female: 0 }])) as Record<
    SenCategory,
    SenSexCount
  >;

/**
 * The pure category×sex aggregation — no DB, so unit-tested directly (GOV10-01/07/11/12). Counts GRANTED +
 * PENDING alike (every row carries a NOT-NULL category, even a pending minimal row). A student whose sex is
 * neither MALE nor FEMALE is skipped (a guard for a widened sex domain — never a fabricated cell), so
 * `total` == Σ the 12 cells == distinct SEN students (one row per student, R415).
 */
export function aggregateCensusSpecialNeeds(rows: { category: SenCategory; sex: string }[]): {
  byCategory: Record<SenCategory, SenSexCount>;
  total: number;
} {
  const byCategory = emptySenByCategory();
  let total = 0;
  for (const r of rows) {
    const cell = byCategory[r.category];
    if (!cell) continue; // defensive against an unknown category value
    if (r.sex === "MALE") cell.male++;
    else if (r.sex === "FEMALE") cell.female++;
    else continue;
    total++;
  }
  return { byCategory, total };
}

export async function getCensusSpecialNeeds(schoolId: string): Promise<CensusSpecialNeeds> {
  return withSchool(schoolId, async (tx) => {
    const marker = await tx
      .select({ schoolId: senModuleAdoption.schoolId })
      .from(senModuleAdoption)
      .where(eq(senModuleAdoption.schoolId, schoolId))
      .limit(1);
    if (marker.length === 0) {
      // Not adopted → the caller renders §5 as a hand-fill NONE, never a fabricated zeros payload (R413).
      return { adopted: false, byCategory: emptySenByCategory(), total: 0 };
    }
    const rows = await tx
      .select({ category: senRegister.category, sex: students.sex })
      .from(senRegister)
      .innerJoin(
        students,
        and(eq(students.schoolId, senRegister.schoolId), eq(students.id, senRegister.studentId)),
      )
      .where(and(eq(senRegister.schoolId, schoolId), eq(students.status, "ACTIVE")));
    const { byCategory, total } = aggregateCensusSpecialNeeds(rows);
    return { adopted: true, byCategory, total };
  });
}
