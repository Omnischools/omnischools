"use server";
/**
 * Sickbay NOTIFY write path (SHS module 4.4 / INCR-26 · referral §02-thread + §03 timeline + visit
 * §05 log). Mirrors lib/actions/sickbay-referral.ts EXACTLY: `authorizeClinicalWrite()` is the FIRST
 * statement of every mutation, a Zod parse, a `withSchool` transaction with `recordAudit` inside the
 * same tx, and every anchor id is re-resolved server-side (a client id is never trusted). Every rule
 * that decides a value lives in lib/sickbay/notify.ts and is unit-tested there.
 *
 * 🔴 R206 — THE CONSOLE-ONLY BOUNDARY IS STRUCTURAL. This file does NOT import or call
 * `getSmsProvider()` / `sendSms()`, reads NO `HUBTEL_*` env, and touches no secret. A live send does
 * exactly three writes then STOPS: INSERT sickbay_notification; for an SMS-OUTBOUND row INSERT
 * notification_log DIRECTLY as `status='QUEUED'`, `provider='console'`; link `notification_log_id`.
 * 🔴 QUEUED IS TERMINAL — nothing dispatches, nothing advances it to SENT/FAILED. The single future
 * real-dispatch seam is one line: route the notification_log write through `sendSms()` when Hubtel
 * lands (see FUTURE-DISPATCH-SEAM below). Costs nothing today, sends nothing real.
 *
 * 🔴 R208 — APPEND-ONLY. Every send/inbound/attempt is a NEW row; the ONLY UPDATE to
 * sickbay_notification in this whole module is `sendScheduledReminder`'s one `scheduled_for → sent_at`
 * stamp. 🔴 The audit `before`/`after` carries EVENT METADATA ONLY — never `body`, `private_note`,
 * clinical text or a diagnosis (the 25a/25b masking lesson).
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withSchool } from "@/lib/db/rls";
import type { Tx } from "@/lib/db";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { getCurrentUser } from "@/lib/auth";
import { hasAnyRole, SICKBAY_CLINICAL_WRITE_ROLES } from "@/lib/access";
import { safeRevalidate } from "@/lib/revalidate";
import {
  houses,
  notificationLog,
  schools,
  sickbayHospital,
  sickbayNotification,
  sickbayReferral,
  sickbayVisit,
  students,
  studentGuardians,
} from "@/db/schema";
import {
  housemasterNotificationBody,
  parentAdmissionConfirmBody,
  parentReferralConfirmBody,
  recipientsForTier,
  sendScheduledGuard,
  tierForEvent,
  tierGuard,
  type NotifyRecipient,
  type SickbayEventKind,
} from "@/lib/sickbay/notify";

type Result = { ok: boolean; error?: string; id?: string };
const refPath = (id: string) => `/senior/sickbay/referrals/${id}`;
const visitPath = (id: string) => `/senior/sickbay/visits/${id}`;
const NOTIFY_PATH = "/senior/sickbay/referrals/notifications";

class NamedError extends Error {}

async function authorizeClinicalWrite(): Promise<
  { ok: true; schoolId: string; actor: { id: string | null; role: string } } | { ok: false; error: string }
> {
  const { school } = await requireSchool();
  const user = await getCurrentUser();
  if (!user || !hasAnyRole(user.roles, SICKBAY_CLINICAL_WRITE_ROLES)) {
    return { ok: false, error: "Only the Matron can record a parent notification." };
  }
  const actor = await resolveActor(school.id);
  return { ok: true, schoolId: school.id, actor };
}

const audit = (
  tx: Tx,
  schoolId: string,
  actor: { id: string | null; role: string },
  entry: { actionType: string; entityType: string; entityId: string; before?: unknown; after?: unknown; reason: string },
) => recordAudit(tx, { schoolId, actorUserId: actor.id ?? undefined, actorRole: actor.role, ...entry });

// ============================================================================
// Server-side anchor + recipient resolution (no IDOR — every id re-resolved in-tx)
// ============================================================================

interface Anchor {
  studentId: string;
  visitId: string | null;
  referralId: string | null;
  hospitalName: string | null;
}

/** Re-resolve the referral/visit anchor of THIS school → the durable student id. A bad id ⇒ null. */
async function resolveAnchor(
  tx: Tx,
  schoolId: string,
  ref: { referralId?: string | null; visitId?: string | null },
): Promise<Anchor | null> {
  if (ref.referralId) {
    const [r] = await tx
      .select({ id: sickbayReferral.id, studentId: sickbayReferral.studentId, visitId: sickbayReferral.visitId, hospitalName: sickbayHospital.name })
      .from(sickbayReferral)
      .leftJoin(sickbayHospital, and(eq(sickbayHospital.schoolId, schoolId), eq(sickbayHospital.id, sickbayReferral.hospitalId)))
      .where(and(eq(sickbayReferral.schoolId, schoolId), eq(sickbayReferral.id, ref.referralId)))
      .limit(1);
    if (!r) return null;
    return { studentId: r.studentId, visitId: r.visitId, referralId: r.id, hospitalName: r.hospitalName };
  }
  if (ref.visitId) {
    const [v] = await tx
      .select({ id: sickbayVisit.id, studentId: sickbayVisit.studentId })
      .from(sickbayVisit)
      .where(and(eq(sickbayVisit.schoolId, schoolId), eq(sickbayVisit.id, ref.visitId)))
      .limit(1);
    if (!v) return null;
    return { studentId: v.studentId, visitId: v.id, referralId: null, hospitalName: null };
  }
  return null;
}

