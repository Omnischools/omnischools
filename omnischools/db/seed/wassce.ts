import "../_loadenv";
import { and, eq, like } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  schools,
  users,
  students,
  auditLog,
  wassceCohort,
  wassceProgrammes,
  wassceSubjects,
  wassceCandidates,
  wassceCandidateSubject,
  wasscePapers,
  wasscePaperSittings,
} from "@/db/schema";
import type { WassceProgrammeKey } from "@/lib/wassce/constants";

/**
 * WASSCE-2026 F3 cohort seed (SHS module 4.3 / INCR-15) — the ALREADY-FROZEN spine that the
 * read-only setup surface renders. MARKER-SCOPED + RE-RUN-SAFE (repo memory: db:seed is not
 * idempotent): it only ever touches THIS school's `wassce_*` spine (tables nothing else writes) and
 * its own `SHS-2023-*` synthetic F3 students. It never broadens a delete beyond those markers and
 * never touches academic_period / other modules. Run AFTER `pnpm db:seed`. `pnpm db:seed-wassce`.
 *
 * EVERY DISPLAYED COUNT DERIVES FROM THESE ROWS (Kofi AC-B/C — nothing hardcoded on the surface):
 * 240 candidates (Sci 60 · Bus 60 · Arts 80 · Home Ec 40) → tiles Confirmed 237/240 · Flagged 3 ·
 * Accommodations 4 (2 chronic · 1 sight · 1 hearing) · fees GHS 336k (240 × GHS 1,400). The 9 named
 * surface rows are specific candidates; P. Donkor owes GHS 240 yet stays REGISTERED/Confirmed (fee is
 * display-only, K3), Y. Aidoo `0184-0817` is `ON_MEDICAL` with an SC-12 accommodation (no sickbay/SC
 * write). Freeze is co-signed by the seeded HEADMASTER + VICE_HEADMASTER_ACADEMIC (distinct — the
 * two same-row CHECKs enforce it). NO projection: `mock_2_aggregate` is a seeded literal (K4),
 * `projected_aggregate` stays NULL, no tier is computed.
 */

const CENTRE_CODE = "SU-0184";
const EXAM_YEAR = 2026;

type SubjectType = "CORE" | "ELECTIVE" | "OPTIONAL";
type FlagValue = "ON_MEDICAL" | "NHIS_ISSUE" | "FEE" | null;
type Accommodation = { type: "chronic" | "sight" | "hearing" | "medical"; scForm: string; detail?: string };

const CORES: { name: string; type: SubjectType }[] = [
  { name: "English Language", type: "CORE" },
  { name: "Mathematics (Core)", type: "CORE" },
  { name: "Integrated Science", type: "CORE" },
  { name: "Social Studies", type: "CORE" },
];

// Per-programme subjects (surface §1.4). Cores repeat under every programme (Kofi K1 — per-programme
// rows, no subject-master). OPTIONAL = the "Alt"/"(or)" alternatives.
const PROGRAMME_SUBJECTS: Record<WassceProgrammeKey, { name: string; type: SubjectType }[]> = {
  GENERAL_SCIENCE: [
    ...CORES,
    { name: "Chemistry", type: "ELECTIVE" },
    { name: "Physics", type: "ELECTIVE" },
    { name: "Biology", type: "ELECTIVE" },
    { name: "Elective Mathematics", type: "ELECTIVE" },
  ],
  BUSINESS: [
    ...CORES,
    { name: "Financial Accounting", type: "ELECTIVE" },
    { name: "Cost Accounting", type: "ELECTIVE" },
    { name: "Business Management", type: "ELECTIVE" },
    { name: "Economics", type: "ELECTIVE" },
    { name: "Elective Mathematics", type: "OPTIONAL" },
  ],
  GENERAL_ARTS: [
    ...CORES,
    { name: "Literature in English", type: "ELECTIVE" },
    { name: "Geography", type: "ELECTIVE" },
    { name: "Government", type: "ELECTIVE" },
    { name: "Economics", type: "ELECTIVE" },
    { name: "History", type: "OPTIONAL" },
    { name: "Christian Religious Studies", type: "OPTIONAL" },
    { name: "French", type: "OPTIONAL" },
  ],
  HOME_ECONOMICS: [
    ...CORES,
    { name: "Management in Living", type: "ELECTIVE" },
    { name: "Food and Nutrition", type: "ELECTIVE" },
    { name: "Clothing and Textiles", type: "ELECTIVE" },
    { name: "Biology", type: "OPTIONAL" },
    { name: "General Knowledge in Art", type: "OPTIONAL" },
  ],
};

