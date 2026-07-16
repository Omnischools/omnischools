import "../_loadenv";
import { and, eq, like } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  schools,
  houses,
  students,
  classes,
  users,
  auditLog,
  boardingDormitory,
  boardingBunk,
  bunkAllocation,
} from "@/db/schema";
import type { PrefectRole } from "@/lib/boarding/roster";

/**
 * Boarding F0 (INCR-7) demo seed for Asankrangwa — dorms A–H × 15 bunks per House, prefect-tagged
 * bunks, boarder→bunk allocations, and the 🔴 J3 gender-coherence fix: the shipped score-ledger
 * roster cross-assigned boarders to Houses ignoring sex, which the reassign guard would reject.
 * This reseeds each boarder into a gender-matching House before placing them.
 *
 * MARKER-SCOPED + RE-RUN-SAFE: it only ever touches the demo school's boarding spine
 * (boarding_dormitory / boarding_bunk / bunk_allocation — tables nothing else populates) and its
 * own ASK-BRD-* demo students. It never broad-deletes shared baseline data (memory: db:seed is not
 * idempotent). Run AFTER db:seed. `pnpm db:seed-boarding`.
 */

const CAPACITY = 120;
const DORM_NAMES = ["A", "B", "C", "D", "E", "F", "G", "H"];
const BUNKS_PER_DORM = 15;
// Bunk 01 of these dorms is the prefect's bunk (Lucy surface map). Display-only in F0.
const PREFECT_AT_BUNK1: Record<string, PrefectRole> = {
  A: "HEAD",
  B: "DINING",
  C: "SANITATION",
  E: "PREP",
  F: "SICKBAY",
};

const HOUSE_META: Record<string, { gender: "BOYS" | "GIRLS"; colour: string }> = {
  Aggrey: { gender: "BOYS", colour: "#B43A2F" },
  Guggisberg: { gender: "BOYS", colour: "#1A2B47" },
  Fraser: { gender: "BOYS", colour: "#2F6B47" },
  Slessor: { gender: "GIRLS", colour: "#FFFFFF" }, // white — exercises the border-2 guard
  Kingsley: { gender: "GIRLS", colour: "#E5C44A" },
  Aryee: { gender: "GIRLS", colour: "#9B6FAA" },
};

// The J3 fix — move each mismatched boarder into a gender-matching House by student_code.
const GENDER_FIX: { code: string; house: string }[] = [
  { code: "ASK-24-0142", house: "Slessor" }, // Abena Mensah  FEMALE (was Aggrey BOYS)
  { code: "ASK-24-0144", house: "Aryee" }, // Ama Asante    FEMALE (was Fraser BOYS)
  { code: "ASK-24-0147", house: "Aggrey" }, // Kwame Boakye  MALE   (was Aryee GIRLS)
];

