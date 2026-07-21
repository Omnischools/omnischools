import "../_loadenv";
import { and, asc, eq, like } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  schools,
  users,
  students,
  classes,
  subjects,
  seniorSubjectTeacher,
  auditLog,
  wassceCohort,
  wassceProgrammes,
  wassceSubjects,
  wassceCandidates,
  wassceCandidateSubject,
  mockExams,
  mockResults,
  benchmarkDataPoints,
  benchmarkReference,
} from "@/db/schema";
import type { WassceGrade } from "@/lib/wassce/mock-grades";

/**
 * WASSCE mock-cycle seed (SHS module 4.3 / INCR-16) — the first WASSCE WRITE increment's fixtures. Run
 * AFTER `pnpm db:seed` + `pnpm db:seed-wassce` (needs the frozen F3-2026 spine). `pnpm db:seed-wassce-mock`.
 *
 * MARKER-SCOPED + RE-RUN-SAFE (repo memory: db:seed is not idempotent): it only touches THIS school's
 * mock_exams / benchmark_data_points, the GLOBAL Chemistry benchmark_reference rows, its own F2-2027
 * cohort + `SHS-2024-*` synthetic students, and create-if-missing Chemistry gradebook subject / Form 3
 * Science class / Mr S. Asiedu. It NEVER broadens a delete beyond those markers and never touches other
 * modules' seed.
 *
 * EVERY DERIVED FIGURE FALLS OUT OF THESE ROWS (AC7/8/9 — nothing hardcoded on the surface): the 28
 * Chemistry candidates get REAL Mock 1 + Mock 2 grades so the histogram (A1 4 · B2 8 · B3 9 · C4 4 · C5
 * 2 · C6 1 = 28), the 100% credit / 43% distinction rates, the cohort mean B3, and each candidate's
 * ↑/→/↓ trajectory + predicted grade all derive. One Mock-2 row carries an HoA MODERATION (C4 → C5) so
 * the moderated-vs-original display + AC10 COALESCE is exercisable. NO aggregate / projection is computed.
 *
 * F2-2027 (2nd cohort) is seeded IN-FLIGHT (setup_frozen_at NULL) with Mock 1 scheduled
 * (marking_complete_at NULL) + candidates, so the ACTIVE-cohort selector must resolve to F3-2026 AND the
 * writable mark-entry path (AC2/AC5) is testable on F2-2027's open Mock 1.
 */

const CENTRE_CODE = "SU-0184";
// The Chemistry F3 teacher of record. We reuse the existing seeded TEACHER (Mr K. Owusu) rather than
// mint a new user, so this seed never perturbs the base-seed baseline the rls-test asserts (role_assignment
// count). The surface persona ("Mr S. Asiedu") is static display copy per Lucy §B.1.2 (cross-module HR).
const TEACHER_PHONE = "+233244000003";

// The 3 INCR-15 named Science candidates whose surface trajectory is exact (by index serial).
const NAMED_GRADES: Record<string, { m1: WassceGrade; m2: WassceGrade; raw: number; note: string }> = {
  "0891": { m1: "A1", m2: "A1", raw: 96, note: "Top of cohort. Mock 2 raw 96/100. Predicted A1." }, // E. Mensah
  "0817": { m1: "B2", m2: "A1", raw: 88, note: "Strong organic chem. Currently on medical leave." }, // Y. Aidoo
  "0823": { m1: "B2", m2: "B2", raw: 74, note: "Steady B2. Organic strong, inorganic weaker." }, // J. Tetteh
};

// The remaining 25 candidates' Mock 2 grades — completes the surface distribution (with the 3 named:
// A1 4 · B2 8 · B3 9 · C4 4 · C5 2 · C6 1 = 28). Mock 1 is one band worse (an improving cohort).
const REST_MOCK2: WassceGrade[] = [
  "A1", "A1",
  "B2", "B2", "B2", "B2", "B2", "B2", "B2",
  "B3", "B3", "B3", "B3", "B3", "B3", "B3", "B3", "B3",
  "C4", "C4", "C4", "C4",
  "C5", "C5",
  "C6",
];

const WORSEN: Record<WassceGrade, WassceGrade> = {
  A1: "B2", B2: "B3", B3: "C4", C4: "C5", C5: "C6", C6: "D7", D7: "E8", E8: "F9", F9: "F9",
};

const FIRST_M = ["Kwame", "Kofi", "Yaw", "Kwaku", "Samuel", "Daniel", "Isaac", "Michael", "Joseph", "Prince", "Eric", "Bright", "Nana"];
const FIRST_F = ["Ama", "Akua", "Abena", "Afua", "Esi", "Grace", "Comfort", "Gifty", "Vida", "Cynthia", "Rita", "Linda", "Naa"];
const LAST = ["Owusu", "Boateng", "Appiah", "Osei", "Danso", "Frimpong", "Adjei", "Amoah", "Ofori", "Sarpong", "Antwi", "Bediako"];