const PROGRAMME_META: { key: WassceProgrammeKey; name: string; target: number }[] = [
  { key: "GENERAL_SCIENCE", name: "General Science", target: 60 },
  { key: "BUSINESS", name: "Business", target: 60 },
  { key: "GENERAL_ARTS", name: "General Arts", target: 80 },
  { key: "HOME_ECONOMICS", name: "Home Economics", target: 40 },
];

type CandidateSpec = {
  serial: string; // "0817"
  first: string;
  last: string;
  sex: "MALE" | "FEMALE";
  programmeKey: WassceProgrammeKey;
  flag: FlagValue;
  accommodation: Accommodation | null;
  note: string | null; // "‖" splits the leading bold segment from the rest
  mock2: number; // 6..54 seeded literal (K4)
};

// The 9 named surface rows (§4.5) — exact copy. "‖" marks the surface's bold-prefix boundary.
const NAMED: CandidateSpec[] = [
  { serial: "0817", first: "Yaa", last: "Aidoo", sex: "FEMALE", programmeKey: "GENERAL_SCIENCE", flag: "ON_MEDICAL", accommodation: { type: "medical", scForm: "SC-12" }, note: "Inpatient · severe malaria‖· Asankrangwa Govt Hospital · matron escorting · medical cert pending", mock2: 10 },
  { serial: "0823", first: "John", last: "Tetteh", sex: "MALE", programmeKey: "GENERAL_SCIENCE", flag: null, accommodation: null, note: "Sitting today's English 2 · no flags", mock2: 14 },
  { serial: "0841", first: "Francis", last: "Boakye", sex: "MALE", programmeKey: "BUSINESS", flag: null, accommodation: null, note: "Sitting today · no flags", mock2: 16 },
  { serial: "0852", first: "Sarah", last: "Asante", sex: "FEMALE", programmeKey: "BUSINESS", flag: "NHIS_ISSUE", accommodation: null, note: "NHIS card expired Apr‖· doesn't affect WASSCE writing · bursar SMS sent", mock2: 19 },
  { serial: "0860", first: "Faustina", last: "Tetteh", sex: "FEMALE", programmeKey: "BUSINESS", flag: null, accommodation: null, note: "Sick Bay Prefect · assisting matron mornings · no exam conflict", mock2: 15 },
  { serial: "0879", first: "Adwoa", last: "Quartey", sex: "FEMALE", programmeKey: "GENERAL_ARTS", flag: null, accommodation: null, note: "Pastoral · VLC flag‖· Dean co-monitoring · no exam exemption", mock2: 22 },
  { serial: "0891", first: "Emmanuel", last: "Mensah", sex: "MALE", programmeKey: "GENERAL_SCIENCE", flag: null, accommodation: { type: "chronic", scForm: "SC-7", detail: "sickle cell · extra 15 min" }, note: "Chronic accommodation‖· sickle cell · extra 15 min if needed · WAEC SC-7 filed Nov", mock2: 9 },
  { serial: "0905", first: "Kwabena", last: "Mensa", sex: "MALE", programmeKey: "GENERAL_ARTS", flag: null, accommodation: { type: "sight", scForm: "SC-3", detail: "1.5× time" }, note: "Visual accommodation‖· 1.5× time · WAEC SC-3 approved Jan", mock2: 17 },
  { serial: "0918", first: "Patience", last: "Donkor", sex: "FEMALE", programmeKey: "HOME_ECONOMICS", flag: "FEE", accommodation: null, note: "Late Free-SHS reconciliation‖· GHS 240 outstanding · bursar working with GES district", mock2: 21 },
];