const SEP = new Date("2024-09-09T08:00:00Z"); // Form-1 resumption (before the current semester)
const MID_SEM = new Date("2026-02-10T09:00:00Z"); // a move made during Semester 2 (green + swap log)

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

  const houseRows = await db.select().from(houses).where(eq(houses.schoolId, schoolId));
  const houseId = (name: string) => houseRows.find((h) => h.name === name)!.id;
  const [hm] = await db.select({ id: users.id }).from(users).where(eq(users.phone, "+233244000004")); // Mr A. Mensah
  const staffId = hm?.id ?? null;

  // 1) Backfill House config (gender / capacity / colour / Aggrey HM). Idempotent.
  for (const [name, meta] of Object.entries(HOUSE_META)) {
    await db
      .update(houses)
      .set({
        gender: meta.gender,
        capacity: CAPACITY,
        colour: meta.colour,
        ...(name === "Aggrey" ? { hmUserId: staffId } : {}),
      })
      .where(and(eq(houses.schoolId, schoolId), eq(houses.name, name)));
  }

  // 2) J3 gender-coherence fix — reseat mismatched boarders before any placement.
  for (const fix of GENDER_FIX) {
    await db
      .update(students)
      .set({ houseId: houseId(fix.house) })
      .where(and(eq(students.schoolId, schoolId), eq(students.studentCode, fix.code)));
  }

  // 3) Re-run-safe wipe of THIS school's boarding spine (nothing else writes these tables).
  await db.delete(bunkAllocation).where(eq(bunkAllocation.schoolId, schoolId));
  await db
    .update(students)
    .set({ currentBunkId: null })
    .where(eq(students.schoolId, schoolId));
  await db.delete(boardingDormitory).where(eq(boardingDormitory.schoolId, schoolId)); // bunks cascade
  await db
    .delete(students)
    .where(and(eq(students.schoolId, schoolId), like(students.studentCode, "ASK-BRD-%")));

  // 4) Dorms A–H per House, 15 bunks each; bunk 01 of A/B/C/E/F prefect-tagged.
  const dormValues = houseRows.flatMap((h) =>
    DORM_NAMES.map((name) => ({ schoolId, houseId: h.id, name, bunkCount: BUNKS_PER_DORM })),
  );
  const dormRows = await db.insert(boardingDormitory).values(dormValues).returning();
  const dormKey = (house: string, dorm: string) => `${house}|${dorm}`;
  const dormIdByKey = new Map(
    dormRows.map((d) => [dormKey(houseRows.find((h) => h.id === d.houseId)!.name, d.name), d.id]),
  );

  const bunkValues = dormRows.flatMap((d) =>
    Array.from({ length: BUNKS_PER_DORM }, (_, i) => ({
      schoolId,
      dormitoryId: d.id,
      positionNumber: i + 1,
      prefectRole: i === 0 ? (PREFECT_AT_BUNK1[d.name] ?? null) : null,
    })),
  );
  const bunkRows = await db.insert(boardingBunk).values(bunkValues).returning();
  const dormNameById = new Map(dormRows.map((d) => [d.id, d.name]));
  const houseNameByDormId = new Map(
    dormRows.map((d) => [d.id, houseRows.find((h) => h.id === d.houseId)!.name]),
  );
  const bunkKey = (house: string, dorm: string, pos: number) => `${house}|${dorm}|${pos}`;
  const bunkIdByKey = new Map(
    bunkRows.map((b) => [
      bunkKey(houseNameByDormId.get(b.dormitoryId)!, dormNameById.get(b.dormitoryId)!, b.positionNumber),
      b.id,
    ]),
  );
  const bunkAt = (house: string, dorm: string, pos: number) => bunkIdByKey.get(bunkKey(house, dorm, pos))!;

  // 5) Two demo Aggrey boarders (marker ASK-BRD-*) so the roster shows the gold + green states.
  const [form2ga] = await db
    .select({ id: classes.id })
    .from(classes)
    .where(and(eq(classes.schoolId, schoolId), eq(classes.name, "Form 2 General Arts A")));
  const demoRows = await db
    .insert(students)
    .values([
      {
        schoolId,
        studentCode: "ASK-BRD-AGG-01",
        firstName: "Samuel",
        lastName: "Adjei",
        sex: "MALE" as const,
        status: "ACTIVE" as const,
        classId: form2ga?.id ?? null,
        programme: "GENERAL_ARTS" as const,
        residency: "BOARDER" as const,
        houseId: houseId("Aggrey"),
        enrolledOn: "2024-09-09",
      },
      {
        schoolId,
        studentCode: "ASK-BRD-AGG-02",
        firstName: "Kojo",
        lastName: "Owusu",
        sex: "MALE" as const,
        status: "ACTIVE" as const,
        classId: form2ga?.id ?? null,
        programme: "GENERAL_ARTS" as const,
        residency: "BOARDER" as const,
        houseId: houseId("Aggrey"),
        enrolledOn: "2024-09-09",
      },
    ])
    .returning();
  const demoId = (code: string) => demoRows.find((r) => r.studentCode === code)!.id;

  const studentByCode = new Map(
    (await db.select().from(students).where(eq(students.schoolId, schoolId))).map((s) => [
      s.studentCode,
      s.id,
    ]),
  );
  const sid = (code: string) => studentByCode.get(code)!;

  // 6) Placements — open allocation + current_bunk_id pointer. Kojo carries a closed→open pair
  //    (a move this semester) so he renders green AND appears in the swap log.
  type Place = { code: string; house: string; dorm: string; pos: number; reason: string; from: Date };
  const placements: Place[] = [
    { code: "ASK-24-0118", house: "Aggrey", dorm: "D", pos: 3, from: SEP, reason: "Initial placement · Form 1 (Sept 2024)" }, // Manu — flagged
    { code: "ASK-24-0147", house: "Aggrey", dorm: "A", pos: 2, from: SEP, reason: "Placed on transfer into Aggrey" }, // Kwame — neutral
    { code: "ASK-BRD-AGG-01", house: "Aggrey", dorm: "A", pos: 1, from: SEP, reason: "Head of House · senior dorm" }, // Samuel — prefect (gold)
    { code: "ASK-24-0149", house: "Guggisberg", dorm: "A", pos: 2, from: SEP, reason: "Initial placement · Form 1" }, // Kofi
    { code: "ASK-24-0146", house: "Kingsley", dorm: "A", pos: 2, from: SEP, reason: "Initial placement · Form 1" }, // Efua
    { code: "ASK-24-0142", house: "Slessor", dorm: "A", pos: 2, from: SEP, reason: "Initial placement · Form 1" }, // Abena
    { code: "ASK-24-0144", house: "Aryee", dorm: "A", pos: 2, from: SEP, reason: "Initial placement · Form 1" }, // Ama
  ];

  const allocValues: (typeof bunkAllocation.$inferInsert)[] = [];
  for (const p of placements) {
    allocValues.push({
      schoolId,
      studentId: sid(p.code),
      bunkId: bunkAt(p.house, p.dorm, p.pos),
      fromAt: p.from,
      reason: p.reason,
      allocatedByUserId: staffId ?? undefined,
    });
  }
  // Kojo — initial G-03 (closed) then a Semester-2 move to A-05 (open) → green + one logged swap.
  const kojo = demoId("ASK-BRD-AGG-02");
  allocValues.push({
    schoolId,
    studentId: kojo,
    bunkId: bunkAt("Aggrey", "G", 3),
    fromAt: SEP,
    toAt: MID_SEM,
    reason: "Initial placement · Form 1",
    allocatedByUserId: staffId ?? undefined,
  });
  allocValues.push({
    schoolId,
    studentId: kojo,
    bunkId: bunkAt("Aggrey", "A", 5),
    fromAt: MID_SEM,
    reason: "Moved nearer the Prep prefect this semester",
    allocatedByUserId: staffId ?? undefined,
  });
  await db.insert(bunkAllocation).values(allocValues);

  // Current-bunk pointers (the live one-per-bunk state; Kojo → his open A-05).
  const pointers: { code: string; bunkId: string }[] = placements.map((p) => ({
    code: p.code,
    bunkId: bunkAt(p.house, p.dorm, p.pos),
  }));
  pointers.push({ code: "ASK-BRD-AGG-02", bunkId: bunkAt("Aggrey", "A", 5) });
  for (const ptr of pointers) {
    await db
      .update(students)
      .set({ currentBunkId: ptr.bunkId })
      .where(and(eq(students.schoolId, schoolId), eq(students.id, sid(ptr.code))));
  }

  await db.insert(auditLog).values({
    schoolId,
    actorUserId: staffId ?? undefined,
    actorRole: "HOUSEMASTER",
    actionType: "created",
    entityType: "boarding_spine",
    entityId: schoolId,
    afterState: {
      houses: houseRows.length,
      dorms: dormRows.length,
      bunks: bunkRows.length,
      allocations: allocValues.length,
    },
    reason: "Boarding F0 demo seed (dorms · bunks · allocations · J3 gender fix)",
  });

  console.log(
    `✓ Boarding seed — ${dormRows.length} dorms, ${bunkRows.length} bunks, ${allocValues.length} allocations, ` +
      `J3 gender fix applied (Abena→Slessor, Ama→Aryee, Kwame→Aggrey), J. Manu at Aggrey D-03.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("✗ Boarding seed failed:", err);
    process.exit(1);
  });
