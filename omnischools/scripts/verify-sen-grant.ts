import "@/db/_loadenv";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { withSchool } from "@/lib/db/rls";
import {
  schools,
  students,
  users,
  senRegister,
  senModuleAdoption,
  senSupportGrant,
} from "@/db/schema";
import { hasAnyLiveSenGrant, liveSenGrantStudentIds } from "@/lib/sen/grants";
import { getSenAccommodationsForGrantee } from "@/lib/sen/register-data";
import { getCensusSpecialNeeds } from "@/lib/reports/census/sen-data";

/**
 * GOV-10b · SEN teacher accommodation-grant + editing/lifecycle DB round-trip (AC GOV10-19..40).
 * Cloned from scripts/verify-sen-register.ts, but the grant flows need the REAL readers run against
 * COMMITTED rows (`getSenAccommodationsForGrantee` / `getCensusSpecialNeeds` open their own withSchool
 * tx, so an outer rolled-back fixture is invisible to them). So this builds a THROWAWAY school
 * (`SEN-GRANT-*` marker), commits its fixtures, exercises every live reader/helper end-to-end, then
 * HARD-DELETES the school (school_id CASCADE removes students → sen_register / sen_support_grant /
 * sen_module_adoption) + the marker users in `finally` — nothing survives.
 *
 * The lifecycle actions (editSenRecord / grantSenConsent / withdrawSenConsent) require an auth session
 * so cannot run in a script; their DB EFFECT is replicated in-tx exactly as the action writes it (the
 * gate/audit/WHERE are source-asserted in lib/sen/sen-grant.test.ts) and the resulting INVARIANT is
 * proven through the real census reader — the same split verify-sen-register uses for the CHECK/FK.
 *
 * Cross-school RLS isolation (GOV10-16/19) is `pnpm db:rls-test` — sen_support_grant is an
 * auto-discovered FORCE-RLS tenant table, so foreign/unscoped SELECT = 0 is covered with no edit here.
 */
let failures = 0;
function ok(cond: boolean, label: string) {
  console.log(`${cond ? "✓" : "✗ FAIL"} ${label}`);
  if (!cond) failures++;
}
class Rollback extends Error {}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

const PAST = () => new Date(Date.now() - 3600_000); // an hour ago