const FIRST_M = ["Kwame","Kofi","Yaw","Kwaku","Kojo","Ekow","Fiifi","Kwesi","Samuel","Daniel","Isaac","Michael","Joseph","Richard","Prince","Bright","Eric","Nana","Elvis","Bernard"];
const FIRST_F = ["Ama","Akua","Abena","Afua","Akosua","Esi","Efua","Aba","Grace","Comfort","Gifty","Vida","Doris","Cynthia","Rita","Linda","Naa","Priscilla","Belinda","Mavis"];
const LAST = ["Owusu","Boateng","Agyeman","Appiah","Osei","Danso","Frimpong","Kissi","Adjei","Amoah","Baah","Ofori","Sarpong","Gyasi","Antwi","Bediako","Nkrumah","Acheampong","Quaye","Bonsu","Yeboah","Nyarko","Addo","Darko","Asiedu"];

async function main() {
  const [school] = await db
    .select({ id: schools.id })
    .from(schools)
    .where(eq(schools.gesCode, "WR-WAW-014"));
  if (!school) {
    console.error("✗ Asankrangwa not seeded yet — run `pnpm db:seed` first.");
    process.exit(1);
  }
  const schoolId = school.id;

  const [headmaster] = await db.select({ id: users.id }).from(users).where(eq(users.phone, "+233244000001")); // V. Yanney (HEADMASTER)
  const [academic] = await db.select({ id: users.id }).from(users).where(eq(users.phone, "+233244000002")); // Mrs P. Anim (VICE_HEADMASTER_ACADEMIC)
  if (!headmaster || !academic) {
    console.error("✗ Co-sign users missing — run `pnpm db:seed` first.");
    process.exit(1);
  }

  // --- re-run-safe wipe of THIS school's WASSCE spine + its synthetic F3 students only ---
  await db.delete(wassceCohort).where(eq(wassceCohort.schoolId, schoolId)); // cascades candidates, papers, joins, sittings
  await db.delete(wassceProgrammes).where(eq(wassceProgrammes.schoolId, schoolId)); // cascades subjects
  await db.delete(students).where(and(eq(students.schoolId, schoolId), like(students.studentCode, "SHS-2023-%")));

  // --- 1) the cohort, already FROZEN with two distinct co-signs (the CHECKs enforce both) ---
  const cosignAt = new Date("2026-02-14T16:00:00Z"); // WAEC export day
  const [cohort] = await db
    .insert(wassceCohort)
    .values({
      schoolId,
      examYear: EXAM_YEAR,
      setupFrozenAt: cosignAt,
      headmasterCosignUserId: headmaster.id,
      headmasterCosignAt: cosignAt,
      academicCosignUserId: academic.id,
      academicCosignAt: new Date("2026-02-14T15:30:00Z"), // HoA proposes → HM ratifies (UX default)
    })
    .returning();

  // --- 2) programmes ---
  const programmeRows = await db
    .insert(wassceProgrammes)
    .values(PROGRAMME_META.map((p) => ({ schoolId, programme: p.key, name: p.name })))
    .returning();
  const progIdByKey = new Map(programmeRows.map((r) => [r.programme as WassceProgrammeKey, r.id]));

  // --- 3) subjects — incremental createdAt so the loader's order matches the surface §1.4 order ---
  const subjectBase = Date.parse("2026-01-10T08:00:00Z");
  let subjIdx = 0;
  const subjectValues = PROGRAMME_META.flatMap((p) =>
    PROGRAMME_SUBJECTS[p.key].map((s) => ({
      schoolId,
      programmeId: progIdByKey.get(p.key)!,
      name: s.name,
      subjectType: s.type,
      createdAt: new Date(subjectBase + subjIdx++ * 1000),
    })),
  );
  const subjectRows = await db.insert(wassceSubjects).values(subjectValues).returning();
  const subjIdByProgName = new Map(subjectRows.map((r) => [`${r.programmeId}|${r.name}`, r.id]));

  // --- 4) candidates: 9 named + 231 generated = 240 (Sci 60 · Bus 60 · Arts 80 · Home Ec 40) ---
  const generated: CandidateSpec[] = [];
  const namedByProg = { GENERAL_SCIENCE: 3, BUSINESS: 3, GENERAL_ARTS: 2, HOME_ECONOMICS: 1 };
  let serialNum = 1;
  let gi = 0;
  for (const p of PROGRAMME_META) {
    const need = p.target - namedByProg[p.key];
    for (let k = 0; k < need; k++, gi++) {
      const sex = gi % 2 === 0 ? "MALE" : "FEMALE";
      const first = (sex === "MALE" ? FIRST_M : FIRST_F)[gi % FIRST_M.length];
      const last = LAST[(gi * 3) % LAST.length];
      const serial = String(serialNum++).padStart(4, "0");
      // Two generated candidates carry the extra structured accommodations that complete the §4.3
      // breakdown (2 chronic · 1 sight · 1 hearing): first Science → chronic, first Arts → hearing.
      let accommodation: Accommodation | null = null;
      let note: string | null = "Registered · no flags";
      if (p.key === "GENERAL_SCIENCE" && k === 0) {
        accommodation = { type: "chronic", scForm: "SC-7", detail: "asthma · inhaler on hand" };
        note = "Chronic accommodation‖· asthma · WAEC SC-7 filed Oct";
      } else if (p.key === "GENERAL_ARTS" && k === 0) {
        accommodation = { type: "hearing", scForm: "SC-3", detail: "front seating · FM aid" };
        note = "Hearing accommodation‖· front seating · WAEC SC-3 approved Jan";
      }
      generated.push({
        serial,
        first,
        last,
        sex,
        programmeKey: p.key,
        flag: null,
        accommodation,
        note,
        mock2: 6 + ((serialNum * 7 + gi * 3) % 49), // seeded literal (K4), never computed
      });
    }
  }
  const allSpecs = [...NAMED, ...generated];

  // synthetic F3 students (marker SHS-2023-*) backing every candidate
  const studentRows = await db
    .insert(students)
    .values(
      allSpecs.map((c) => ({
        schoolId,
        studentCode: `SHS-2023-${c.serial}`,
        firstName: c.first,
        lastName: c.last,
        sex: c.sex,
        status: "ACTIVE" as const,
        programme: c.programmeKey,
        enrolledOn: "2023-09-11",
      })),
    )
    .returning();
  const studentIdByCode = new Map(studentRows.map((r) => [r.studentCode, r.id]));

  const candidateRows = await db
    .insert(wassceCandidates)
    .values(
      allSpecs.map((c) => ({
        schoolId,
        cohortId: cohort.id,
        studentId: studentIdByCode.get(`SHS-2023-${c.serial}`)!,
        programmeId: progIdByKey.get(c.programmeKey)!,
        indexNumber: `0184-${c.serial}`,
        centreCode: CENTRE_CODE,
        candidateStatus: "REGISTERED" as const, // WAEC lifecycle only — fee/NHIS/medical never a status (K3)
        regFlag: c.flag,
        accommodationsJson: c.accommodation,
        note: c.note,
        mock2Aggregate: c.mock2, // seeded display-only
        projectedAggregate: null, // stays NULL in INCR-15 (INCR-17)
      })),
    )
    .returning();
  const candIdBySerial = new Map(
    candidateRows.map((r) => [r.indexNumber.replace("0184-", ""), r.id]),
  );

  // --- 5) candidate_subject picks: 4 cores + first 4 electives (ELECTIVE-first) of the programme ---
  const csValues: (typeof wassceCandidateSubject.$inferInsert)[] = [];
  for (const c of allSpecs) {
    const pid = progIdByKey.get(c.programmeKey)!;
    const candId = candIdBySerial.get(c.serial)!;
    const subs = PROGRAMME_SUBJECTS[c.programmeKey];
    const cores = subs.filter((s) => s.type === "CORE");
    const electives = subs.filter((s) => s.type !== "CORE").slice(0, 4); // ELECTIVE listed before OPTIONAL
    for (const s of [...cores, ...electives]) {
      csValues.push({ schoolId, candidateId: candId, subjectId: subjIdByProgName.get(`${pid}|${s.name}`)! });
    }
  }
  await db.insert(wassceCandidateSubject).values(csValues);

  // --- 6) WAEC 2026 timetable papers (cohort-scoped, K2). Core papers attach to the Science core
  //        subject rows (canonical); elective papers to their programme's elective row. ---
  const sciId = progIdByKey.get("GENERAL_SCIENCE")!;
  const busId = progIdByKey.get("BUSINESS")!;
  const artsId = progIdByKey.get("GENERAL_ARTS")!;
  const subjId = (pid: string, name: string) => subjIdByProgName.get(`${pid}|${name}`)!;
  type PaperSpec = {
    name: string;
    subjectId: string;
    paperNumber: number | null;
    paperType: "OBJECTIVE" | "ESSAY" | "PRACTICAL" | "ORAL" | "COMBINED";
    code: string;
    date: string;
    time: string;
    duration: number;
    core: boolean;
  };
  const papers: PaperSpec[] = [
    { name: "Social Studies 1 (Objective)", subjectId: subjId(sciId, "Social Studies"), paperNumber: 1, paperType: "OBJECTIVE", code: "005/1", date: "2026-04-21", time: "09:00", duration: 60, core: true },
    { name: "Social Studies 2 (Essay)", subjectId: subjId(sciId, "Social Studies"), paperNumber: 2, paperType: "ESSAY", code: "005/2", date: "2026-04-21", time: "10:00", duration: 120, core: true },
    { name: "Integrated Science 1 (Objective)", subjectId: subjId(sciId, "Integrated Science"), paperNumber: 1, paperType: "OBJECTIVE", code: "193/1", date: "2026-04-28", time: "09:00", duration: 60, core: true },
    { name: "Integrated Science 2 (Essay)", subjectId: subjId(sciId, "Integrated Science"), paperNumber: 2, paperType: "ESSAY", code: "193/2", date: "2026-04-28", time: "10:00", duration: 120, core: true },
    { name: "Mathematics (Core) 1 (Objective)", subjectId: subjId(sciId, "Mathematics (Core)"), paperNumber: 1, paperType: "OBJECTIVE", code: "251/1", date: "2026-05-05", time: "09:00", duration: 90, core: true },
    { name: "Mathematics (Core) 2 (Essay)", subjectId: subjId(sciId, "Mathematics (Core)"), paperNumber: 2, paperType: "ESSAY", code: "251/2", date: "2026-05-05", time: "10:30", duration: 150, core: true },
    { name: "Oral English", subjectId: subjId(sciId, "English Language"), paperNumber: 3, paperType: "ORAL", code: "191/3", date: "2026-05-13", time: "08:00", duration: 45, core: true },
    { name: "English Language 2 (Essay)", subjectId: subjId(sciId, "English Language"), paperNumber: 2, paperType: "ESSAY", code: "191/2", date: "2026-05-14", time: "09:30", duration: 150, core: true },
    { name: "English Language 1 (Objective)", subjectId: subjId(sciId, "English Language"), paperNumber: 1, paperType: "OBJECTIVE", code: "191/1", date: "2026-05-14", time: "14:00", duration: 60, core: true },
    { name: "Chemistry 2 (Essay)", subjectId: subjId(sciId, "Chemistry"), paperNumber: 2, paperType: "ESSAY", code: "213/2", date: "2026-06-02", time: "09:30", duration: 120, core: false },
    { name: "Financial Accounting 2 (Essay)", subjectId: subjId(busId, "Financial Accounting"), paperNumber: 2, paperType: "ESSAY", code: "241/2", date: "2026-06-09", time: "09:30", duration: 120, core: false },
    { name: "Literature in English 2 (Prose)", subjectId: subjId(artsId, "Literature in English"), paperNumber: 2, paperType: "ESSAY", code: "121/2", date: "2026-06-16", time: "09:30", duration: 120, core: false },
  ];
  const paperRows = await db
    .insert(wasscePapers)
    .values(
      papers.map((p) => ({
        schoolId,
        cohortId: cohort.id,
        subjectId: p.subjectId,
        name: p.name,
        paperNumber: p.paperNumber,
        paperType: p.paperType,
        waecPaperCode: p.code,
        scheduledDate: p.date,
        scheduledTime: p.time,
        durationMinutes: p.duration,
      })),
    )
    .returning();
  const paperIdByName = new Map(paperRows.map((r) => [r.name, r.id]));
  const paperWhen = (name: string) => {
    const p = papers.find((x) => x.name === name)!;
    return new Date(`${p.date}T${p.time}:00Z`);
  };

  // --- 7) sittings for the 9 named candidates × the 9 core papers (representative; the full
  //        cross-product feeds the deferred live-tracker, not this surface). Y. Aidoo's two "today"
  //        English papers carry the medical exemption (AC-D). Uniqueness = one per candidate×paper. ---
  const corePaperNames = papers.filter((p) => p.core).map((p) => p.name);
  const AIDOO_EXEMPT = new Set(["English Language 2 (Essay)", "English Language 1 (Objective)"]);
  const sittingValues: (typeof wasscePaperSittings.$inferInsert)[] = [];
  for (const c of NAMED) {
    const candId = candIdBySerial.get(c.serial)!;
    for (const pn of corePaperNames) {
      const isAidoo = c.serial === "0817";
      if (isAidoo && AIDOO_EXEMPT.has(pn)) {
        sittingValues.push({
          schoolId,
          candidateId: candId,
          paperId: paperIdByName.get(pn)!,
          exemptedAt: new Date("2026-05-14T11:00:00Z"),
          exemptionReasonText: "Inpatient · severe malaria · WAEC Form SC-12 filed 11:00; make-up pending discharge",
        });
      } else {
        sittingValues.push({
          schoolId,
          candidateId: candId,
          paperId: paperIdByName.get(pn)!,
          satAt: paperWhen(pn),
        });
      }
    }
  }
  await db.insert(wasscePaperSittings).values(sittingValues);

  // --- audit (append-only) ---
  await db.insert(auditLog).values({
    schoolId,
    actorUserId: headmaster.id,
    actorRole: "HEADMASTER",
    actionType: "created",
    entityType: "wassce_cohort",
    entityId: cohort.id,
    afterState: {
      examYear: EXAM_YEAR,
      frozen: true,
      programmes: programmeRows.length,
      subjects: subjectRows.length,
      candidates: candidateRows.length,
      candidateSubjects: csValues.length,
      papers: paperRows.length,
      sittings: sittingValues.length,
    },
    reason: "WASSCE-2026 F3 cohort spine seed (frozen · co-signed · INCR-15)",
  });

  const byProg = PROGRAMME_META.map(
    (p) => `${p.name} ${allSpecs.filter((c) => c.programmeKey === p.key).length}`,
  ).join(" · ");
  console.log(
    `✓ WASSCE seed — cohort ${EXAM_YEAR} FROZEN, ${programmeRows.length} programmes, ` +
      `${subjectRows.length} subject rows, ${candidateRows.length} candidates (${byProg}), ` +
      `${csValues.length} subject picks, ${paperRows.length} papers, ${sittingValues.length} sittings.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("✗ WASSCE seed failed:", err);
    process.exit(1);
  });
