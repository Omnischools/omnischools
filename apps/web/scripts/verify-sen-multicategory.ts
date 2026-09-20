import "@/db/_loadenv";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { schools, students, users, senRegister, senModuleAdoption, senSupportGrant } from "@/db/schema";
import { getSenRegister, getSenAccommodationsForGrantee } from "@/lib/sen/register-data";
import { getCensusSpecialNeeds, SEN_CATEGORIES } from "@/lib/reports/census/sen-data";

/**
 * GOV-10c (R445) · SEN multi-category DB round-trip — AC GOV10-41..54. Cloned from verify-sen-grant.ts:
 * a THROWAWAY school (SEN-MULTI-* marker) with COMMITTED fixtures, so the REAL readers
 * (getCensusSpecialNeeds / getSenRegister / getSenAccommodationsForGrantee — each opens its own
 * withSchool tx) see the rows; then a HARD teardown in `finally` (school CASCADE removes students →
 * sen_register / sen_support_grant / adoption) + the marker users.
 *
 * The census/grantee/admin invariants run on the committed fixtures (GOV10-46/47/51/53/54). The schema
 * FENCES (unique one-parent-row / category NOT NULL / the primary∈secondary CHECK / dup-secondary
 * accepted by the DB so the app refine is the sole guard / pending_no_detail with a full category set)
 * run in ONE rolled-back nested tx on throwaway students, so committed state stays pristine (GOV10-41..45).
 *
 * Cross-school RLS isolation is `pnpm db:rls-test` (sen_register auto-discovered). The app-layer
 * categoriesDistinct refine (GOV10-43 dup-secondary) is source-pinned in lib/sen/sen-multicategory.test.ts
 * — a "use server" module can only export async actions, so the pure refine cannot be unit-called here.
 */
let failures = 0;
function ok(cond: boolean, label: string) {
  console.log(`${cond ? "✓" : "✗ FAIL"} ${label}`);
  if (!cond) failures++;
}
class Rollback extends Error {}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTx = any;

const cellSum = (byCategory: Record<string, { male: number; female: number }>): number =>
  SEN_CATEGORIES.reduce((s, c) => s + byCategory[c].male + byCategory[c].female, 0);

