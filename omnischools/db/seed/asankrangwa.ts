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
  type appRoleEnum,
} from "@/db/schema";

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
  await db.insert(academicPeriod).values([
    {
      schoolId: school.id,
      academicYear: "2025/26",
      periodNumber: 1,
      periodLabel: "Semester 1",
      startsOn: "2025-09-09",
      endsOn: "2025-12-19",
    },
    {
      schoolId: school.id,
      academicYear: "2025/26",
      periodNumber: 2,
      periodLabel: "Semester 2",
      startsOn: "2026-01-13",
      endsOn: "2026-06-21",
    },
  ]);

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
    `✓ Seeded Asankrangwa SHS — school ${school.id}, ${staff.length} staff, 2 semesters, ${ROLE_CATALOGUE.length} roles.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("✗ Seed failed:", err);
    process.exit(1);
  });
