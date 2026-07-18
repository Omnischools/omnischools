/**
 * The PURE decision logic at the heart of the exeat lifecycle (SHS module 4.2 / INCR-9).
 * No DB, no I/O — every branch is deterministic and unit-tested (exeat-decision.test.ts). The
 * thin DB layer (lib/boarding/exeat-data.ts) and the server actions (lib/actions/boarding-exeat.ts)
 * gather the live facts (fee-owing balance, quota count, roles, times), call these functions, and
 * only write when the decision says so.
 *
 * The derived facts NEVER live in the DB (Kofi OQ1): quota_used is counted, returned_late and
 * overdue are computed here from timestamps — there is deliberately no counter column and no
 * overdue/returned_late column to drift.
 */

export type ExeatType = "SCHEDULED" | "SPECIAL" | "FEE_COLLECTION";
export type ExeatStatus =
  | "REQUESTED"
  | "HM_APPROVED"
  | "SR_HM_SIGNED"
  | "DEPARTED"
  | "RETURNED"
  | "DECLINED";
export type NotificationKind =
  | "DEPARTURE"
  | "REMINDER"
  | "OVERDUE_STAGE_1"
  | "OVERDUE_STAGE_2"
  | "OVERDUE_STAGE_3";

/**
 * The ordered gate-crossing lifecycle per exeat type (Kofi OQ4 / AC A1–A3). A scheduled or
 * fee-collection exeat skips SR_HM_SIGNED; a special MUST pass it. DEPARTED needs the prior
 * HM_APPROVED (scheduled/fee) or SR_HM_SIGNED (special) — no illegal skip (A3).
 */
const LIFECYCLE: Record<ExeatType, ExeatStatus[]> = {
  SCHEDULED: ["REQUESTED", "HM_APPROVED", "DEPARTED", "RETURNED"],
  FEE_COLLECTION: ["REQUESTED", "HM_APPROVED", "DEPARTED", "RETURNED"],
  SPECIAL: ["REQUESTED", "HM_APPROVED", "SR_HM_SIGNED", "DEPARTED", "RETURNED"],
};

/**
 * The 5-stage state machine guard (AC A1–A3/A5). A transition is legal only when `to` is the
 * immediate next stage in the type's lifecycle (rejecting REQUESTED→DEPARTED and every skip), OR a
 * decline of a not-yet-departed exeat. RETURNED and DECLINED are terminal; a DEPARTED exeat can no
 * longer be declined (its departure is immutable history — trap T4).
 */
export function canTransition(type: ExeatType, from: ExeatStatus, to: ExeatStatus): boolean {
  if (from === "RETURNED" || from === "DECLINED") return false; // terminal
  if (to === "DECLINED") return from !== "DEPARTED"; // decline only before departure (A5)
  const seq = LIFECYCLE[type];
  const fi = seq.indexOf(from);
  const ti = seq.indexOf(to);
  if (fi < 0 || ti < 0) return false;
  return ti === fi + 1; // next stage only — no skips
}

/** True when the student is over the per-semester scheduled cap (Kofi OQ3 / AC B1). */
export function quotaExceeded(quotaUsed: number, cap: number): boolean {
  return quotaUsed >= cap;
}

// ---------------------------------------------------------------------------
// Ref-code generation (pure) — ASA-EX-2026-0341. Number is per-school, collision
// guarded by uniq_exeat_ref_code; the caller retries on a lost race.
// ---------------------------------------------------------------------------

