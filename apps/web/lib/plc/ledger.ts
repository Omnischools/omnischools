/**
 * PLC CPD ledger ACCRUAL seam (SHS module 4.6 / INCR-49 · R398–R401) — the SOLE `plc_cpd_ledger`
 * writer, and the other half of the R391 48/49 boundary. INCR-48 DISPLAYS `lib/plc/points.ts` as a
 * "will award" preview; THIS module ACCRUES the same numbers to the persisted ledger by importing
 * `points.ts` UNCHANGED — so display == accrual by construction.
 *
 * LAZY MATERIALISE-ON-SETTLE, idempotent (R398): a session accrues only AFTER it SETTLES (now ≥ its
 * write-lock = scheduled-close + reflection_window_hours), triggered by the READ path (the two cpd-data
 * readers call `accrueSettledSessions` inside their withSchool tx). NO cron, NO manual "post", and the
 * INCR-48 mark/confirm actions are NOT modified. Idempotent three ways: the UNIQUE(school_id,session_id,
 * user_id) conflict target + on-conflict-do-nothing, the candidate filter that skips already-accrued
 * sessions, and the deterministic re-derivation of a settled session's frozen inputs.
 *
 * POINT-IN-TIME FREEZE (R401): the roster for a settling session = members ACTIVE AT THE SETTLE INSTANT
 * (joined_at ≤ settled_at AND (left_at IS NULL OR left_at > settled_at)), NOT the current roster — this
 * supersedes, for settled sessions, the `session-data.ts:402` live-roster approximation. Points freeze
 * from the settle-time programme rates; a later membership/rate edit does NOT rewrite accrued history.
 *
 * CONFIRM-CUTOFF (R399): a reflection counts only if submitted_at ≤ settled_at AND confirmed_at ≤
 * settled_at — a confirm stamped AFTER settle does NOT retro-add. The CALLER applies the cutoff exactly
 * as `session-data.ts` computes submitted-ms (points.ts stays unchanged): the window-close ms passed to
 * points.ts IS the settle instant, and `reflectionConfirmed` is pre-gated to confirmed_at ≤ settle.
 *
 * NO new user-audit entry (R403): the accrual is a derived materialization of already-audited events
 * (the INCR-48 attendance/reflection rows), so it does NOT call recordAudit.
 */
import "server-only";
import { and, eq, gt, inArray, isNotNull, isNull, lte, or } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { addMinutes } from "@/lib/senior/time";
import {
  plc,
  plcCpdLedger,
  plcMembership,
  plcProgramme,
  plcSession,
  plcSessionAttendance,
  plcSessionReflection,
} from "@/db/schema";
import { coalescePlcProgramme, type PlcProgramme } from "./defaults";
import { plcSessionInstant } from "./session-clock";
import {
  sessionPointsSummary,
  type PlcAttendanceState,
  type PlcMemberSessionInput,
  type PlcPointsRates,
} from "./points";

const HOUR_MS = 3_600_000;

const PROGRAMME_COLS = {
  sessionDay: plcProgramme.sessionDay,
  sessionStart: plcProgramme.sessionStart,
  sessionLengthMin: plcProgramme.sessionLengthMin,
  weeksPerSemester: plcProgramme.weeksPerSemester,
  ptsPerAttendedSession: plcProgramme.ptsPerAttendedSession,
  ptsPerReflection: plcProgramme.ptsPerReflection,
  reflectionWindowHours: plcProgramme.reflectionWindowHours,
  annualPlcTarget: plcProgramme.annualPlcTarget,
  configuredAt: plcProgramme.configuredAt,
} as const;

/** Stored attendance enum → the points model's state. A missing row (mark-present deletes) ⇒ present. */
function toAttendanceState(raw: string | undefined | null): PlcAttendanceState {
  switch (raw) {
    case "LATE":
      return "late";
    case "ABSENT":
      return "absent";
    case "EXCUSED":
      return "excused";
    case "MEDICAL":
      return "medical";
    default:
      return "present";
  }
}

/**
 * The deterministic SETTLE instant (ms) of a session = its write-lock = scheduled-close +
 * reflection_window_hours (the same boundary `isPlcSessionWriteLocked` tests). Stored as `settled_at`.
 */
export function plcSettleAtMs(programme: PlcProgramme, sessionDate: string): number {
  const closeHHMM = addMinutes(programme.sessionStart, programme.sessionLengthMin);
  return plcSessionInstant(sessionDate, closeHHMM).getTime() + programme.reflectionWindowHours * HOUR_MS;
}

export interface FrozenLedgerRow {
  userId: string;
  attendedPts: number;
  reflectionPts: number;
}

/**
 * PURE, DB-free: freeze a settled session's members into ledger rows via `points.ts` UNCHANGED. Only
 * members with a total > 0 get a row (present-by-default: an absent member earns 0 → no row). The
 * caller must have pre-gated each input's `reflectionConfirmed` to confirmed_at ≤ settle and passed the
 * settle instant as `reflectionWindowCloseMs` (so points.ts applies the submitted ≤ settle cutoff). The
 * result is deterministic in its inputs — re-derivation of a frozen (settled) session yields the SAME
 * rows, which is what makes the on-conflict-do-nothing upsert idempotent.
 */
export function frozenLedgerRows(
  members: PlcMemberSessionInput[],
  rates: PlcPointsRates,
): FrozenLedgerRow[] {
  return sessionPointsSummary(members, rates)
    .perMember.filter((p) => p.total > 0)
    .map((p) => ({ userId: p.userId, attendedPts: p.attendedPts, reflectionPts: p.reflectionPts }));
}

