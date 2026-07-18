"use server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor, type ActiveSchool } from "@/lib/auth/server";
import { getCurrentUser, type AppUser } from "@/lib/auth";
import { hasAnyRole, BOARDING_ROLES, canAccessHouse } from "@/lib/access";
import { safeRevalidate } from "@/lib/revalidate";
import { inspections, prepAttendance, students, houses } from "@/db/schema";
import {
  getDormHouseContext,
  getHouseWriteContext,
} from "@/lib/boarding/daily-data";
import {
  dailyFindingsSchema,
  weeklyFindingsSchema,
  computeAnomalies,
} from "@/lib/boarding/daily-life";

type ActionResult = { ok: boolean; error?: string; message?: string };
const forbidden: ActionResult = { ok: false, error: "Your role cannot perform this action." };

/** The Today view path for revalidation (force-dynamic route; the client also router.refresh()es). */
const todayPath = (houseId: string) => `/senior/boarding/houses/${houseId}/today`;

/** Shared guard: signed-in staff holding a BOARDING role, else null (mirrors the exeat action). */
async function ctx(): Promise<{ school: ActiveSchool; user: AppUser } | null> {
  const { school } = await requireSchool();
  const user = await getCurrentUser();
  if (!user || !hasAnyRole(user.roles, BOARDING_ROLES)) return null;
  return { school, user };
}

// ---------------------------------------------------------------------------
// Daily per-dorm inspection (type=DAILY, 3-state result + bunks-clean + findings — AC C)
// ---------------------------------------------------------------------------

const DailyInspectionInput = z.object({
  dormId: z.string().uuid(),
  result: z.enum(["PASS", "PARTIAL", "FAIL"]),
  bunksClean: z.number().int().min(0).max(200),
  bunksTotal: z.number().int().min(0).max(200),
  checks: z.object({
    bunks: z.enum(["OK", "ISSUE"]),
    lockers: z.enum(["OK", "ISSUE"]),
    attire: z.enum(["OK", "ISSUE"]),
  }),
  flaggedBunks: z.array(z.number().int().positive()).max(60).optional(),
  notes: z.string().trim().max(1000).optional(),
});

/**
 * Record a morning per-dorm DAILY inspection (AC C). Appends a row (latest-wins on read — a
 * re-inspection never updates in place, C4); bunks_total is a WRITE-TIME SNAPSHOT (C3). A
 * PARTIAL/FAIL records the result + anomalies_count (computed in lib) + audit but writes ZERO
 * boarding_infractions — the daily→Note escalation is STUBBED to INCR-13 (AC E1). House-scoped for
 * a plain HM (canAccessHouse), audited, atomic.
 */
export async function recordDailyInspection(input: unknown): Promise<ActionResult> {
  const c = await ctx();
  if (!c) return forbidden;
  const parsed = DailyInspectionInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid inspection." };
  const d = parsed.data;
  if (d.bunksClean > d.bunksTotal) {
    return { ok: false, error: "Bunks clean cannot exceed bunks total." };
  }
  const findings = dailyFindingsSchema.safeParse({
    kind: "DAILY",
    checks: d.checks,
    flaggedBunks: d.flaggedBunks,
    notes: d.notes,
  });
  if (!findings.success) return { ok: false, error: "Invalid findings." };

  const { school, user } = c;
  const actor = await resolveActor(school.id);
  const dorm = await getDormHouseContext(school.id, d.dormId);
  if (!dorm) return { ok: false, error: "Dormitory not found." };
  if (!canAccessHouse(user.roles, user.id, dorm.hmUserId)) {
    return { ok: false, error: "You can only inspect the House you are assigned to." };
  }
  const anomalies = computeAnomalies(findings.data);

  await withSchool(school.id, async (tx) => {
    const [row] = await tx
      .insert(inspections)
      .values({
        schoolId: school.id,
        dormitoryId: d.dormId,
        type: "DAILY",
        result: d.result,
        bunksClean: d.bunksClean,
        bunksTotal: d.bunksTotal, // snapshot at write (C3)
        findingsJson: findings.data,
        anomaliesCount: anomalies,
        inspectedByUserId: actor.id ?? undefined,
      })
      .returning({ id: inspections.id });
    await recordAudit(tx, {
      schoolId: school.id,
      actorUserId: actor.id ?? undefined,
      actorRole: actor.role,
      actionType: "INSPECTION_DAILY_RECORDED",
      entityType: "inspections",
      entityId: row.id,
      after: {
        dormId: d.dormId,
        type: "DAILY",
        result: d.result,
        bunksClean: d.bunksClean,
        bunksTotal: d.bunksTotal,
        anomalies,
        // Discipline escalation (daily→Note) is STUBBED to INCR-13 — no infraction row written.
        escalationStub: d.result !== "PASS" ? "INCR-13" : null,
      },
    });
  });

  safeRevalidate(todayPath(dorm.houseId));
  return { ok: true, message: `Dorm inspection recorded (${d.result.toLowerCase()}).` };
}

