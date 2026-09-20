/**
 * Sickbay NOTIFY domain — PURE, DB-free, unit-tested (notify.test.ts). SHS module 4.4 / INCR-26.
 *
 * The R24 precedent applied to the three-tier parent-notification chain: every rule that decides a
 * value (the tier, the fan-out, the fixed HM template, the append-only invariant, the on-read due
 * state) lives HERE as a function of plain values. `lib/actions/sickbay-notify.ts` is the thin server
 * shell that fetches rows, calls these, and writes; `lib/sickbay/notify-reads.ts` is the projection.
 * No trigger, no derived column, no DB CHECK beyond the shipped tier BETWEEN 1 AND 3 (portability).
 *
 * 🔴 This module reads NO env, imports NO SMS provider, touches NO secret — it is pure data.
 */

// ============================================================================
// Tier = event SEVERITY, derived server-side (R207 / NF3)
// ============================================================================

/** The clinical events that trigger a notification. `tier` is derived from this, never client-picked. */
export type SickbayEventKind = "VISIT" | "ADMISSION" | "REFERRAL" | "CONSULT";
export type NotifyTier = 1 | 2 | 3;
/** Mirrors db/schema/_enums.ts `sickbay_notify_recipient`. */
export type NotifyRecipient = "PARENT" | "HOUSEMASTER" | "HEADMASTER" | "DISTRICT_HEALTH";

/**
 * 🔴 R207 — `tier` is the event SEVERITY, resolved from the event and STORED (a later policy edit does
 * not rewrite history). A routine visit is Tier 1 (light), a chronic/admission Tier 2 (call + SMS), a
 * consult/referral Tier 3 (phone-first). Never client-picked.
 */
export function tierForEvent(kind: SickbayEventKind): NotifyTier {
  switch (kind) {
    case "VISIT":
      return 1;
    case "ADMISSION":
      return 2;
    case "REFERRAL":
    case "CONSULT":
      return 3;
  }
}

/**
 * 🔴 NF3 — a client `tier` that contradicts the derived event tier is REFUSED (returns a NAMED error;
 * null = consistent). The DB `sickbay_notification_tier_range` CHECK 1..3 is the backstop; this is the
 * app-layer guard that a hand-crafted POST cannot claim Tier 1 for a referral.
 */
export function tierGuard(kind: SickbayEventKind, claimedTier: number | null | undefined): string | null {
  if (claimedTier == null) return null;
  const derived = tierForEvent(kind);
  if (claimedTier !== derived) {
    return `Tier ${claimedTier} contradicts a ${kind.toLowerCase()} event — its severity is tier ${derived}.`;
  }
  return null;
}

// ============================================================================
// Recipient fan-out (R207 / R214a / NF4)
// ============================================================================

/**
 * 🔴 R207/R214a — the recipient fan-out per tier, from ONE confirm (policy parallel):
 *   tier 1 → [] (no auto row — a routine visit gets a MANUAL pastoral/discharge SMS only)
 *   tier 2 → [PARENT]
 *   tier 3 → [PARENT, HOUSEMASTER]  (both rows from one action, in parallel — NO "escalate" step)
 *
 * 🔴 HEADMASTER + DISTRICT_HEALTH are NEVER in this list (their digest/outbreak fan-out is INCR-27,
 * enum authored but never fired here). Unit-pinned so a widening is a RED test, not a silent leak.
 */
export function recipientsForTier(tier: NotifyTier): NotifyRecipient[] {
  switch (tier) {
    case 1:
      return [];
    case 2:
      return ["PARENT"];
    case 3:
      return ["PARENT", "HOUSEMASTER"];
  }
}

// ============================================================================
// 🔴 The fixed body templates (R211 / R214b / A9 / A10 / NF13)
// ============================================================================

/**
 * 🔴 R214b / A10 / NF13 — the `recipient=HOUSEMASTER` body is a FIXED medical-detail-light template.
 * Constructed server-side from name + location ONLY; it NEVER carries a diagnosis. A clinical HM body
 * is impossible to submit because no client text ever reaches this string — the HM write path calls
 * this, it never accepts a free-typed body. Unit-pinned: the string must never name a condition.
 */
export function housemasterNotificationBody(studentName: string, houseName: string | null): string {
  const where = houseName ? ` (${houseName} House)` : "";
  return `${studentName}${where} is under sickbay care today. Attendance auto-excused for today. Please flag classmates if they ask — no medical detail to share.`;
}

/**
 * 🔴 A9 — the auto-confirm PARENT SMS is system-composed and DIAGNOSIS-FREE (the 06:52 model:
 * "referred to {hospital}", never "malaria"). Names the school + that the child is being cared for /
 * referred, and the safe callback channel; never the condition. A matron-TYPED parent body stays free
 * text (her clinical judgement) — that is a separate path (`sendParentSms`), not this template.
 */