/** Max trailing number across a school's existing exeat ref codes, + 1 (1-based). */
export function nextExeatSequence(existing: readonly string[]): number {
  let max = 0;
  for (const code of existing) {
    const m = code.match(/(\d+)\s*$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}

/** "ASA-EX-2026-0341" — prefix · EX · year · zero-padded 4-digit sequence. */
export function formatRefCode(prefix: string, year: number, seq: number): string {
  return `${prefix}-EX-${year}-${String(seq).padStart(4, "0")}`;
}

// ---------------------------------------------------------------------------
// Creation decision — quota + fee-routing (AC B/C)
// ---------------------------------------------------------------------------

export interface CreateExeatInput {
  /** What the requester asked for — only SCHEDULED or SPECIAL are user-selectable. */
  requestedType: "SCHEDULED" | "SPECIAL";
  /** The student is an active BOARDER (residency gate — trap T4). */
  isBoarder: boolean;
  /** Live SUM(invoices.balance_amount) for owing statuses, GHS (READ, never a write — AC C1). */
  feeOwing: number;
  /** getExeatPolicy.feeOwingMustCollect — the GES fee-collection routing switch. */
  feeOwingMustCollect: boolean;
  /** Count of SCHEDULED+FEE_COLLECTION, status≠DECLINED, this student×semester (BEFORE this one). */
  quotaUsed: number;
  /** getExeatPolicy.scheduledPerTerm (default 3). */
  cap: number;
  /** The request lines up with the EXEAT_WINDOW / standard timing (drives auto-approve — AC D2). */
  isStandardWindow: boolean;
  /** Discipline hold — STUB (forward dep on INCR-13), always false in INCR-9 (trap T3). */
  disciplineFlag: boolean;
}

export type CreateExeatDecision =
  | { ok: false; reason: "not_boarder" | "quota_exceeded" }
  | {
      ok: true;
      type: ExeatType;
      /** Live balance frozen at creation, or null when fees are clear (AC C5 / T5). */
      feeSnapshot: number | null;
      /** The clean-check passed → the exeat is created already HM_APPROVED (AC D1). */
      autoApprove: boolean;
      /** A fee-owing scheduled request was re-typed to FEE_COLLECTION (GES route — AC C2). */
      feeRouted: boolean;
    };

/**
 * Decide the type + fee snapshot + auto-approval of a new exeat (AC B/C/D).
 *   • SPECIAL — uncapped, soft-warn on fees (stays SPECIAL, never rerouted, AC C4), NEVER
 *     auto-approves (needs the Senior HM signature, D3).
 *   • SCHEDULED with fees owing + feeOwingMustCollect — routed to FEE_COLLECTION and taken home to
 *     collect (GES cannot-detain, AC C2); allowed EVEN over quota (B4) because the trip is mandated.
 *   • SCHEDULED with fees clear — blocked over quota (B1); else a plain SCHEDULED exeat.
 * Auto-approve is fail-safe (AC D1): only a scheduled/fee trip, in the standard window, with no
 * discipline flag. Any doubt → stays REQUESTED for manual review.
 */
export function decideExeatCreation(i: CreateExeatInput): CreateExeatDecision {
  if (!i.isBoarder) return { ok: false, reason: "not_boarder" }; // T4
  const owing = i.feeOwing > 0;
  const snapshot = owing ? i.feeOwing : null;

  if (i.requestedType === "SPECIAL") {
    return { ok: true, type: "SPECIAL", feeSnapshot: snapshot, autoApprove: false, feeRouted: false };
  }

  // SCHEDULED path.
  if (owing && i.feeOwingMustCollect) {
    // GES cannot-detain — route home to collect regardless of quota (B4); auto-approve if clean.
    const autoApprove = !i.disciplineFlag && i.isStandardWindow;
    return { ok: true, type: "FEE_COLLECTION", feeSnapshot: i.feeOwing, autoApprove, feeRouted: true };
  }
  if (quotaExceeded(i.quotaUsed, i.cap)) return { ok: false, reason: "quota_exceeded" }; // B1
  const autoApprove = !i.disciplineFlag && i.isStandardWindow;
  return { ok: true, type: "SCHEDULED", feeSnapshot: snapshot, autoApprove, feeRouted: false };
}

// ---------------------------------------------------------------------------
// Queue clean-check — the bulk-approve predicate (AC D5)
// ---------------------------------------------------------------------------

export interface QueuedRowCleanInput {
  type: ExeatType;
  /** Fees clear at creation OR the row was routed to FEE_COLLECTION (fees-clear-or-routed). */
  feesClearOrRouted: boolean;
  /** Discipline hold — STUB, always false in INCR-9. */
  disciplineFlag: boolean;
  /** The row is tied to the standard EXEAT_WINDOW (off-window → manual, AC D2). */
  standardWindow: boolean;
}

/**
 * Is a queued (REQUESTED) row auto-approvable — i.e. would "Approve all clean" include it (AC D5)?
 * SPECIAL is never clean (it needs the Senior HM signature); a discipline flag or an off-window
 * request drops it to manual review. A SCHEDULED row that was accepted at request time is within
 * quota by construction, so quota is not re-checked here.
 */
export function isQueuedRowClean(r: QueuedRowCleanInput): boolean {
  if (r.type === "SPECIAL") return false;
  if (r.disciplineFlag) return false;
  if (!r.standardWindow) return false;
  return r.feesClearOrRouted;
}

// ---------------------------------------------------------------------------
// Return timing + overdue (AC E1/E2)
// ---------------------------------------------------------------------------

/** returned_late = returned_at > return_by (computed, never stored — AC E1). */
export function isReturnedLate(returnedAt: Date, returnBy: Date | null): boolean {
  if (!returnBy) return false;
  return returnedAt.getTime() > returnBy.getTime();
}

/** overdue = DEPARTED ∧ now > return_by ∧ not yet returned (computed predicate — AC E2). */
export function isOverdue(
  status: ExeatStatus,
  returnBy: Date | null,
  returnedAt: Date | null,
  now: Date,
): boolean {
  return (
    status === "DEPARTED" &&
    returnBy != null &&
    returnedAt == null &&
    now.getTime() > returnBy.getTime()
  );
}

// ---------------------------------------------------------------------------
// Role gates (AC D3)
// ---------------------------------------------------------------------------

/** Roles that may sign a SPECIAL exeat (the Senior HM lane) — a plain HOUSEMASTER is NOT here. */
export const SPECIAL_SIGN_ROLES = ["DEAN_OF_BOARDING", "HEADMASTER", "ADMIN"] as const;

/** True when the user may sign a special exeat (SR_HM_SIGNED). Plain HOUSEMASTER → false (D3). */
export function canSignSpecial(roles: readonly string[]): boolean {
  return roles.some((r) => (SPECIAL_SIGN_ROLES as readonly string[]).includes(r));
}

// ---------------------------------------------------------------------------
// Late-return SMS escalation chain (AC E3/E4/E5)
// ---------------------------------------------------------------------------

/** The +5 / +30 / +60 escalation, offsets in minutes relative to return_by (Kofi OQ5). */
export const OVERDUE_STAGES: { kind: NotificationKind; offsetMin: number }[] = [
  { kind: "OVERDUE_STAGE_1", offsetMin: 5 },
  { kind: "OVERDUE_STAGE_2", offsetMin: 30 },
  { kind: "OVERDUE_STAGE_3", offsetMin: 60 },
];

/** Add minutes to an "HH:MM" wall-clock string → "HH:MM" (16:00 + 5 → 16:05). Wraps within a day. */
export function addMinutesToTime(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/**
 * The three escalation-stage labels derived from getExeatPolicy.returnByTime (16:00 → 16:05 / 16:30
 * / 17:00) — computed, never hard-coded (Lucy surface map). Used to render the late-return band.
 */
export function overdueStageLabels(
  returnByTime: string,
): { kind: NotificationKind; offsetMin: number; label: string }[] {
  return OVERDUE_STAGES.map((s) => ({ ...s, label: addMinutesToTime(returnByTime, s.offsetMin) }));
}

/** Which overdue stages are due NOW for an exeat past its return_by (now ≥ return_by + offset). */
export function dueOverdueStages(returnBy: Date, now: Date): NotificationKind[] {
  return OVERDUE_STAGES.filter(
    (s) => now.getTime() >= returnBy.getTime() + s.offsetMin * 60_000,
  ).map((s) => s.kind);
}

// ---------------------------------------------------------------------------
// SMS body copy (pure — parent phone/name are runtime, the templates are fixed)
// ---------------------------------------------------------------------------

export interface SmsContext {
  studentName: string;
  /** "Fri 16 May · 16:00" — the return-by, pre-formatted by the caller. */
  returnByLabel: string;
  /** "GHS 340.00" for a fee-collection trip, else undefined. */
  amountLabel?: string;
}

/**
 * The SMS body for each chain stage. Stage-3 (+1hr) is the STUB (forward dep on INCR-13 discipline,
 * AC E5): its copy is deliberately CONDITIONAL/future ("a formal note may be raised") — it must NOT
 * imply a working discipline record, because INCR-9 writes ZERO discipline and ZERO invoice rows.
 */
export function buildExeatSms(kind: NotificationKind, ctx: SmsContext): string {
  const fee = ctx.amountLabel
    ? ` Please clear outstanding fees of ${ctx.amountLabel} before return.`
    : "";
  switch (kind) {
    case "DEPARTURE":
      return `${ctx.studentName} has departed campus on exeat and is due back by ${ctx.returnByLabel}.${fee} Safe journey.`;
    case "REMINDER":
      return `Reminder: ${ctx.studentName} is due back from exeat by ${ctx.returnByLabel} today.${fee}`;
    case "OVERDUE_STAGE_1":
      return `${ctx.studentName} is now overdue from exeat (due ${ctx.returnByLabel}). Please confirm their return ETA.`;
    case "OVERDUE_STAGE_2":
      return `${ctx.studentName} remains overdue from exeat. The Senior Housemaster has been notified. Please contact the school immediately.`;
    case "OVERDUE_STAGE_3":
      // STUB copy — future/conditional; no discipline record is created in INCR-9.
      return `${ctx.studentName} is over an hour overdue. The Housemaster will call you directly; a formal note may be raised on the student's record if this is not resolved.`;
  }
}
