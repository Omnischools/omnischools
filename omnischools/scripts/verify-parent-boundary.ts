import "../db/_loadenv";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  schools,
  students,
  studentGuardians,
  users,
  wassceCohort,
  wassceProgrammes,
  wassceSubjects,
  wassceCandidates,
  wasscePapers,
  wasscePaperSittings,
  mockExams,
  mockResults,
  benchmarkDataPoints,
  waecSpecialConsideration,
  readinessStatements,
} from "@/db/schema";
import {
  loadParentChildrenTx,
  linkedSchoolIdsTx,
  resolveParentInviteTargetTx,
  stampGuardianUserId,
} from "@/lib/parent/parent-data";

/**
 * INCR-19a parent-boundary verification (AC D1-D10 · L1-L6 · C1-C7 · M1-M2). The vitest suite is
 * pure/node and cannot exercise RLS, so this runs against the dev DB in a ROLLED-BACK transaction.
 *
 * MECHANISM (mirrors scripts/rls-test.ts): the dev app role is a SUPERUSER, which bypasses RLS. To make
 * the RESTRICTIVE parent policies apply we `SET LOCAL ROLE omnischools_app` (the non-superuser app role,
 * which prod connects as) before each parent read, and set `app.current_school` + `app.current_parent_user`
 * exactly as lib/db/rls.ts `withParentScope` does. Fixture inserts + the claim-flow writes run as the
 * superuser (as the real createInvite/acceptInvite do under withSchool/withoutTenantScope). The whole
 * transaction is rolled back, so nothing persists.
 */

let failures = 0;
function ok(cond: boolean, label: string) {
  console.log(`${cond ? "✓" : "✗ FAIL"} ${label}`);
  if (!cond) failures++;
}
class Rollback extends Error {}

const APP_ROLE = sql`set local role omnischools_app`;
const RESET_ROLE = sql`reset role`;
const setSchool = (id: string) =>
  sql`select set_config('app.current_school', ${id}, true)`;
const setParent = (id: string) =>
  sql`select set_config('app.current_parent_user', ${id}, true)`;

const P_MOM = "+233555000001"; // the mother's number — on childA/B/D/E/F guardian rows AND her login
const P_DAD = "+233555000003"; // childA co-guardian (unlinked)
const P_OTHER = "+233555000002"; // childL1 guardian + otherUser login (both unlinked)
const P_CLAIM = "+233555000004";
const P_STAFF = "+233555000005";