// ---------------------------------------------------------------------------
// Weekly whole-house inspection (type=WEEKLY, area list, bunks NULL — AC D)
// ---------------------------------------------------------------------------

const WeeklyInspectionInput = z.object({
  houseId: z.string().uuid(),
  result: z.enum(["PASS", "PARTIAL", "FAIL"]),
  areas: z
    .array(
      z.object({
        area: z.string().trim().min(1).max(120),
        result: z.enum(["OK", "ISSUE"]),
        note: z.string().trim().max(500).optional(),
      }),
    )
    .min(1)
    .max(30),
  notes: z.string().trim().max(1000).optional(),
});

/**
 * Record the Saturday WEEKLY whole-house inspection (AC D). One row (type=WEEKLY, WEEKLY findings
 * area-list, bunks_clean/total NULL) anchored to the House's first dormitory — it stays out of the
 * daily grid/count (the read filters latest-wins by type). Same recording gate as daily; a FAIL
 * records result + anomalies but writes NO discipline row (Warning STUBBED to INCR-13, AC E2). Not
 * weekday-constrained (a WEEKLY on a Wednesday is accepted, D3). Audited, atomic.
 */
export async function recordWeeklyInspection(input: unknown): Promise<ActionResult> {
  const c = await ctx();
  if (!c) return forbidden;
  const parsed = WeeklyInspectionInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid inspection." };
  const d = parsed.data;
  const findings = weeklyFindingsSchema.safeParse({ kind: "WEEKLY", areas: d.areas, notes: d.notes });
  if (!findings.success) return { ok: false, error: "Invalid findings." };

  const { school, user } = c;
  const actor = await resolveActor(school.id);
  const wctx = await getHouseWriteContext(school.id, d.houseId);
  if (!wctx) return { ok: false, error: "House not found." };
  if (!canAccessHouse(user.roles, user.id, wctx.hmUserId)) {
    return { ok: false, error: "You can only inspect the House you are assigned to." };
  }
  if (!wctx.firstDormId) return { ok: false, error: "This House has no dormitory configured." };
  const anomalies = computeAnomalies(findings.data);

  await withSchool(school.id, async (tx) => {
    const [row] = await tx
      .insert(inspections)
      .values({
        schoolId: school.id,
        dormitoryId: wctx.firstDormId!, // whole-house, anchored to the first dorm
        type: "WEEKLY",
        result: d.result,
        bunksClean: null,
        bunksTotal: null,
        findingsJson: findings.data,
        anomaliesCount: anomalies,
        inspectedByUserId: actor.id ?? undefined,
      })
      .returning({ id: inspections.id });
    await recordAudit(tx, {
      schoolId: school.id,
      actorUserId: actor.id ?? undefined,
      actorRole: actor.role,
      actionType: "INSPECTION_WEEKLY_RECORDED",
      entityType: "inspections",
      entityId: row.id,
      after: {
        houseId: d.houseId,
        type: "WEEKLY",
        result: d.result,
        areas: d.areas.length,
        anomalies,
        escalationStub: d.result !== "PASS" ? "INCR-13" : null,
      },
    });
  });

  safeRevalidate(todayPath(d.houseId));
  return { ok: true, message: `Weekly inspection recorded (${d.result.toLowerCase()}).` };
}

