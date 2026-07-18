"use server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor, type ActiveSchool } from "@/lib/auth/server";
import { getCurrentUser, type AppUser } from "@/lib/auth";
import { hasAnyRole, BOARDING_ROLES, canAccessHouse } from "@/lib/access";
import { safeRevalidate } from "@/lib/revalidate";
import { boardingArrival, students, houses, schools } from "@/db/schema";
import { getCurrentPeriod } from "@/lib/boarding/period";
import { feeOwingForStudent } from "@/lib/boarding/exeat-data";
import { checklistSchemaFor, type BoardingMode } from "@/lib/boarding/resumption";
import { sendArrivalNotification, runUnaccountedSweep } from "@/lib/boarding/resumption-notify";

type ActionResult = { ok: boolean; error?: string; message?: string; feeOwing?: number };
const forbidden: ActionResult = { ok: false, error: "Your role cannot perform this action." };

const opsPath = (mode: BoardingMode) => `/senior/boarding/operations/${mode.toLowerCase()}`;

/** Shared guard: signed-in staff holding a BOARDING role, else null (mirrors the exeat/daily action). */
async function ctx(): Promise<{ school: ActiveSchool; user: AppUser } | null> {
  const { school } = await requireSchool();
  const user = await getCurrentUser();
  if (!user || !hasAnyRole(user.roles, BOARDING_ROLES)) return null;
  return { school, user };
}

const GateCheckInput = z.object({
  studentId: z.string().uuid(),
  mode: z.enum(["RESUMPTION", "VACATION"]),
  checklist: z.record(z.string(), z.enum(["ok", "partial", "missing"])),
  note: z.string().trim().max(500).optional(),
});

/**
 * Record a boarder's gate check (AC D–F, M) — RESUMPTION arrival / VACATION departure. Upserts on
 * uniq_boarding_arrival(school, student, period, mode) so a re-scan updates the ONE row, never a dup
 * (AC M1). The checklist is Zod-validated by mode (6-key RESUMPTION / 5-key VACATION, 3-state — AC
 * D2/D5). The live fee balance is frozen to fee_owing_snapshot (AC E1) and NEVER blocks (GES cannot-
 * detain — the row always records, the flag is surfaced not enforced — AC E2). The bunk is confirmed
 * live from current_bunk_id (no bunk column — AC F). House-scoped for a plain HM, audited, atomic. The
 * arrival/departure confirmation SMS fires (console) only on the FIRST check-in, not on a re-scan.
 */