/** `Y. Aidoo` — the one-name form. The parent SMS carries the child's name; never inline in the action. */
async function studentContext(
  tx: Tx,
  schoolId: string,
  studentId: string,
): Promise<{ shortName: string; houseName: string | null; hmUserId: string | null } | null> {
  const [s] = await tx
    .select({ firstName: students.firstName, lastName: students.lastName, houseName: houses.name, hmUserId: houses.hmUserId })
    .from(students)
    .leftJoin(houses, and(eq(houses.schoolId, schoolId), eq(houses.id, students.houseId)))
    .where(and(eq(students.schoolId, schoolId), eq(students.id, studentId)))
    .limit(1);
  if (!s) return null;
  return { shortName: `${s.firstName.charAt(0)}. ${s.lastName}`, houseName: s.houseName, hmUserId: s.hmUserId };
}

async function primaryGuardianPhone(tx: Tx, schoolId: string, studentId: string): Promise<string | null> {
  const [g] = await tx
    .select({ phone: studentGuardians.phone })
    .from(studentGuardians)
    .where(and(eq(studentGuardians.schoolId, schoolId), eq(studentGuardians.studentId, studentId), eq(studentGuardians.isPrimary, true)))
    .limit(1);
  return g?.phone ?? null;
}

async function schoolName(tx: Tx, schoolId: string): Promise<string> {
  const [s] = await tx.select({ name: schools.name }).from(schools).where(eq(schools.id, schoolId)).limit(1);
  return s?.name ?? "School";
}

// ============================================================================
// 🔴 The 3-write console-only chain (R206 / NF1 / NF2 / NF9)
// ============================================================================

interface NotificationArgs {
  studentId: string;
  visitId: string | null;
  referralId: string | null;
  tier: 1 | 2 | 3;
  channel: "SMS" | "CALL" | "IN_APP" | "SYSTEM";
  direction: "OUTBOUND" | "INBOUND";
  recipient: NotifyRecipient;
  triggerLabel?: string | null;
  body?: string | null;
  privateNote?: string | null;
  answered?: boolean | null;
  callDurationSeconds?: number | null;
  scheduledFor?: Date | null;
  sentAt?: Date | null;
  /** Only used for the SMS-OUTBOUND notification_log write (channel/direction gate it, not this). */
  phone?: string | null;
}

