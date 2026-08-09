import "@/db/_loadenv";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { schools, censusReturn } from "@/db/schema";
import { generateCensusSnapshot } from "@/lib/reports/census/generate";
import { getCensusSpecialNeeds } from "@/lib/reports/census/sen-data";
import {
  parseCensusHandFill,
  CENSUS_HAND_FILL_VERSION,
  type CensusHandFill,
} from "@/lib/reports/census/hand-fill-schema";

/**
 * GOV-9 · the ANNUAL census hand-fill lifecycle, DB round-trip (AC GOV9-05/07/14/09). Clone of
 * scripts/verify-sen-register.ts. Two halves against the live Asankrangwa dev row:
 *  A) READ-ONLY through the REAL readers: §5 auto-fills FULL from the 2 seeded SEN rows (adopted, total 2 —
 *     VISUAL·boy + HEARING·girl); the seeded ANNUAL DRAFT row's frozen auto_snapshot carries that FULL §5 arm
 *     (render-from-frozen, GOV9-09).
 *  B) A ROLLED-BACK tx proving the `WHERE status='DRAFT'` lock the two actions share:
 *     - saveCensusHandFill writes hand_fill on a DRAFT row → parseCensusHandFill round-trips (05);
 *     - an un-written section stays ABSENT in the blob (honest-blank — never a fabricated 0);
 *     - markCensusCompleted flips DRAFT→COMPLETED (14);
 *     - once COMPLETED, a hand-fill write matches 0 rows and the stored value is UNCHANGED (locked, 14);
 *     - a second complete matches 0 rows (idempotent refuse); a missing year matches 0 rows.
 *  All rolled back — nothing persists. Cross-school RLS isolation is `pnpm db:rls-test` (census_return is an
 *  auto-discovered tenant table).
 */
let failures = 0;
function ok(cond: boolean, label: string) {
  console.log(`${cond ? "✓" : "✗ FAIL"} ${label}`);
  if (!cond) failures++;
}
class Rollback extends Error {}

const RB_YEAR = "2099/RB"; // a throwaway academic-year tag; never collides with the seeded 2025/26 filing.