export async function recordGateCheck(input: unknown): Promise<ActionResult> {
  const c = await ctx();
  if (!c) return forbidden;
  const parsed = GateCheckInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid gate check." };
  const { studentId, mode, note } = parsed.data;

  // Strict per-mode checklist shape (rejects wrong/extra/missing keys — the inspections pattern).
  const checklist = checklistSchemaFor(mode).safeParse(parsed.data.checklist);
  if (!checklist.success) {
    return { ok: false, error: `Checklist must carry exactly the ${mode.toLowerCase()} items, each ok/partial/missing.` };
  }

  const { school, user } = c;
  const actor = await resolveActor(school.id);

  const out = await withSchool(school.id, async (tx): Promise<ActionResult & { isNew?: boolean; schoolName?: string }> => {
    const period = await getCurrentPeriod(tx, school.id);
    if (!period) return { ok: false, error: "No SHS semester is configured." };

    const [stu] = await tx
      .select({ residency: students.residency, status: students.status, houseId: students.houseId })
      .from(students)
      .where(and(eq(students.schoolId, school.id), eq(students.id, studentId)))
      .limit(1);
    if (!stu || !stu.houseId) return { ok: false, error: "That student is not in a House." };
    if (stu.status !== "ACTIVE" || stu.residency !== "BOARDER") {
      return { ok: false, error: "Only an active boarder can be gate-checked (day students are not on the roster)." };
    }
    // House-scope (AC L3) — a plain HOUSEMASTER only for the House they master.
    const [house] = await tx
      .select({ hmUserId: houses.hmUserId })
      .from(houses)
      .where(and(eq(houses.schoolId, school.id), eq(houses.id, stu.houseId)))
      .limit(1);
    if (!canAccessHouse(user.roles, user.id, house?.hmUserId)) {
      return { ok: false, error: "You can only gate-check the House you are assigned to." };
    }

    // Live fee balance frozen to the snapshot — a FLAG, never a block (AC E1/E2).
    const feeOwing = await feeOwingForStudent(tx, school.id, studentId);
    const feeSnapshot = feeOwing > 0 ? feeOwing.toFixed(2) : null;

    // SMS-once: was there already a row for this (student × period × mode)? Only a first check-in sends.
    const existing = await tx
      .select({ id: boardingArrival.id })
      .from(boardingArrival)
      .where(
        and(
          eq(boardingArrival.schoolId, school.id),
          eq(boardingArrival.studentId, studentId),
          eq(boardingArrival.academicPeriodId, period.periodId),
          eq(boardingArrival.mode, mode),
        ),
      )
      .limit(1);
    const isNew = existing.length === 0;

    const now = new Date();
    const [row] = await tx
      .insert(boardingArrival)
      .values({
        schoolId: school.id,
        studentId,
        houseId: stu.houseId, // snapshot of the boarder's House at check time
        academicPeriodId: period.periodId,
        mode,
        checklistJson: checklist.data,
        feeOwingSnapshot: feeSnapshot ?? undefined,
        note: note ?? null,
        checkedAt: now,
        checkedByUserId: actor.id ?? undefined,
      })
      .onConflictDoUpdate({
        target: [
          boardingArrival.schoolId,
          boardingArrival.studentId,
          boardingArrival.academicPeriodId,
          boardingArrival.mode,
        ],
        set: {
          houseId: stu.houseId,
          checklistJson: checklist.data,
          feeOwingSnapshot: feeSnapshot,
          note: note ?? null,
          checkedAt: now,
          checkedByUserId: actor.id ?? undefined,
        },
      })
      .returning({ id: boardingArrival.id });

    const [sch] = await tx.select({ name: schools.name }).from(schools).where(eq(schools.id, school.id)).limit(1);

    await recordAudit(tx, {
      schoolId: school.id,
      actorUserId: actor.id ?? undefined,
      actorRole: actor.role,
      actionType: mode === "RESUMPTION" ? "BOARDING_ARRIVAL_RECORDED" : "BOARDING_DEPARTURE_RECORDED",
      entityType: "boarding_arrival",
      entityId: row.id,
      after: {
        studentId,
        mode,
        feeSnapshot,
        feeFlagged: feeOwing > 0,
        checklist: checklist.data,
        rescan: !isNew,
      },
      reason: note ?? undefined,
    });

    return { ok: true, feeOwing, isNew, schoolName: sch?.name ?? "School" };
  });

  if (!out.ok) return out;

  // Fire the confirmation SMS (console) after commit, only on a first check-in (re-scan never re-sends).
  if (out.isNew) {
    await withSchool(school.id, (tx) =>
      sendArrivalNotification(tx, school.id, studentId, mode, out.schoolName ?? "School").then(() => undefined),
    );
  }

  safeRevalidate(opsPath(mode));
  const feeNote = (out.feeOwing ?? 0) > 0 ? " Fee owing flagged (not blocked)." : "";
  return {
    ok: true,
    feeOwing: out.feeOwing,
    message: `${mode === "RESUMPTION" ? "Arrival" : "Departure"} recorded.${feeNote}`,
  };
}

/**
 * Triggered unaccounted sweep (AC G2/I2) — derives the unaccounted boarders on-read and fires the
 * parent a console SMS for each. No cron, no discipline write (INCR-13 stub). BOARDING_ROLES gated.
 */
export async function runUnaccountedChecks(dateIso?: string): Promise<ActionResult> {
  const c = await ctx();
  if (!c) return forbidden;
  const { school, user } = c;
  const [sch] = await withSchool(school.id, (tx) =>
    tx.select({ name: schools.name }).from(schools).where(eq(schools.id, school.id)).limit(1),
  );
  const summary = await runUnaccountedSweep(
    school.id,
    user.roles,
    user.id,
    sch?.name ?? "School",
    dateIso,
  );
  safeRevalidate(opsPath("RESUMPTION"));
  return {
    ok: true,
    message:
      summary.checked === 0
        ? "No unaccounted boarders past their window — nothing to send."
        : `Checked ${summary.checked} unaccounted · ${summary.sent} reminder SMS sent (console).`,
  };
}
