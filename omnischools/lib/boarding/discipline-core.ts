/**
 * SERVER-ONLY shared infraction insert (SHS module 4.2 / INCR-13). This is THE single insert site for
 * a boarding_infractions row — the manual log AND all four parked auto-stubs (exeat overdue /
 * inspection FAIL / visit overstay / resumption absent) route through it, so the two cross-cutting
 * rules live in exactly one place:
 *
 *   • PASTORAL BYPASS (AC G1/G2) — a pastorally-flagged student (isPastorallyFlagged, VLC 4.5 stub)
 *     writes ZERO infraction; the trigger records a Dean-route audit marker and returns "bypassed".
 *     Because both manual and auto logs share this site, the bypass holds for both.
 *   • IDEMPOTENCY (AC E) — an auto-log carries source_kind/source_ref_id and inserts with
 *     onConflictDoNothing on the partial unique index (source_ref_id IS NOT NULL), so a repeating
 *     on-read sweep never double-logs. A MANUAL log (source_ref_id NULL) is exempt from the index and
 *     always inserts.
 *
 * Parent-notify SMS fires at Warning+ (AC I1) on a FRESH insert only, via sendSms() (console) — this
 * file NEVER provisions HUBTEL_* creds. It writes NO invoices/finance row (the #1 scope guard).
 */
import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { boardingInfractions, students, studentGuardians, schools } from "@/db/schema";
import { recordAudit } from "@/lib/db/audit";
import { sendSms } from "@/lib/sms";
import { isPastorallyFlagged } from "./pastoral-stub";
import {
  disciplineParentSms,
  severityNotifiesParent,
  type InfractionSeverity,
  type InfractionSource,
} from "./discipline";

export type InsertInfractionResult =
  | { status: "inserted"; id: string }
  | { status: "duplicate" } // idempotent auto-log — the (source_kind, source_ref_id) row already exists
  | { status: "bypassed" } // pastoral — routed to the Dean, ZERO infraction written
  | { status: "no_student" };

export interface InsertInfractionArgs {
  schoolId: string;
  studentId: string;
  severity: InfractionSeverity;
  narrativeText: string;
  sourceKind: InfractionSource;
  /** null for a MANUAL log; the source row's id for an auto-log (the idempotency ref). */
  sourceRefId?: string | null;
  loggedByUserId?: string | null;
  actorRole: string;
  coSignsJson?: unknown;
  parentInfractionId?: string | null;
}

/**
 * Insert one infraction, respecting the pastoral bypass + auto-log idempotency, and notify the parent
 * at Warning+. Runs inside the caller's tx (atomic with its own work). Returns a discriminated result
 * so callers can count inserted vs bypassed vs duplicate.
 */
export async function insertInfraction(tx: Tx, args: InsertInfractionArgs): Promise<InsertInfractionResult> {
  const { schoolId, studentId, severity, sourceKind } = args;
  const sourceRefId = args.sourceRefId ?? null;

  // Resolve the student (for the pastoral check + House snapshot + SMS name). Not found → skip.
  const [stu] = await tx
    .select({
      code: students.studentCode,
      houseId: students.houseId,
      firstName: students.firstName,
      lastName: students.lastName,
    })
    .from(students)
    .where(and(eq(students.schoolId, schoolId), eq(students.id, studentId)))
    .limit(1);
  if (!stu) return { status: "no_student" };

  // PASTORAL BYPASS (AC G) — a flagged student is routed to the Dean, NOT the ladder. Zero infraction.
  if (isPastorallyFlagged(stu.code)) {
    await recordAudit(tx, {
      schoolId,
      actorUserId: args.loggedByUserId ?? undefined,
      actorRole: args.actorRole,
      actionType: "DISCIPLINE_PASTORAL_BYPASS",
      entityType: "student",
      entityId: studentId,
      after: { severity, sourceKind, routedTo: "Dean of Boarding (VLC 4.5 stub)" },
      reason: "Pastoral case active — routed to the Dean, not laddered (no infraction written).",
    });
    return { status: "bypassed" };
  }

  // Insert. An auto-log (source_ref_id present) is idempotent on the partial unique index; a MANUAL
  // log (source_ref_id NULL) is exempt and always inserts. onConflictDoNothing → empty returning on dup.
  const inserted = await tx
    .insert(boardingInfractions)
    .values({
      schoolId,
      studentId,
      houseId: stu.houseId ?? null, // snapshot of the student's House at log time
      severity,
      narrativeText: args.narrativeText,
      status: "OPEN",
      coSignsJson: args.coSignsJson ?? null,
      parentInfractionId: args.parentInfractionId ?? null,
      sourceKind,
      sourceRefId,
      loggedByUserId: args.loggedByUserId ?? undefined,
      parentsNotifiedAt: null,
    })
    .onConflictDoNothing({
      target: [boardingInfractions.schoolId, boardingInfractions.sourceKind, boardingInfractions.sourceRefId],
      where: sql`source_ref_id is not null`,
    })
    .returning({ id: boardingInfractions.id });

  if (inserted.length === 0) return { status: "duplicate" }; // a concurrent/repeat auto-log — no dup

  const id = inserted[0].id;

  // Parent-notify at Warning+ (AC I1) — console SMS, set parents_notified_at. Fresh insert only, so it
  // is naturally idempotent per infraction (a duplicate auto-log never re-sends).
  if (severityNotifiesParent(severity)) {
    const [g] = await tx
      .select({ phone: studentGuardians.phone })
      .from(studentGuardians)
      .where(
        and(
          eq(studentGuardians.schoolId, schoolId),
          eq(studentGuardians.studentId, studentId),
          eq(studentGuardians.isPrimary, true),
        ),
      )
      .limit(1);
    if (g?.phone) {
      const [sch] = await tx.select({ name: schools.name }).from(schools).where(eq(schools.id, schoolId)).limit(1);
      const name = `${stu.firstName.charAt(0)}. ${stu.lastName}`;
      await sendSms(g.phone, disciplineParentSms(name, severity, sch?.name ?? "School"));
      await tx
        .update(boardingInfractions)
        .set({ parentsNotifiedAt: new Date() })
        .where(and(eq(boardingInfractions.schoolId, schoolId), eq(boardingInfractions.id, id)));
    }
  }

  await recordAudit(tx, {
    schoolId,
    actorUserId: args.loggedByUserId ?? undefined,
    actorRole: args.actorRole,
    actionType: "INFRACTION_LOGGED",
    entityType: "boarding_infractions",
    entityId: id,
    after: { studentId, severity, sourceKind, sourceRefId },
    reason: args.narrativeText.slice(0, 200),
  });

  return { status: "inserted", id };
}
