"use server";
import { z } from "zod";
import { safeRevalidate } from "@/lib/revalidate";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, assertAnyRole, resolveActor } from "@/lib/auth/server";
import { TERMINAL_RESULTS_WRITE_ROLES } from "@/lib/access";
import { examTypesFor, MIN_SITTING_YEAR, maxSittingYear } from "@/lib/import/terminal-results-import";
import { terminalExamResult } from "@/db/schema";
import type { Tx } from "@/lib/db";
import type { ActiveSchool } from "@/lib/auth/server";

/**
 * GOV-6 · terminal-exam-results capture actions (management-gated). Terminal results are OFFICIAL school
 * outcomes, so EVERY action re-checks `TERMINAL_RESULTS_WRITE_ROLES` server-side (a hand-crafted POST that
 * never touched the UI is still refused) BEFORE any DB work, tier-gates the exam_type against the school's
 * DB-authoritative `schoolType` (R367), UPSERTs on the UNIQUE (school, exam_type, year) target (R370),
 * and writes an audit row in the same transaction. AGGREGATE-ONLY — the four sex-split leaf counts, never
 * a candidate. total/passed/passRate are NEVER stored (derived at read — R364).
 */

const CountsSchema = {
  femaleCandidates: z.number().int().min(0),
  maleCandidates: z.number().int().min(0),
  femalePassed: z.number().int().min(0),
  malePassed: z.number().int().min(0),
};

const SittingShape = z
  .object({
    examType: z.enum(["BECE", "WASSCE"]),
    year: z.number().int().min(MIN_SITTING_YEAR).max(maxSittingYear()),
    ...CountsSchema,
    note: z.string().max(500).optional().or(z.literal("")),
  })
  // passed ≤ candidates per sex, and ≥ 1 candidate — the same invariants the DB CHECKs enforce, surfaced
  // here as friendly messages (and so a valid-looking-but-inconsistent row never reaches the DB).
  .refine((d) => d.femalePassed <= d.femaleCandidates, {
    message: "Female passed cannot exceed female candidates.",
    path: ["femalePassed"],
  })
  .refine((d) => d.malePassed <= d.maleCandidates, {
    message: "Male passed cannot exceed male candidates.",
    path: ["malePassed"],
  })
  .refine((d) => d.femaleCandidates + d.maleCandidates >= 1, {
    message: "A sitting needs at least one candidate.",
    path: ["femaleCandidates"],
  });

type Sitting = z.infer<typeof SittingShape>;

export type SaveTerminalResultResult = { ok: true } | { ok: false; error: string };

/** True when the school's tier offers this exam (R367). */
function tierAllows(school: ActiveSchool, examType: "BECE" | "WASSCE"): boolean {
  return examTypesFor(school.schoolType).includes(examType);
}

/** UPSERT one sitting + its audit row, inside one tenant-scoped transaction. */
async function upsertSitting(
  tx: Tx,
  schoolId: string,
  actor: { id: string | null; role: string },
  d: Sitting,
): Promise<void> {
  await tx
    .insert(terminalExamResult)
    .values({
      schoolId,
      examType: d.examType,
      year: d.year,
      femaleCandidates: d.femaleCandidates,
      maleCandidates: d.maleCandidates,
      femalePassed: d.femalePassed,
      malePassed: d.malePassed,
      note: d.note ? d.note : null,
      capturedBy: actor.id ?? undefined,
      capturedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [terminalExamResult.schoolId, terminalExamResult.examType, terminalExamResult.year],
      set: {
        femaleCandidates: d.femaleCandidates,
        maleCandidates: d.maleCandidates,
        femalePassed: d.femalePassed,
        malePassed: d.malePassed,
        note: d.note ? d.note : null,
        capturedBy: actor.id ?? undefined,
        capturedAt: new Date(),
      },
    });

  await recordAudit(tx, {
    schoolId,
    actorUserId: actor.id ?? undefined,
    actorRole: actor.role,
    actionType: "captured",
    entityType: "terminal_exam_result",
    after: {
      examType: d.examType,
      year: d.year,
      femaleCandidates: d.femaleCandidates,
      maleCandidates: d.maleCandidates,
      femalePassed: d.femalePassed,
      malePassed: d.malePassed,
    },
    reason: "Terminal exam result captured",
  });
}

// ------------------------------------------------------------- single capture / update
export async function saveTerminalResult(input: unknown): Promise<SaveTerminalResultResult> {
  const { school } = await requireSchool();
  await assertAnyRole(TERMINAL_RESULTS_WRITE_ROLES);
  const parsed = SittingShape.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid result." };
  }
  const d = parsed.data;
  if (!tierAllows(school, d.examType)) {
    return { ok: false, error: `${d.examType} is not offered by this school.` };
  }
  const actor = await resolveActor(school.id);
  try {
    await withSchool(school.id, (tx) => upsertSitting(tx, school.id, actor, d));
    safeRevalidate("/reports/terminal-results");
    safeRevalidate("/board");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not save the result. Please try again." };
  }
}

// ------------------------------------------------------------- bulk CSV import
const ImportSchema = z.object({ rows: z.array(SittingShape).min(1, "No rows to import").max(200) });

export type ImportTerminalResultsResult =
  | { ok: true; imported: number; skipped: number }
  | { ok: false; error: string };

export async function importTerminalResults(input: unknown): Promise<ImportTerminalResultsResult> {
  const { school } = await requireSchool();
  await assertAnyRole(TERMINAL_RESULTS_WRITE_ROLES);
  const parsed = ImportSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid import." };
  }
  const actor = await resolveActor(school.id);
  try {
    const { imported, skipped } = await withSchool(school.id, async (tx) => {
      let imported = 0;
      let skipped = 0;
      for (const d of parsed.data.rows) {
        // REJECT-NOT-FABRICATE, server-side: a wrong-tier row is skipped, the rest still import (R371).
        if (!tierAllows(school, d.examType)) {
          skipped++;
          continue;
        }
        await upsertSitting(tx, school.id, actor, d);
        imported++;
      }
      return { imported, skipped };
    });
    safeRevalidate("/reports/terminal-results");
    safeRevalidate("/board");
    return { ok: true, imported, skipped };
  } catch {
    return { ok: false, error: "Could not import results. Please try again." };
  }
}
