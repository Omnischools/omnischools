import "../_loadenv";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  schools,
  users,
  auditLog,
  wassceCohort,
  wassceProgrammes,
  wassceSubjects,
  wassceCandidates,
  mockExams,
  mockResults,
  waecSpecialConsideration,
  readinessStatements,
} from "@/db/schema";
import {
  projectAggregate,
  type ProjectionSubjectInput,
  type WassceSubjectType,
  type ProjectionSnapshot,
} from "@/lib/wassce/projection";
import type { WassceGrade } from "@/lib/wassce/mock-grades";

/**
 * WASSCE readiness seed (SHS module 4.3 / INCR-17) — makes the projection fixtures REAL. Run AFTER
 * `pnpm db:seed` + `db:seed-wassce` + `db:seed-wassce-mock`. `pnpm db:seed-wassce-readiness`.
 *
 * MARKER-SCOPED + RE-RUN-SAFE (repo memory: db:seed is not idempotent): it wipes only THIS school's
 * INCR-17-owned rows (readiness_statements, waec_special_consideration — tables nothing else writes) and
 * UPSERTs a handful of supplementary Mock-1/Mock-2 grades for three named Science candidates (the INCR-16
 * seed only marked Chemistry). It never broadens a delete beyond those markers and never touches other
 * modules' seed.
 *
 * THE CANONICAL FIXTURE (Kofi AC1): Y. Aidoo's predictor grades yield aggregate 10 — cores {IntSci A1,
 * Math B2, Eng B3} counted, Social B3 dropped (tie with Eng, "English Language" < "Social Studies");
 * electives {Bio A1, Chem A1, Phys B2} counted, ElecMath C4 dropped. The seed ASSERTS 10 and fails loudly
 * otherwise. It also generates statements for E. Mensah + J. Tetteh, files SC-12/SC-7/SC-3, and records a
 * school-captured (IN_PERSON) parent acknowledgement on Y. Aidoo.
 */

const SUBJECTS: { name: string; type: WassceSubjectType }[] = [
  { name: "English Language", type: "CORE" },
  { name: "Mathematics (Core)", type: "CORE" },
  { name: "Integrated Science", type: "CORE" },
  { name: "Social Studies", type: "CORE" },
  { name: "Biology", type: "ELECTIVE" },
  { name: "Chemistry", type: "ELECTIVE" },
  { name: "Physics", type: "ELECTIVE" },
  { name: "Elective Mathematics", type: "ELECTIVE" },
];

type GradePair = { m1: WassceGrade; m2: WassceGrade };
type GradeMap = Record<string, GradePair>;

// Full 8-subject Mock-1/Mock-2 grades. Chemistry matches the INCR-16 mock seed exactly (Aidoo B2→A1,
// Mensah A1→A1, Tetteh B2→B2) so the projection is consistent whether read from DB or from this map.
const AIDOO: GradeMap = {
  "English Language": { m1: "C4", m2: "B3" }, // held from Mock 2 through the SC-12 (projected)
  "Mathematics (Core)": { m1: "B3", m2: "B2" },
  "Integrated Science": { m1: "B2", m2: "A1" },
  "Social Studies": { m1: "C4", m2: "B3" },
  Biology: { m1: "B2", m2: "A1" },
  Chemistry: { m1: "B2", m2: "A1" },
  Physics: { m1: "B3", m2: "B2" },
  "Elective Mathematics": { m1: "C5", m2: "C4" },
};
const MENSAH: GradeMap = {
  "English Language": { m1: "B3", m2: "B2" },
  "Mathematics (Core)": { m1: "B2", m2: "A1" },
  "Integrated Science": { m1: "B2", m2: "A1" },
  "Social Studies": { m1: "B3", m2: "B2" },
  Biology: { m1: "B2", m2: "A1" },
  Chemistry: { m1: "A1", m2: "A1" },
  Physics: { m1: "B3", m2: "B2" },
  "Elective Mathematics": { m1: "B3", m2: "B2" },
};
const TETTEH: GradeMap = {
  "English Language": { m1: "C4", m2: "B3" },
  "Mathematics (Core)": { m1: "C4", m2: "B3" },
  "Integrated Science": { m1: "B3", m2: "B2" },
  "Social Studies": { m1: "C5", m2: "C4" },
  Biology: { m1: "C4", m2: "B3" },
  Chemistry: { m1: "B2", m2: "B2" },
  Physics: { m1: "C4", m2: "B3" },
  "Elective Mathematics": { m1: "C5", m2: "C4" },
};

function projectFor(map: GradeMap, which: "m1" | "m2") {
  const input: ProjectionSubjectInput[] = SUBJECTS.map((s) => ({
    name: s.name,
    type: s.type,
    grade: map[s.name][which],
  }));
  return projectAggregate(input);
}