/**
 * Insert one notification event. For a LIVE SMS-OUTBOUND row (channel SMS, direction OUTBOUND, not a
 * scheduled plan) the notification_log row is written FIRST — DIRECTLY as QUEUED/console — and linked
 * at insert, so the create path performs ZERO update to sickbay_notification (append-only, R208/NF5).
 * A CALL / INBOUND / IN_APP / plan row writes no log (NF9). Returns the new row id.
 *
 * 🔴 FUTURE-DISPATCH-SEAM: when Hubtel goes live, THIS is the single place a real dispatch is wired —
 * replace the direct QUEUED/console notification_log INSERT with `sendSms(phone, body)` and record its
 * provider result. Nothing else changes. Today: no provider, no HUBTEL_* read, QUEUED terminal.
 */
async function insertNotification(
  tx: Tx,
  schoolId: string,
  actor: { id: string | null; role: string },
  args: NotificationArgs,
): Promise<{ id: string; notificationLogId: string | null }> {
  const isLiveSms = args.channel === "SMS" && args.direction === "OUTBOUND" && !args.scheduledFor;
  let notificationLogId: string | null = null;
  if (isLiveSms) {
    const [log] = await tx
      .insert(notificationLog)
      .values({
        schoolId,
        studentId: args.studentId,
        phone: args.phone ?? "",
        message: args.body ?? "",
        status: "QUEUED", // 🔴 terminal — nothing advances it (no dispatch on a console build)
        provider: "console",
        sentByUserId: actor.id ?? undefined,
      })
      .returning({ id: notificationLog.id });
    notificationLogId = log.id;
  }
  const [row] = await tx
    .insert(sickbayNotification)
    .values({
      schoolId,
      studentId: args.studentId,
      visitId: args.visitId,
      referralId: args.referralId,
      tier: args.tier,
      channel: args.channel,
      direction: args.direction,
      recipient: args.recipient,
      triggerLabel: args.triggerLabel ?? null,
      body: args.body ?? null,
      privateNote: args.privateNote ?? null,
      answered: args.answered ?? null,
      callDurationSeconds: args.callDurationSeconds ?? null,
      scheduledFor: args.scheduledFor ?? null,
      sentAt: args.sentAt ?? null,
      notificationLogId,
      createdByUserId: actor.id ?? null,
    })
    .returning({ id: sickbayNotification.id });
  return { id: row.id, notificationLogId };
}

const AnchorSchema = z
  .object({ referralId: z.string().uuid().nullish(), visitId: z.string().uuid().nullish() })
  .refine((d) => !!d.referralId || !!d.visitId, "A referral or visit anchor is required.");

const EVENT_KIND = z.enum(["VISIT", "ADMISSION", "REFERRAL", "CONSULT"]);
const defaultEventKind = (anchor: Anchor): SickbayEventKind => (anchor.referralId ? "REFERRAL" : "VISIT");

// ============================================================================
// W13 + auto-confirm — the tier fan-out from ONE action (R207/R214a · NF4)
// ============================================================================

const ConfirmSchema = AnchorSchema.and(
  z.object({ eventKind: EVENT_KIND, tier: z.number().int().nullish() }),
);

/**
 * 🔴 R207/R214a — confirm an event → the recipient fan-out, ONE action, NO "escalate" control. The
 * PARENT gets a system-composed, DIAGNOSIS-FREE auto-confirm SMS; a Tier-3 event ALSO writes the
 * HOUSEMASTER awareness row (channel IN_APP) with the FIXED medical-detail-light template. A Tier-1
 * event writes NO auto row (routine visits get a manual SMS only). NO HEADMASTER / DISTRICT row is
 * ever written here (INCR-27).
 */
