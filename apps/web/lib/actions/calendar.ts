"use server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { safeRevalidate } from "@/lib/revalidate";
import { schoolHolidays } from "@/db/schema";

type Result = { ok: boolean; error?: string };

const HolidaySchema = z
  .object({
    name: z.string().min(1, "Name is required").max(80),
    startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
    endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
    kind: z.enum(["PUBLIC", "BREAK", "EVENT", "EXAM"]).default("PUBLIC"),
  })
  .refine((d) => d.endsOn >= d.startsOn, {
    message: "End date can't be before the start date.",
    path: ["endsOn"],
  });

export async function addSchoolHoliday(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  const parsed = HolidaySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const d = parsed.data;
  const actor = await resolveActor(school.id);
  try {
    await withSchool(school.id, async (tx) => {
      const [row] = await tx
        .insert(schoolHolidays)
        .values({
          schoolId: school.id,
          name: d.name.trim(),
          startsOn: d.startsOn,
          endsOn: d.endsOn,
          kind: d.kind,
        })
        .returning({ id: schoolHolidays.id });
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "created",
        entityType: "school_holiday",
        entityId: row.id,
        after: { name: d.name, startsOn: d.startsOn, endsOn: d.endsOn, kind: d.kind },
        reason: "School holiday added",
      });
    });
    safeRevalidate("/settings/attendance");
    safeRevalidate("/attendance");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not add the holiday." };
  }
}

export async function deleteSchoolHoliday(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  const id = z
    .string()
    .uuid()
    .safeParse((input as { id?: string })?.id);
  if (!id.success) return { ok: false, error: "Invalid input." };
  try {
    await withSchool(school.id, (tx) =>
      tx
        .delete(schoolHolidays)
        .where(and(eq(schoolHolidays.id, id.data), eq(schoolHolidays.schoolId, school.id))),
    );
    safeRevalidate("/settings/attendance");
    safeRevalidate("/attendance");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not remove the holiday." };
  }
}