async function main() {
  const rand = Math.random().toString(36).slice(2, 8);
  try {
    await db.transaction(async (tx) => {
      // ── Fixture (as the superuser — RLS bypassed) ──────────────────────────────────────────────
      const [{ id: schoolA }] = await tx
        .insert(schools)
        .values({ name: "Parent Boundary A", gesCode: `PBT-A-${rand}`, schoolType: "SENIOR" })
        .returning({ id: schools.id });
      const [{ id: schoolB }] = await tx
        .insert(schools)
        .values({ name: "Parent Boundary B", gesCode: `PBT-B-${rand}`, schoolType: "SENIOR" })
        .returning({ id: schools.id });

      const [{ id: parentUser }] = await tx
        .insert(users)
        .values({ phone: P_MOM, fullName: "Ama Aidoo" })
        .returning({ id: users.id });
      const [{ id: otherUser }] = await tx
        .insert(users)
        .values({ phone: P_OTHER, fullName: "Same-Phone Stranger" })
        .returning({ id: users.id });
      const [{ id: claimUser }] = await tx
        .insert(users)
        .values({ phone: P_CLAIM, fullName: "Claimer" })
        .returning({ id: users.id });
      const [{ id: staffUser }] = await tx
        .insert(users)
        .values({ phone: P_STAFF, fullName: "SC Filer" })
        .returning({ id: users.id });

      const mkStudent = async (schoolId: string, code: string, first: string) => {
        const [{ id }] = await tx
          .insert(students)
          .values({ schoolId, studentCode: code, firstName: first, lastName: "Test", sex: "FEMALE" })
          .returning({ id: students.id });
        return id;
      };
      const mkGuardian = async (
        schoolId: string,
        studentId: string,
        phone: string,
        userId: string | null,
        name = "Ama Aidoo",
      ) => {
        const [{ id }] = await tx
          .insert(studentGuardians)
          .values({ schoolId, studentId, name, phone, relationship: "MOTHER", userId })
          .returning({ id: studentGuardians.id });
        return id;
      };

      const childA = await mkStudent(schoolA, "PBT-A-001", "Yaa");
      const childB = await mkStudent(schoolA, "PBT-A-002", "Kwame");
      const childD = await mkStudent(schoolA, "PBT-A-003", "Adwoa");
      const childE = await mkStudent(schoolA, "PBT-A-004", "Kojo");
      const childF = await mkStudent(schoolA, "PBT-A-005", "Esi");
      const childL1 = await mkStudent(schoolA, "PBT-A-006", "Abena");
      const childC = await mkStudent(schoolB, "PBT-B-001", "Kofi"); // other school

      const gA = await mkGuardian(schoolA, childA, P_MOM, parentUser); // THE live link
      await mkGuardian(schoolA, childA, P_DAD, null, "Kwesi Aidoo"); // co-guardian of A, unlinked
      const gB = await mkGuardian(schoolA, childB, P_MOM, null); // same phone, other child
      await mkGuardian(schoolA, childD, P_MOM, null);
      const gE = await mkGuardian(schoolA, childE, P_MOM, null); // C4 stamp target
      const gF = await mkGuardian(schoolA, childF, P_MOM, null); // C4 must-not-stamp (same phone)
      await mkGuardian(schoolA, childL1, P_OTHER, null); // otherUser's phone, unlinked
      await mkGuardian(schoolB, childC, P_MOM, parentUser); // parent's child at ANOTHER school

      // WASSCE spine for school A.
      const [{ id: cohortA }] = await tx
        .insert(wassceCohort)
        .values({ schoolId: schoolA, examYear: 2099 })
        .returning({ id: wassceCohort.id });
      const [{ id: progA }] = await tx
        .insert(wassceProgrammes)
        .values({ schoolId: schoolA, programme: "GENERAL_SCIENCE", name: "General Science" })
        .returning({ id: wassceProgrammes.id });
      const [{ id: subjA }] = await tx
        .insert(wassceSubjects)
        .values({ schoolId: schoolA, programmeId: progA, name: "Chemistry", subjectType: "ELECTIVE" })
        .returning({ id: wassceSubjects.id });

      const mkCandidate = async (studentId: string, index: string, regFlag?: "FEE", note?: string) => {
        const [{ id }] = await tx
          .insert(wassceCandidates)
          .values({
            schoolId: schoolA,
            cohortId: cohortA,
            studentId,
            programmeId: progA,
            indexNumber: index,
            centreCode: "PBT-A",
            regFlag: regFlag ?? null,
            note: note ?? null,
          })
          .returning({ id: wassceCandidates.id });
        return id;
      };
      const candA = await mkCandidate(childA, "PBT-0001", "FEE", "SECRET_CANDIDATE_NOTE");
      const candB = await mkCandidate(childB, "PBT-0002"); // D1 — another candidate

      const [{ id: paperA }] = await tx
        .insert(wasscePapers)
        .values({ schoolId: schoolA, cohortId: cohortA, subjectId: subjA, name: "Chemistry 2 (Essay)", paperType: "ESSAY" })
        .returning({ id: wasscePapers.id });
      await tx.insert(wasscePaperSittings).values({ schoolId: schoolA, candidateId: candA, paperId: paperA });

      const [{ id: mockA }] = await tx
        .insert(mockExams)
        .values({ schoolId: schoolA, cohortId: cohortA, name: "Mock 2", mockNumber: 2, isPredictor: false })
        .returning({ id: mockExams.id });
      await tx.insert(mockResults).values({ schoolId: schoolA, mockId: mockA, candidateId: candA, subjectId: subjA, grade: "B2" });

      // readiness — insert the SUPERSEDED row first, then the CURRENT (superseded_at IS NULL) row.
      const [{ id: stmtSuperseded }] = await tx
        .insert(readinessStatements)
        .values({
          schoolId: schoolA,
          candidateId: candA,
          mock2Id: mockA,
          projectedAggregate: 20,
          projectedBand: "Old projection",
          projectionSnapshotJson: { superseded: true },
          generatedAt: new Date(Date.now() - 86400_000),
          supersededAt: new Date(),
        })
        .returning({ id: readinessStatements.id });
      const [{ id: stmtCurrent }] = await tx
        .insert(readinessStatements)
        .values({
          schoolId: schoolA,
          candidateId: candA,
          mock2Id: mockA,
          projectedAggregate: 12,
          projectedBand: "Current projection",
          projectionSnapshotJson: { mock2Aggregate: 14, projectedAggregate: 12, band: "current" },
          generatedAt: new Date(),
        })
        .returning({ id: readinessStatements.id });

      await tx.insert(waecSpecialConsideration).values({
        schoolId: schoolA,
        candidateId: candA,
        scForm: "SC-12",
        status: "FILED",
        filedAt: new Date(),
        filedByUserId: staffUser,
        waecRef: "WAEC-REF-1",
        notes: "SECRET_STAFF_NOTE_XYZ",
      });
      await tx.insert(waecSpecialConsideration).values({
        schoolId: schoolA,
        candidateId: candA,
        scForm: "SC-3",
        status: "DRAFT",
        notes: "DRAFT_NOT_YET_FILED",
      });

      await tx.insert(benchmarkDataPoints).values({
        schoolId: schoolA,
        metric: "CREDIT_RATE",
        scope: "SCHOOL",
        value: "68.50",
        source: "SCHOOLUP_DIRECT",
        quality: "STRONG",
        referenceYear: 2025,
      });

      console.log("\n── AC M1/M2 — multi-school signal (identity metadata, no PII) ──");
      const schoolIds = await linkedSchoolIdsTx(tx, parentUser);
      ok(schoolIds.length === 2 && schoolIds.includes(schoolA) && schoolIds.includes(schoolB), "M2: parentUser holds live guardian links at exactly 2 schools");
      ok(schoolIds.some((s) => s !== schoolA), "M2: hasChildrenAtOtherSchools is TRUE for active school A");
      ok((await linkedSchoolIdsTx(tx, otherUser)).length === 0, "M2: a same-phone user with no link → 0 schools");

      console.log("\n── AC C2 — invite destination is the STORED guardian number ──");
      const tA = await resolveParentInviteTargetTx(tx, schoolA, childA, gA);
      ok(tA?.phone === P_MOM, "C2: destination for childA/gA is the stored number, never a request phone");
      const tB = await resolveParentInviteTargetTx(tx, schoolA, childB, gB);
      ok(tB?.phone === P_MOM, "C2: destination is read from the guardian row for childB/gB too");
      ok((await resolveParentInviteTargetTx(tx, schoolA, childA, gB)) === null, "C2: a guardian row that is not on (school, childA) is rejected");

      console.log("\n── AC C4 — a claim stamps EXACTLY the named guardian row ──");
      const stamped = await stampGuardianUserId(tx, { schoolId: schoolA, studentId: childE, phone: P_MOM, userId: claimUser });
      ok(stamped === 1, "C4: exactly ONE row stamped for (schoolA, childE, P_MOM)");
      const gEafter = await tx.select({ u: studentGuardians.userId }).from(studentGuardians).where(eq(studentGuardians.id, gE));
      const gFafter = await tx.select({ u: studentGuardians.userId }).from(studentGuardians).where(eq(studentGuardians.id, gF));
      const gAafter = await tx.select({ u: studentGuardians.userId }).from(studentGuardians).where(eq(studentGuardians.id, gA));
      ok(gEafter[0].u === claimUser, "C4: childE's guardian row is stamped");
      ok(gFafter[0].u === null, "C4: childF's SAME-PHONE row (other child) is NOT stamped");
      ok(gAafter[0].u === parentUser, "C4: childA's SAME-PHONE row (other child) is untouched");

      // ── Parent-scoped reads (drop to the non-superuser role so the RESTRICTIVE policies apply) ──
      await tx.execute(APP_ROLE);
      await tx.execute(setSchool(schoolA));
      await tx.execute(setParent(parentUser));

      const nStudents = async () => (await tx.select({ id: students.id }).from(students)).length;
      const nGuardians = async () => (await tx.select({ id: studentGuardians.id }).from(studentGuardians)).length;

      console.log("\n── parent = Ama @ school A · positive controls + denials ──");
      const kids = await loadParentChildrenTx(tx, schoolA, parentUser);
      ok(kids.length === 1 && kids[0].id === childA, "L2/L3: entitled set is EXACTLY {childA} — one claimed row → one child");
      ok(kids.every((k) => k.id !== childC), "M1: childC (school B) is NOT in the active school's set (never a union)");
      ok(!!kids[0]?.candidate && kids[0].candidate.indexNumber === "PBT-0001", "positive: the child's OWN candidate is visible");

      ok((await nStudents()) === 1, "positive: exactly 1 student row visible (childA)");
      ok((await nGuardians()) === 1, "own-guardian-only: co-guardian of childA (P_DAD) is NOT visible");

      const visibleCands = await tx.select({ id: wassceCandidates.id }).from(wassceCandidates);
      ok(visibleCands.length === 1 && visibleCands[0].id === candA, "D1: only childA's candidate visible — candidateB → 0");
      void candB;

      ok((await tx.select({ id: benchmarkDataPoints.id }).from(benchmarkDataPoints)).length === 0, "D2: benchmark_data_points (cohort aggregates) → 0");
      ok((await tx.select({ id: mockResults.id }).from(mockResults)).length === 0, "D3: mock_results → 0 even for the OWN child (grades only via the frozen snapshot)");

      const visStmts = await tx.select({ id: readinessStatements.id }).from(readinessStatements);
      ok(visStmts.length === 1 && visStmts[0].id === stmtCurrent, "D4: only the CURRENT readiness statement visible");
      ok(!visStmts.some((s) => s.id === stmtSuperseded), "D4: the SUPERSEDED statement → 0");

      ok((await tx.select({ id: wasscePaperSittings.id }).from(wasscePaperSittings)).length === 1, "positive: childA's own paper sitting is visible");

      // D8/D9 — RLS is row-level and cannot mask columns; the loader redacts staff-only columns.
      const payload = JSON.stringify(kids);
      const scs = kids[0].candidate!.specialConsiderations;
      ok(scs.length === 1 && scs[0].waecRef === "WAEC-REF-1", "D8: only the FILED SC row surfaces (DRAFT SC-3 hidden), public fields only");
      ok(!("notes" in (scs[0] as object)) && !("filedByUserId" in (scs[0] as object)), "D8: SC payload has NO notes / filed_by_user_id keys");
      ok(!payload.includes("SECRET_STAFF_NOTE"), "D8: the staff SC note never reaches the parent payload");
      const rawSc = await tx.select({ notes: waecSpecialConsideration.notes }).from(waecSpecialConsideration).where(and(eq(waecSpecialConsideration.candidateId, candA), eq(waecSpecialConsideration.scForm, "SC-12")));
      ok(rawSc[0]?.notes === "SECRET_STAFF_NOTE_XYZ", "D8: (proof) the SC ROW is reachable — redaction is column-level in the loader, not a row denial");
      ok(!("regFlag" in (kids[0].candidate as object)) && !payload.includes("SECRET_CANDIDATE_NOTE"), "D9: reg_flag / candidate free-text note are NOT in the parent payload");
      const rawFlag = await tx.select({ f: wassceCandidates.regFlag }).from(wassceCandidates).where(eq(wassceCandidates.id, candA));
      ok(rawFlag[0]?.f === "FEE", "D9: (proof) reg_flag='FEE' exists on the reachable row — the loader omits the column");

      console.log("\n── AC L1 — phone equality confers NOTHING ──");
      await tx.execute(setParent(otherUser));
      ok((await nStudents()) === 0, "L1: otherUser (phone matches guardian rows, user_id IS NULL) sees 0 students");
      ok((await loadParentChildrenTx(tx, schoolA, otherUser)).length === 0, "L1: loader returns no children for the unlinked same-phone user");

      console.log("\n── AC L4 — deleting the guardian link revokes access in the same statement ──");
      await tx.execute(RESET_ROLE);
      await tx.delete(studentGuardians).where(eq(studentGuardians.id, gA));
      await tx.execute(APP_ROLE);
      await tx.execute(setSchool(schoolA));
      await tx.execute(setParent(parentUser));
      ok((await nStudents()) === 0, "L4: after the guardian row is deleted, the next read returns 0 (immediate revocation)");
      ok((await loadParentChildrenTx(tx, schoolA, parentUser)).length === 0, "L4: loader returns no children post-revocation");

      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }

  console.log(`\n${failures === 0 ? "✓ ALL PARENT-BOUNDARY ASSERTIONS PASS" : `✗ ${failures} ASSERTION(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