export async function confirmEventNotification(input: unknown): Promise<Result> {
  const auth = await authorizeClinicalWrite();
  if (!auth.ok) return auth;
  const parsed = ConfirmSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Pick a case to notify the parent about." };
  const d = parsed.data;
  // 🔴 NF3 — a client tier contradicting the event is refused before any write.
  const tierErr = tierGuard(d.eventKind, d.tier);
  if (tierErr) return { ok: false, error: tierErr };

  try {
    const id = await withSchool(auth.schoolId, async (tx) => {
      const anchor = await resolveAnchor(tx, auth.schoolId, d);
      if (!anchor) throw new NamedError("That case no longer exists.");
      const tier = tierForEvent(d.eventKind);
      const recipients = recipientsForTier(tier);
      if (recipients.length === 0) {
        throw new NamedError("A routine visit sends no automatic notification — send a manual SMS.");
      }
      const ctx = await studentContext(tx, auth.schoolId, anchor.studentId);
      if (!ctx) throw new NamedError("That student no longer exists.");
      const sName = await schoolName(tx, auth.schoolId);
      const now = new Date();
      let parentRowId: string | null = null;

      for (const recipient of recipients) {
        if (recipient === "PARENT") {
          const phone = await primaryGuardianPhone(tx, auth.schoolId, anchor.studentId);
          const body =
            d.eventKind === "REFERRAL"
              ? parentReferralConfirmBody(ctx.shortName, sName, anchor.hospitalName)
              : parentAdmissionConfirmBody(ctx.shortName, sName);
          const row = await insertNotification(tx, auth.schoolId, auth.actor, {
            studentId: anchor.studentId,
            visitId: anchor.visitId,
            referralId: anchor.referralId,
            tier,
            channel: "SMS",
            direction: "OUTBOUND",
            recipient: "PARENT",
            triggerLabel: "auto",
            body,
            sentAt: now,
            phone,
          });
          parentRowId = row.id;
        } else if (recipient === "HOUSEMASTER") {
          // 🔴 R214b/NF13 — the HM body is the FIXED template, constructed here from name + location.
          // No client text is ever accepted for an HM row → a clinical HM body is impossible.
          await insertNotification(tx, auth.schoolId, auth.actor, {
            studentId: anchor.studentId,
            visitId: anchor.visitId,
            referralId: anchor.referralId,
            tier,
            channel: "IN_APP",
            direction: "OUTBOUND",
            recipient: "HOUSEMASTER",
            triggerLabel: "hm-awareness",
            body: housemasterNotificationBody(ctx.shortName, ctx.houseName),
            sentAt: now,
          });
        }
      }

      await audit(tx, auth.schoolId, auth.actor, {
        actionType: "created",
        entityType: "sickbay_notification",
        entityId: parentRowId ?? anchor.studentId,
        // 🔴 metadata only — no body, no private_note, no diagnosis.
        after: { tier, recipients, referralId: anchor.referralId, visitId: anchor.visitId },
        reason: "Sickbay notification confirmed",
      });
      return parentRowId ?? anchor.studentId;
    });
    revalidateAnchorById(d);
    return { ok: true, id };
  } catch (err) {
    if (err instanceof NamedError) return { ok: false, error: err.message };
    return { ok: false, error: "Could not send the confirmation." };
  }
}

// A thin best-effort revalidate that does not need the resolved anchor (used post-tx).
function revalidateAnchorById(d: { referralId?: string | null; visitId?: string | null }): void {
  if (d.referralId) safeRevalidate(refPath(d.referralId));
  if (d.visitId) safeRevalidate(visitPath(d.visitId));
  safeRevalidate(NOTIFY_PATH);
}

// ============================================================================
// W9 — send / log a manual outbound PARENT SMS (Send manual · ward update)
// ============================================================================

const SendSmsSchema = AnchorSchema.and(
  z.object({
    body: z.string().trim().min(1).max(1000),
    eventKind: EVENT_KIND.nullish(),
    triggerLabel: z.string().trim().max(60).nullish(),
  }),
);

/**
 * W9 — a matron-typed parent SMS (her clinical judgement; A9 leaves free text). Console-only: the row
 * records `sent_at` + a QUEUED/console notification_log link. Rendered "Queued · console", never
 * "delivered".
 */
