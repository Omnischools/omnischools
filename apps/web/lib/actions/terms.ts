"use server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withSchool } from "@/lib/db/rls";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { recordAudit } from "@/lib/db/audit";
import { safeRevalidate } from "@/lib/revalidate";
import { academicPeriod } from "@/db/schema";

type Result = { ok: boolean; error?: string };
const IdSchema = z.object({ periodId: z.string().uuid() });

/**
 * Close a term: finalise it. A closed term's gradebook scores and attendance become
 * read-only (enforced in saveColumnScores / saveAttendance) and the next term becomes the
 * school's active working term. Admin action; audited. Reversible via reopenTerm.
 */
export async function closeTerm(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  const parsed = IdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const { periodId } = parsed.data;
  const actor = await resolveActor(school.id);
  try {
    const out = await withSchool(school.id, async (tx) => {
      const [p] = await tx
        .select({
          periodLabel: academicPeriod.periodLabel,
          closedAt: academicPeriod.closedAt,
        })
        .from(academicPeriod)
        .where(and(eq(academicPeriod.periodId, periodId), eq(academicPeriod.schoolId, school.id)));
      if (!p) return { ok: false as const, error: "Term not found." };
      if (p.closedAt) return { ok: false as const, error: `${p.periodLabel} is already closed.` };
      await tx
        .update(academicPeriod)
        .set({ closedAt: new Date(), closedByUserId: actor.id ?? undefined })
        .where(and(eq(academicPeriod.periodId, periodId), eq(academicPeriod.schoolId, school.id)));
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "closed",
        entityType: "academic_period",
        entityId: periodId,
        after: { periodLabel: p.periodLabel },
        reason: `${p.periodLabel} closed`,
      });
      return { ok: true as const };
    });
    if (!out.ok) return out;
    safeRevalidate("/settings/academic");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not close the term." };
  }
}

/** Reopen a closed term — makes its scores and attendance editable again. Admin; audited. */
export async function reopenTerm(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  const parsed = IdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const { periodId } = parsed.data;
  const actor = await resolveActor(school.id);
  try {
    const out = await withSchool(school.id, async (tx) => {
      const [p] = await tx
        .select({
          periodLabel: academicPeriod.periodLabel,
          closedAt: academicPeriod.closedAt,
        })
        .from(academicPeriod)
        .where(and(eq(academicPeriod.periodId, periodId), eq(academicPeriod.schoolId, school.id)));
      if (!p) return { ok: false as const, error: "Term not found." };
      if (!p.closedAt) return { ok: false as const, error: `${p.periodLabel} is already open.` };
      await tx
        .update(academicPeriod)
        .set({ closedAt: null, closedByUserId: null })
        .where(and(eq(academicPeriod.periodId, periodId), eq(academicPeriod.schoolId, school.id)));
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "reopened",
        entityType: "academic_period",
        entityId: periodId,
        after: { periodLabel: p.periodLabel },
        reason: `${p.periodLabel} reopened`,
      });
      return { ok: true as const };
    });
    if (!out.ok) return out;
    safeRevalidate("/settings/academic");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not reopen the term." };
  }
}
