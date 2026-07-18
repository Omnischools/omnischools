/**
 * SERVER-ONLY visiting-day SMS chain (SHS module 4.2 / INCR-12). Cohort RSVP invitation/reminders +
 * per-visit arrival-confirm + overstay → sendSms() — the CONSOLE provider until the owner provisions
 * Hubtel (module decision #3). This file NEVER provisions HUBTEL_* creds; it costs nothing until
 * go-live and reuses the INCR-9 exeat_notification idempotency posture.
 *
 * Idempotency (Kofi OQ7): one boarding_visit_notification per (scope × kind), guarded by NOT EXISTS
 * before each send. Cohort/event kinds (INVITATION/REMINDER_T3/REMINDER_T1) are event-scoped (visit_id
 * NULL) — ONE guard row per (event × kind) covers the whole batch, so a re-click never double-sends.
 * Per-visit kinds (ARRIVAL_CONFIRM/OVERSTAY) are visit-scoped. Overstay is on-read (no cron), grace 15
 * min. PII discipline: only the delivery to_phone is logged — never a visitor name/ID hint (AC J4).
 *
 * Overstay writes ZERO discipline rows (INCR-13 stub) — it is a notification only (AC G3).
 */
import "server-only";
import { and, eq, isNull, inArray } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { withSchool } from "@/lib/db/rls";
import {
  boardingVisit,
  boardingVisitNotification,
  students,
  studentGuardians,
  houses,
  users,
  classes,
  schools,
} from "@/db/schema";
import { canAccessHouse } from "@/lib/access";
import { sendSms } from "@/lib/sms";
import { isPastorallyFlagged } from "./pastoral-stub";
import {
  cohortSms,
  arrivalConfirmSms,
  overstaySms,
  formInScope,
  overstayState,
  type NotificationKind,
  type VisitStatus,
} from "./visiting";
import type { CalendarEvent, VisitingPolicy } from "./config";

const shortName = (first: string, last: string) => `${first.charAt(0)}. ${last}`;

function formNumberOf(level: string | null, name: string | null): number | null {
  const src = `${level ?? ""} ${name ?? ""}`;
  const m = src.match(/(?:Form|F)\s*([123])/i);
  return m ? Number(m[1]) : null;
}

async function primaryGuardianPhone(tx: Tx, schoolId: string, studentId: string): Promise<string | null> {
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
  return g?.phone ?? null;
}

/** The House HM's phone (the overstay/arrival notification recipient — "HM is notified"). */
async function houseHmPhone(tx: Tx, schoolId: string, houseId: string): Promise<string | null> {
  const [row] = await tx
    .select({ phone: users.phone })
    .from(houses)
    .leftJoin(users, eq(houses.hmUserId, users.id))
    .where(and(eq(houses.schoolId, schoolId), eq(houses.id, houseId)))
    .limit(1);
  return row?.phone ?? null;
}

const fmtDate = (dateIso: string): string =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(`${dateIso}T12:00:00Z`),
  );

export interface CohortResult {
  ok: boolean;
  skipped: boolean;
  sent: number;
  error?: string;
}

/**
 * Cohort RSVP reminder (AC I1/I2) — sends the console SMS to every in-scope boarder's primary guardian
 * ONCE per (event × kind). Idempotent: a guard boarding_visit_notification row (event-scoped, visit_id
 * NULL) makes a re-click a no-op. Respects the event formScope (FORMS_1_2 → F3 excluded — E2). The guard
 * row logs only a cohort marker + the copy — never a visitor name/ID (AC J4).
 */
export async function sendCohortReminder(
  schoolId: string,
  roles: readonly string[],
  userId: string | null,
  event: CalendarEvent,
  policy: VisitingPolicy,
  kind: "INVITATION" | "REMINDER_T3" | "REMINDER_T1",
  actorUserId: string | null,
): Promise<CohortResult> {
  return withSchool(schoolId, async (tx): Promise<CohortResult> => {
    // Idempotency guard — one row per (event × kind), visit_id NULL.
    const existing = await tx
      .select({ id: boardingVisitNotification.id })
      .from(boardingVisitNotification)
      .where(
        and(
          eq(boardingVisitNotification.schoolId, schoolId),
          eq(boardingVisitNotification.calendarEventId, event.id),
          eq(boardingVisitNotification.kind, kind),
          isNull(boardingVisitNotification.visitId),
        ),
      )
      .limit(1);
    if (existing.length) return { ok: true, skipped: true, sent: 0 };

    const [school] = await tx.select({ name: schools.name }).from(schools).where(eq(schools.id, schoolId)).limit(1);
    const schoolName = school?.name ?? "School";

    // Accessible Houses (house-scope for a plain HM).
    const houseRows = await tx
      .select({ id: houses.id, hmUserId: houses.hmUserId })
      .from(houses)
      .where(eq(houses.schoolId, schoolId));
    const houseIds = houseRows.filter((h) => canAccessHouse(roles, userId, h.hmUserId)).map((h) => h.id);
    if (houseIds.length === 0) return { ok: false, skipped: false, sent: 0, error: "No Houses in scope." };

    const boarders = await tx
      .select({
        studentId: students.id,
        classLevel: classes.level,
        className: classes.name,
      })
      .from(students)
      .leftJoin(classes, and(eq(classes.schoolId, students.schoolId), eq(classes.id, students.classId)))
      .where(
        and(
          eq(students.schoolId, schoolId),
          inArray(students.houseId, houseIds),
          eq(students.residency, "BOARDER"),
          eq(students.status, "ACTIVE"),
        ),
      );

    const body = cohortSms(kind, schoolName, fmtDate(event.date), policy.hoursStart, policy.hoursEnd);
    const phones = new Set<string>();
    for (const b of boarders) {
      if (!formInScope(formNumberOf(b.classLevel, b.className), event.formScope)) continue;
      const phone = await primaryGuardianPhone(tx, schoolId, b.studentId);
      if (phone) phones.add(phone);
    }

    let sent = 0;
    for (const phone of phones) {
      const r = await sendSms(phone, body);
      if (r.ok) sent += 1;
    }

    // The single event-scoped guard row (cohort marker — NO visitor PII).
    await tx.insert(boardingVisitNotification).values({
      schoolId,
      visitId: null,
      calendarEventId: event.id,
      kind,
      toPhone: `cohort:${phones.size}`,
      body,
      provider: "console",
      ok: true,
      sentByUserId: actorUserId ?? undefined,
    });

    return { ok: true, skipped: false, sent };
  });
}