export async function sendParentSms(input: unknown): Promise<Result> {
  const auth = await authorizeClinicalWrite();
  if (!auth.ok) return auth;
  const parsed = SendSmsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Write the message to send it." };
  const d = parsed.data;
  const tierErr = d.eventKind ? tierGuard(d.eventKind, null) : null;
  if (tierErr) return { ok: false, error: tierErr };

  try {
    const id = await withSchool(auth.schoolId, async (tx) => {
      const anchor = await resolveAnchor(tx, auth.schoolId, d);
      if (!anchor) throw new NamedError("That case no longer exists.");
      const tier = tierForEvent(d.eventKind ?? defaultEventKind(anchor));
      const phone = await primaryGuardianPhone(tx, auth.schoolId, anchor.studentId);
      const now = new Date();
      const row = await insertNotification(tx, auth.schoolId, auth.actor, {
        studentId: anchor.studentId,
        visitId: anchor.visitId,
        referralId: anchor.referralId,
        tier,
        channel: "SMS",
        direction: "OUTBOUND",
        recipient: "PARENT",
        triggerLabel: d.triggerLabel || "update",
        body: d.body,
        sentAt: now,
        phone,
      });
      await audit(tx, auth.schoolId, auth.actor, {
        actionType: "created",
        entityType: "sickbay_notification",
        entityId: row.id,
        after: { tier, recipient: "PARENT", channel: "SMS", direction: "OUTBOUND" },
        reason: "Sickbay parent SMS sent (console)",
      });
      return row.id;
    });
    revalidateAnchorById(d);
    return { ok: true, id };
  } catch (err) {
    if (err instanceof NamedError) return { ok: false, error: err.message };
    return { ok: false, error: "Could not send the message." };
  }
}

// ============================================================================
// W8 — log an outbound PARENT call (answered / no-answer + private note)
// ============================================================================

const LogCallSchema = AnchorSchema.and(
  z.object({
    body: z.string().trim().min(1).max(4000),
    privateNote: z.string().trim().max(4000).nullish(),
    answered: z.boolean(),
    callDurationSeconds: z.coerce.number().int().min(0).max(32000).nullish(),
    eventKind: EVENT_KIND.nullish(),
    triggerLabel: z.string().trim().max(60).nullish(),
  }),
);

/** W8 — the matron records a call outcome. `answered=false` ⇒ the no-answer render (dashed, "attempted"). No log row (a call is not an SMS). */
export async function logParentCall(input: unknown): Promise<Result> {
  const auth = await authorizeClinicalWrite();
  if (!auth.ok) return auth;
  const parsed = LogCallSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Record what was said to log the call." };
  const d = parsed.data;

  try {
    const id = await withSchool(auth.schoolId, async (tx) => {
      const anchor = await resolveAnchor(tx, auth.schoolId, d);
      if (!anchor) throw new NamedError("That case no longer exists.");
      const tier = tierForEvent(d.eventKind ?? defaultEventKind(anchor));
      const now = new Date();
      const row = await insertNotification(tx, auth.schoolId, auth.actor, {
        studentId: anchor.studentId,
        visitId: anchor.visitId,
        referralId: anchor.referralId,
        tier,
        channel: "CALL",
        direction: "OUTBOUND",
        recipient: "PARENT",
        triggerLabel: d.triggerLabel || (d.answered ? "update" : "attempted"),
        body: d.body,
        privateNote: d.privateNote || null,
        answered: d.answered,
        callDurationSeconds: d.answered ? (d.callDurationSeconds ?? null) : null,
        sentAt: now,
      });
      await audit(tx, auth.schoolId, auth.actor, {
        actionType: "created",
        entityType: "sickbay_notification",
        entityId: row.id,
        // 🔴 no body, no private_note in the ADMIN-readable feed — only the fact + the answered flag.
        after: { tier, recipient: "PARENT", channel: "CALL", direction: "OUTBOUND", answered: d.answered },
        reason: "Sickbay parent call logged",
      });
      return row.id;
    });
    revalidateAnchorById(d);
    return { ok: true, id };
  } catch (err) {
    if (err instanceof NamedError) return { ok: false, error: err.message };
    return { ok: false, error: "Could not log the call." };
  }
}

// ============================================================================
// W10 — record an inbound parent contact (call/SMS the parent initiated)
// ============================================================================

