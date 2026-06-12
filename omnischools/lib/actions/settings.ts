"use server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { safeRevalidate } from "@/lib/revalidate";
import { schools, gradebookConfig } from "@/db/schema";

// --------------------------------------------------------------- school profile
const ProfileSchema = z.object({
  name: z.string().min(2, "School name is too short").max(120),
  shortName: z
    .string()
    .max(12, "Sign-off must be 12 characters or fewer")
    .optional()
    .or(z.literal("")),
});

export async function updateSchoolProfile(
  input: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const { school } = await requireSchool();
  const parsed = ProfileSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const actor = await resolveActor(school.id);
  try {
    await withSchool(school.id, async (tx) => {
      await tx
        .update(schools)
        .set({
          name: parsed.data.name.trim(),
          shortName: parsed.data.shortName
            ? parsed.data.shortName.trim().toUpperCase()
            : null,
        })
        .where(eq(schools.id, school.id));
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "updated",
        entityType: "school",
        entityId: school.id,
        after: { name: parsed.data.name },
        reason: "School profile updated",
      });
    });
    safeRevalidate("/settings");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not save changes. Please try again." };
  }
}

// --------------------------------------------------------------- grading weights
const WeightsSchema = z
  .object({
    classWeight: z.coerce.number().int().min(0).max(100),
    examWeight: z.coerce.number().int().min(0).max(100),
  })
  .refine((d) => d.classWeight + d.examWeight === 100, {
    message: "Class and exam weights must add up to 100%.",
  });

export async function updateGradingWeights(
  input: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const { school } = await requireSchool();
  const parsed = WeightsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid weights" };
  }
  const actor = await resolveActor(school.id);
  try {
    await withSchool(school.id, async (tx) => {
      await tx
        .insert(gradebookConfig)
        .values({
          schoolId: school.id,
          classWeight: parsed.data.classWeight,
          examWeight: parsed.data.examWeight,
        })
        .onConflictDoUpdate({
          target: gradebookConfig.schoolId,
          set: {
            classWeight: parsed.data.classWeight,
            examWeight: parsed.data.examWeight,
          },
        });
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "updated",
        entityType: "gradebook_config",
        entityId: school.id,
        after: {
          classWeight: parsed.data.classWeight,
          examWeight: parsed.data.examWeight,
        },
        reason: "Grading weights updated",
      });
    });
    safeRevalidate("/settings");
    safeRevalidate("/gradebook");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not save weights. Please try again." };
  }
}