async function main() {
  const [school] = await db.select({ id: schools.id }).from(schools).where(eq(schools.gesCode, "WR-WAW-014"));
  if (!school) {
    console.error("✗ Asankrangwa not seeded yet — run `pnpm db:seed` first.");
    process.exit(1);
  }
  const schoolId = school.id;

  const [f3] = await db
    .select()
    .from(wassceCohort)
    .where(and(eq(wassceCohort.schoolId, schoolId), eq(wassceCohort.examYear, 2026)));
  if (!f3) {
    console.error("✗ F3-2026 cohort missing — run `pnpm db:seed-wassce` first.");
    process.exit(1);
  }

  const [sciProg] = await db
    .select()
    .from(wassceProgrammes)
    .where(and(eq(wassceProgrammes.schoolId, schoolId), eq(wassceProgrammes.programme, "GENERAL_SCIENCE")));
  const [chemSubject] = await db
    .select()
    .from(wassceSubjects)
    .where(and(eq(wassceSubjects.schoolId, schoolId), eq(wassceSubjects.name, "Chemistry")));
  if (!sciProg || !chemSubject) {
    console.error("✗ Science programme / Chemistry wassce_subject missing — run `pnpm db:seed-wassce` first.");
    process.exit(1);
  }

  const [academic] = await db.select({ id: users.id }).from(users).where(eq(users.phone, "+233244000002")); // Mrs P. Anim (HoA moderator)
  if (!academic) {
    console.error("✗ Academic co-signer missing — run `pnpm db:seed` first.");
    process.exit(1);
  }

  // ---------------- re-run-safe wipe of THIS increment's markers ONLY ----------------
  await db.delete(mockExams).where(eq(mockExams.schoolId, schoolId)); // cascades mock_results
  await db.delete(benchmarkDataPoints).where(eq(benchmarkDataPoints.schoolId, schoolId));
  await db.delete(benchmarkReference).where(eq(benchmarkReference.subjectName, "Chemistry")); // global Chemistry rows only
  await db.delete(wassceCohort).where(and(eq(wassceCohort.schoolId, schoolId), eq(wassceCohort.examYear, 2027))); // cascades F2 candidates
  await db.delete(students).where(and(eq(students.schoolId, schoolId), like(students.studentCode, "SHS-2024-%")));

  // ---------------- shared correspondence entities (create-if-missing) ----------------
  // Gradebook Chemistry subject (base seed lacks it) — the R5 seam's score-ledger side.
  await db
    .insert(subjects)
    .values({ schoolId, name: "Chemistry", code: "CHEM" })
    .onConflictDoNothing({ target: [subjects.schoolId, subjects.name] });
  const [chemGradebook] = await db
    .select()
    .from(subjects)
    .where(and(eq(subjects.schoolId, schoolId), eq(subjects.name, "Chemistry")));

  // Form 3 Science class (F3-level — the correspondence requires an F3 assignment).
  await db
    .insert(classes)
    .values({ schoolId, name: "Form 3 Science", level: "Form 3", programme: "GENERAL_SCIENCE" })
    .onConflictDoNothing({ target: [classes.schoolId, classes.name] });
  const [f3sci] = await db
    .select()
    .from(classes)
    .where(and(eq(classes.schoolId, schoolId), eq(classes.name, "Form 3 Science")));

  // The Chemistry F3 teacher of record (existing seeded TEACHER — the AC4 authz subject holder).
  const [teacher] = await db.select({ id: users.id }).from(users).where(eq(users.phone, TEACHER_PHONE));
  if (!teacher) {
    console.error("✗ Seeded TEACHER missing — run `pnpm db:seed` first.");
    process.exit(1);
  }
  // The assignment: Form 3 Science × Chemistry (gradebook) × the teacher — the R5 correspondence anchor.
  await db
    .insert(seniorSubjectTeacher)
    .values({ schoolId, classId: f3sci.id, subjectId: chemGradebook.id, teacherUserId: teacher.id })
    .onConflictDoNothing({ target: [seniorSubjectTeacher.schoolId, seniorSubjectTeacher.classId, seniorSubjectTeacher.subjectId] });

  // ---------------- F3-2026 mocks (both COMPLETE → results read-only) ----------------
  const [mock1] = await db
    .insert(mockExams)
    .values({
      schoolId,
      cohortId: f3.id,
      name: "Mock 1",
      mockNumber: 1,
      isPredictor: false,
      scheduledStart: "2025-11-03",
      scheduledEnd: "2025-11-14",
      markingCompleteAt: new Date("2025-11-28T16:00:00Z"),
    })
    .returning();
  const [mock2] = await db
    .insert(mockExams)
    .values({
      schoolId,
      cohortId: f3.id,
      name: "Mock 2 (Predictor)",
      mockNumber: 2,
      isPredictor: true, // explicit predictor (R1) — enforced one-per-cohort by the partial unique index
      scheduledStart: "2026-03-09",
      scheduledEnd: "2026-03-20",
      markingCompleteAt: new Date("2026-03-27T16:00:00Z"),
    })
    .returning();

  // The 28 Chemistry candidates: the 3 named + 25 others (by index serial) from the F3-2026 Science 60.
  const sciCandidates = await db
    .select({ id: wassceCandidates.id, indexNumber: wassceCandidates.indexNumber })
    .from(wassceCandidates)
    .where(and(eq(wassceCandidates.schoolId, schoolId), eq(wassceCandidates.programmeId, sciProg.id)))
    .orderBy(asc(wassceCandidates.indexNumber));

  const serialOf = (idx: string) => idx.replace("0184-", "");
  const named = sciCandidates.filter((c) => NAMED_GRADES[serialOf(c.indexNumber)]);
  const rest = sciCandidates.filter((c) => !NAMED_GRADES[serialOf(c.indexNumber)]).slice(0, 25);
  const cohort28 = [...named, ...rest];
  if (cohort28.length < 28) {
    console.error(`✗ Only ${cohort28.length} Science candidates found — expected ≥ 28.`);
    process.exit(1);
  }

  // One deterministic MODERATION target: the first C4 in REST_MOCK2 → moderated up to C5 (both credit,
  // neither distinction → keeps the 100% credit / 43% distinction / mean B3 derivations intact).
  const moderateAtRestIdx = REST_MOCK2.indexOf("C4");

  const mockRows: (typeof mockResults.$inferInsert)[] = [];
  named.forEach((c) => {
    const g = NAMED_GRADES[serialOf(c.indexNumber)];
    mockRows.push({ schoolId, mockId: mock1.id, candidateId: c.id, subjectId: chemSubject.id, grade: g.m1, markedByUserId: teacher.id, markedAt: new Date("2025-11-20T10:00:00Z") });
    mockRows.push({ schoolId, mockId: mock2.id, candidateId: c.id, subjectId: chemSubject.id, grade: g.m2, rawScore: g.raw.toFixed(2), maxScore: "100.00", markedByUserId: teacher.id, markedAt: new Date("2026-03-24T10:00:00Z") });
  });
  rest.forEach((c, i) => {
    const m2 = REST_MOCK2[i];
    const m1 = WORSEN[m2];
    const isModerated = i === moderateAtRestIdx;
    mockRows.push({ schoolId, mockId: mock1.id, candidateId: c.id, subjectId: chemSubject.id, grade: m1, markedByUserId: teacher.id, markedAt: new Date("2025-11-20T10:00:00Z") });
    mockRows.push({
      schoolId,
      mockId: mock2.id,
      candidateId: c.id,
      subjectId: chemSubject.id,
      grade: m2,
      markedByUserId: teacher.id,
      markedAt: new Date("2026-03-24T10:00:00Z"),
      // HoA moderation trail (R3 / AC10) — original grade preserved, moderated_grade supersedes on read.
      ...(isModerated
        ? {
            moderatedGrade: "C5" as WassceGrade,
            moderatorUserId: academic.id,
            moderatedAt: new Date("2026-03-26T14:00:00Z"),
            moderationReason: "HoA re-mark: script under-credited on stoichiometry section.",
          }
        : {}),
    });
  });
  await db.insert(mockResults).values(mockRows);

  // ---------------- F2-2027 in-flight cohort (unfrozen) + open Mock 1 (writable) ----------------
  const [f2] = await db
    .insert(wassceCohort)
    .values({ schoolId, examYear: 2027, setupFrozenAt: null }) // NULL freeze → in-flight (forces the active-cohort selector)
    .returning();

  // R53 (INCR-22b) — same defect, same fix, this file's own SHS-2024-* marker rows: an ACTIVE student
  // with no class cannot receive an attendance row at all (`attendance_record.class_id` is NOT NULL).
  await db
    .insert(classes)
    .values({ schoolId, name: "Form 2 Science", level: "Form 2", programme: "GENERAL_SCIENCE" })
    .onConflictDoNothing({ target: [classes.schoolId, classes.name] });
  const [f2sci] = await db
    .select()
    .from(classes)
    .where(and(eq(classes.schoolId, schoolId), eq(classes.name, "Form 2 Science")));

  const F2_N = 6;
  const f2Students = await db
    .insert(students)
    .values(
      Array.from({ length: F2_N }, (_, i) => {
        const sex = i % 2 === 0 ? "MALE" : "FEMALE";
        return {
          schoolId,
          studentCode: `SHS-2024-${String(4001 + i).padStart(4, "0")}`,
          firstName: (sex === "MALE" ? FIRST_M : FIRST_F)[i % FIRST_M.length],
          lastName: LAST[(i * 3) % LAST.length],
          sex: sex as "MALE" | "FEMALE",
          status: "ACTIVE" as const,
          programme: "GENERAL_SCIENCE" as const,
          enrolledOn: "2024-09-10",
          classId: f2sci.id,
          currentClassLabel: f2sci.name,
        };
      }),
    )
    .returning();
  const f2Candidates = await db
    .insert(wassceCandidates)
    .values(
      f2Students.map((st, i) => ({
        schoolId,
        cohortId: f2.id,
        studentId: st.id,
        programmeId: sciProg.id,
        indexNumber: `0184-${String(5001 + i).padStart(4, "0")}`,
        centreCode: CENTRE_CODE,
        candidateStatus: "REGISTERED" as const,
      })),
    )
    .returning();
  // Register the F2 candidates for Chemistry so the OPEN Mock 1 grid lists them for mark-entry.
  await db
    .insert(wassceCandidateSubject)
    .values(f2Candidates.map((c) => ({ schoolId, candidateId: c.id, subjectId: chemSubject.id })));

  // F2 Mock 1 — SCHEDULED, marking OPEN (marking_complete_at NULL → writable mark-entry path).
  const [f2mock1] = await db
    .insert(mockExams)
    .values({
      schoolId,
      cohortId: f2.id,
      name: "Mock 1",
      mockNumber: 1,
      isPredictor: false,
      scheduledStart: "2026-11-02",
      scheduledEnd: "2026-11-13",
      markingCompleteAt: null,
    })
    .returning();

  // ---------------- benchmarks (R4): tenant SCHOOLUP_DIRECT + global WAEC national + DIRECTIONAL region ----------------
  await db.insert(benchmarkDataPoints).values([
    { schoolId, subjectId: chemSubject.id, metric: "CREDIT_RATE", scope: "SCHOOL", value: "96.00", source: "SCHOOLUP_DIRECT", quality: "STRONG", referenceYear: 2025 },
    { schoolId, subjectId: chemSubject.id, metric: "DISTINCTION_RATE", scope: "SCHOOL", value: "31.00", source: "SCHOOLUP_DIRECT", quality: "STRONG", referenceYear: 2025 },
  ]);
  await db.insert(benchmarkReference).values([
    { subjectName: "Chemistry", region: null, metric: "CREDIT_RATE", scope: "NATIONAL", value: "71.00", source: "WAEC_NATIONAL", quality: "STRONG", referenceYear: 2024 },
    { subjectName: "Chemistry", region: null, metric: "DISTINCTION_RATE", scope: "NATIONAL", value: "19.00", source: "WAEC_NATIONAL", quality: "STRONG", referenceYear: 2024 },
    // Region ships DIRECTIONAL (±pp) — the surface renders the weak dot + "± N pp" caveat, never measured.
    { subjectName: "Chemistry", region: "Western Region", metric: "CREDIT_RATE", scope: "REGION", value: "78.00", source: "WAEC_REGIONAL_SUMMARY", quality: "DIRECTIONAL", confidenceIntervalPp: "4.00", referenceYear: 2024 },
    { subjectName: "Chemistry", region: "Western Region", metric: "DISTINCTION_RATE", scope: "REGION", value: "24.00", source: "WAEC_REGIONAL_SUMMARY", quality: "DIRECTIONAL", confidenceIntervalPp: "5.00", referenceYear: 2024 },
  ]);

  // ---------------- audit (append-only) ----------------
  await db.insert(auditLog).values({
    schoolId,
    actorUserId: teacher.id,
    actorRole: "TEACHER",
    actionType: "created",
    entityType: "mock_exam",
    entityId: mock2.id,
    afterState: {
      f3Mocks: 2,
      chemistryResults: mockRows.length,
      moderatedRows: 1,
      f2Cohort: f2.examYear,
      f2Candidates: f2Candidates.length,
      f2OpenMock: f2mock1.id,
      benchmarkTenant: 2,
      benchmarkGlobal: 4,
    },
    reason: "WASSCE INCR-16 mock cycle seed (F3-2026 complete · F2-2027 in-flight)",
  });

  console.log(
    `✓ WASSCE mock seed — F3-2026: Mock 1 + Mock 2 (predictor) complete, ${mockRows.length} Chemistry ` +
      `results over ${cohort28.length} candidates (1 moderated). F2-2027 in-flight: ${f2Candidates.length} ` +
      `candidates + open Mock 1. Benchmarks: 2 tenant + 4 global. Asiedu → Chemistry F3 assignment set.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("✗ WASSCE mock seed failed:", err);
    process.exit(1);
  });