const InboundSchema = AnchorSchema.and(
  z.object({
    channel: z.enum(["CALL", "SMS"]),
    body: z.string().trim().min(1).max(4000),
    privateNote: z.string().trim().max(4000).nullish(),
    answered: z.boolean().nullish(),
    callDurationSeconds: z.coerce.number().int().min(0).max(32000).nullish(),
    eventKind: EVENT_KIND.nullish(),
    triggerLabel: z.string().trim().max(60).nullish(),
  }),
);

/**
 * W10 — the matron records a parent-initiated call/SMS AFTER the fact (R21 recorded-actor idiom). No
 * telephony capture, no webhook; the parent's words are matron-transcribed. `notification_log_id`
 * stays NULL (NF8) — an inbound contact is never an SMS the school sent.
 */
export async function logInboundContact(input: unknown): Promise<Result> {
  const auth = await authorizeClinicalWrite();
  if (!auth.ok) return auth;
  const parsed = InboundSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Record what the parent said to log it." };
  const d = parsed.data;

  try {
    const id = await withSchool(auth.schoolId, async (tx) => {
      const anchor = await resolveAnchor(tx, auth.schoolId, d);
      if (!anchor) throw new NamedError("That case no longer exists.");
      const tier = tierForEvent(d.eventKind ?? defaultEventKind(anchor));
      const now = new Date();
      // Direction INBOUND ⇒ insertNotification writes NO notification_log (the gate is channel+direction).
      const row = await insertNotification(tx, auth.schoolId, auth.actor, {
        studentId: anchor.studentId,
        visitId: anchor.visitId,
        referralId: anchor.referralId,
        tier,
        channel: d.channel,
        direction: "INBOUND",
        recipient: "PARENT",
        triggerLabel: d.triggerLabel || "parent-initiated",
        body: d.body,
        privateNote: d.privateNote || null,
        answered: d.answered ?? null,
        callDurationSeconds: d.callDurationSeconds ?? null,
        sentAt: now,
      });
      await audit(tx, auth.schoolId, auth.actor, {
        actionType: "created",
        entityType: "sickbay_notification",
        entityId: row.id,
        after: { tier, recipient: "PARENT", channel: d.channel, direction: "INBOUND" },
        reason: "Sickbay inbound parent contact recorded",
      });
      return row.id;
    });
    revalidateAnchorById(d);
    return { ok: true, id };
  } catch (err) {
    if (err instanceof NamedError) return { ok: false, error: err.message };
    return { ok: false, error: "Could not record the contact." };
  }
}

// ============================================================================
// W11 — schedule a reminder (a plan row; renders DUE on read, no cron)
// ============================================================================

const ScheduleSchema = AnchorSchema.and(
  z.object({
    body: z.string().trim().min(1).max(1000),
    scheduledFor: z.coerce.date(),
    eventKind: EVENT_KIND.nullish(),
    triggerLabel: z.string().trim().max(60).nullish(),
  }),
);

/** W11 — a plan row (`scheduled_for` set, `sent_at` null). Writes NO log (nothing is sent yet). The matron sends at the window. */
export async function scheduleReminder(input: unknown): Promise<Result> {
  const auth = await authorizeClinicalWrite();
  if (!auth.ok) return auth;
  const parsed = ScheduleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Set a reminder time and message." };
  const d = parsed.data;

  try {
    const id = await withSchool(auth.schoolId, async (tx) => {
      const anchor = await resolveAnchor(tx, auth.schoolId, d);
      if (!anchor) throw new NamedError("That case no longer exists.");
      const tier = tierForEvent(d.eventKind ?? defaultEventKind(anchor));
      const row = await insertNotification(tx, auth.schoolId, auth.actor, {
        studentId: anchor.studentId,
        visitId: anchor.visitId,
        referralId: anchor.referralId,
        tier,
        channel: "SMS",
        direction: "OUTBOUND",
        recipient: "PARENT",
        triggerLabel: d.triggerLabel || "scheduled",
        body: d.body,
        scheduledFor: d.scheduledFor, // 🔴 sets scheduledFor ⇒ insertNotification writes NO log yet
      });
      await audit(tx, auth.schoolId, auth.actor, {
        actionType: "created",
        entityType: "sickbay_notification",
        entityId: row.id,
        after: { tier, recipient: "PARENT", channel: "SMS", scheduled: true },
        reason: "Sickbay reminder scheduled",
      });
      return row.id;
    });
    revalidateAnchorById(d);
    return { ok: true, id };
  } catch (err) {
    if (err instanceof NamedError) return { ok: false, error: err.message };
    return { ok: false, error: "Could not schedule the reminder." };
  }
}

