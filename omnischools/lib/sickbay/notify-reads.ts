/**
 * SERVER-ONLY read API for the sickbay NOTIFY surfaces (SHS module 4.4 / INCR-26) — the referral
 * §02-thread, the §03 today timeline, and the visit §05 comms log. Imports the DB driver via
 * `withSchool`, so it must NEVER be imported by a client component: pages fetch through here, pre-shape
 * every string a client table needs, and pass serialisable props down (repo memory
 * `reports-data-is-server-only` — only `pnpm build` catches the leak).
 *
 * 🔴 R211/F4/NF11 — the PROJECTIONS live here. `private_note` is MATRON-ONLY: the reader takes a
 * `canReadPrivateNote` flag and `projectPrivateNote` trims it to null for a HEADMASTER, server-side.
 * `trigger_label` + all metadata are staff-only (both readers are clinical-gated). 🔴 R206/CS-1..9 —
 * a console send has a `sent_at` (it was logged) but NO delivery receipt: the delivery label reads the
 * notification_log `status` honestly ("Queued · console"), NEVER "delivered".
 */
import "server-only";
import { and, asc, eq, gte, lt, or } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import type { Tx } from "@/lib/db";
import {
  classes,
  houses,
  notificationLog,
  sickbayNotification,
  students,
  studentGuardians,
  users,
} from "@/db/schema";
import { formLabel } from "./defaults";
import { abbreviateName as shortName } from "./board-copy";
import {
  durationLabel,
  projectPrivateNote,
  relativeLabel,
  scheduledState,
  type NotifyRecipient,
  type ScheduledState,
} from "./notify";

const REL_LABEL: Record<string, string> = {
  MOTHER: "mother",
  FATHER: "father",
  GUARDIAN: "guardian",
  GRANDPARENT: "grandparent",
  SIBLING: "sibling",
  AUNT_UNCLE: "aunt / uncle",
  OTHER: "contact",
};

