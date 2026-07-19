/**
 * SERVER-ONLY exeat SMS chain (SHS module 4.2 / INCR-9). Wires the departure + late-return
 * escalation to sendSms() — the CONSOLE provider until the owner provisions Hubtel (module
 * decision #3); this file NEVER provisions HUBTEL_* creds and costs nothing until go-live.
 *
 * Idempotency: one exeat_notification per (exeat × kind), guarded by a NOT-EXISTS check before
 * each send. Overdue is computed on-read (no cron/scheduler in INCR-9 — the deferred timed
 * escalation calls runOverdueChain via a triggered action). Stage-3 (+1hr) is the STUB: it records
 * the notification + an audit row and writes ZERO discipline rows + ZERO invoices (INCR-13 owns the
 * real NOTE/penalty/auto-invoice); its copy is deliberately conditional, never a working record.
 */
import "server-only";
import { and, eq } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { withSchool } from "@/lib/db/rls";
import {
  boardingExeat,
  exeatNotification,
  students,
  studentGuardians,
} from "@/db/schema";
import { sendSms } from "@/lib/sms";
import { insertInfraction } from "./discipline-core";
import { getExeatBoard } from "./exeat-data";
import {
  buildExeatSms,
  type ExeatType,
  type NotificationKind,
} from "./exeat-decision";

const fmtReturnBy = (d: Date | null): string =>
  d
    ? new Intl.DateTimeFormat("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
        .format(d)
        .replace(",", " ·")
    : "the agreed time";

const money = (n: number) =>
  `GHS ${n.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export type StageResult = "sent" | "skipped" | "no_phone";

/**
 * Send one chain stage for an exeat, idempotently. Returns "skipped" when the (exeat, kind) row
 * already exists (no re-send — AC E4), "no_phone" when the boarder has no primary guardian phone
 * (a row is still logged so the stage is not silently lost). The console provider logs the body;
 * a real send happens only once Hubtel creds exist.
 */
export async function sendExeatStage(
  tx: Tx,
  schoolId: string,
  exeatId: string,
  kind: NotificationKind,
  actorUserId: string | null,
): Promise<StageResult> {
  const existing = await tx
    .select({ id: exeatNotification.id })
    .from(exeatNotification)
    .where(
      and(
        eq(exeatNotification.schoolId, schoolId),
        eq(exeatNotification.exeatId, exeatId),
        eq(exeatNotification.kind, kind),
      ),
    )
    .limit(1);
  if (existing.length) return "skipped";

  const [ex] = await tx
    .select({
      type: boardingExeat.exeatType,
      returnBy: boardingExeat.returnBy,
      feeSnapshot: boardingExeat.feeOwingSnapshot,
      firstName: students.firstName,
      lastName: students.lastName,
      studentId: boardingExeat.studentId,
    })
    .from(boardingExeat)
    .innerJoin(
      students,
      and(eq(students.schoolId, boardingExeat.schoolId), eq(students.id, boardingExeat.studentId)),
    )
    .where(and(eq(boardingExeat.schoolId, schoolId), eq(boardingExeat.id, exeatId)))
    .limit(1);
  if (!ex) return "skipped";

  const [guardian] = await tx
    .select({ phone: studentGuardians.phone })
    .from(studentGuardians)
    .where(
      and(
        eq(studentGuardians.schoolId, schoolId),
        eq(studentGuardians.studentId, ex.studentId),
        eq(studentGuardians.isPrimary, true),
      ),
    )
    .limit(1);

  const snapshot = ex.feeSnapshot != null ? Number(ex.feeSnapshot) : 0;
  const body = buildExeatSms(kind, {
    studentName: `${ex.firstName.charAt(0)}. ${ex.lastName}`,
    returnByLabel: fmtReturnBy(ex.returnBy),
    amountLabel:
      (ex.type as ExeatType) === "FEE_COLLECTION" && snapshot > 0 ? money(snapshot) : undefined,
  });

  if (!guardian?.phone) {
    await tx.insert(exeatNotification).values({
      schoolId,
      exeatId,
      kind,
      toPhone: "",
      body,
      provider: "none",
      ok: false,
      error: "no parent phone on file",
      sentByUserId: actorUserId ?? undefined,
    });
    return "no_phone";
  }

  // ponytail: sendSms runs inside the tx — negligible for the console provider; once Hubtel
  // go-lives, move the send outside the tx (network call shouldn't hold a row lock).
  const result = await sendSms(guardian.phone, body);
  await tx.insert(exeatNotification).values({
    schoolId,
    exeatId,
    kind,
    toPhone: guardian.phone,
    body,
    provider: result.provider,
    providerMessageId: result.id,
    error: result.error,
    ok: result.ok,
    sentByUserId: actorUserId ?? undefined,
  });
  return "sent";
}

export interface OverdueRunSummary {
  checked: number;
  sent: number;
  stage3Stubs: number;
}

/**
 * Triggered late-return sweep (no cron in INCR-9 — overdue computed on-read). For every overdue
 * exeat in the user's accessible Houses, send each stage now due (idempotent). Stage-3 also writes
 * an EXEAT_OVERDUE_NOTE_STUB audit row and NOTHING else — no discipline record, no invoice (T3/E5).
 */
export async function runOverdueChain(
  schoolId: string,
  roles: readonly string[],
  userId: string | null,
  actorUserId: string | null,
  actorRole: string,
  now: Date = new Date(),
): Promise<OverdueRunSummary> {
  const board = await getExeatBoard(schoolId, roles, userId, now);
  let sent = 0;
  let stage3Stubs = 0;

  for (const row of board.late) {
    await withSchool(schoolId, async (tx) => {
      for (const kind of row.dueStages) {
        const res = await sendExeatStage(tx, schoolId, row.id, kind, actorUserId);
        if (res === "sent" || res === "no_phone") {
          if (res === "sent") sent += 1;
          if (kind === "OVERDUE_STAGE_3") {
            stage3Stubs += 1;
            // INCR-13: the +1hr escalation now writes a REAL NOTE against the overdue boarder,
            // idempotent on (EXEAT_OVERDUE, exeat.id) — a repeat sweep never double-logs. Still NO
            // invoice/finance write. Respects the pastoral bypass at the shared insert site.
            const [ex] = await tx
              .select({ studentId: boardingExeat.studentId })
              .from(boardingExeat)
              .where(and(eq(boardingExeat.schoolId, schoolId), eq(boardingExeat.id, row.id)))
              .limit(1);
            if (ex) {
              await insertInfraction(tx, {
                schoolId,
                studentId: ex.studentId,
                severity: "NOTE",
                narrativeText: `Late return from exeat ${row.refCode} — not returned by the agreed time (+1hr escalation).`,
                sourceKind: "EXEAT_OVERDUE",
                sourceRefId: row.id,
                loggedByUserId: actorUserId,
                actorRole,
              });
            }
          }
        }
      }
    });
  }
  return { checked: board.late.length, sent, stage3Stubs };
}
