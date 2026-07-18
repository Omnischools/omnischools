import "../_loadenv";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  regions,
  districts,
  schools,
  schoolProducts,
  users,
  roles,
  roleAssignments,
  academicPeriodConfig,
  academicPeriod,
  genPeriodDefaults,
  anomalyRules,
  auditLog,
  houses,
  classes,
  subjects,
  students,
  assessmentWeights,
  seniorAssessments,
  seniorAssessmentScores,
  seniorScoreLedger,
  seniorLedgerPath,
  seniorSubjectTeacher,
  type appRoleEnum,
} from "@/db/schema";
import {
  compileComputableCategories,
  computedStatus,
  SYSTEM_DEFAULT_WEIGHTS,
  type EventMark,
} from "@/lib/score-ledger/compute";

type RoleCode = (typeof appRoleEnum.enumValues)[number];

const ROLE_CATALOGUE: { code: RoleCode; label: string; description: string }[] = [
  { code: "ADMIN", label: "Administrator", description: "School office / system admin" },
  { code: "HEADMASTER", label: "Headmaster", description: "Head of school" },
  {
    code: "VICE_HEADMASTER_ACADEMIC",
    label: "Vice Headmaster (Academic)",
    description: "Academic oversight (Senior)",
  },
  { code: "TEACHER", label: "Teacher", description: "Subject / class teacher" },
  { code: "FORM_MASTER", label: "Form Master", description: "Form-class pastoral lead" },
  {
    code: "HOUSEMASTER",
    label: "Housemaster",
    description: "Boarding house lead (Senior)",
  },
  { code: "STUDENT", label: "Student", description: "Enrolled student" },
  { code: "PARENT", label: "Parent / Guardian", description: "Parent or guardian" },
  { code: "BURSAR", label: "Bursar", description: "Finance / accountant" },
  {
    code: "DEAN_OF_BOARDING",
    label: "Dean of Boarding",
    description: "Boarding operations (Senior)",
  },
  { code: "MATRON", label: "Matron", description: "Sickbay / welfare (Senior)" },
];