// ---------------------------------------------------------------------------
// Prep attendance exception log (upsert per boarder per night — AC F)
// ---------------------------------------------------------------------------

const PrepInput = z.object({
  houseId: z.string().uuid(),
  studentId: z.string().uuid(),
  // PRESENT is never a status here — present-by-default is the absence of a row (F3).
  status: z.enum(["LATE", "ABSENT", "EXCUSED", "MEDICAL"]),
  minutesLate: z.number().int().min(0).max(600).optional(),
  note: z.string().trim().max(500).optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date")
    .optional(),
});

/**
 * Log a prep-attendance EXCEPTION for one boarder-night (AC F). Upserts on
 * (school_id, student_id, session_date) — re-logging the same boarder the same night updates the
 * one row, never a second (F2). Only LATE/ABSENT/EXCUSED/MEDICAL are ever written (PRESENT is the
 * absence of a row, F3). house_id + session_date are stored snapshots (avoids the tz-boundary
 * trap). House-scoped for a plain HM, audited, atomic.
 */
export async function logPrepException(input: unknown): Promise<ActionResult> {
  const c = await ctx();
  if (!c) return forbidden;
  const parsed = PrepInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid entry." };
  const d = parsed.data;
  const sessionDate = d.date ?? new Date().toISOString().slice(0, 10);

  const { school, user } = c;
  const actor = await resolveActor(school.id);

  const out = await withSchool(school.id, async (tx): Promise<ActionResult> => {
    const [house] = await tx
      .select({ hmUserId: houses.hmUserId })
      .from(houses)
      .where(and(eq(houses.schoolId, school.id), eq(houses.id, d.houseId)))
      .limit(1);
    if (!house) return { ok: false, error: "House not found." };
    if (!canAccessHouse(user.roles, user.id, house.hmUserId)) {
      return { ok: false, error: "You can only manage the House you are assigned to." };
    }
    // The boarder must be an active BOARDER of THIS House (roster gate).
    const [stu] = await tx
      .select({ houseId: students.houseId, residency: students.residency, status: students.status })
      .from(students)
      .where(and(eq(students.schoolId, school.id), eq(students.id, d.studentId)))
      .limit(1);
    if (!stu || stu.houseId !== d.houseId || stu.residency !== "BOARDER" || stu.status !== "ACTIVE") {
      return { ok: false, error: "That student is not an active boarder of this House." };
    }

    await tx
      .insert(prepAttendance)
      .values({
        schoolId: school.id,
        studentId: d.studentId,
        houseId: d.houseId, // snapshot
        sessionDate, // stored date
        status: d.status,
        minutesLate: d.status === "LATE" ? d.minutesLate ?? null : null,
        note: d.note ?? null,
        loggedByUserId: actor.id ?? undefined,
      })
      .onConflictDoUpdate({
        target: [prepAttendance.schoolId, prepAttendance.studentId, prepAttendance.sessionDate],
        set: {
          status: d.status,
          minutesLate: d.status === "LATE" ? d.minutesLate ?? null : null,
          note: d.note ?? null,
          loggedAt: new Date(),
          loggedByUserId: actor.id ?? undefined,
        },
      });

    await recordAudit(tx, {
      schoolId: school.id,
      actorUserId: actor.id ?? undefined,
      actorRole: actor.role,
      actionType: "PREP_EXCEPTION_LOGGED",
      entityType: "prep_attendance",
      entityId: d.studentId,
      after: {
        houseId: d.houseId,
        sessionDate,
        status: d.status,
        minutesLate: d.status === "LATE" ? d.minutesLate ?? null : null,
      },
      reason: d.note ?? undefined,
    });
    return { ok: true };
  });

  if (out.ok) safeRevalidate(todayPath(d.houseId));
  return out;
}
