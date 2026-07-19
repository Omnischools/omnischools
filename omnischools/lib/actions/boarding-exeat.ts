"use server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withSchool, isUniqueViolation } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor, type ActiveSchool } from "@/lib/auth/server";
import { getCurrentUser, type AppUser } from "@/lib/auth";
import { hasAnyRole, BOARDING_ROLES, canAccessHouse } from "@/lib/access";
import { safeRevalidate } from "@/lib/revalidate";
import type { Tx } from "@/lib/db";
import { boardingExeat, students, houses } from "@/db/schema";
import { getExeatPolicy } from "@/lib/boarding/config";
import {
  feeOwingForStudent,
  getCurrentPeriod,
  countQuotaUsed,
} from "@/lib/boarding/exeat-data";
import { sendExeatStage, runOverdueChain } from "@/lib/boarding/exeat-notify";
import {
  canTransition,
  canSignSpecial,
  decideExeatCreation,
  isReturnedLate,
  isQueuedRowClean,
  nextExeatSequence,
  formatRefCode,
  type ExeatStatus,
  type ExeatType,
} from "@/lib/boarding/exeat-decision";

const EXEAT_PATH = "/senior/boarding/exeats";
type ExeatResult = { ok: boolean; error?: string; refCode?: string; message?: string };
const forbidden: ExeatResult = { ok: false, error: "Your role cannot perform this action." };

/** Shared guard: signed-in staff holding a BOARDING role, else null. */
async function ctx(): Promise<{ school: ActiveSchool; user: AppUser } | null> {
  const { school } = await requireSchool();
  const user = await getCurrentUser();
  if (!user || !hasAnyRole(user.roles, BOARDING_ROLES)) return null;
  return { school, user };
}

interface LoadedExeat {
  id: string;
  type: ExeatType;
  status: ExeatStatus;
  houseId: string;
  studentId: string;
  refCode: string;
  returnBy: Date | null;
  hmUserId: string | null;
}

/** Load one exeat + its House HM (for the house-scope guard), or null. */
async function loadExeat(tx: Tx, schoolId: string, exeatId: string): Promise<LoadedExeat | null> {
  const [ex] = await tx
    .select({
      id: boardingExeat.id,
      type: boardingExeat.exeatType,
      status: boardingExeat.status,
      houseId: boardingExeat.houseId,
      studentId: boardingExeat.studentId,
      refCode: boardingExeat.refCode,
      returnBy: boardingExeat.returnBy,
      hmUserId: houses.hmUserId,
    })
    .from(boardingExeat)
    .innerJoin(
      houses,
      and(eq(houses.schoolId, boardingExeat.schoolId), eq(houses.id, boardingExeat.houseId)),
    )
    .where(and(eq(boardingExeat.schoolId, schoolId), eq(boardingExeat.id, exeatId)))
    .limit(1);
  if (!ex) return null;
  return { ...ex, type: ex.type as ExeatType, status: ex.status as ExeatStatus };
}