async function main() {
  const rand = Math.random().toString(36).slice(2, 8);

  // A real student of ANOTHER tenant — the cross-tenant FK probe target (mirrors verify-sen-grant).
  const [foreignStudent] = await db
    .select({ id: students.id })
    .from(students)
    .innerJoin(schools, eq(schools.id, students.schoolId))
    .where(eq(schools.gesCode, "WR-WAW-014"))
    .limit(1);
  if (!foreignStudent) throw new Error("Seed missing — Asankrangwa (WR-WAW-014) has no students.");

  let schoolId = "";
  const userIds: string[] = [];
  try {
    // ── Committed fixtures (superuser bypasses RLS exactly as seeds/ETL do) ─────────────────────────
    [{ id: schoolId }] = await db
      .insert(schools)
      .values({ name: `SEN-MULTI ${rand}`, gesCode: `SEN-MULTI-${rand}`, schoolType: "SENIOR" })
      .returning({ id: schools.id });
    await db.insert(senModuleAdoption).values({ schoolId }); // R413 marker → census reads rows

    const mkUser = async (label: string) => {
      const [{ id }] = await db
        .insert(users)
        .values({ phone: `+233SM${rand}${label}`.slice(0, 15), fullName: `SM ${label}` })
        .returning({ id: users.id });
      userIds.push(id);
      return id;
    };
    const G = await mkUser("grantee"); // holds LIVE grants on Ada (multi-cat, GRANTED) + Cyn (multi-cat, PENDING)

    const mkStudent = async (code: string, sex: "MALE" | "FEMALE") => {
      const [{ id }] = await db
        .insert(students)
        .values({ schoolId, studentCode: `SM-${code}-${rand}`, firstName: code, lastName: "T", sex })
        .returning({ id: students.id });
      return id;
    };
    const ada = await mkStudent("Ada", "FEMALE"); // primary HEARING + secondary {INTELLECTUAL}, GRANTED
    const ben = await mkStudent("Ben", "MALE"); //   primary VISUAL, NULL secondary (legacy backfill state)
    const cyn = await mkStudent("Cyn", "FEMALE"); // primary PHYSICAL + secondary {VISUAL,SPEECH}, PENDING

    // Ada — the multi-category GRANTED record: ONE per-student detail cluster (severity/notes/accs), a
    // secondary category set that is NOT detail (GOV10-44).
    await db.insert(senRegister).values({
      schoolId,
      studentId: ada,
      category: "HEARING",
      secondaryCategories: ["INTELLECTUAL"],
      consentState: "GRANTED",
      severity: "MODERATE",
      supportNotes: "Deaf + intellectual support",
      accommodations: ["FM hearing system", "Note-taker"],
      consentOnFileAt: "2024-02-01",
    });
    // Ben — a LEGACY single-category row: secondary_categories omitted → stored NULL (the migration is
    // ADD COLUMN nullable, so every pre-migration row is NULL). GOV10-54 backfill no-op.
    await db.insert(senRegister).values({
      schoolId,
      studentId: ben,
      category: "VISUAL",
      consentState: "GRANTED",
      accommodations: ["Large-print handouts"],
      consentOnFileAt: "2024-02-02",
    });
    // Cyn — a PENDING multi-category row: a full category set, EVERY detail column NULL (GOV10-45/53).
    await db.insert(senRegister).values({
      schoolId,
      studentId: cyn,
      category: "PHYSICAL",
      secondaryCategories: ["VISUAL", "SPEECH"],
      consentState: "PENDING",
    });

    // Ben's row must be NULL secondary (not [], the action's value) — assert the legacy shape directly.
    const [benRaw] = await db
      .select({ sec: senRegister.secondaryCategories })
      .from(senRegister)
      .where(and(eq(senRegister.schoolId, schoolId), eq(senRegister.studentId, ben)));
    ok(benRaw.sec === null, "S0: a legacy single-category row stores secondary_categories = NULL (GOV10-54 backfill)");

    const mkGrant = async (studentId: string) => {
      await db
        .insert(senSupportGrant)
        .values({ schoolId, studentId, granteeUserId: G, reason: "Accommodation planning" });
    };
    await mkGrant(ada); // LIVE grant on the multi-cat GRANTED child
    await mkGrant(cyn); // LIVE grant on the multi-cat PENDING child → reader must STILL exclude her

    // ── §5 census: each student counted ONCE under primary; secondaries NEVER folded in (GOV10-46/47) ─
    const census = await getCensusSpecialNeeds(schoolId);
    ok(census.adopted, "C0: the module is adopted (marker present)");
    ok(census.total === 3, `C1 (GOV10-46): §5 counts each of the 3 students ONCE (total=${census.total})`);
    ok(cellSum(census.byCategory) === 3, `C2 (GOV10-47): total == Σ the 12 cells (Σ=${cellSum(census.byCategory)})`);
    ok(census.byCategory.HEARING.female === 1, "C3: Ada's PRIMARY HEARING is her single census cell");
    ok(census.byCategory.VISUAL.male === 1, "C4: Ben's PRIMARY VISUAL is his single census cell");
    ok(census.byCategory.PHYSICAL.female === 1, "C5 (GOV10-53): the PENDING child is counted under her PRIMARY PHYSICAL");
    // THE non-inflation assertions — a folding mutation (secondary → census) turns these RED.
    ok(
      census.byCategory.INTELLECTUAL.male === 0 && census.byCategory.INTELLECTUAL.female === 0,
      "C6 (KEY GOV10-47): Ada's SECONDARY {INTELLECTUAL} is NEVER summed into §5 (cell stays 0)",
    );
    ok(
      census.byCategory.SPEECH.male === 0 && census.byCategory.SPEECH.female === 0,
      "C7 (KEY GOV10-47): Cyn's SECONDARY {SPEECH} is NEVER summed into §5 (cell stays 0)",
    );
    ok(
      census.byCategory.VISUAL.female === 0,
      "C8 (KEY GOV10-47): Cyn's SECONDARY {VISUAL} is NOT folded — VISUAL·female stays 0 (only Ben's PRIMARY counts)",
    );

    // ── The admin register view: GRANTED-only detail table, per-student detail, primary + secondaries ─
    const view = await getSenRegister(schoolId);
    ok(view.census.total === 3, "V0: the register view's census also counts all 3");
    ok(view.records.length === 2, `V1 (GOV10-53): the detail table shows ONLY the 2 GRANTED rows, PENDING excluded (records=${view.records.length})`);
    ok(view.pendingCount === 1, `V2: the PENDING multi-cat child is carried as a count only (pendingCount=${view.pendingCount})`);
    const adaRec = view.records.find((r) => r.studentName === "Ada T");
    const benRec = view.records.find((r) => r.studentName === "Ben T");
    ok(adaRec?.category === "HEARING", "V3 (GOV10-52): Ada's PRIMARY category is HEARING");
    ok(
      JSON.stringify(adaRec?.secondaryCategories) === JSON.stringify(["INTELLECTUAL"]),
      `V4 (GOV10-52): Ada's SECONDARY set reads back as [INTELLECTUAL] (got ${JSON.stringify(adaRec?.secondaryCategories)})`,
    );
    // GOV10-44 — the detail is ONE per student, not per category: a single severity/notes/accommodations.
    ok(adaRec?.severity === "MODERATE" && adaRec?.supportNotes === "Deaf + intellectual support", "V5 (GOV10-44): Ada carries ONE per-student severity + notes (not per-category)");
    ok(
      JSON.stringify(adaRec?.accommodations) === JSON.stringify(["FM hearing system", "Note-taker"]),
      "V6 (GOV10-44): Ada carries ONE per-student accommodation list (not per-category)",
    );
    ok(
      Array.isArray(benRec?.secondaryCategories) && benRec?.secondaryCategories.length === 0,
      `V7 (GOV10-54): the legacy NULL-secondary row reads back as an EMPTY set (got ${JSON.stringify(benRec?.secondaryCategories)})`,
    );

    // ── The grantee card: the WHOLE child's category set (primary + secondary), diagnosis-free (GOV10-51) ─
    const recsG = await getSenAccommodationsForGrantee(schoolId, G);
    ok(recsG.length === 1, `G1 (GOV10-53): the grantee sees ONLY the GRANTED granted student — Cyn (PENDING) excluded (got ${recsG.length})`);
    const adaGrantee = recsG.find((r) => r.studentName === "Ada T");
    ok(adaGrantee?.category === "HEARING", "G2 (GOV10-51): the grantee sees Ada's PRIMARY HEARING");
    ok(
      JSON.stringify(adaGrantee?.secondaryCategories) === JSON.stringify(["INTELLECTUAL"]),
      "G3 (GOV10-51): the grantee sees Ada's SECONDARY {INTELLECTUAL} too — the whole child",
    );
    const diagKeys = ["diagnosisSource", "diagnosingClinician", "diagnosingInstitution", "diagnosisYear", "consentOnFileAt", "consentState"];
    const leaked = adaGrantee ? Object.keys(adaGrantee).filter((k) => diagKeys.includes(k)) : ["<no record>"];
    ok(leaked.length === 0, `G4 (KEY GOV10-51): the grantee record stays diagnosis/consent-free at runtime (leaked: ${leaked.join(",") || "none"})`);

    // ── Fences — rolled back; throwaway students created in-tx (GOV10-41..45) ────────────────────────
    try {
      await db.transaction(async (tx) => {
        const mkTxStudent = async (code: string) => {
          const [{ id }] = await tx
            .insert(students)
            .values({ schoolId, studentCode: `SMF-${code}-${rand}`, firstName: code, lastName: "F", sex: "MALE" })
            .returning({ id: students.id });
          return id;
        };
        const fA = await mkTxStudent("A");
        const fB = await mkTxStudent("B");

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

        // F1 (GOV10-41) — one parent row per (school, student): a 2nd sen_register for fA is rejected.
        const seed = await tx
          .insert(senRegister)
          .values({ schoolId, studentId: fA, category: "VISUAL", consentState: "PENDING" })
          .returning({ id: senRegister.id });
        ok(seed.length === 1, "F0: a first PENDING minimal row is accepted");
        const f1 = await refused((sp) =>
          sp.insert(senRegister).values({ schoolId, studentId: fA, category: "HEARING", consentState: "PENDING" }),
        );
        ok(f1, "F1 (GOV10-41): a SECOND sen_register row for the same student is REJECTED (uniq_sen_register_student)");

        // F2 (GOV10-42) — category is NOT NULL, even on a pending row.
        const f2 = await refused((sp) =>
          sp.insert(senRegister).values({ schoolId, studentId: fB, consentState: "PENDING" } as AnyTx),
        );
        ok(f2, "F2 (GOV10-42): a row with a NULL primary category is REJECTED (category NOT NULL)");

        // F3 (GOV10-43) — the CHECK rejects primary ∈ secondary.
        const f3 = await refused((sp) =>
          sp.insert(senRegister).values({ schoolId, studentId: fB, category: "HEARING", secondaryCategories: ["HEARING"], consentState: "PENDING" }),
        );
        ok(f3, "F3 (GOV10-43): primary ∈ secondary is REJECTED by sen_register_secondary_not_primary");
        const f3b = await refused((sp) =>
          sp.insert(senRegister).values({ schoolId, studentId: fB, category: "HEARING", secondaryCategories: ["VISUAL", "HEARING"], consentState: "PENDING" }),
        );
        ok(f3b, "F3': the CHECK also rejects the primary appearing ANYWHERE in the secondary set");

        // F4 (GOV10-43 note) — a DUPLICATE secondary is ACCEPTED by the DB (no array-is-a-set CHECK
        // exists), so the app-layer `categoriesDistinct` refine is the SOLE guard for dups. This proves
        // the source-pinned refine is load-bearing, not redundant with the DB.
        const dup = await tx
          .insert(senRegister)
          .values({ schoolId, studentId: fB, category: "HEARING", secondaryCategories: ["VISUAL", "VISUAL"], consentState: "PENDING" })
          .returning({ id: senRegister.id });
        ok(dup.length === 1, "F4 (GOV10-43): the DB ACCEPTS a duplicate secondary → the app `categoriesDistinct` refine is the sole dup guard");
        await tx.delete(senRegister).where(and(eq(senRegister.schoolId, schoolId), eq(senRegister.studentId, fB)));

        // F5 (GOV10-45) — a PENDING row carries a FULL category set with EVERY detail column NULL.
        const pmc = await tx
          .insert(senRegister)
          .values({ schoolId, studentId: fB, category: "HEARING", secondaryCategories: ["VISUAL", "INTELLECTUAL"], consentState: "PENDING" })
          .returning({ id: senRegister.id, sec: senRegister.secondaryCategories });
        ok(
          pmc.length === 1 && JSON.stringify(pmc[0].sec) === JSON.stringify(["VISUAL", "INTELLECTUAL"]),
          "F5 (GOV10-45): a PENDING row is accepted with a full category set (categories are NOT detail; pending_no_detail holds)",
        );
        // F5' — the SAME PENDING row + any detail value is still rejected (the category set didn't loosen the CHECK).
        await tx.delete(senRegister).where(and(eq(senRegister.schoolId, schoolId), eq(senRegister.studentId, fB)));
        const f5 = await refused((sp) =>
          sp.insert(senRegister).values({ schoolId, studentId: fB, category: "HEARING", secondaryCategories: ["VISUAL"], consentState: "PENDING", severity: "MILD" }),
        );
        ok(f5, "F5' (GOV10-45): a PENDING multi-cat row carrying ANY detail (severity) is STILL rejected by pending_no_detail");

        // F6 — the composite (school, student) FK still refuses a cross-tenant/dangling student.
        const f6 = await refused((sp) =>
          sp.insert(senRegister).values({ schoolId, studentId: foreignStudent.id, category: "OTHER", consentState: "PENDING" }),
        );
        ok(f6, "F6: the composite (school_id, student_id) FK refuses another tenant's student (unchanged)");

        throw new Rollback();
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }

    // Nothing from the fence tx persisted — the committed register still holds exactly the 3 fixtures.
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(senRegister)
      .where(eq(senRegister.schoolId, schoolId));
    ok(n === 3, `F7: after rollback the register holds only the 3 committed fixtures (got ${n})`);
    const censusPost = await getCensusSpecialNeeds(schoolId);
    ok(censusPost.total === 3, `F8: the §5 count is unchanged by the rolled-back fences (total=${censusPost.total})`);
  } finally {
    if (schoolId) await db.delete(schools).where(eq(schools.id, schoolId)).catch(() => {});
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds)).catch(() => {});
  }

  console.log("\nℹ cross-school SELECT=0 is `pnpm db:rls-test`; the app-layer categoriesDistinct refine is source-pinned in lib/sen/sen-multicategory.test.ts.");
  console.log(
    `\n${failures === 0 ? "✓ ALL SEN-MULTICATEGORY ROUND-TRIP ASSERTIONS PASS" : `✗ ${failures} ASSERTION(S) FAILED`}`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