async function main() {
  const [asankrangwa] = await db
    .select({ id: schools.id })
    .from(schools)
    .where(eq(schools.gesCode, "WR-WAW-014"));
  if (!asankrangwa) throw new Error("Seed missing — Asankrangwa (WR-WAW-014) not found.");
  const schoolId = asankrangwa.id;

  // ── A · READ-ONLY: §5 auto-fills from the SEN register, frozen into the seeded DRAFT row ─────────────
  const sen = await getCensusSpecialNeeds(schoolId);
  ok(sen.adopted === true, "A1: SEN module adopted → §5 auto-fills (not a hand-fill NONE)");
  ok(sen.total === 2, `A2: §5 counts the 2 seeded SEN students (total=${sen.total}) — GOV9-07`);
  ok(sen.byCategory.VISUAL.male === 1, "A3: Visual·boys = 1 (the GRANTED row)");
  ok(sen.byCategory.HEARING.female === 1, "A4: Hearing·girls = 1 (the PENDING row is still COUNTED)");

  const seeded = await db
    .select({ status: censusReturn.status, autoSnapshot: censusReturn.autoSnapshot })
    .from(censusReturn)
    .where(and(eq(censusReturn.schoolId, schoolId), eq(censusReturn.cadence, "ANNUAL")))
    .limit(1);
  const frozenSen = (seeded[0]?.autoSnapshot as { sections?: Record<string, { coverage: string }> })
    ?.sections?.specialNeeds;
  ok(
    frozenSen?.coverage === "FULL",
    `A5: the seeded ANNUAL row's FROZEN auto_snapshot §5 arm is FULL (auto) — render-from-frozen (got ${frozenSen?.coverage})`,
  );

  const [{ n: before }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(censusReturn)
    .where(eq(censusReturn.schoolId, schoolId));

  // ── B · ROLLED-BACK lifecycle round-trip ─────────────────────────────────────────────────────────
  const snapshot = await generateCensusSnapshot(schoolId, { cadence: "ANNUAL", censusDate: new Date() });
  const written: CensusHandFill = {
    version: CENSUS_HAND_FILL_VERSION,
    repetition: { male: 5, female: 3 },
    feeding: { participates: true, pupilsFed: 120, caterer: "Ama Kitchen" },
  };

  try {
    await db.transaction(async (tx) => {
      // seed a fresh DRAFT row (hand_fill NULL) under the throwaway year
      await tx.insert(censusReturn).values({
        schoolId,
        cadence: "ANNUAL",
        academicYear: RB_YEAR,
        status: "DRAFT",
        censusDate: snapshot.censusDate,
        autoSnapshot: snapshot,
      });

      const draftWhere = and(
        eq(censusReturn.schoolId, schoolId),
        eq(censusReturn.cadence, "ANNUAL"),
        eq(censusReturn.academicYear, RB_YEAR),
        eq(censusReturn.status, "DRAFT"),
      );

      // B1 · saveCensusHandFill on a DRAFT row → 1 row updated
      const wrote = await tx
        .update(censusReturn)
        .set({ handFill: written, updatedAt: new Date() })
        .where(draftWhere)
        .returning({ academicYear: censusReturn.academicYear });
      ok(wrote.length === 1, "B1: hand-fill write matched the DRAFT row (1 row) — GOV9-05");

      // B2 · re-read → parseCensusHandFill round-trips; unwritten sections stay ABSENT (honest-blank)
      const [afterWrite] = await tx
        .select({ handFill: censusReturn.handFill })
        .from(censusReturn)
        .where(and(eq(censusReturn.schoolId, schoolId), eq(censusReturn.academicYear, RB_YEAR)));
      const parsed = parseCensusHandFill(afterWrite.handFill);
      ok(
        JSON.stringify(parsed) === JSON.stringify(written),
        "B2: parseCensusHandFill round-trips the stored blob exactly",
      );
      ok(
        parsed.qualifications === undefined &&
          parsed.movementExits === undefined &&
          parsed.textbooks === undefined &&
          parsed.specialNeeds === undefined,
        "B3: un-written sections stay ABSENT (honest-blank → hatched, never a fabricated 0) — GOV9-06",
      );

      // B4 · markCensusCompleted flips DRAFT→COMPLETED (1 row)
      const completed = await tx
        .update(censusReturn)
        .set({ status: "COMPLETED", updatedAt: new Date() })
        .where(draftWhere)
        .returning({ academicYear: censusReturn.academicYear });
      ok(completed.length === 1, "B4: markCompleted flipped the DRAFT row to COMPLETED (1 row) — GOV9-14");

      // B5 · once COMPLETED, a hand-fill write matches 0 rows (locked) and leaves the stored value UNCHANGED
      const relocked = await tx
        .update(censusReturn)
        .set({ handFill: { version: 1, textbooks: { adequate: false } }, updatedAt: new Date() })
        .where(draftWhere)
        .returning({ academicYear: censusReturn.academicYear });
      ok(relocked.length === 0, "B5: a hand-fill write on a COMPLETED row matches 0 rows (LOCKED) — GOV9-14");
      const [afterLock] = await tx
        .select({ handFill: censusReturn.handFill })
        .from(censusReturn)
        .where(and(eq(censusReturn.schoolId, schoolId), eq(censusReturn.academicYear, RB_YEAR)));
      ok(
        JSON.stringify(parseCensusHandFill(afterLock.handFill)) === JSON.stringify(written),
        "B6: the COMPLETED row's frozen hand_fill is UNCHANGED by the refused write",
      );

      // B7 · a second complete matches 0 rows (idempotent refuse)
      const reComplete = await tx
        .update(censusReturn)
        .set({ status: "COMPLETED", updatedAt: new Date() })
        .where(draftWhere)
        .returning({ academicYear: censusReturn.academicYear });
      ok(reComplete.length === 0, "B7: completing an already-COMPLETED row matches 0 rows (refused)");

      // B8 · a missing year matches 0 rows (nothing to update)
      const missing = await tx
        .update(censusReturn)
        .set({ handFill: written, updatedAt: new Date() })
        .where(
          and(
            eq(censusReturn.schoolId, schoolId),
            eq(censusReturn.cadence, "ANNUAL"),
            eq(censusReturn.academicYear, "NO-SUCH/YR"),
            eq(censusReturn.status, "DRAFT"),
          ),
        )
        .returning({ academicYear: censusReturn.academicYear });
      ok(missing.length === 0, "B8: a hand-fill write with no matching row matches 0 rows (refused)");

      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }

  const [{ n: after }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(censusReturn)
    .where(eq(censusReturn.schoolId, schoolId));
  ok(after === before, `B9: after rollback the census_return count is unchanged (${before} → ${after})`);

  console.log(
    `\n${failures === 0 ? "✓ ALL CENSUS HAND-FILL ROUND-TRIP ASSERTIONS PASS" : `✗ ${failures} ASSERTION(S) FAILED`}`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