function snapshotFor(map: GradeMap): { aggregate: number; band: string; snapshot: ProjectionSnapshot } {
  const m2 = projectFor(map, "m2");
  const m1 = projectFor(map, "m1");
  if (!m2.computable) throw new Error("predictor projection not computable for a seed candidate");
  return {
    aggregate: m2.aggregate,
    band: m2.band,
    snapshot: {
      mock1Aggregate: m1.computable ? m1.aggregate : null,
      mock2Aggregate: m2.aggregate,
      projectedAggregate: m2.aggregate,
      band: m2.band,
      subjects: m2.subjects.map((s) => ({
        name: s.name,
        type: s.type,
        grade: s.grade,
        points: s.points,
        counted: s.counted,
      })),
    },
  };
}

async function main() {
  const [school] = await db.select({ id: schools.id }).from(schools).where(eq(schools.gesCode, "WR-WAW-014"));
  if (!school) {
    console.error("✗ Asankrangwa not seeded — run `pnpm db:seed` first.");
    process.exit(1);
  }
  const schoolId = school.id;

  const [f3] = await db
    .select()
    .from(wassceCohort)
    .where(and(eq(wassceCohort.schoolId, schoolId), eq(wassceCohort.examYear, 2026)));
  const [sciProg] = await db
    .select()
    .from(wassceProgrammes)
    .where(and(eq(wassceProgrammes.schoolId, schoolId), eq(wassceProgrammes.programme, "GENERAL_SCIENCE")));
  if (!f3 || !sciProg) {
    console.error("✗ F3-2026 cohort / Science programme missing — run `db:seed-wassce` first.");
    process.exit(1);
  }

  const mocks = await db
    .select()
    .from(mockExams)
    .where(and(eq(mockExams.schoolId, schoolId), eq(mockExams.cohortId, f3.id)));
  const mock1 = mocks.find((m) => !m.isPredictor);
  const mock2 = mocks.find((m) => m.isPredictor);
  if (!mock1 || !mock2) {
    console.error("✗ F3-2026 Mock 1 / predictor missing — run `db:seed-wassce-mock` first.");
    process.exit(1);
  }
  if (mock2.markingCompleteAt == null) {
    console.error("✗ Predictor mock marking is not complete — cannot freeze a statement.");
    process.exit(1);
  }

  const sciSubjects = await db
    .select({ id: wassceSubjects.id, name: wassceSubjects.name })
    .from(wassceSubjects)
    .where(and(eq(wassceSubjects.schoolId, schoolId), eq(wassceSubjects.programmeId, sciProg.id)));
  const subjectIdByName = new Map(sciSubjects.map((s) => [s.name, s.id]));

  const [teacher] = await db.select({ id: users.id }).from(users).where(eq(users.phone, "+233244000003"));
  const [academic] = await db.select({ id: users.id }).from(users).where(eq(users.phone, "+233244000002")); // HoA
  if (!teacher || !academic) {
    console.error("✗ Seeded teacher / HoA user missing — run `pnpm db:seed` first.");
    process.exit(1);
  }

  const candBySerial = new Map<string, string>();
  const wanted = ["0817", "0891", "0905", "0823"];
  for (const serial of wanted) {
    const [c] = await db
      .select({ id: wassceCandidates.id })
      .from(wassceCandidates)
      .where(and(eq(wassceCandidates.schoolId, schoolId), eq(wassceCandidates.indexNumber, `0184-${serial}`)));
    if (c) candBySerial.set(serial, c.id);
  }
  const aidoo = candBySerial.get("0817");
  const mensah = candBySerial.get("0891");
  const tetteh = candBySerial.get("0823");
  const mensa = candBySerial.get("0905");
  if (!aidoo || !mensah || !tetteh || !mensa) {
    console.error("✗ Expected named candidates (0817/0891/0905/0823) missing — run `db:seed-wassce` first.");
    process.exit(1);
  }

  // ---------- re-run-safe wipe of INCR-17-owned rows (this school only) ----------
  await db.delete(readinessStatements).where(eq(readinessStatements.schoolId, schoolId));
  await db.delete(waecSpecialConsideration).where(eq(waecSpecialConsideration.schoolId, schoolId));

  // ---------- upsert supplementary Mock-1/Mock-2 grades (7 non-Chemistry subjects) ----------
  const upsertGrades = async (candidateId: string, map: GradeMap) => {
    for (const s of SUBJECTS) {
      if (s.name === "Chemistry") continue; // INCR-16 owns Chemistry — never perturb it
      const subjectId = subjectIdByName.get(s.name);
      if (!subjectId) throw new Error(`missing wassce_subject: ${s.name}`);
      for (const [mockId, grade, markedAt] of [
        [mock1.id, map[s.name].m1, new Date("2025-11-20T10:00:00Z")] as const,
        [mock2.id, map[s.name].m2, new Date("2026-03-24T10:00:00Z")] as const,
      ]) {
        await db
          .insert(mockResults)
          .values({ schoolId, mockId, candidateId, subjectId, grade, markedByUserId: teacher.id, markedAt })
          .onConflictDoUpdate({
            target: [mockResults.schoolId, mockResults.mockId, mockResults.candidateId, mockResults.subjectId],
            set: { grade, markedByUserId: teacher.id, markedAt },
          });
      }
    }
  };
  await upsertGrades(aidoo, AIDOO);
  await upsertGrades(mensah, MENSAH);
  await upsertGrades(tetteh, TETTEH);

  // ---------- freeze readiness statements (projection run ONCE, snapshot frozen) ----------
  const generate = async (candidateId: string, map: GradeMap, ack: boolean) => {
    const { aggregate, band, snapshot } = snapshotFor(map);
    const [row] = await db
      .insert(readinessStatements)
      .values({
        schoolId,
        candidateId,
        mock2Id: mock2.id,
        projectedAggregate: aggregate,
        projectedBand: band,
        projectionSnapshotJson: snapshot,
        targetUniversitiesJson: null, // INCR-17b — no university leak
        generatedAt: new Date("2026-03-28T09:00:00Z"),
        generatedByUserId: academic.id,
        ...(ack
          ? {
              parentAcknowledgedAt: new Date("2026-03-28T14:30:00Z"),
              parentAcknowledgedSignatureMethod: "IN_PERSON" as const,
              parentAcknowledgedPhone: "+233201234567",
              parentConcernsText: "Agreed with the projection; asked about commute distance to campus.",
            }
          : {}),
      })
      .returning({ id: readinessStatements.id, aggregate: readinessStatements.projectedAggregate });
    return { id: row.id, aggregate };
  };

  const aidooStmt = await generate(aidoo, AIDOO, true); // Y. Aidoo — parent-ack captured (IN_PERSON)
  await generate(mensah, MENSAH, false);
  await generate(tetteh, TETTEH, false);

  // THE fixture assertion — Y. Aidoo MUST project to 10, or the seed is wrong.
  if (aidooStmt.aggregate !== 10) {
    console.error(`✗ Y. Aidoo projected ${aidooStmt.aggregate}, expected 10 — fix the seed grades.`);
    process.exit(1);
  }

  // ---------- file SC forms (SC-12 medical · SC-7 chronic · SC-3 sensory) ----------
  await db.insert(waecSpecialConsideration).values([
    {
      schoolId,
      candidateId: aidoo,
      scForm: "SC-12",
      status: "ACKNOWLEDGED",
      filedAt: new Date("2026-05-14T11:00:00Z"),
      filedByUserId: academic.id,
      waecAcknowledgedAt: new Date("2026-05-14T11:32:00Z"),
      waecRef: "SC-12-184-2026-0044",
      notes: "Inpatient · severe malaria · missed the English papers; make-up sitting pending discharge.",
    },
    {
      schoolId,
      candidateId: mensah,
      scForm: "SC-7",
      status: "APPROVED",
      filedAt: new Date("2025-11-10T09:00:00Z"),
      filedByUserId: academic.id,
      waecAcknowledgedAt: new Date("2025-11-18T09:00:00Z"),
      approvedAt: new Date("2026-01-15T09:00:00Z"),
      waecRef: "SC-7-184-2025-0012",
      notes: "Chronic condition (sickle cell) · extra 15 minutes if needed.",
    },
    {
      schoolId,
      candidateId: mensa,
      scForm: "SC-3",
      status: "APPROVED",
      filedAt: new Date("2025-11-10T09:00:00Z"),
      filedByUserId: academic.id,
      waecAcknowledgedAt: new Date("2025-11-18T09:00:00Z"),
      approvedAt: new Date("2026-01-15T09:00:00Z"),
      waecRef: "SC-3-184-2025-0007",
      notes: "Sensory accommodation (visual) · 1.5× time.",
    },
  ]);

  await db.insert(auditLog).values({
    schoolId,
    actorUserId: academic.id,
    actorRole: "VICE_HEADMASTER_ACADEMIC",
    actionType: "created",
    entityType: "readiness_statement",
    entityId: aidooStmt.id,
    afterState: {
      statements: 3,
      aidooAggregate: aidooStmt.aggregate,
      scForms: 3,
      parentAcks: 1,
    },
    reason: "WASSCE INCR-17 readiness seed (3 statements · Y. Aidoo=10 · 3 SC forms · 1 parent-ack)",
  });

  console.log(
    `✓ WASSCE readiness seed — 3 readiness statements frozen (Y. Aidoo agg ${aidooStmt.aggregate}, E. Mensah, J. Tetteh), ` +
      `3 SC forms (SC-12/SC-7/SC-3), 1 parent-ack (IN_PERSON). Supplementary Mock 1/2 grades upserted.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("✗ WASSCE readiness seed failed:", err);
    process.exit(1);
  });
