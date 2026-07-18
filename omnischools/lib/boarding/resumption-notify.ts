/**
 * SERVER-ONLY resumption/vacation SMS chain (SHS module 4.2 / INCR-11). Arrival/departure
 * confirmation + unaccounted-at-window reminder → sendSms() — the CONSOLE provider until the owner
 * provisions Hubtel (module decision #3). This file NEVER provisions HUBTEL_* creds; it costs nothing
 * until go-live and reuses the INCR-9 posture.
 *
 * Kofi OQ5 gave boarding_arrival NO notification table (unlike exeat_notification) — the arrival
 * SMS is a one-shot fired on the FIRST check-in (the action only sends when a row is newly inserted,
 * never on a re-scan upsert), and the unaccounted sweep is on-read + triggered (no cron, no stored
 * idempotency). ponytail: unaccounted has no per-send de-dup store, so a re-triggered sweep re-sends;
 * for the console provider that is harmless. Add an exeat_notification-style log only if Hubtel go-live
 * needs paid-send idempotency.
 */
import "server-only";
import { and, eq } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { withSchool } from "@/lib/db/rls";
import { students, studentGuardians } from "@/db/schema";
import { sendSms, type SmsResult } from "@/lib/sms";
import { getResumptionBoard } from "./resumption-data";
import { arrivalSms, departureSms, unaccountedSms, type BoardingMode } from "./resumption";

async function primaryGuardianPhone(
  tx: Tx,
  schoolId: string,
  studentId: string,
): Promise<string | null> {
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

/**
 * Fire the arrival (RESUMPTION) / departure (VACATION) confirmation SMS to the boarder's primary
 * guardian (AC H4/I1). Console provider — no real send. Returns null when no phone is on file (the
 * SMS is skipped, never a hard failure that blocks the gate check). No notification row is written
 * (Kofi OQ5 — no arrival notification table).
 */
export async function sendArrivalNotification(
  tx: Tx,
  schoolId: string,
  studentId: string,
  mode: BoardingMode,
  schoolName: string,
): Promise<SmsResult | null> {
  const [stu] = await tx
    .select({ firstName: students.firstName, lastName: students.lastName })
    .from(students)
    .where(and(eq(students.schoolId, schoolId), eq(students.id, studentId)))
    .limit(1);
  if (!stu) return null;
  const phone = await primaryGuardianPhone(tx, schoolId, studentId);
  if (!phone) return null;
  const name = `${stu.firstName.charAt(0)}. ${stu.lastName}`;
  const body = mode === "RESUMPTION" ? arrivalSms(name, schoolName) : departureSms(name, schoolName);
  return sendSms(phone, body);
}

const UNACCOUNTED_PREFIX = "unaccounted-";

/**
 * Triggered unaccounted sweep (AC G2/I2) — on-read, no cron. Re-derives the unaccounted set through
 * getResumptionBoard (the same derivation the surface shows) and sends the parent a console SMS for
 * each. Returns how many were checked / sent. NO discipline row, NO stored flag (INCR-13 stub).
 */
export async function runUnaccountedSweep(
  schoolId: string,
  roles: readonly string[],
  userId: string | null,
  schoolName: string,
  dateIso?: string,
  now: Date = new Date(),
): Promise<{ checked: number; sent: number }> {
  const board = await getResumptionBoard(schoolId, "RESUMPTION", roles, userId, dateIso, now);
  const studentIds = board.issues
    .filter((i) => i.category === "unaccounted")
    .map((i) => i.id.slice(UNACCOUNTED_PREFIX.length));
  if (studentIds.length === 0) return { checked: 0, sent: 0 };

  let sent = 0;
  await withSchool(schoolId, async (tx) => {
    for (const studentId of studentIds) {
      const [stu] = await tx
        .select({ firstName: students.firstName, lastName: students.lastName })
        .from(students)
        .where(and(eq(students.schoolId, schoolId), eq(students.id, studentId)))
        .limit(1);
      if (!stu) continue;
      const phone = await primaryGuardianPhone(tx, schoolId, studentId);
      if (!phone) continue;
      const name = `${stu.firstName.charAt(0)}. ${stu.lastName}`;
      await sendSms(phone, unaccountedSms(name, schoolName));
      sent += 1;
    }
  });
  return { checked: studentIds.length, sent };
}
