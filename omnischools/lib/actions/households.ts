"use server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { safeRevalidate } from "@/lib/revalidate";
import { students, studentGuardians, households } from "@/db/schema";

type Result = { ok: boolean; error?: string };

/** Name a household after its most common last name (else the guardian). */
function householdName(
  group: { lastName: string; guardianName: string | null }[],
): string {
  const counts = new Map<string, number>();
  for (const g of group) counts.set(g.lastName, (counts.get(g.lastName) ?? 0) + 1);
  let best = "";
  let bestN = 0;
  for (const [ln, n] of Array.from(counts)) {
    if (n > bestN) {
      best = ln;
      bestN = n;
    }
  }
  if (best) return `${best} family`;
  return group[0]?.guardianName ? `${group[0].guardianName}'s family` : "Family";
}

export type AutoGroupResult =
  | { ok: true; householdsCreated: number; studentsGrouped: number }
  | { ok: false; error: string };

/**
 * Group active students who share a primary-guardian phone into households —
 * the cheap path to sibling linkage with no manual data entry. Idempotent: only
 * touches students not already in a household, and reuses a sibling's existing
 * household when one already exists.
 */
export async function autoGroupHouseholds(): Promise<AutoGroupResult> {
  const { school } = await requireSchool();
  const actor = await resolveActor(school.id);
  try {
    const result = await withSchool(school.id, async (tx) => {
      const rows = await tx
        .select({
          id: students.id,
          lastName: students.lastName,
          householdId: students.householdId,
          phone: studentGuardians.phone,
          guardianName: studentGuardians.name,
        })
        .from(students)
        .leftJoin(
          studentGuardians,
          and(
            eq(studentGuardians.studentId, students.id),
            eq(studentGuardians.isPrimary, true),
          ),
        )
        .where(and(eq(students.schoolId, school.id), eq(students.status, "ACTIVE")));

      const byPhone = new Map<string, typeof rows>();
      for (const r of rows) {
        const key = r.phone?.trim();
        if (!key) continue;
        const arr = byPhone.get(key) ?? [];
        arr.push(r);
        byPhone.set(key, arr);
      }

      let householdsCreated = 0;
      let studentsGrouped = 0;
      for (const [, group] of Array.from(byPhone)) {
        if (group.length < 2) continue; // a lone student isn't a sibling group
        const ungrouped = group.filter((g) => !g.householdId);
        if (ungrouped.length === 0) continue;

        let householdId = group.find((g) => g.householdId)?.householdId ?? null;
        if (!householdId) {
          const [h] = await tx
            .insert(households)
            .values({ schoolId: school.id, name: householdName(group) })
            .returning({ id: households.id });
          householdId = h.id;
          householdsCreated++;
        }
        const ids = ungrouped.map((g) => g.id);
        await tx
          .update(students)
          .set({ householdId })
          .where(and(eq(students.schoolId, school.id), inArray(students.id, ids)));
        studentsGrouped += ids.length;
      }

      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "updated",
        entityType: "household_autogroup",
        entityId: school.id,
        after: { householdsCreated, studentsGrouped },
        reason: "Siblings auto-grouped by guardian phone",
      });

      return { householdsCreated, studentsGrouped };
    });
    safeRevalidate("/billing");
    return { ok: true, ...result };
  } catch {
    return { ok: false, error: "Could not group families. Please try again." };
  }
}

const SetHouseholdSchema = z.object({
  studentId: z.string().uuid(),
  householdId: z.string().uuid().nullable(),
});

/** Move a student into a household, or out of one (`householdId: null`). */
export async function setStudentHousehold(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  const parsed = SetHouseholdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const { studentId, householdId } = parsed.data;
  try {
    await withSchool(school.id, async (tx) => {
      if (householdId) {
        const [h] = await tx
          .select({ id: households.id })
          .from(households)
          .where(and(eq(households.id, householdId), eq(households.schoolId, school.id)));
        if (!h) throw new Error("household not found");
      }
      await tx
        .update(students)
        .set({ householdId })
        .where(and(eq(students.id, studentId), eq(students.schoolId, school.id)));
    });
    safeRevalidate("/billing");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not update the family." };
  }
}