// ============================================================================
// 🔴 W12 — send a scheduled reminder: THE ONE PERMITTED UPDATE (R208 · NF6)
// ============================================================================

const SendScheduledSchema = z.object({ notificationId: z.string().uuid() });

/**
 * 🔴 W12 — the SINGLE in-place stamp this module performs: a PLAN row's `scheduled_for → sent_at`
 * fulfillment, attaching the QUEUED/console `notification_log_id`. Legal only while `sent_at` is null
 * (a re-click is a NO-OP — NF6). No history is mutated; the timestamp IS the lifecycle (the row has no
 * status enum). Console-only: the log is written directly, QUEUED terminal.
 */
export async function sendScheduledReminder(input: unknown): Promise<Result> {
  const auth = await authorizeClinicalWrite();
  if (!auth.ok) return auth;
  const parsed = SendScheduledSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid reminder." };
  const d = parsed.data;

  try {
    const anchorForPath = await withSchool(auth.schoolId, async (tx) => {
      const [row] = await tx
        .select({
          id: sickbayNotification.id,
          studentId: sickbayNotification.studentId,
          referralId: sickbayNotification.referralId,
          visitId: sickbayNotification.visitId,
          body: sickbayNotification.body,
          scheduledFor: sickbayNotification.scheduledFor,
          sentAt: sickbayNotification.sentAt,
        })
        .from(sickbayNotification)
        .where(and(eq(sickbayNotification.schoolId, auth.schoolId), eq(sickbayNotification.id, d.notificationId)))
        .limit(1);
      if (!row) throw new NamedError("That reminder no longer exists.");
      // 🔴 NF6 — idempotent: only a not-yet-sent plan row may be stamped; a re-click is refused.
      const guardErr = sendScheduledGuard({ scheduledFor: row.scheduledFor, sentAt: row.sentAt });
      if (guardErr) throw new NamedError(guardErr);

      const phone = await primaryGuardianPhone(tx, auth.schoolId, row.studentId);
      const now = new Date();
      // Write the QUEUED/console log directly (console-only, no dispatch), then the ONE stamp.
      const [log] = await tx
        .insert(notificationLog)
        .values({
          schoolId: auth.schoolId,
          studentId: row.studentId,
          phone: phone ?? "",
          message: row.body ?? "",
          status: "QUEUED",
          provider: "console",
          sentByUserId: auth.actor.id ?? undefined,
        })
        .returning({ id: notificationLog.id });
      await tx
        .update(sickbayNotification)
        // 🔴 the ONLY sickbay_notification UPDATE in the module — exactly { sentAt, notificationLogId }.
        .set({ sentAt: now, notificationLogId: log.id })
        .where(and(eq(sickbayNotification.schoolId, auth.schoolId), eq(sickbayNotification.id, row.id)));
      await audit(tx, auth.schoolId, auth.actor, {
        actionType: "updated",
        entityType: "sickbay_notification",
        entityId: row.id,
        before: { sentAt: null },
        after: { sentAt: now, scheduled: true },
        reason: "Sickbay scheduled reminder sent (console)",
      });
      return { referralId: row.referralId, visitId: row.visitId };
    });
    revalidateAnchorById(anchorForPath);
    return { ok: true, id: d.notificationId };
  } catch (err) {
    if (err instanceof NamedError) return { ok: false, error: err.message };
    return { ok: false, error: "Could not send the reminder." };
  }
}