async function main() {
  // Idempotency guard: skip if Asankrangwa already seeded.
  const existing = await db
    .select({ id: schools.id })
    .from(schools)
    .where(eq(schools.gesCode, "WR-WAW-014"));
  if (existing.length > 0) {
    console.log("• Asankrangwa SHS already seeded — skipping.");
    return;
  }

  console.log("Seeding Asankrangwa SHS (WR-WAW-014)...");

  // --- geography ---
  const [region] = await db
    .insert(regions)
    .values({ name: "Western Region", code: "WR" })
    .onConflictDoNothing({ target: regions.code })
    .returning();
  const regionId =
    region?.id ?? (await db.select().from(regions).where(eq(regions.code, "WR")))[0].id;

  const [district] = await db
    .insert(districts)
    .values({ regionId, name: "Wassa Amenfi West", code: "WR-WAW" })
    .onConflictDoNothing({ target: districts.code })
    .returning();
  const districtId =
    district?.id ??
    (await db.select().from(districts).where(eq(districts.code, "WR-WAW")))[0].id;

  // --- school + product ---
  const [school] = await db
    .insert(schools)
    .values({
      name: "Asankrangwa Senior High School",
      shortName: "ASANKSHS",
      gesCode: "WR-WAW-014",
      schoolType: "SENIOR",
      shsCategory: "B",
      ownership: "PUBLIC",
      districtId,
      regionId,
    })
    .returning();

  await db
    .insert(schoolProducts)
    .values({ schoolId: school.id, product: "SENIOR", active: true });

  // --- role catalogue (global) ---
  await db
    .insert(roles)
    .values(ROLE_CATALOGUE)
    .onConflictDoNothing({ target: roles.code });
  const roleRows = await db.select().from(roles);
  const roleId = (code: RoleCode) => roleRows.find((r) => r.code === code)!.id;

  // --- staff users + role assignments ---
  const staff: { phone: string; name: string; role: RoleCode }[] = [
    { phone: "+233244000000", name: "School Office", role: "ADMIN" },
    { phone: "+233244000001", name: "V. Yanney", role: "HEADMASTER" },
    { phone: "+233244000002", name: "Mrs P. Anim", role: "VICE_HEADMASTER_ACADEMIC" },
    { phone: "+233244000003", name: "Mr K. Owusu", role: "TEACHER" },
    { phone: "+233244000004", name: "Mr A. Mensah", role: "FORM_MASTER" },
  ];
  const insertedUsers = await db
    .insert(users)
    .values(staff.map((s) => ({ phone: s.phone, fullName: s.name })))
    .returning();
  const userByPhone = new Map(insertedUsers.map((u) => [u.phone, u.id]));

  await db.insert(roleAssignments).values(
    staff.map((s) => ({
      userId: userByPhone.get(s.phone)!,
      schoolId: school.id,
      roleId: roleId(s.role),
    })),
  );
  // Mr A. Mensah also serves as a Housemaster (Aggrey House).
  await db.insert(roleAssignments).values({
    userId: userByPhone.get("+233244000004")!,
    schoolId: school.id,
    roleId: roleId("HOUSEMASTER"),
  });

  // --- academic period config: 2025/26, 2 semesters (Senior) ---
  await db.insert(academicPeriodConfig).values({
    schoolId: school.id,
    academicYear: "2025/26",
    periodType: "SEMESTER",
    periodCount: 2,
    source: "GES_DEFAULT",
    configuredBy: userByPhone.get("+233244000001"),
  });
  const periodRows = await db
    .insert(academicPeriod)
    .values([
      {
        schoolId: school.id,
        academicYear: "2025/26",
        periodNumber: 1,
        periodLabel: "Semester 1",
        startsOn: "2025-09-09",
        endsOn: "2025-12-19",
        productLine: "SENIOR", // SEMESTER config → SENIOR (INCR-11 tweak #1 NOT NULL column)
      },
      {
        schoolId: school.id,
        academicYear: "2025/26",
        periodNumber: 2,
        periodLabel: "Semester 2",
        startsOn: "2026-01-13",
        endsOn: "2026-06-21",
        productLine: "SENIOR",
      },
    ])
    .returning();
  const semester2 = periodRows.find((p) => p.periodNumber === 2)!;

  // --- GES default calendars (global reference; illustrative 2025/26 dates) ---
  await db
    .insert(genPeriodDefaults)
    .values([
      // Basic: 3 terms
      {
        academicYear: "2025/26",
        productLine: "BASIC",
        periodNumber: 1,
        periodLabel: "Term 1",
        startsOn: "2025-09-09",
        endsOn: "2025-12-19",
      },
      {
        academicYear: "2025/26",
        productLine: "BASIC",
        periodNumber: 2,
        periodLabel: "Term 2",
        startsOn: "2026-01-06",
        endsOn: "2026-04-02",
      },
      {
        academicYear: "2025/26",
        productLine: "BASIC",
        periodNumber: 3,
        periodLabel: "Term 3",
        startsOn: "2026-04-28",
        endsOn: "2026-07-31",
      },
      // Senior: 2 semesters
      {
        academicYear: "2025/26",
        productLine: "SENIOR",
        periodNumber: 1,
        periodLabel: "Semester 1",
        startsOn: "2025-09-09",
        endsOn: "2025-12-19",
      },
      {
        academicYear: "2025/26",
        productLine: "SENIOR",
        periodNumber: 2,
        periodLabel: "Semester 2",
        startsOn: "2026-01-13",
        endsOn: "2026-07-10",
      },
      // Senior F3: shorter Semester 2 (WASSCE year)
      {
        academicYear: "2025/26",
        productLine: "SENIOR_F3",
        periodNumber: 1,
        periodLabel: "Semester 1",
        startsOn: "2025-09-09",
        endsOn: "2025-12-19",
      },
      {
        academicYear: "2025/26",
        productLine: "SENIOR_F3",
        periodNumber: 2,
        periodLabel: "Semester 2",
        startsOn: "2026-01-13",
        endsOn: "2026-06-21",
      },
    ])
    .onConflictDoNothing();

  // --- anomaly rules (global, shared with Vice-Headmaster progress + Oversight) ---
  await db
    .insert(anomalyRules)
    .values([
      {
        ruleCode: "LEDGER-INACTIVE-14",
        severity: "MEDIUM",
        appliesTo: "SCORE_LEDGER",
        description: "Teacher inactive 14+ days in the score ledger",
        thresholdJson: { days: 14 },
      },
      {
        ruleCode: "LEDGER-BLANK-SEMESTER-END",
        severity: "HIGH",
        appliesTo: "SCORE_LEDGER",
        description: "Score rows still blank near semester end",
        thresholdJson: { window_days: 7 },
      },
      {
        ruleCode: "LEDGER-DEADLINE-7",
        severity: "HIGH",
        appliesTo: "SCORE_LEDGER",
        description: "STPSHS submission deadline <7 days and not complete",
        thresholdJson: { days: 7 },
      },
      {
        ruleCode: "LEDGER-SUSPICIOUS-RATE",
        severity: "LOW",
        appliesTo: "SCORE_LEDGER",
        description: "Suspicious score-entry rate",
        thresholdJson: {},
      },
    ])
    .onConflictDoNothing({ target: anomalyRules.ruleCode });

  // --- Senior (SHS) F0 + score-ledger Item 1 demo data ---
  // 6 Houses (canonical names §1.7 + per-House dot colours — colour is user data, not a token).
  const houseRows = await db
    .insert(houses)
    .values([
      { schoolId: school.id, name: "Aggrey", colour: "#D87794" },
      { schoolId: school.id, name: "Guggisberg", colour: "#5A7A9F" },
      { schoolId: school.id, name: "Fraser", colour: "#5A8F6E" },
      { schoolId: school.id, name: "Slessor", colour: "#C8975B" },
      { schoolId: school.id, name: "Kingsley", colour: "#1A2B47" },
      { schoolId: school.id, name: "Aryee", colour: "#B84A39" },
    ])
    .returning();
  const houseId = (name: string) => houseRows.find((h) => h.name === name)!.id;

  // Core SHS subjects.
  const subjectRows = await db
    .insert(subjects)
    .values([
      { schoolId: school.id, name: "Mathematics", code: "MATH" },
      { schoolId: school.id, name: "English Language", code: "ENG" },
      { schoolId: school.id, name: "Integrated Science", code: "SCI" },
      { schoolId: school.id, name: "Social Studies", code: "SOC" },
    ])
    .returning();
  const maths = subjectRows.find((s) => s.name === "Mathematics")!;

  // SHS classes — programme on the class; Mr K. Owusu teaches the Science form.
  const classRows = await db
    .insert(classes)
    .values([
      {
        schoolId: school.id,
        name: "Form 2 Science",
        level: "Form 2",
        programme: "GENERAL_SCIENCE",
        classTeacherUserId: userByPhone.get("+233244000003"),
      },
      {
        schoolId: school.id,
        name: "Form 2 General Arts A",
        level: "Form 2",
        programme: "GENERAL_ARTS",
      },
      {
        schoolId: school.id,
        name: "Form 3 General Arts",
        level: "Form 3",
        programme: "GENERAL_ARTS",
      },
    ])
    .returning();
  const form2Science = classRows.find((c) => c.name === "Form 2 Science")!;
  const form2GA = classRows.find((c) => c.name === "Form 2 General Arts A")!;
  const form3GA = classRows.find((c) => c.name === "Form 3 General Arts")!;

  // School-default assessment weights (15/15/40/15/15 — end-of-sem dominant, Asankrangwa).
  // Denominators: portfolio is marked out of 10 at Asankrangwa (Path B scan scale, Item 4);
  // the other four categories are out of 100, so they inherit the column default (100) and
  // are left unset here. Seeded real config — the system fallback (all /100) never inflates.
  await db.insert(assessmentWeights).values({
    schoolId: school.id,
    subjectId: null,
    asgnWeight: SYSTEM_DEFAULT_WEIGHTS.asgn,
    midSemWeight: SYSTEM_DEFAULT_WEIGHTS.midSem,
    endSemWeight: SYSTEM_DEFAULT_WEIGHTS.endSem,
    projectWeight: SYSTEM_DEFAULT_WEIGHTS.project,
    portfolioWeight: SYSTEM_DEFAULT_WEIGHTS.portfolio,
    portfolioDenominator: 10,
    updatedByUserId: userByPhone.get("+233244000002"),
  });

  // Students — J. Manu (Form 2 GA, Aggrey, boarder) + Y. Aidoo (Form 3, WASSCE) per §1.7,
  // plus the Form 2 Science roster for the Path A Mathematics demo. Marks are
  // [asgn1/20, asgn2/20, mid/40, end/100, project/50].
  type SeedStudent = {
    code: string;
    first: string;
    last: string;
    sex: "MALE" | "FEMALE";
    classId: string;
    programme: "GENERAL_ARTS" | "GENERAL_SCIENCE";
    residency: "BOARDER" | "DAY";
    house: string;
    marks?: [number, number, number, number, number];
  };
  const scienceRoster: SeedStudent[] = [
    { code: "ASK-24-0142", first: "Abena", last: "Mensah", sex: "FEMALE", classId: form2Science.id, programme: "GENERAL_SCIENCE", residency: "BOARDER", house: "Aggrey", marks: [16, 15, 30, 72, 40] },
    { code: "ASK-24-0143", first: "Akwasi", last: "Boateng", sex: "MALE", classId: form2Science.id, programme: "GENERAL_SCIENCE", residency: "DAY", house: "Guggisberg", marks: [13, 14, 28, 55, 42] },
    { code: "ASK-24-0144", first: "Ama", last: "Asante", sex: "FEMALE", classId: form2Science.id, programme: "GENERAL_SCIENCE", residency: "BOARDER", house: "Fraser", marks: [18, 19, 36, 89, 46] },
    { code: "ASK-24-0145", first: "Daniel", last: "Owusu", sex: "MALE", classId: form2Science.id, programme: "GENERAL_SCIENCE", residency: "DAY", house: "Slessor", marks: [11, 12, 22, 51, 30] },
    { code: "ASK-24-0146", first: "Efua", last: "Sarpong", sex: "FEMALE", classId: form2Science.id, programme: "GENERAL_SCIENCE", residency: "BOARDER", house: "Kingsley", marks: [17, 16, 33, 78, 44] },
    { code: "ASK-24-0147", first: "Kwame", last: "Boakye", sex: "MALE", classId: form2Science.id, programme: "GENERAL_SCIENCE", residency: "BOARDER", house: "Aryee", marks: [14, 15, 31, 66, 38] },
    { code: "ASK-24-0148", first: "Yaa", last: "Owusu", sex: "FEMALE", classId: form2Science.id, programme: "GENERAL_SCIENCE", residency: "DAY", house: "Aggrey", marks: [15, 17, 29, 70, 41] },
    { code: "ASK-24-0149", first: "Kofi", last: "Adjei", sex: "MALE", classId: form2Science.id, programme: "GENERAL_SCIENCE", residency: "BOARDER", house: "Guggisberg", marks: [12, 13, 26, 60, 35] },
  ];
  const pastoralStudents: SeedStudent[] = [
    { code: "ASK-24-0118", first: "Joseph", last: "Manu", sex: "MALE", classId: form2GA.id, programme: "GENERAL_ARTS", residency: "BOARDER", house: "Aggrey" },
    { code: "ASK-23-0007", first: "Yaw", last: "Aidoo", sex: "MALE", classId: form3GA.id, programme: "GENERAL_ARTS", residency: "DAY", house: "Fraser" },
  ];
  const allStudents = [...scienceRoster, ...pastoralStudents];
  const studentRows = await db
    .insert(students)
    .values(
      allStudents.map((s) => ({
        schoolId: school.id,
        studentCode: s.code,
        firstName: s.first,
        lastName: s.last,
        sex: s.sex,
        status: "ACTIVE" as const,
        classId: s.classId,
        programme: s.programme,
        residency: s.residency,
        houseId: houseId(s.house),
        enrolledOn: "2024-09-09",
      })),
    )
    .returning();
  const studentIdByCode = new Map(studentRows.map((r) => [r.studentCode, r.id]));

  // Path A assessments for Form 2 Science · Mathematics · Semester 2.
  const assessmentDefs = [
    { category: "ASSIGNMENT" as const, title: "Assignment 1", maxMark: 20 },
    { category: "ASSIGNMENT" as const, title: "Assignment 2", maxMark: 20 },
    { category: "MID_SEM_EXAM" as const, title: "Mid-Sem Exam", maxMark: 40 },
    { category: "END_SEM_EXAM" as const, title: "End-of-Sem Exam", maxMark: 100 },
    { category: "PROJECT" as const, title: "Term Project", maxMark: 50 },
  ];
  const assessmentRows = await db
    .insert(seniorAssessments)
    .values(
      assessmentDefs.map((a) => ({
        schoolId: school.id,
        classId: form2Science.id,
        subjectId: maths.id,
        periodId: semester2.periodId,
        category: a.category,
        title: a.title,
        maxMark: a.maxMark.toFixed(2),
        assessedOn: "2026-03-15",
        createdByUserId: userByPhone.get("+233244000003"),
      })),
    )
    .returning();
  const assessmentByIdx = assessmentDefs.map(
    (d) => assessmentRows.find((r) => r.title === d.title)!,
  );

  // Marks + pre-compiled ledger (portfolio deliberately left pending, per the surface).
  const markValues: (typeof seniorAssessmentScores.$inferInsert)[] = [];
  const ledgerValues: (typeof seniorScoreLedger.$inferInsert)[] = [];
  for (const s of scienceRoster) {
    if (!s.marks) continue;
    const sid = studentIdByCode.get(s.code)!;
    const eventMarks: EventMark[] = [];
    s.marks.forEach((m, i) => {
      markValues.push({
        schoolId: school.id,
        assessmentId: assessmentByIdx[i].id,
        studentId: sid,
        rawMark: m.toFixed(2),
        updatedByUserId: userByPhone.get("+233244000003"),
      });
      eventMarks.push({
        category: assessmentDefs[i].category,
        maxMark: assessmentDefs[i].maxMark,
        rawMark: m,
      });
    });
    const four = compileComputableCategories(eventMarks);
    const cats = { ...four, portfolio: null };
    ledgerValues.push({
      schoolId: school.id,
      studentId: sid,
      subjectId: maths.id,
      periodId: semester2.periodId,
      asgnScore: four.asgn?.toFixed(2) ?? null,
      midSemScore: four.midSem?.toFixed(2) ?? null,
      endSemScore: four.endSem?.toFixed(2) ?? null,
      projectScore: four.project?.toFixed(2) ?? null,
      weightedTotal: null, // provisional until the portfolio is entered
      asgnWeightUsed: SYSTEM_DEFAULT_WEIGHTS.asgn,
      midSemWeightUsed: SYSTEM_DEFAULT_WEIGHTS.midSem,
      endSemWeightUsed: SYSTEM_DEFAULT_WEIGHTS.endSem,
      projectWeightUsed: SYSTEM_DEFAULT_WEIGHTS.project,
      portfolioWeightUsed: SYSTEM_DEFAULT_WEIGHTS.portfolio,
      portfolioManual: false,
      status: computedStatus(cats),
      compiledByUserId: userByPhone.get("+233244000003"),
      compiledAt: new Date(),
    });
  }
  await db.insert(seniorAssessmentScores).values(markValues);
  await db.insert(seniorScoreLedger).values(ledgerValues);

  // Path C demo — Form 2 Science takes English via direct entry (a blank grid the
  // teacher types category scores straight into; no assessment events).
  const english = subjectRows.find((s) => s.name === "English Language")!;
  await db.insert(seniorLedgerPath).values({
    schoolId: school.id,
    classId: form2Science.id,
    subjectId: english.id,
    periodId: semester2.periodId,
    path: "DIRECT_ENTRY",
    updatedByUserId: userByPhone.get("+233244000003"),
  });

  // Subject-teacher assignments — the enumeration source for the VHM progress view.
  // A mix so the view shows every state: Owusu's Maths (Path A, 4/5 behind — portfolio
  // pending), Owusu's English (Path C, nothing entered → at risk), and two Mensah
  // assignments never touched → at-risk 0/5 rows (the "never started" case must be visible).
  const socialStudies = subjectRows.find((s) => s.name === "Social Studies")!;
  const science = subjectRows.find((s) => s.name === "Integrated Science")!;
  await db.insert(seniorSubjectTeacher).values([
    {
      schoolId: school.id,
      classId: form2Science.id,
      subjectId: maths.id,
      teacherUserId: userByPhone.get("+233244000003")!, // Mr K. Owusu
    },
    {
      schoolId: school.id,
      classId: form2Science.id,
      subjectId: english.id,
      teacherUserId: userByPhone.get("+233244000003")!,
    },
    {
      schoolId: school.id,
      classId: form2GA.id,
      subjectId: socialStudies.id,
      teacherUserId: userByPhone.get("+233244000004")!, // Mr A. Mensah
    },
    {
      schoolId: school.id,
      classId: form3GA.id,
      subjectId: science.id,
      teacherUserId: userByPhone.get("+233244000004")!,
    },
  ]);

  // --- audit: record the seed itself (append-only) ---
  await db.insert(auditLog).values({
    schoolId: school.id,
    actorUserId: userByPhone.get("+233244000000"),
    actorRole: "ADMIN",
    actionType: "created",
    entityType: "school",
    entityId: school.id,
    afterState: { name: "Asankrangwa Senior High School", gesCode: "WR-WAW-014" },
    reason: "Initial demo-school seed",
  });

  console.log(
    `✓ Seeded Asankrangwa SHS — school ${school.id}, ${staff.length} staff, 2 semesters, ` +
      `${ROLE_CATALOGUE.length} roles, 6 Houses, ${subjectRows.length} subjects, ` +
      `${classRows.length} classes, ${studentRows.length} students, ` +
      `${assessmentRows.length} Maths assessments + compiled Semester 2 ledger.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("✗ Seed failed:", err);
    process.exit(1);
  });