/**
 * Accrue every SETTLED-but-not-yet-accrued PLC session for a school. Called on the READ path inside the
 * caller's withSchool tx (RLS is the boundary; the INSERT passes the ledger's tenant_isolation WITH
 * CHECK because withSchool has set app.current_school). Runs in a single scoped scan — the ledger is
 * tiny (staff × sessions per school) — so no secondary index or cron is warranted.
 *
 * ponytail: an all-absent settled session writes 0 rows and so is re-derived every read (it never
 * becomes "has ≥1 row"); that's a rare, cheap no-op, upgrade to a marker only if a school ever
 * accumulates many all-absent settled sessions.
 */
export async function accrueSettledSessions(
  tx: Tx,
  schoolId: string,
  now: Date = new Date(),
): Promise<void> {
  const [progRow] = await tx
    .select(PROGRAMME_COLS)
    .from(plcProgramme)
    .where(eq(plcProgramme.schoolId, schoolId))
    .limit(1);
  const programme = coalescePlcProgramme(progRow ?? null);
  const nowMs = now.getTime();

  // Every session + its PLC's facilitator (server-loaded; NEVER request-supplied). Archived PLCs are
  // NOT filtered out — a session held before archive still earned its CPD (R373 keeps history).
  const sessions = await tx
    .select({
      id: plcSession.id,
      plcId: plcSession.plcId,
      sessionDate: plcSession.sessionDate,
      facilitatorUserId: plc.facilitatorUserId,
    })
    .from(plcSession)
    .innerJoin(plc, and(eq(plc.schoolId, plcSession.schoolId), eq(plc.id, plcSession.plcId)))
    .where(eq(plcSession.schoolId, schoolId));

  const settled = sessions
    .map((s) => ({ ...s, settledAtMs: plcSettleAtMs(programme, s.sessionDate) }))
    .filter((s) => nowMs >= s.settledAtMs);
  if (settled.length === 0) return;

  // Already-accrued sessions (≥1 frozen row) — a settled session's inputs are frozen, so one pass
  // fully accrues it; skip those to keep the read-path work lazy.
  const settledIds = settled.map((s) => s.id);
  const accruedRows = await tx
    .select({ sessionId: plcCpdLedger.sessionId })
    .from(plcCpdLedger)
    .where(and(eq(plcCpdLedger.schoolId, schoolId), inArray(plcCpdLedger.sessionId, settledIds)));
  const accrued = new Set(accruedRows.map((r) => r.sessionId));
  const candidates = settled.filter((s) => !accrued.has(s.id));
  if (candidates.length === 0) return;

  for (const s of candidates) {
    const settledAt = new Date(s.settledAtMs);

    // POINT-IN-TIME roster: members active AT the settle instant (R401), NOT the current roster.
    const roster = await tx
      .select({ userId: plcMembership.userId })
      .from(plcMembership)
      .where(
        and(
          eq(plcMembership.schoolId, schoolId),
          eq(plcMembership.plcId, s.plcId),
          lte(plcMembership.joinedAt, settledAt),
          or(isNull(plcMembership.leftAt), gt(plcMembership.leftAt, settledAt)),
          isNotNull(plcMembership.userId),
        ),
      );
    const memberIds = roster.map((r) => r.userId).filter((u): u is string => !!u);
    if (memberIds.length === 0) continue;

    const attRows = await tx
      .select({ userId: plcSessionAttendance.userId, status: plcSessionAttendance.status })
      .from(plcSessionAttendance)
      .where(
        and(eq(plcSessionAttendance.schoolId, schoolId), eq(plcSessionAttendance.sessionId, s.id)),
      );
    const statusByUser = new Map(attRows.filter((r) => r.userId).map((r) => [r.userId as string, r.status]));

    const reflRows = await tx
      .select({
        userId: plcSessionReflection.userId,
        submittedAt: plcSessionReflection.submittedAt,
        confirmedAt: plcSessionReflection.confirmedAt,
      })
      .from(plcSessionReflection)
      .where(
        and(eq(plcSessionReflection.schoolId, schoolId), eq(plcSessionReflection.sessionId, s.id)),
      );
    const reflByUser = new Map(reflRows.filter((r) => r.userId).map((r) => [r.userId as string, r]));

    const input: PlcMemberSessionInput[] = memberIds.map((userId) => {
      const refl = reflByUser.get(userId);
      // CONFIRM-CUTOFF (R399): count a confirm only if it was stamped at/before settle. The submitted ≤
      // settle cutoff is applied inside points.ts via reflectionWindowCloseMs = settle instant.
      const reflectionConfirmed = !!refl?.confirmedAt && refl.confirmedAt.getTime() <= s.settledAtMs;
      return {
        userId,
        isFacilitator: userId === s.facilitatorUserId,
        attendance: toAttendanceState(statusByUser.get(userId)),
        reflectionSubmittedAtMs: refl ? refl.submittedAt.getTime() : null,
        reflectionConfirmed,
      };
    });

    const rates: PlcPointsRates = {
      ptsPerAttendedSession: programme.ptsPerAttendedSession,
      ptsPerReflection: programme.ptsPerReflection,
      reflectionWindowCloseMs: s.settledAtMs,
    };
    const rows = frozenLedgerRows(input, rates);
    if (rows.length === 0) continue;

    await tx
      .insert(plcCpdLedger)
      .values(
        rows.map((r) => ({
          schoolId,
          sessionId: s.id,
          userId: r.userId,
          attendedPts: r.attendedPts.toFixed(2),
          reflectionPts: r.reflectionPts.toFixed(2),
          settledAt,
        })),
      )
      .onConflictDoNothing({
        target: [plcCpdLedger.schoolId, plcCpdLedger.sessionId, plcCpdLedger.userId],
      });
  }
}