const hhmm = (d: Date) =>
  `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;

/** Keep the country code + last 3 digits; mask the middle (the chronic-register store-full/mask-display rule). */
function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\s+/g, "");
  if (digits.length < 6) return "•••";
  return `${digits.slice(0, 4)} ••• ${digits.slice(-3)}`;
}

/**
 * 🔴 R206/CS-1..9 — the console-honest delivery label. A logged console send is "Queued · console",
 * never "delivered". SENT/FAILED only appear on SEED rows that pre-stage the future-dispatch visuals
 * (F-F); a LIVE send is always QUEUED. A row with no log (a call / inbound / IN_APP) has no label.
 */
function deliveryLabel(status: string | null, provider: string | null): string | null {
  if (!status) return null;
  if (status === "QUEUED") return provider === "console" ? "Queued · console" : "Queued";
  if (status === "SENT") return "Sent";
  if (status === "FAILED") return "Failed";
  return null;
}

// ============================================================================
// §02 — the referral parent-comms thread (PARENT only, chronological)
// ============================================================================

export interface ThreadEvent {
  id: string;
  timeHHMM: string;
  ago: string;
  channel: "SMS" | "CALL" | "IN_APP" | "SYSTEM";
  direction: "OUTBOUND" | "INBOUND";
  answered: boolean | null;
  /** `4m 12s` for an answered call; null for an SMS or a no-answer. */
  durationLabel: string | null;
  tier: number;
  triggerLabel: string | null;
  /** Parent-facing. */
  body: string | null;
  /** 🔴 MATRON-only (F4/NF11) — always null for a HEADMASTER reader. */
  privateNote: string | null;
  /** "Queued · console" for a logged SMS; null for a call/inbound. Never "delivered". */
  deliveryLabel: string | null;
  isFailedCall: boolean;
}

export interface ReferralThread {
  head: { guardianLabel: string | null; phoneMasked: string | null; count: number };
  events: ThreadEvent[];
}

/**
 * §02 — `WHERE referral_id = ? AND recipient = 'PARENT'`, chronological ascending. `canReadPrivateNote`
 * is the F4 boundary: true for a MATRON, false for a HEADMASTER (the note is trimmed to null server-
 * side, never sent in the flight payload). A bad id ⇒ empty thread (the page has already gated + the
 * referral re-resolve returns notFound upstream).
 */
export async function getReferralThread(
  schoolId: string,
  referralId: string,
  now: Date,
  canReadPrivateNote: boolean,
): Promise<ReferralThread> {
  return withSchool(schoolId, async (tx) => {
    const rows = await tx
      .select({
        id: sickbayNotification.id,
        studentId: sickbayNotification.studentId,
        channel: sickbayNotification.channel,
        direction: sickbayNotification.direction,
        answered: sickbayNotification.answered,
        callDurationSeconds: sickbayNotification.callDurationSeconds,
        tier: sickbayNotification.tier,
        triggerLabel: sickbayNotification.triggerLabel,
        body: sickbayNotification.body,
        privateNote: sickbayNotification.privateNote,
        sentAt: sickbayNotification.sentAt,
        createdAt: sickbayNotification.createdAt,
        logStatus: notificationLog.status,
        logProvider: notificationLog.provider,
      })
      .from(sickbayNotification)
      .leftJoin(notificationLog, eq(notificationLog.id, sickbayNotification.notificationLogId))
      .where(
        and(
          eq(sickbayNotification.schoolId, schoolId),
          eq(sickbayNotification.referralId, referralId),
          eq(sickbayNotification.recipient, "PARENT"),
        ),
      )
      .orderBy(asc(sickbayNotification.createdAt));

    const events: ThreadEvent[] = rows.map((r) => {
      const when = r.sentAt ?? r.createdAt;
      return {
        id: r.id,
        timeHHMM: hhmm(when),
        ago: relativeLabel(when, now),
        channel: r.channel,
        direction: r.direction,
        answered: r.answered,
        durationLabel: durationLabel(r.callDurationSeconds),
        tier: r.tier,
        triggerLabel: r.triggerLabel,
        body: r.body,
        // 🔴 the F4/NF11 trim — MATRON gets the note, HEADMASTER gets null.
        privateNote: projectPrivateNote(r.privateNote, canReadPrivateNote),
        deliveryLabel: r.channel === "SMS" ? deliveryLabel(r.logStatus, r.logProvider) : null,
        isFailedCall: r.channel === "CALL" && r.answered === false,
      };
    });

    // Head — the primary guardian identity + masked phone, derived (never a demo literal).
    const studentId = rows[0]?.studentId;
    let guardianLabel: string | null = null;
    let phoneMasked: string | null = null;
    if (studentId) {
      const [g] = await tx
        .select({ name: studentGuardians.name, relationship: studentGuardians.relationship, phone: studentGuardians.phone })
        .from(studentGuardians)
        .where(and(eq(studentGuardians.schoolId, schoolId), eq(studentGuardians.studentId, studentId), eq(studentGuardians.isPrimary, true)))
        .limit(1);
      if (g) {
        guardianLabel = `${shortName(g.name) ?? g.name} (${REL_LABEL[g.relationship] ?? "contact"})`;
        phoneMasked = maskPhone(g.phone);
      }
    }

    return { head: { guardianLabel, phoneMasked, count: events.length }, events };
  });
}

// ============================================================================
// §03 — today's parent-notifications timeline (all PARENT rows for the civil day)
// ============================================================================

export interface TimelineRow {
  id: string;
  timeHHMM: string;
  ago: string;
  tier: number;
  scheduled: ScheduledState;
  studentShort: string;
  formLabel: string;
  houseName: string | null;
  triggerLabel: string | null;
  channel: "SMS" | "CALL" | "IN_APP" | "SYSTEM";
  durationLabel: string | null;
  direction: "OUTBOUND" | "INBOUND";
  /** The `Due HH:MM` chip time for a plan row; null once sent. */
  dueHHMM: string | null;
}

export interface TimelineStats {
  tier1: number;
  tier2: number;
  tier3: number;
  due: number;
}

export interface TodayTimeline {
  rows: TimelineRow[];
  stats: TimelineStats;
}

function dayBounds(now: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start.getTime() + 86_400_000);
  return { start, end };
}

/**
 * §03 — the day view: every PARENT notification whose `sent_at` is today, PLUS today's not-yet-sent
 * plan rows (`scheduled_for` today, `sent_at` null → the `.future`/`Due` row). Ordered by the
 * effective time. Stats are DERIVED from the actual rows (never a fabricated literal — F14). The
 * fabricated delivery-rate / failure telemetry (85% · "1 fail") is OMITTED entirely (console-only, §3).
 */
export async function getTodayNotifications(schoolId: string, now: Date): Promise<TodayTimeline> {
  return withSchool(schoolId, async (tx) => {
    const { start, end } = dayBounds(now);
    const rows = await tx
      .select({
        id: sickbayNotification.id,
        tier: sickbayNotification.tier,
        channel: sickbayNotification.channel,
        direction: sickbayNotification.direction,
        triggerLabel: sickbayNotification.triggerLabel,
        callDurationSeconds: sickbayNotification.callDurationSeconds,
        scheduledFor: sickbayNotification.scheduledFor,
        sentAt: sickbayNotification.sentAt,
        firstName: students.firstName,
        lastName: students.lastName,
        programme: students.programme,
        className: classes.name,
        classLevel: classes.level,
        houseName: houses.name,
      })
      .from(sickbayNotification)
      .innerJoin(students, and(eq(students.schoolId, schoolId), eq(students.id, sickbayNotification.studentId)))
      .leftJoin(classes, and(eq(classes.schoolId, schoolId), eq(classes.id, students.classId)))
      .leftJoin(houses, and(eq(houses.schoolId, schoolId), eq(houses.id, students.houseId)))
      .where(
        and(
          eq(sickbayNotification.schoolId, schoolId),
          eq(sickbayNotification.recipient, "PARENT"),
          or(
            and(gte(sickbayNotification.sentAt, start), lt(sickbayNotification.sentAt, end)),
            and(gte(sickbayNotification.scheduledFor, start), lt(sickbayNotification.scheduledFor, end)),
          ),
        ),
      );

    const shaped: TimelineRow[] = rows
      .map((r) => {
        const state = scheduledState({ scheduledFor: r.scheduledFor, sentAt: r.sentAt }, now);
        const when = r.sentAt ?? r.scheduledFor ?? new Date();
        return {
          id: r.id,
          when,
          row: {
            id: r.id,
            timeHHMM: hhmm(when),
            ago: relativeLabel(when, now),
            tier: r.tier,
            scheduled: state,
            studentShort: `${r.firstName.charAt(0)}. ${r.lastName}`,
            formLabel: formLabel(r.classLevel, r.className, r.programme),
            houseName: r.houseName,
            triggerLabel: r.triggerLabel,
            channel: r.channel,
            durationLabel: durationLabel(r.callDurationSeconds),
            direction: r.direction,
            dueHHMM: r.sentAt ? null : r.scheduledFor ? hhmm(r.scheduledFor) : null,
          } as TimelineRow,
        };
      })
      .sort((a, b) => a.when.getTime() - b.when.getTime())
      .map((x) => x.row);

    const stats: TimelineStats = {
      tier1: shaped.filter((r) => r.tier === 1 && r.scheduled !== "DUE" && r.scheduled !== "PENDING").length,
      tier2: shaped.filter((r) => r.tier === 2 && r.scheduled !== "DUE" && r.scheduled !== "PENDING").length,
      tier3: shaped.filter((r) => r.tier === 3 && r.scheduled !== "DUE" && r.scheduled !== "PENDING").length,
      due: shaped.filter((r) => r.scheduled === "DUE" || r.scheduled === "PENDING").length,
    };
    return { rows: shaped, stats };
  });
}

// ============================================================================
// §05 — the visit comms log (the recipient fan-out: PARENT / HOUSEMASTER / HEADMASTER)
// ============================================================================

const RECIPIENT_LABEL: Record<NotifyRecipient, string> = {
  PARENT: "Parent",
  HOUSEMASTER: "Housemaster",
  HEADMASTER: "Headmaster",
  DISTRICT_HEALTH: "District health",
};

const CHANNEL_LABEL: Record<string, string> = {
  SMS: "SMS",
  CALL: "Phone",
  IN_APP: "In-app",
  SYSTEM: "System",
};

export interface CommsLogRow {
  id: string;
  timeHHMM: string;
  who: string;
  recipient: NotifyRecipient;
  channelLabel: string;
  detail: string | null;
  body: string | null;
  deliveryLabel: string | null;
}

/**
 * §05 — `WHERE visit_id = ?`, ALL recipients, chronological. Draws the fan-out §03 never shows (parent
 * + HM + headmaster). `private_note` is NOT rendered here (it lives in the §02 thread where the matron
 * works). The HM/headmaster identity is derived; the delivery line is console-honest ("logged {time}"
 * / "Queued · console"), never a fabricated receipt or ack timestamp (CS-2, B18).
 */
export async function getVisitCommsLog(schoolId: string, visitId: string): Promise<CommsLogRow[]> {
  return withSchool(schoolId, async (tx) => {
    const rows = await tx
      .select({
        id: sickbayNotification.id,
        studentId: sickbayNotification.studentId,
        channel: sickbayNotification.channel,
        direction: sickbayNotification.direction,
        recipient: sickbayNotification.recipient,
        answered: sickbayNotification.answered,
        callDurationSeconds: sickbayNotification.callDurationSeconds,
        body: sickbayNotification.body,
        sentAt: sickbayNotification.sentAt,
        createdAt: sickbayNotification.createdAt,
        logStatus: notificationLog.status,
        logProvider: notificationLog.provider,
      })
      .from(sickbayNotification)
      .leftJoin(notificationLog, eq(notificationLog.id, sickbayNotification.notificationLogId))
      .where(and(eq(sickbayNotification.schoolId, schoolId), eq(sickbayNotification.visitId, visitId)))
      .orderBy(asc(sickbayNotification.createdAt));
    if (rows.length === 0) return [];

    // Resolve identities: the primary guardian (for PARENT) + the House HM (for HOUSEMASTER).
    const studentId = rows[0].studentId;
    const [g] = await tx
      .select({ name: studentGuardians.name, relationship: studentGuardians.relationship })
      .from(studentGuardians)
      .where(and(eq(studentGuardians.schoolId, schoolId), eq(studentGuardians.studentId, studentId), eq(studentGuardians.isPrimary, true)))
      .limit(1);
    const [hm] = await tx
      .select({ name: users.fullName })
      .from(students)
      .leftJoin(houses, and(eq(houses.schoolId, schoolId), eq(houses.id, students.houseId)))
      .leftJoin(users, eq(users.id, houses.hmUserId))
      .where(and(eq(students.schoolId, schoolId), eq(students.id, studentId)))
      .limit(1);

    const whoFor = (recipient: NotifyRecipient): string => {
      if (recipient === "PARENT") {
        return g ? `${shortName(g.name) ?? g.name} · ${REL_LABEL[g.relationship] ?? "contact"}` : "Parent";
      }
      if (recipient === "HOUSEMASTER") return hm?.name ? `${shortName(hm.name) ?? hm.name} · housemaster` : "Housemaster";
      return RECIPIENT_LABEL[recipient];
    };

    return rows.map((r) => {
      const when = r.sentAt ?? r.createdAt;
      const dur = durationLabel(r.callDurationSeconds);
      let detail: string | null = null;
      if (r.channel === "CALL") {
        detail = r.answered === false ? "no answer" : dur ? `answered · call duration ${dur}` : "answered";
      } else if (r.channel === "SMS") {
        detail = `SMS logged ${hhmm(when)}`; // 🔴 CS-2 — never "delivered {timestamp}"
      } else if (r.channel === "IN_APP") {
        detail = "In-app notification"; // 🔴 B18 — no fabricated "acknowledged at {time}"
      } else if (r.channel === "SYSTEM") {
        detail = "Auto-routed digest";
      }
      return {
        id: r.id,
        timeHHMM: hhmm(when),
        who: whoFor(r.recipient),
        recipient: r.recipient,
        channelLabel: CHANNEL_LABEL[r.channel] ?? r.channel,
        detail,
        body: r.body,
        deliveryLabel: r.channel === "SMS" ? deliveryLabel(r.logStatus, r.logProvider) : null,
      };
    });
  });
}