async function main() {
  const rand = Math.random().toString(36).slice(2, 8);

  // A real student of ANOTHER tenant (the seeded Asankrangwa roll) — the cross-tenant FK probe target.
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
    // ── Fixtures (committed; superuser bypasses RLS exactly as seeds/ETL do) ────────────────────────
    [{ id: schoolId }] = await db
      .insert(schools)
      .values({ name: `SEN-GRANT ${rand}`, gesCode: `SEN-GRANT-${rand}`, schoolType: "SENIOR" })
      .returning({ id: schools.id });
    await db.insert(senModuleAdoption).values({ schoolId }); // the R413 adoption marker → census reads rows

    const mkUser = async (label: string) => {
      const [{ id }] = await db
        .insert(users)
        .values({ phone: `+233SG${rand}${label}`.slice(0, 15), fullName: `SG ${label}` })
        .returning({ id: users.id });
      userIds.push(id);
      return id;
    };
    const G = await mkUser("grantee"); // holds LIVE grants
    const H = await mkUser("revoked"); // holds ONLY a revoked grant
    const J = await mkUser("expired"); // holds ONLY an expired grant

    const mkStudent = async (code: string, sex: "MALE" | "FEMALE") => {
      const [{ id }] = await db
        .insert(students)
        .values({ schoolId, studentCode: `SG-${code}-${rand}`, firstName: code, lastName: "T", sex })
        .returning({ id: students.id });
      return id;
    };
    const ada = await mkStudent("Ada", "FEMALE"); // GRANTED + accommodations
    const ben = await mkStudent("Ben", "MALE"); // GRANTED, but NOT granted to G
    const cyn = await mkStudent("Cyn", "FEMALE"); // PENDING (no detail)

    await db.insert(senRegister).values([
      {
        schoolId,
        studentId: ada,
        category: "VISUAL",
        consentState: "GRANTED",
        severity: "MILD",
        supportNotes: "Prefers front of class",
        accommodations: ["Front-row seat", "Large-print handouts"],
        diagnosisSource: "CLINICAL_DIAGNOSIS",
        diagnosingClinician: "Korle-Bu",
        diagnosisYear: 2022,
        consentOnFileAt: "2024-01-15",
      },
      {
        schoolId,
        studentId: ben,
        category: "HEARING",
        consentState: "GRANTED",
        accommodations: ["FM hearing system"],
        consentOnFileAt: "2024-01-20",
      },
      { schoolId, studentId: cyn, category: "PHYSICAL", consentState: "PENDING" },
    ]);

    const mkGrant = async (studentId: string, grantee: string, opts: { revoked?: boolean; expired?: boolean } = {}) => {
      const [{ id }] = await db
        .insert(senSupportGrant)
        .values({
          schoolId,
          studentId,
          granteeUserId: grantee,
          reason: "Accommodation planning",
          ...(opts.expired ? { expiresAt: PAST() } : {}),
          ...(opts.revoked ? { revokedAt: PAST() } : {}),
        })
        .returning({ id: senSupportGrant.id });
      return id;
    };
    await mkGrant(ada, G); // LIVE
    await mkGrant(cyn, G); // LIVE (but Cyn is PENDING → reader must still exclude her)
    await mkGrant(ben, H, { revoked: true }); // revoked-only grantee
    await mkGrant(ada, J, { expired: true }); // expired-only grantee

    // ── L · liveness of the gate helpers (GOV10-22/23/24/25) ────────────────────────────────────────
    const liveG = await withSchool(schoolId, (tx) => liveSenGrantStudentIds(tx, schoolId, G));
    ok(liveG.has(ada) && liveG.has(cyn), "L1: liveSenGrantStudentIds includes the LIVE-granted students (GOV10-24)");
    ok(liveG.size === 2, `L1: exactly the 2 live-granted students, no dead ones (size=${liveG.size})`);
    ok(await withSchool(schoolId, (tx) => hasAnyLiveSenGrant(tx, schoolId, G)), "L2: hasAnyLiveSenGrant=true for a live-grant holder (GOV10-22)");

    const liveH = await withSchool(schoolId, (tx) => liveSenGrantStudentIds(tx, schoolId, H));
    ok(liveH.size === 0, "L3: a REVOKED grant is EXCLUDED — liveSenGrantStudentIds empty (GOV10-23)");
    ok(!(await withSchool(schoolId, (tx) => hasAnyLiveSenGrant(tx, schoolId, H))), "L3: hasAnyLiveSenGrant=false for a revoked-only grantee (GOV10-23)");

    const liveJ = await withSchool(schoolId, (tx) => liveSenGrantStudentIds(tx, schoolId, J));
    ok(liveJ.size === 0, "L4: an EXPIRED grant (expires_at < now()) is EXCLUDED — liveness in SQL (GOV10-25)");
    ok(!(await withSchool(schoolId, (tx) => hasAnyLiveSenGrant(tx, schoolId, J))), "L4: hasAnyLiveSenGrant=false for an expired-only grantee (GOV10-25)");

    // ── R · the grantee reader: GRANTED-only, granted-students-only, diagnosis-free (GOV10-26/27/28) ─
    const recsG = await getSenAccommodationsForGrantee(schoolId, G);
    ok(recsG.length === 1, `R1: reader returns ONLY the GRANTED + live-granted student (got ${recsG.length})`);
    ok(recsG[0]?.studentName === "Ada T", "R2: that student is Ada (the GRANTED + granted one)");
    ok(recsG[0]?.accommodations.includes("Front-row seat"), "R2: her accommodations are projected");
    ok(!recsG.some((r) => r.studentName === "Ben T"), "R3: Ben (GRANTED but NOT granted to this teacher) is EXCLUDED (GOV10-28)");
    ok(!recsG.some((r) => r.studentName === "Cyn T"), "R4: Cyn (PENDING, though live-granted) is EXCLUDED — GRANTED-only (GOV10-27)");
    const diagKeys = ["diagnosisSource", "diagnosingClinician", "diagnosingInstitution", "diagnosisYear", "consentOnFileAt", "consentState"];
    const leaked = recsG[0] ? Object.keys(recsG[0]).filter((k) => diagKeys.includes(k)) : [];
    ok(leaked.length === 0, `R5 (KEY): the grantee record carries NO diagnosis/consent field at runtime (leaked: ${leaked.join(",") || "none"}) (GOV10-26)`);

    const recsH = await getSenAccommodationsForGrantee(schoolId, H);
    ok(recsH.length === 0, "R6: a revoked-only grantee reads ZERO accommodation records (GOV10-23)");

    // ── E · editing is GRANTED-only + advances updatedAt (GOV10-36/37) ──────────────────────────────
    const [benBefore] = await db
      .select({ updatedAt: senRegister.updatedAt })
      .from(senRegister)
      .where(and(eq(senRegister.schoolId, schoolId), eq(senRegister.studentId, ben)));
    // editSenRecord's effect: set category/detail + updatedAt, WHERE consentState='GRANTED'.
    const editGranted = await withSchool(schoolId, (tx) =>
      tx
        .update(senRegister)
        .set({ category: "HEARING", accommodations: ["FM hearing system", "Note-taker"], updatedAt: new Date() })
        .where(and(eq(senRegister.schoolId, schoolId), eq(senRegister.studentId, ben), eq(senRegister.consentState, "GRANTED")))
        .returning({ id: senRegister.id }),
    );
    ok(editGranted.length === 1, "E1: editing a GRANTED record updates exactly that row (GOV10-36)");
    const [benAfter] = await db
      .select({ updatedAt: senRegister.updatedAt })
      .from(senRegister)
      .where(and(eq(senRegister.schoolId, schoolId), eq(senRegister.studentId, ben)));
    ok(benAfter.updatedAt >= benBefore.updatedAt, "E2: updatedAt advances on edit (GOV10-37)");
    // A PENDING record is NOT editable (WHERE consentState='GRANTED' matches 0 rows).
    const editPending = await withSchool(schoolId, (tx) =>
      tx
        .update(senRegister)
        .set({ accommodations: ["should not apply"], updatedAt: new Date() })
        .where(and(eq(senRegister.schoolId, schoolId), eq(senRegister.studentId, cyn), eq(senRegister.consentState, "GRANTED")))
        .returning({ id: senRegister.id }),
    );
    ok(editPending.length === 0, "E3: a PENDING record is NOT editable (GOV10-36 — only a GRANTED row)");

    // ── C · PENDING → GRANTED keeps the census total UNCHANGED (GOV10-38) ───────────────────────────
    const censusBefore = await getCensusSpecialNeeds(schoolId);
    ok(censusBefore.adopted && censusBefore.total === 3, `C0: census counts all 3 (Ada+Ben+Cyn) incl. the PENDING child (total=${censusBefore.total})`);
    // grantSenConsent's effect: PENDING → GRANTED, unlock detail, WHERE consentState='PENDING'.
    const consentRows = await withSchool(schoolId, (tx) =>
      tx
        .update(senRegister)
        .set({ consentState: "GRANTED", severity: "MODERATE", accommodations: ["Ramp access"], consentOnFileAt: "2024-03-01", updatedAt: new Date() })
        .where(and(eq(senRegister.schoolId, schoolId), eq(senRegister.studentId, cyn), eq(senRegister.consentState, "PENDING")))
        .returning({ id: senRegister.id }),
    );
    ok(consentRows.length === 1, "C1: PENDING→GRANTED succeeds — the pending_no_detail CHECK passes on GRANTED (GOV10-38)");
    const censusAfterConsent = await getCensusSpecialNeeds(schoolId);
    ok(censusAfterConsent.total === 3, `C2: the census total is UNCHANGED at 3 — consent gates the DETAIL, not the COUNT (GOV10-38, got ${censusAfterConsent.total})`);
    const recsGafter = await getSenAccommodationsForGrantee(schoolId, G);
    ok(recsGafter.length === 2 && recsGafter.some((r) => r.studentName === "Cyn T"), "C3: Cyn now appears to the grantee (she became GRANTED and G holds a live grant)");

    // ── W · withdrawal: NULL detail (CHECK passes), STILL counted, cascade-revoke grants (GOV10-40) ──
    const withdrawn = await withSchool(schoolId, async (tx) => {
      const rows = await tx
        .update(senRegister)
        .set({
          consentState: "PENDING",
          severity: null,
          supportNotes: null,
          accommodations: null,
          diagnosisSource: null,
          diagnosingClinician: null,
          diagnosingInstitution: null,
          diagnosisYear: null,
          consentOnFileAt: null,
          updatedAt: new Date(),
        })
        .where(and(eq(senRegister.schoolId, schoolId), eq(senRegister.studentId, ada), eq(senRegister.consentState, "GRANTED")))
        .returning({ studentId: senRegister.studentId });
      if (rows.length === 1) {
        await tx
          .update(senSupportGrant)
          .set({ revokedAt: new Date() })
          .where(and(eq(senSupportGrant.schoolId, schoolId), eq(senSupportGrant.studentId, ada), isNull(senSupportGrant.revokedAt)));
      }
      return rows;
    });
    ok(withdrawn.length === 1, "W1: GRANTED→PENDING withdrawal succeeds — the CHECK passes with the detail nulled (GOV10-40)");
    const [adaRow] = await db
      .select({
        consentState: senRegister.consentState,
        category: senRegister.category,
        severity: senRegister.severity,
        supportNotes: senRegister.supportNotes,
        accommodations: senRegister.accommodations,
        diagnosisSource: senRegister.diagnosisSource,
        diagnosingClinician: senRegister.diagnosingClinician,
        diagnosisYear: senRegister.diagnosisYear,
        consentOnFileAt: senRegister.consentOnFileAt,
      })
      .from(senRegister)
      .where(and(eq(senRegister.schoolId, schoolId), eq(senRegister.studentId, ada)));
    const detailNulled =
      adaRow.severity === null &&
      adaRow.supportNotes === null &&
      adaRow.accommodations === null &&
      adaRow.diagnosisSource === null &&
      adaRow.diagnosingClinician === null &&
      adaRow.diagnosisYear === null &&
      adaRow.consentOnFileAt === null;
    ok(detailNulled, "W2: the WHOLE detail cluster + consentOnFileAt is NULLed on withdrawal (GOV10-40)");
    ok(adaRow.consentState === "PENDING" && adaRow.category === "VISUAL", "W3: consent demoted to PENDING but category RETAINED");
    const censusAfterWithdraw = await getCensusSpecialNeeds(schoolId);
    ok(censusAfterWithdraw.total === 3, `C4: the child STAYS census-counted after withdrawal — total still 3 (GOV10-40, got ${censusAfterWithdraw.total})`);
    const liveGpost = await withSchool(schoolId, (tx) => liveSenGrantStudentIds(tx, schoolId, G));
    ok(!liveGpost.has(ada) && liveGpost.has(cyn), "W4: Ada's live grant is CASCADE-REVOKED; the Cyn grant is untouched (GOV10-40)");
    const recsGpost = await getSenAccommodationsForGrantee(schoolId, G);
    ok(recsGpost.length === 1 && recsGpost[0]?.studentName === "Cyn T", "W5: the grantee no longer sees Ada — access followed the consent (GOV10-40)");

    // ── F · fence probes (rolled back — they raise or mutate) (GOV10-20/21) ──────────────────────────
    const refused = async (fn: (t: AnyDb) => Promise<unknown>): Promise<boolean> => {
      try {
        await db.transaction(async (tx) => {
          await fn(tx);
        });
        return false;
      } catch {
        return true;
      }
    };
    const f1 = await refused((tx) =>
      tx.insert(senSupportGrant).values({ schoolId, studentId: foreignStudent.id, granteeUserId: G, reason: "x" }),
    );
    ok(f1, "F1: the composite (school_id,student_id) FK REFUSES a grant naming another tenant's student (GOV10-20)");
    const f2 = await refused((tx) =>
      tx.insert(senSupportGrant).values({ schoolId, studentId: "00000000-0000-0000-0000-0000000000ff", granteeUserId: G, reason: "x" }),
    );
    ok(f2, "F1': the composite FK also refuses a dangling student id (GOV10-20)");

    // Grantee-user DELETE cascades the grant (append-only revoke aside — a removed user IS a hard delete).
    let cascadeGone = false;
    try {
      await db.transaction(async (tx) => {
        await tx.delete(users).where(eq(users.id, G));
        const [{ n }] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(senSupportGrant)
          .where(and(eq(senSupportGrant.schoolId, schoolId), eq(senSupportGrant.granteeUserId, G)));
        cascadeGone = n === 0;
        throw new Rollback();
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }
    ok(cascadeGone, "F2: deleting the grantee ref_user CASCADE-deletes their grants (grantee_user_id ON DELETE CASCADE) (GOV10-21)");

    console.log("\nℹ cross-school SELECT=0 (GOV10-16/19) is proven by `pnpm db:rls-test` (sen_support_grant is auto-discovered).");
  } finally {
    // Scoped teardown — school delete CASCADES students → sen_register / sen_support_grant / adoption.
    if (schoolId) await db.delete(schools).where(eq(schools.id, schoolId)).catch(() => {});
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds)).catch(() => {});
  }

  console.log(
    `\n${failures === 0 ? "✓ ALL SEN-GRANT ROUND-TRIP ASSERTIONS PASS" : `✗ ${failures} ASSERTION(S) FAILED`}`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
