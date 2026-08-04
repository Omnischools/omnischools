"use server";
import { z } from "zod";
import { safeRevalidate } from "@/lib/revalidate";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, assertAnyRole, resolveActor } from "@/lib/auth/server";
import { FACILITIES_WRITE_ROLES } from "@/lib/access";
import { facilitiesSnapshot } from "@/db/schema";

/**
 * GOV-7 · facilities-snapshot capture action (management-gated). The facilities census is a school-level
 * governance record, so the action re-checks `FACILITIES_WRITE_ROLES` server-side (a hand-crafted POST that
 * never touched the UI is still refused) BEFORE any DB work, UPSERTs on the UNIQUE (school, period) target
 * (R376) — a re-submitted term overwrites its row, never appends — and writes an audit row in the same
 * transaction. NO CSV import (R383): manual native-form capture only.
 *
 * Core fields (classrooms / all WASH / status booleans) are REQUIRED; the optional detail is nullable
 * (R375). The zod schema surfaces the two cross-column DB CHECKs (good+repair ≤ total; working ≤ total) as
 * friendly messages, so a valid-looking-but-inconsistent row never reaches the DB.
 */

const nonNegInt = z.number().int().min(0);
const optNonNegInt = nonNegInt.nullable();

const SnapshotShape = z
  .object({
    periodId: z.string().uuid(),

    // Classrooms (required).
    classroomsTotal: nonNegInt,
    classroomsGood: nonNegInt,
    classroomsRepair: nonNegInt,

    // WASH (required).
    waterSource: z.enum(["BOREHOLE", "PIPE", "WELL", "NONE"]),
    electricitySource: z.enum(["GRID", "SOLAR", "GENERATOR", "NONE"]),
    latrinesBoys: nonNegInt,
    latrinesGirls: nonNegInt,
    latrinesStaff: nonNegInt,
    latrineType: z.enum(["WC", "KVIP", "PIT", "NONE"]),
    handwashing: z.boolean(),

    // Facility presence (required).
    hasLibrary: z.boolean(),
    hasIctLab: z.boolean(),
    internet: z.boolean(),
    hasKitchen: z.boolean(),
    gsfpParticipating: z.boolean(),

    // Optional detail (nullable — an omitted value passes the DB's NULL-satisfied CHECKs).
    libraryBookCount: optNonNegInt,
    libraryStaffFte: z.number().min(0).nullable(),
    computersTotal: optNonNegInt,
    computersWorking: optNonNegInt,
    internetType: z.string().max(60).nullable(),
    mealsServedLastTerm: optNonNegInt,
    pupilsFedDailyAvg: optNonNegInt,
    catererName: z.string().max(120).nullable(),
    textbookAvailability: z.enum(["ADEQUATE", "INADEQUATE"]).nullable(),
    studentDesksUsable: optNonNegInt,
    studentDesksBroken: optNonNegInt,
    teacherDesks: optNonNegInt,
    chalkboards: optNonNegInt,
    whiteboards: optNonNegInt,
    projectors: optNonNegInt,

    note: z.string().max(500).nullable(),
  })
  // The two cross-column invariants the DB CHECKs enforce, surfaced here as friendly messages (GOV7-04).
  .refine((d) => d.classroomsGood + d.classroomsRepair <= d.classroomsTotal, {
    message: "Good + needing-repair classrooms cannot exceed the total.",
    path: ["classroomsRepair"],
  })
  .refine(
    (d) => d.computersWorking == null || d.computersTotal == null || d.computersWorking <= d.computersTotal,
    { message: "Working computers cannot exceed total computers.", path: ["computersWorking"] },
  );

type Snapshot = z.infer<typeof SnapshotShape>;

export type SaveFacilitiesResult = { ok: true } | { ok: false; error: string };

/** The insert/update column bag — identical between the insert values and the conflict `set`. */
function columns(d: Snapshot, actorId: string | null) {
  return {
    classroomsTotal: d.classroomsTotal,
    classroomsGood: d.classroomsGood,
    classroomsRepair: d.classroomsRepair,
    waterSource: d.waterSource,
    electricitySource: d.electricitySource,
    latrinesBoys: d.latrinesBoys,
    latrinesGirls: d.latrinesGirls,
    latrinesStaff: d.latrinesStaff,
    latrineType: d.latrineType,
    handwashing: d.handwashing,
    hasLibrary: d.hasLibrary,
    hasIctLab: d.hasIctLab,
    internet: d.internet,
    hasKitchen: d.hasKitchen,
    gsfpParticipating: d.gsfpParticipating,
    libraryBookCount: d.libraryBookCount,
    // numeric(4,1) → Drizzle wants a string; keep null as null.
    libraryStaffFte: d.libraryStaffFte == null ? null : String(d.libraryStaffFte),
    computersTotal: d.computersTotal,
    computersWorking: d.computersWorking,
    internetType: d.internetType,
    mealsServedLastTerm: d.mealsServedLastTerm,
    pupilsFedDailyAvg: d.pupilsFedDailyAvg,
    catererName: d.catererName,
    textbookAvailability: d.textbookAvailability,
    studentDesksUsable: d.studentDesksUsable,
    studentDesksBroken: d.studentDesksBroken,
    teacherDesks: d.teacherDesks,
    chalkboards: d.chalkboards,
    whiteboards: d.whiteboards,
    projectors: d.projectors,
    note: d.note,
    capturedBy: actorId ?? undefined,
    capturedAt: new Date(),
  };
}

export async function saveFacilitiesSnapshot(input: unknown): Promise<SaveFacilitiesResult> {
  const { school } = await requireSchool();
  await assertAnyRole(FACILITIES_WRITE_ROLES);
  const parsed = SnapshotShape.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid snapshot." };
  }
  const d = parsed.data;
  const actor = await resolveActor(school.id);
  try {
    await withSchool(school.id, async (tx) => {
      const cols = columns(d, actor.id);
      await tx
        .insert(facilitiesSnapshot)
        .values({ schoolId: school.id, periodId: d.periodId, ...cols })
        .onConflictDoUpdate({
          // The idempotency target (R376) — one census per (school × term); re-submit overwrites.
          target: [facilitiesSnapshot.schoolId, facilitiesSnapshot.periodId],
          set: cols,
        });
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "captured",
        entityType: "facilities_snapshot",
        after: {
          periodId: d.periodId,
          classroomsTotal: d.classroomsTotal,
          classroomsGood: d.classroomsGood,
          classroomsRepair: d.classroomsRepair,
          waterSource: d.waterSource,
          electricitySource: d.electricitySource,
          latrineType: d.latrineType,
          hasLibrary: d.hasLibrary,
          hasIctLab: d.hasIctLab,
          hasKitchen: d.hasKitchen,
          gsfpParticipating: d.gsfpParticipating,
        },
        reason: "Facilities snapshot captured",
      });
    });
    safeRevalidate("/reports/facilities");
    safeRevalidate("/board");
    return { ok: true };
  } catch {
    // A bad periodId trips the composite FK; any inconsistent row trips a DB CHECK — both land here.
    return { ok: false, error: "Could not save the snapshot. Check the term and figures, then try again." };
  }
}