export function parentReferralConfirmBody(
  studentName: string,
  schoolName: string,
  hospitalName: string | null,
): string {
  const dest = hospitalName ? ` to ${hospitalName}` : " to hospital";
  return `${schoolName}: your child ${studentName} has been referred${dest} and the Matron is accompanying. We will call with updates. Reply CALL to request a callback.`;
}

export function parentAdmissionConfirmBody(studentName: string, schoolName: string): string {
  return `${schoolName}: ${studentName} has been admitted to the school sickbay and is being cared for. We will call you with an update. Reply CALL to request a callback.`;
}

// ============================================================================
// 🔴 Append-only invariant (R208 / NF5 / NF6)
// ============================================================================

/**
 * 🔴 R208 — the module is APPEND-ONLY on `sickbay_notification` with exactly ONE permitted in-place
 * transition: a plan row's `scheduled_for → sent_at` fulfillment, attaching `notification_log_id`. No
 * row's body/private_note/recipient/tier/direction/channel is ever mutated; none is deleted. This is
 * the set of keys the ONE update may carry.
 */
export const NOTIFICATION_MUTABLE_FIELDS = ["sentAt", "notificationLogId", "updatedAt"] as const;

/**
 * Returns the first key in a proposed update patch that is NOT a permitted fulfillment field, or null.
 * A non-null result is a bug — the append-only invariant would be violated. The spec guard (the R208
 * statement); the send-scheduled path is the only caller, and its patch is exactly `{ sentAt,
 * notificationLogId }`. Unit-pinned.
 */
export function forbiddenNotificationPatchKey(patch: Record<string, unknown>): string | null {
  return (
    Object.keys(patch).find(
      (k) => !(NOTIFICATION_MUTABLE_FIELDS as readonly string[]).includes(k),
    ) ?? null
  );
}

/**
 * 🔴 NF6 — the send-scheduled stamp is legal only on a PLAN row (`scheduled_for` set, `sent_at` null).
 * A re-click on an already-sent row is a NO-OP, never a second stamp (idempotent). Returns a NAMED
 * error or null.
 */
export function sendScheduledGuard(row: { scheduledFor: Date | null; sentAt: Date | null }): string | null {
  if (!row.scheduledFor) return "This is not a scheduled reminder.";
  if (row.sentAt) return "This reminder has already been sent.";
  return null;
}

// ============================================================================
// 🔴 The scheduled-send lifecycle — derived ON-READ, no cron (R210 / NF10)
// ============================================================================

/**
 * The render state of a scheduled notification, DERIVED from the timestamps + an injected `now` (the
 * `overstayState` pattern — no ticking clock, no cron). A PLAN row renders DUE the instant
 * `scheduled_for <= now`; the matron then presses send manually (nothing auto-fires).
 */
export type ScheduledState = "SENT" | "DUE" | "PENDING" | "NONE";

export function scheduledState(
  row: { scheduledFor: Date | null; sentAt: Date | null },
  now: Date,
): ScheduledState {
  if (row.sentAt) return "SENT";
  if (!row.scheduledFor) return "NONE";
  return row.scheduledFor.getTime() <= now.getTime() ? "DUE" : "PENDING";
}

// ============================================================================
// 🔴 The parent-facing boundary trim (R211 / F4 / NF11)
// ============================================================================

/**
 * 🔴 F4/NF11 — `private_note` is MATRON-ONLY. The HEADMASTER (a Tier-3 digest reader, not the
 * clinician) reads the parent-facing `body`, never the matron's private annotation. This is the trim:
 * a non-MATRON reader always gets null, regardless of what the row holds. Unit-pinned so a projection
 * that forgets the flag REDs here.
 */
export function projectPrivateNote(rawNote: string | null, canReadPrivateNote: boolean): string | null {
  return canReadPrivateNote ? rawNote : null;
}

// ============================================================================
// Pure formatters for the reads (unit-tested)
// ============================================================================

/** `4m 12s` from 252 seconds; `47s` under a minute; null when no duration (an SMS, or a no-answer call). */
export function durationLabel(seconds: number | null): string | null {
  if (seconds == null || seconds < 0) return null;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/**
 * `9h ago` / `5m ago` for the past, `in 1h 30m` / `in 45m` for the future (the scheduled `.future`
 * row). Computed on-read from an injected `now` — a stale minute is honest, a client clock is not.
 */
export function relativeLabel(target: Date, now: Date): string {
  const deltaMs = target.getTime() - now.getTime();
  const past = deltaMs <= 0;
  const mins = Math.floor(Math.abs(deltaMs) / 60_000);
  const body =
    mins < 60
      ? `${Math.max(mins, past ? 0 : 1)}m`
      : mins < 60 * 36
        ? formatHm(mins)
        : `${Math.floor(mins / 1440)}d`;
  return past ? `${body} ago` : `in ${body}`;
}

function formatHm(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