export type PerVisitResult = "sent" | "skipped" | "no_phone";

/**
 * Fire a per-visit notification (ARRIVAL_CONFIRM / OVERSTAY) to the House HM, idempotently. Returns
 * "skipped" when the (visit × kind) row already exists (AC I2 — a re-arrival never double-sends). A
 * pastoral-active student's arrival adds the "HM to check in personally" note (AC I4 — console
 * notification only, NO VLC journal write). Runs inside the caller's tx.
 */
export async function sendVisitNotification(
  tx: Tx,
  schoolId: string,
  visitId: string,
  kind: "ARRIVAL_CONFIRM" | "OVERSTAY",
  policy: VisitingPolicy,
  actorUserId: string | null,
): Promise<PerVisitResult> {
  const existing = await tx
    .select({ id: boardingVisitNotification.id })
    .from(boardingVisitNotification)
    .where(
      and(
        eq(boardingVisitNotification.schoolId, schoolId),
        eq(boardingVisitNotification.visitId, visitId),
        eq(boardingVisitNotification.kind, kind),
      ),
    )
    .limit(1);
  if (existing.length) return "skipped";

  const [v] = await tx
    .select({
      houseId: boardingVisit.houseId,
      firstName: students.firstName,
      lastName: students.lastName,
      studentCode: students.studentCode,
    })
    .from(boardingVisit)
    .innerJoin(students, and(eq(students.schoolId, boardingVisit.schoolId), eq(students.id, boardingVisit.studentId)))
    .where(and(eq(boardingVisit.schoolId, schoolId), eq(boardingVisit.id, visitId)))
    .limit(1);
  if (!v) return "skipped";

  const [school] = await tx.select({ name: schools.name }).from(schools).where(eq(schools.id, schoolId)).limit(1);
  const schoolName = school?.name ?? "School";
  const studentName = shortName(v.firstName, v.lastName);
  const body =
    kind === "ARRIVAL_CONFIRM"
      ? arrivalConfirmSms(studentName, schoolName, isPastorallyFlagged(v.studentCode))
      : overstaySms(studentName, schoolName, policy.hoursEnd);

  const phone = await houseHmPhone(tx, schoolId, v.houseId);
  if (!phone) {
    await tx.insert(boardingVisitNotification).values({
      schoolId,
      visitId,
      kind,
      toPhone: "",
      body,
      provider: "none",
      ok: false,
      error: "no HM phone on file",
      sentByUserId: actorUserId ?? undefined,
    });
    return "no_phone";
  }
  const r = await sendSms(phone, body);
  await tx.insert(boardingVisitNotification).values({
    schoolId,
    visitId,
    kind,
    toPhone: phone,
    body,
    provider: r.provider,
    providerMessageId: r.id,
    error: r.error,
    ok: r.ok,
    sentByUserId: actorUserId ?? undefined,
  });
  return "sent";
}

export interface OverstaySummary {
  checked: number;
  sent: number;
}

/**
 * Triggered overstay sweep (AC G2 — on-read, no cron). For every on-campus visit past hoursEnd+grace in
 * the accessible Houses, fire the HM console SMS (idempotent per visit). Writes ZERO discipline rows
 * (INCR-13 stub — AC G3). `now` injected for tests.
 */
export async function runOverstaySweep(
  schoolId: string,
  roles: readonly string[],
  userId: string | null,
  event: CalendarEvent,
  policy: VisitingPolicy,
  actorUserId: string | null,
  now: Date = new Date(),
): Promise<OverstaySummary> {
  return withSchool(schoolId, async (tx): Promise<OverstaySummary> => {
    const houseRows = await tx
      .select({ id: houses.id, hmUserId: houses.hmUserId })
      .from(houses)
      .where(eq(houses.schoolId, schoolId));
    const houseIds = houseRows.filter((h) => canAccessHouse(roles, userId, h.hmUserId)).map((h) => h.id);
    if (houseIds.length === 0) return { checked: 0, sent: 0 };

    const rows = await tx
      .select({ id: boardingVisit.id, status: boardingVisit.status, departedAt: boardingVisit.departedAt })
      .from(boardingVisit)
      .where(
        and(
          eq(boardingVisit.schoolId, schoolId),
          eq(boardingVisit.calendarEventId, event.id),
          inArray(boardingVisit.houseId, houseIds),
        ),
      );
    const overstaying = rows.filter(
      (r) =>
        overstayState(
          { status: r.status as VisitStatus, departedAt: r.departedAt },
          event.date,
          policy.hoursEnd,
          now,
        ) !== "none",
    );

    let sent = 0;
    for (const r of overstaying) {
      const res = await sendVisitNotification(tx, schoolId, r.id, "OVERSTAY", policy, actorUserId);
      if (res === "sent") sent += 1;
    }
    return { checked: overstaying.length, sent };
  });
}

// Re-export for the actions' kind typing.
export type { NotificationKind };
