import "@/db/_loadenv";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { schools, students, senRegister } from "@/db/schema";
import { getCensusSpecialNeeds } from "@/lib/reports/census/sen-data";
import { getSenRegister } from "@/lib/sen/register-data";

/**
 * GOV-10 · SEN register DB round-trip (AC GOV10-04/05/06). Two halves:
 *  A) READ-ONLY through the REAL readers on the seeded Asankrangwa rows (1 GRANTED Visual·boy + 1 PENDING
 *     Hearing·girl): the census counts BOTH, the admin table shows ONLY the GRANTED — consent gates the
 *     detail, not the count.
 *  B) A ROLLED-BACK tx proving the schema fences: the pending_no_detail CHECK rejects a PENDING row that
 *     carries any detail, the UNIQUE rejects a second row per student, and the composite (school,student)
 *     FK rejects a dangling/cross-tenant student. All rolled back — nothing persists.
 * Cross-school RLS isolation (GOV10-16) is `pnpm db:rls-test` (sen_register + sen_module_adoption are
 * auto-discovered tenant tables).
 */
let failures = 0;
function ok(cond: boolean, label: string) {
  console.log(`${cond ? "✓" : "✗ FAIL"} ${label}`);
  if (!cond) failures++;
}
class Rollback extends Error {}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTx = any;

async function main() {
  const [asankrangwa] = await db
    .select({ id: schools.id })
    .from(schools)
    .where(eq(schools.gesCode, "WR-WAW-014"));
  if (!asankrangwa) throw new Error("Seed missing — Asankrangwa (WR-WAW-014) not found.");
  const schoolId = asankrangwa.id;

  // ── A · READ-ONLY through the real readers (the seeded GRANTED + PENDING rows) ──────────────────────
  const census = await getCensusSpecialNeeds(schoolId);
  ok(census.adopted === true, "A1: getCensusSpecialNeeds reports the module adopted (marker present)");
  ok(census.total === 2, `A2: the census counts BOTH the GRANTED and the PENDING child (total=${census.total})`);
  ok(census.byCategory.VISUAL.male === 1, "A3: Visual·boys = 1 (the GRANTED row)");
  ok(census.byCategory.HEARING.female === 1, "A4: Hearing·girls = 1 (the PENDING row is COUNTED, GOV10-04)");
  // de-id: the payload structurally carries no PII (a runtime echo of the compile-fence)
  ok(
    JSON.stringify(Object.keys(census).sort()) === JSON.stringify(["adopted", "byCategory", "total"]),
    "A5: the census payload is de-identified — only {adopted, byCategory, total}",
  );

  const view = await getSenRegister(schoolId);
  ok(view.census.total === 2, "A6: the register view's census also counts both (2)");
  ok(view.records.length === 1, `A7: the admin detail table shows ONLY the GRANTED row (records=${view.records.length})`);
  ok(view.pendingCount === 1, `A8: the PENDING child is carried as a count only (pendingCount=${view.pendingCount})`);
  ok(
    view.records.every((r) => r.consentOnFileAt !== null),
    "A9: every visible detail record has consent on file (no consent → no detail row)",
  );

  // ── B · ROLLED-BACK schema-fence probes ─────────────────────────────────────────────────────────────
  const rand = Math.random().toString(36).slice(2, 8);
  try {
    await db.transaction(async (tx) => {
      const mkStudent = async (code: string) => {
        const [{ id }] = await tx
          .insert(students)
          .values({ schoolId, studentCode: `SEN-${code}-${rand}`, firstName: code, lastName: "T", sex: "MALE" })
          .returning({ id: students.id });
        return id;
      };
      const sA = await mkStudent("A");
      const sB = await mkStudent("B");

      const refused = async (fn: (sp: AnyTx) => Promise<unknown>): Promise<boolean> => {
        try {
          await tx.transaction(async (sp) => {
            await fn(sp);
          });
          return false;
        } catch {
          return true;
        }
      };

      // B1 · the pending_no_detail CHECK rejects a PENDING row carrying detail (severity) ---------------
      const b1 = await refused((sp) =>
        sp.insert(senRegister).values({ schoolId, studentId: sA, category: "VISUAL", consentState: "PENDING", severity: "SEVERE" }),
      );
      ok(b1, "B1: a PENDING row WITH detail (severity) is REJECTED by sen_register_pending_no_detail (GOV10-05)");

      // B1' · the same CHECK rejects a PENDING row carrying a diagnosis-cluster value -------------------
      const b1b = await refused((sp) =>
        sp.insert(senRegister).values({ schoolId, studentId: sA, category: "VISUAL", consentState: "PENDING", diagnosingClinician: "Dr X" }),
      );
      ok(b1b, "B1': a PENDING row WITH a diagnosis-cluster value is also REJECTED (whole cluster fenced)");

      // B2 · a PENDING minimal row (category only) is ACCEPTED — the census-counted, no-detail child -----
      const minimal = await tx
        .insert(senRegister)
        .values({ schoolId, studentId: sA, category: "VISUAL", consentState: "PENDING" })
        .returning({ id: senRegister.id });
      ok(minimal.length === 1, "B2: a PENDING (student_id + category only) minimal row is ACCEPTED (GOV10-04)");

      // B3 · UNIQUE(school,student) — a second row for the same student is REJECTED --------------------
      const b3 = await refused((sp) =>
        sp.insert(senRegister).values({ schoolId, studentId: sA, category: "HEARING", consentState: "PENDING" }),
      );
      ok(b3, "B3: a SECOND sen_register row for the same student is REJECTED by uniq_sen_register_student (GOV10-06)");

      // B4 · a GRANTED row MAY carry full detail (positive control) ------------------------------------
      const granted = await tx
        .insert(senRegister)
        .values({
          schoolId,
          studentId: sB,
          category: "INTELLECTUAL",
          consentState: "GRANTED",
          severity: "MODERATE",
          diagnosingClinician: "Accra Psychology Centre",
          diagnosisYear: 2023,
          consentOnFileAt: "2026-01-15",
        })
        .returning({ id: senRegister.id });
      ok(granted.length === 1, "B4: a GRANTED row carrying the full detail cluster is ACCEPTED (positive control)");

      // B5 · the composite (school, student) FK rejects a dangling/cross-tenant student -----------------
      const b5 = await refused((sp) =>
        sp.insert(senRegister).values({ schoolId, studentId: "00000000-0000-0000-0000-0000000000ff", category: "OTHER", consentState: "PENDING" }),
      );
      ok(b5, "B5: a sen_register row for a non-existent/cross-tenant student is REJECTED by the composite FK");

      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }

  // sanity: nothing persisted (the seeded 2 rows only)
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(senRegister)
    .where(and(eq(senRegister.schoolId, schoolId)));
  ok(n === 2, `B6: after rollback the register still holds only the 2 seeded rows (got ${n})`);

  console.log(
    `\n${failures === 0 ? "✓ ALL SEN-REGISTER ROUND-TRIP ASSERTIONS PASS" : `✗ ${failures} ASSERTION(S) FAILED`}`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
