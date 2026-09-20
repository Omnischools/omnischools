import "../_loadenv";
import { and, eq, inArray, like } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  auditLog,
  boardingBunk,
  boardingDormitory,
  bunkAllocation,
  classes,
  houses,
  roleAssignments,
  roles,
  schools,
  sickbayBed,
  sickbayScheduleSlot,
  sickbaySettings,
  staffProfiles,
  students,
  users,
} from "@/db/schema";
import { CANONICAL_SICKBAY_SLOTS } from "@/lib/sickbay/defaults";

/**
 * Sickbay F0 (INCR-21) demo seed for Asankrangwa — the Mode-B first-aid station the setup surface
 * draws: mode FIRST_AID, 8 beds (6 general + 2 isolation), the canonical 7 schedule slots, a Senior
 * and an Assistant Matron who are REAL users holding the MATRON role, and a visiting doctor who is
 * TEXT ONLY — no ref_user, no role_assignment, no invite, no login (R21 · AC D4).
 *
 * It also seats one Sick Bay Prefect in each House's already-marked `prefect_role = 'SICKBAY'` bunk,
 * so the health-prefect card renders REAL derived data (AC D6): the roster is a read of
 * boarding_bunk, never a stored id array. Run AFTER `pnpm db:seed` and `pnpm db:seed-boarding`.
 *
 * MARKER-SCOPED + RE-RUN-SAFE. Cleanup only ever touches:
 *   • the three sickbay_* tables for THIS school (nothing else writes them);
 *   • students whose code starts `ASK-SBP-` (this seed's own);
 *   • the two matron users at the two marker phones below.
 * It NEVER broad-deletes shared baseline data — repo memory `seed-cleanup-must-be-scoped`: a
 * `where schoolId` / `name LIKE` sweep once destroyed the academic_period baseline. academic_period,
 * houses, classes and the boarding spine are read-only here.
 *
 * `pnpm db:seed-sickbay`
 */

const GES_CODE = "WR-WAW-014";
const STUDENT_MARKER = "ASK-SBP-";
const MATRON_PHONE = "+233244000005";
const ASSISTANT_PHONE = "+233244000006";
const MATRON_PHONES = [MATRON_PHONE, ASSISTANT_PHONE];

/** 6 general + 2 isolation — the surface's Mode-B scale. Numbers are stable for life (R8). */
const GENERAL_BEDS = 6;
const ISOLATION_BEDS = 2;

/**
 * One Sick Bay Prefect per House, seated in that House's SICKBAY-marked bunk. Boarders (a marked
 * bunk implies boarding), gender-matched to the House — the boarding J3 guard rejects a mismatch.
 * F. Tetteh continues the named-student narrative from boarding surface 2, where he was established
 * as Aggrey's Sick Bay Prefect.
 */
const PREFECTS: {
  code: string;
  first: string;
  last: string;
  sex: "MALE" | "FEMALE";
  house: string;
  className: string;
}[] = [
  { code: `${STUDENT_MARKER}01`, first: "Francis", last: "Tetteh", sex: "MALE", house: "Aggrey", className: "Form 3 General Arts" },
  { code: `${STUDENT_MARKER}02`, first: "Albert", last: "Osei", sex: "MALE", house: "Guggisberg", className: "Form 3 General Arts" },
  { code: `${STUDENT_MARKER}03`, first: "Emmanuel", last: "Asare", sex: "MALE", house: "Fraser", className: "Form 2 Science" },
  { code: `${STUDENT_MARKER}04`, first: "Adjoa", last: "Nyarko", sex: "FEMALE", house: "Slessor", className: "Form 2 General Arts A" },
  { code: `${STUDENT_MARKER}05`, first: "Comfort", last: "Baidoo", sex: "FEMALE", house: "Kingsley", className: "Form 2 Science" },
  { code: `${STUDENT_MARKER}06`, first: "Priscilla", last: "Bonsu", sex: "FEMALE", house: "Aryee", className: "Form 2 General Arts A" },
];