const money = (n: number) =>
  `GHS ${n.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function refPrefix(school: ActiveSchool): string {
  const src = (school.shortName ?? school.name).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return src.slice(0, 4) || "EXT";
}

function parseWhen(v?: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

// ---------------------------------------------------------------------------
// Request (create) — quota + fee routing + auto-approve, via the pure decision core
// ---------------------------------------------------------------------------

const RequestSchema = z.object({
  studentId: z.string().uuid(),
  requestedType: z.enum(["SCHEDULED", "SPECIAL"]),
  reason: z.string().trim().max(500).optional(),
  departAt: z.string().trim().optional(),
  returnBy: z.string().trim().optional(),
});

export async function requestExeat(input: unknown): Promise<ExeatResult> {
  const c = await ctx();
  if (!c) return forbidden;
  const parsed = RequestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }
  const { studentId, requestedType, reason, departAt, returnBy } = parsed.data;
  if (requestedType === "SPECIAL" && !reason) {
    return { ok: false, error: "A special exeat needs a reason (funeral, illness, church…)." };
  }
  const { school, user } = c;
  const policy = await getExeatPolicy(school.id);
  const actor = await resolveActor(school.id);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const out = await withSchool(school.id, async (tx): Promise<ExeatResult & { houseId?: string }> => {
        const [stu] = await tx
          .select({
            residency: students.residency,
            status: students.status,
            houseId: students.houseId,
          })
          .from(students)
          .where(and(eq(students.schoolId, school.id), eq(students.id, studentId)))
          .limit(1);
        if (!stu || !stu.houseId) return { ok: false, error: "That student is not in a House." };
        if (stu.status !== "ACTIVE" || stu.residency !== "BOARDER") {
          return { ok: false, error: "Only an active boarder can be given an exeat." };
        }
        // House-scope (D4) — a plain HOUSEMASTER only for their own House.
        const [house] = await tx
          .select({ hmUserId: houses.hmUserId })
          .from(houses)
          .where(and(eq(houses.schoolId, school.id), eq(houses.id, stu.houseId)))
          .limit(1);
        if (!canAccessHouse(user.roles, user.id, house?.hmUserId)) {
          return { ok: false, error: "You can only manage the House you are assigned to." };
        }

        const period = await getCurrentPeriod(tx, school.id);
        if (!period) return { ok: false, error: "No academic semester is configured." };
        const feeOwing = await feeOwingForStudent(tx, school.id, studentId);
        const quotaUsed = await countQuotaUsed(tx, school.id, studentId, period.periodId);

        // A scheduled request targets the standard exeat window (auto-approvable if clean); a
        // special is off-cycle and always routes to manual review (never auto — AC D2).
        const isStandardWindow = requestedType === "SCHEDULED";
        const decision = decideExeatCreation({
          requestedType,
          isBoarder: true,
          feeOwing,
          feeOwingMustCollect: policy.feeOwingMustCollect,
          quotaUsed,
          cap: policy.scheduledPerTerm,
          isStandardWindow,
          disciplineFlag: false, // stub (INCR-13) — trap T3
        });
        if (!decision.ok) {
          return {
            ok: false,
            error:
              decision.reason === "quota_exceeded"
                ? `Scheduled exeat quota reached (${policy.scheduledPerTerm}/semester). A special exeat is uncapped.`
                : "Only an active boarder can be given an exeat.",
          };
        }

        const finalReason =
          decision.type === "FEE_COLLECTION"
            ? `Fee collection · ${money(decision.feeSnapshot ?? feeOwing)} outstanding`
            : reason ?? null;

        const existing = await tx
          .select({ refCode: boardingExeat.refCode })
          .from(boardingExeat)
          .where(eq(boardingExeat.schoolId, school.id));
        const year = new Date().getFullYear();
        const seq = nextExeatSequence(existing.map((e) => e.refCode)) + attempt;
        const refCode = formatRefCode(refPrefix(school), year, seq);

        const status: ExeatStatus = decision.autoApprove ? "HM_APPROVED" : "REQUESTED";
        const [row] = await tx
          .insert(boardingExeat)
          .values({
            schoolId: school.id,
            studentId,
            houseId: stu.houseId,
            academicPeriodId: period.periodId,
            exeatType: decision.type,
            status,
            refCode,
            reason: finalReason,
            parentInitiated: requestedType === "SPECIAL" ? true : policy.parentInitiated,
            departAt: parseWhen(departAt),
            returnBy: parseWhen(returnBy),
            requestedByUserId: actor.id ?? undefined,
            feeOwingSnapshot:
              decision.feeSnapshot != null ? decision.feeSnapshot.toFixed(2) : undefined,
            ...(decision.autoApprove
              ? { hmApprovedAt: new Date(), hmApprovedByUserId: actor.id ?? undefined }
              : {}),
          })
          .returning({ id: boardingExeat.id });

        await recordAudit(tx, {
          schoolId: school.id,
          actorUserId: actor.id ?? undefined,
          actorRole: actor.role,
          actionType: "EXEAT_REQUESTED",
          entityType: "boarding_exeat",
          entityId: row.id,
          after: {
            refCode,
            type: decision.type,
            status,
            autoApproved: decision.autoApprove,
            feeRouted: decision.feeRouted,
            feeSnapshot: decision.feeSnapshot,
          },
          reason: finalReason ?? undefined,
        });
        return { ok: true, refCode, houseId: stu.houseId };
      });

      if (!out.ok) return out;
      safeRevalidate(EXEAT_PATH);
      return { ok: true, refCode: out.refCode };
    } catch (err) {
      // A ref-code collision is the EXPECTED failure this loop exists to retry. MUST go through
      // `isUniqueViolation`: Drizzle wraps the driver error and hangs the real PostgresError off
      // `.cause`, so reading `.code` off the THROWN error always missed — which made this retry
      // dead code and hard-failed exeat creation on any collision.
      if (isUniqueViolation(err)) continue;
      throw err;
    }
  }
  return { ok: false, error: "Could not allocate an exeat reference — please retry." };
}

// ---------------------------------------------------------------------------
// Transitions — approve / sign / depart / return / decline (each atomic + audited)
// ---------------------------------------------------------------------------

async function transition(
  exeatId: string,
  to: ExeatStatus,
  mutate: (now: Date, actorId: string | null) => Record<string, unknown>,
  actionType: string,
  opts?: { requireSign?: boolean; afterExtra?: (ex: LoadedExeat, now: Date) => unknown },
): Promise<ExeatResult> {
  const c = await ctx();
  if (!c) return forbidden;
  const { school, user } = c;
  if (opts?.requireSign && !canSignSpecial(user.roles)) {
    return { ok: false, error: "Only the Senior Housemaster (Dean) can sign a special exeat." };
  }
  const actor = await resolveActor(school.id);

  const out = await withSchool(school.id, async (tx): Promise<ExeatResult> => {
    const ex = await loadExeat(tx, school.id, exeatId);
    if (!ex) return { ok: false, error: "Exeat not found." };
    if (!canAccessHouse(user.roles, user.id, ex.hmUserId)) {
      return { ok: false, error: "You can only manage the House you are assigned to." };
    }
    if (opts?.requireSign && ex.type !== "SPECIAL") {
      return { ok: false, error: "Only special exeats are signed by the Senior Housemaster." };
    }
    if (!canTransition(ex.type, ex.status, to)) {
      return { ok: false, error: `That exeat cannot move to ${to.toLowerCase()} from ${ex.status.toLowerCase()}.` };
    }
    const now = new Date();
    await tx
      .update(boardingExeat)
      .set({ status: to, ...mutate(now, actor.id) })
      .where(and(eq(boardingExeat.schoolId, school.id), eq(boardingExeat.id, exeatId)));
    await recordAudit(tx, {
      schoolId: school.id,
      actorUserId: actor.id ?? undefined,
      actorRole: actor.role,
      actionType,
      entityType: "boarding_exeat",
      entityId: exeatId,
      before: { status: ex.status },
      after: { status: to, ...(opts?.afterExtra ? { extra: opts.afterExtra(ex, now) } : {}) },
    });
    return { ok: true, refCode: ex.refCode };
  });

  if (out.ok) {
    safeRevalidate(EXEAT_PATH);
    // Fire the departure SMS after the state change commits (idempotent, console provider).
    if (to === "DEPARTED") {
      await withSchool(school.id, (tx) =>
        sendExeatStage(tx, school.id, exeatId, "DEPARTURE", actor.id),
      );
    }
  }
  return out;
}

export async function hmApproveExeat(exeatId: string): Promise<ExeatResult> {
  return transition(
    exeatId,
    "HM_APPROVED",
    (now, id) => ({ hmApprovedAt: now, hmApprovedByUserId: id ?? undefined }),
    "EXEAT_HM_APPROVED",
  );
}

export async function signSpecialExeat(exeatId: string): Promise<ExeatResult> {
  return transition(
    exeatId,
    "SR_HM_SIGNED",
    (now, id) => ({ srHmSignedAt: now, srHmSignedByUserId: id ?? undefined }),
    "EXEAT_SR_HM_SIGNED",
    { requireSign: true },
  );
}

export async function departExeat(exeatId: string): Promise<ExeatResult> {
  return transition(
    exeatId,
    "DEPARTED",
    (now, id) => ({ departedAt: now, departedByUserId: id ?? undefined, departAt: now }),
    "EXEAT_DEPARTED",
  );
}

export async function returnExeat(exeatId: string): Promise<ExeatResult> {
  return transition(
    exeatId,
    "RETURNED",
    (now, id) => ({ returnedAt: now, returnedByUserId: id ?? undefined }),
    "EXEAT_RETURNED",
    { afterExtra: (ex, now) => ({ returnedLate: isReturnedLate(now, ex.returnBy) }) },
  );
}

const DeclineSchema = z.object({
  exeatId: z.string().uuid(),
  reason: z.string().trim().min(1, "Enter a reason for declining").max(500),
});

export async function declineExeat(input: unknown): Promise<ExeatResult> {
  const parsed = DeclineSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }
  const { exeatId, reason } = parsed.data;
  return transition(
    exeatId,
    "DECLINED",
    (now, id) => ({ declinedAt: now, declinedByUserId: id ?? undefined, declineReason: reason }),
    "EXEAT_DECLINED",
    { afterExtra: () => ({ reason }) },
  );
}

// ---------------------------------------------------------------------------
// Bulk-approve every clean queued row (skips special / off-window / owing — AC D5)
// ---------------------------------------------------------------------------

export async function bulkApproveClean(): Promise<ExeatResult> {
  const c = await ctx();
  if (!c) return forbidden;
  const { school, user } = c;
  const actor = await resolveActor(school.id);

  const out = await withSchool(school.id, async (tx) => {
    const rows = await tx
      .select({
        id: boardingExeat.id,
        type: boardingExeat.exeatType,
        feeSnapshot: boardingExeat.feeOwingSnapshot,
        hmUserId: houses.hmUserId,
      })
      .from(boardingExeat)
      .innerJoin(
        houses,
        and(eq(houses.schoolId, boardingExeat.schoolId), eq(houses.id, boardingExeat.houseId)),
      )
      .where(and(eq(boardingExeat.schoolId, school.id), eq(boardingExeat.status, "REQUESTED")));

    let approved = 0;
    for (const r of rows) {
      if (!canAccessHouse(user.roles, user.id, r.hmUserId)) continue;
      const type = r.type as ExeatType;
      const snapshot = r.feeSnapshot != null ? Number(r.feeSnapshot) : 0;
      const clean = isQueuedRowClean({
        type,
        feesClearOrRouted: type === "FEE_COLLECTION" || snapshot === 0,
        disciplineFlag: false,
        standardWindow: type !== "SPECIAL",
      });
      if (!clean) continue;
      const now = new Date();
      await tx
        .update(boardingExeat)
        .set({ status: "HM_APPROVED", hmApprovedAt: now, hmApprovedByUserId: actor.id ?? undefined })
        .where(
          and(
            eq(boardingExeat.schoolId, school.id),
            eq(boardingExeat.id, r.id),
            eq(boardingExeat.status, "REQUESTED"),
          ),
        );
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "EXEAT_HM_APPROVED",
        entityType: "boarding_exeat",
        entityId: r.id,
        before: { status: "REQUESTED" },
        after: { status: "HM_APPROVED", via: "bulk-approve-clean" },
      });
      approved += 1;
    }
    return approved;
  });

  safeRevalidate(EXEAT_PATH);
  return { ok: true, message: `${out} clean exeat${out === 1 ? "" : "s"} approved.` };
}

// ---------------------------------------------------------------------------
// Triggered late-return sweep (overdue computed on-read; console SMS chain)
// ---------------------------------------------------------------------------

export async function runLateReturnChecks(): Promise<ExeatResult> {
  const c = await ctx();
  if (!c) return forbidden;
  const { school, user } = c;
  const actor = await resolveActor(school.id);
  const summary = await runOverdueChain(
    school.id,
    user.roles,
    user.id,
    actor.id,
    actor.role,
  );
  safeRevalidate(EXEAT_PATH);
  return {
    ok: true,
    message:
      summary.checked === 0
        ? "No overdue returns — nothing to send."
        : `Checked ${summary.checked} overdue exeat${summary.checked === 1 ? "" : "s"} · ${summary.sent} SMS stage${summary.sent === 1 ? "" : "s"} sent (console).`,
  };
}
