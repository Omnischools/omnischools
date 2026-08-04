"use server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { safeRevalidate } from "@/lib/revalidate";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, assertAnyRole, resolveActor } from "@/lib/auth/server";
import { CENSUS_WRITE_ROLES } from "@/lib/access";
import { censusReturn } from "@/db/schema";
import { captureError } from "@/lib/observability";
import { generateCensusSnapshot } from "@/lib/reports/census/generate";
import { parseCensusSnapshot } from "@/lib/reports/census/schema";
import { computeCensusView } from "@/lib/reports/census/view";

/**
 * GOV-8 · the census generation action (management-gated, R402). It COMPOSES the live readers into a frozen
 * snapshot server-side and UPSERTs one DRAFT `census_return` per (school × cadence × academic_year) — the
 * idempotency target (GOV8-01). The snapshot is generated HERE, never trusted from the client (a hand-crafted
 * POST carries only the cadence/period; the school id is the SESSION's, never the request's — GOV8-14), and
 * `census_date` is frozen to now so a later roll change cannot move a filed census (GOV8-02).
 *
 * Dual gate: the page runs `requireSchoolRole(CENSUS_WRITE_ROLES)`; this action re-checks `assertAnyRole`
 * BEFORE any DB work. Regenerate-while-DRAFT overwrites; a COMPLETED return is locked (defended twice — the
 * pre-read and the `WHERE status = 'DRAFT'` on the upsert). The audit `after` carries only cadence/year/
 * coverage counts — no per-student/per-staff figure (census_return is SHOWN).
 */

const InputShape = z.object({
  cadence: z.enum(["MID_YEAR", "ANNUAL"]),
  periodId: z.string().uuid().optional(),
});

export type SaveCensusResult = { ok: true; academicYear: string } | { ok: false; error: string };

export async function saveCensusReturn(input: unknown): Promise<SaveCensusResult> {
  const { school } = await requireSchool();
  await assertAnyRole(CENSUS_WRITE_ROLES);

  const parsed = InputShape.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { cadence, periodId } = parsed.data;

  // Freeze the point-in-time, then compose the snapshot from the live readers (session school only).
  const censusDate = new Date();
  const snapshot = await generateCensusSnapshot(school.id, { cadence, censusDate, periodId });
  // Belt-and-suspenders: validate the envelope against the versioned Zod schema before it is persisted.
  parseCensusSnapshot(snapshot);
  const academicYear = snapshot.academicYear;
  if (!academicYear) {
    return { ok: false, error: "Configure an academic year before generating a census." };
  }

  const view = computeCensusView(snapshot, cadence);
  const actor = await resolveActor(school.id);

  try {
    const result = await withSchool(school.id, async (tx) => {
      // A COMPLETED return is locked — regenerating only overwrites a DRAFT (OC-CENSUS-STATUS default).
      const existing = await tx
        .select({ status: censusReturn.status })
        .from(censusReturn)
        .where(
          and(
            eq(censusReturn.schoolId, school.id),
            eq(censusReturn.cadence, cadence),
            eq(censusReturn.academicYear, academicYear),
          ),
        )
        .limit(1);
      if (existing[0]?.status === "COMPLETED") return { locked: true as const };

      const cols = {
        status: "DRAFT" as const,
        censusDate: snapshot.censusDate,
        autoSnapshot: snapshot,
        generatedBy: actor.id ?? undefined,
        generatedAt: new Date(),
        updatedAt: new Date(),
      };
      await tx
        .insert(censusReturn)
        .values({ schoolId: school.id, cadence, academicYear, ...cols })
        .onConflictDoUpdate({
          // Idempotency / upsert target (GOV8-01): one return per (school × cadence × year); re-generate
          // overwrites — but only a DRAFT (a COMPLETED filing is never silently clobbered).
          target: [censusReturn.schoolId, censusReturn.cadence, censusReturn.academicYear],
          set: cols,
          where: eq(censusReturn.status, "DRAFT"),
        });

      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "generated",
        entityType: "census_return",
        after: {
          cadence,
          academicYear,
          censusDate: snapshot.censusDate,
          fillPct: view.fillPct,
          fullSections: view.fullCount,
          inScopeSections: view.inScopeCount,
        },
        reason: `Generated ${cadence === "MID_YEAR" ? "mid-year" : "annual"} census (DRAFT)`,
      });
      return { locked: false as const };
    });

    if (result.locked) {
      return { ok: false, error: "This census is already completed and locked." };
    }
    safeRevalidate("/reports/statutory/generate-annual-census");
    return { ok: true, academicYear };
  } catch (err) {
    // A failed statutory filing must leave a server-side trail (LOW-2) — the admin still gets a friendly
    // message, never a stack trace.
    captureError(err, { action: "saveCensusReturn", cadence, academicYear });
    return { ok: false, error: "Could not generate the census. Please try again." };
  }
}