const SEP = new Date("2025-09-09T08:00:00Z");

async function main() {
  const [school] = await db
    .select({ id: schools.id })
    .from(schools)
    .where(eq(schools.gesCode, GES_CODE));
  if (!school) {
    console.error("✗ Asankrangwa not seeded yet — run `pnpm db:seed` first.");
    process.exit(1);
  }
  const schoolId = school.id;

  // ---- 1) Marker-scoped cleanup, in FK order. Nothing outside the markers is touched. ----
  const oldStudents = await db
    .select({ id: students.id })
    .from(students)
    .where(and(eq(students.schoolId, schoolId), like(students.studentCode, `${STUDENT_MARKER}%`)));
  if (oldStudents.length > 0) {
    const ids = oldStudents.map((s) => s.id);
    await db.delete(bunkAllocation).where(inArray(bunkAllocation.studentId, ids));
    await db.delete(students).where(inArray(students.id, ids));
  }
  // The three sickbay tables belong to this module alone — a school-scoped wipe is safe here in the
  // way a `where schoolId` on a shared table never is.
  await db.delete(sickbaySettings).where(eq(sickbaySettings.schoolId, schoolId));
  await db.delete(sickbayBed).where(eq(sickbayBed.schoolId, schoolId));
  await db.delete(sickbayScheduleSlot).where(eq(sickbayScheduleSlot.schoolId, schoolId));
  const oldMatrons = await db
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.phone, MATRON_PHONES));
  if (oldMatrons.length > 0) {
    const ids = oldMatrons.map((u) => u.id);
    await db.delete(staffProfiles).where(inArray(staffProfiles.userId, ids));
    await db.delete(roleAssignments).where(inArray(roleAssignments.userId, ids));
    await db.delete(users).where(inArray(users.id, ids));
  }

  // ---- 2) The two matrons — real users holding the MATRON role in THIS school (R20) ----
  const [matronRole] = await db.select().from(roles).where(eq(roles.code, "MATRON"));
  if (!matronRole) {
    console.error("✗ MATRON is missing from the role catalogue — run `pnpm db:seed` first.");
    process.exit(1);
  }
  const matronRows = await db
    .insert(users)
    .values([
      { phone: MATRON_PHONE, fullName: "Mrs Akua Bediako" },
      { phone: ASSISTANT_PHONE, fullName: "Ms Grace Antwi" },
    ])
    .returning();
  const userIdByPhone = new Map(matronRows.map((u) => [u.phone, u.id]));
  const matronUserId = userIdByPhone.get(MATRON_PHONE)!;
  const assistantUserId = userIdByPhone.get(ASSISTANT_PHONE)!;

  await db.insert(roleAssignments).values(
    MATRON_PHONES.map((phone) => ({
      userId: userIdByPhone.get(phone)!,
      schoolId,
      roleId: matronRole.id,
    })),
  );

  // The N&MC number is a PUBLIC statutory-register credential, not medical PII (R22) — it sits on
  // staff_profile beside the teaching-council pair, because a teacher-turned-matron holds BOTH.
  await db.insert(staffProfiles).values([
    { schoolId, userId: matronUserId, nmcLicenceNumber: "N-04827" },
    { schoolId, userId: assistantUserId },
  ]);

  // ---- 3) The config row — Mode B, both matron pointers, the doctor as TEXT ONLY ----
  await db.insert(sickbaySettings).values({
    schoolId,
    mode: "FIRST_AID",
    matronUserId,
    assistantMatronUserId: assistantUserId,
    // No ref_user, no role_assignment, no invite for Dr Mensah (AC D4). His clinical artefacts are
    // attributed at INCR-22/23 as a recorded EXTERNAL actor, authored by the transcribing matron.
    visitingDoctorName: "Dr K. Mensah",
    visitingDoctorAffiliation: "Asankrangwa Govt. Hospital",
    configuredAt: new Date(),
  });

  // ---- 4) 8 beds — 6 general numbered 1–6, 2 isolation numbered 7–8 (R8/R9) ----
  await db.insert(sickbayBed).values(
    Array.from({ length: GENERAL_BEDS + ISOLATION_BEDS }, (_, i) => ({
      schoolId,
      bedNumber: i + 1,
      isIsolation: i >= GENERAL_BEDS,
    })),
  );

  // ---- 5) The canonical 7 slots (R13) — one source, shared with `Reset to defaults` ----
  await db
    .insert(sickbayScheduleSlot)
    .values(CANONICAL_SICKBAY_SLOTS.map((s) => ({ schoolId, ...s })));

  // ---- 6) Seat one Sick Bay Prefect in each House's SICKBAY-marked bunk (R23 · AC D6) ----
  const sickbayBunks = await db
    .select({ bunkId: boardingBunk.id, house: houses.name })
    .from(boardingBunk)
    .innerJoin(boardingDormitory, eq(boardingDormitory.id, boardingBunk.dormitoryId))
    .innerJoin(houses, eq(houses.id, boardingDormitory.houseId))
    .where(and(eq(boardingBunk.schoolId, schoolId), eq(boardingBunk.prefectRole, "SICKBAY")));
  const bunkByHouse = new Map(sickbayBunks.map((b) => [b.house, b.bunkId]));

  let seatedPrefects = 0;
  if (bunkByHouse.size === 0) {
    console.warn(
      "• No boarding bunks are marked prefect_role='SICKBAY' — run `pnpm db:seed-boarding` first. " +
        "The prefect card will render its honest empty state, not a fabricated roster.",
    );
  } else {
    const houseRows = await db.select().from(houses).where(eq(houses.schoolId, schoolId));
    const classRows = await db.select().from(classes).where(eq(classes.schoolId, schoolId));
    const seatable = PREFECTS.filter((p) => bunkByHouse.has(p.house));
    const prefectRows = await db
      .insert(students)
      .values(
        seatable.map((p) => {
          const cls = classRows.find((c) => c.name === p.className);
          return {
            schoolId,
            studentCode: p.code,
            firstName: p.first,
            lastName: p.last,
            sex: p.sex,
            status: "ACTIVE" as const,
            classId: cls?.id ?? null,
            programme: cls?.programme ?? null,
            residency: "BOARDER" as const,
            houseId: houseRows.find((h) => h.name === p.house)?.id ?? null,
            enrolledOn: "2024-09-09",
          };
        }),
      )
      .returning();

    for (const row of prefectRows) {
      const bunkId = bunkByHouse.get(
        seatable.find((p) => p.code === row.studentCode)!.house,
      )!;
      await db.insert(bunkAllocation).values({
        schoolId,
        studentId: row.id,
        bunkId,
        fromAt: SEP,
        reason: "Sick Bay Prefect · House prefect bunk",
      });
      await db.update(students).set({ currentBunkId: bunkId }).where(eq(students.id, row.id));
    }
    seatedPrefects = prefectRows.length;
  }

  await db.insert(auditLog).values({
    schoolId,
    actorRole: "ADMIN",
    actionType: "created",
    entityType: "sickbay_settings",
    entityId: schoolId,
    afterState: {
      mode: "FIRST_AID",
      beds: GENERAL_BEDS + ISOLATION_BEDS,
      slots: CANONICAL_SICKBAY_SLOTS.length,
      prefects: seatedPrefects,
    },
    reason: "Sickbay F0 demo seed (INCR-21)",
  });

  console.log(
    `✓ Seeded sickbay — Mode FIRST_AID, ${GENERAL_BEDS} general + ${ISOLATION_BEDS} isolation beds, ` +
      `${CANONICAL_SICKBAY_SLOTS.length} schedule slots (06:30 anchor), 2 matrons (N&MC N-04827), ` +
      `1 visiting doctor (no login), ${seatedPrefects} health prefects seated.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("✗ Sickbay seed failed:", err);
    process.exit(1);
  });
