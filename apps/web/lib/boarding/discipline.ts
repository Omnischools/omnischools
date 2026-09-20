/**
 * Boarding discipline & deboardinization (SHS module 4.2 / INCR-13) — the PURE, DB-free core of
 * surface 07. Everything here is safe to import from vitest and from client components: the co-sign
 * role map + gate, the penalty DISPLAY formula, the auto-escalation PROMPT derivation, the pastoral
 * bypass decision, and the parent-notify SMS body. No DB, no I/O.
 *
 * The 5-rung ladder itself is NOT redeclared here — it is READ from the frozen
 * getDeboardinizationLadder constant (schema-locked, BUILD_STACK #4). This module only enforces
 * against that constant's coSignCount/coSignRoles.
 *
 * 🟥 The penalty is DISPLAY-ONLY (computePenaltyDisplay) — it computes days × per-day × 3 from stored
 * snapshots and NEVER reads billing or writes an invoice (owner-settled STUB, the #1 scope guard).
 */
import type { DeboardinizationSeverity } from "./deboardinization-ladder";

export type InfractionSeverity = DeboardinizationSeverity;
export type InfractionSource =
  | "MANUAL"
  | "EXEAT_OVERDUE"
  | "INSPECTION_DAILY"
  | "INSPECTION_WEEKLY"
  | "VISIT_OVERSTAY"
  | "RESUMPTION_ABSENT";
export type InfractionStatus = "OPEN" | "RESOLVED" | "SUPERSEDED";

/** Severities that notify the parent by SMS (Warning and above — surface §2 / AC I1). */
export const NOTIFY_SEVERITIES: readonly InfractionSeverity[] = [
  "WARNING",
  "BOND",
  "SUSPENSION",
  "DEBOARDINIZATION",
];
export function severityNotifiesParent(severity: InfractionSeverity): boolean {
  return NOTIFY_SEVERITIES.includes(severity);
}

// ---------------------------------------------------------------------------
// Co-sign role map + gate (Kofi OQ2 — app-enforced vs the frozen coSignCount/coSignRoles)
// ---------------------------------------------------------------------------

/**
 * The deboardinization record's three discrete co-sign slots and the AppRole each requires (Kofi OQ2):
 * HM = HOUSEMASTER (house-scoped to the student's House) · Senior HM = DEAN_OF_BOARDING · Headmaster =
 * HEADMASTER. There is no "Senior HM" / "Board" RBAC role — the mapping lives here, app-checked.
 */
export type CoSignSlot = "hm" | "seniorHm" | "headmaster";
export const DEBOARD_SLOT_ROLE: Record<CoSignSlot, string> = {
  hm: "HOUSEMASTER",
  seniorHm: "DEAN_OF_BOARDING",
  headmaster: "HEADMASTER",
};
export const DEBOARD_SLOT_LABEL: Record<CoSignSlot, string> = {
  hm: "HM",
  seniorHm: "Senior HM",
  headmaster: "Headmaster",
};
export const DEBOARD_SLOT_ORDER: readonly CoSignSlot[] = ["hm", "seniorHm", "headmaster"];

/**
 * True when a signer's roles satisfy a given deboardinization slot (AC B3). ADMIN is the super-role
 * (stands in for any slot, per OQ3 "HEADMASTER/ADMIN"); otherwise the exact mapped role is required —
 * a wrong-role signer is rejected. House-scope for the HM slot is a separate DB check (canAccessHouse).
 */
export function roleSatisfiesSlot(roles: readonly string[], slot: CoSignSlot): boolean {
  if (roles.includes("ADMIN")) return true;
  return roles.includes(DEBOARD_SLOT_ROLE[slot]);
}

/** The three co-sign timestamps (any truthy value = signed). */
export interface DeboardSigns {
  hmAt: unknown;
  seniorHmAt: unknown;
  headmasterAt: unknown;
}

/** How many of the three deboardinization slots are signed (0..3). */
export function signedCount(signs: DeboardSigns): number {
  return (signs.hmAt ? 1 : 0) + (signs.seniorHmAt ? 1 : 0) + (signs.headmasterAt ? 1 : 0);
}

/**
 * The 3-co-sign gate (AC B1/B2). A deboardinization may take effect (effective_at set → residency
 * flip) ONLY when all three slots are signed. A 2-of-3 draft returns false — no effect, no flip. This
 * mirrors the same-table CHECK backstop (deboard_effective_needs_all_signs).
 */
export function deboardReadyToEffect(signs: DeboardSigns): boolean {
  return signedCount(signs) === 3;
}

/** Draft state label for the deboardinized card (surface: "Awaiting co-signs (2 of 3)"). */
export function coSignStatusLabel(signs: DeboardSigns): string {
  const n = signedCount(signs);
  return n === 3 ? "All co-signs present" : `Awaiting co-signs (${n} of 3)`;
}

// ---------------------------------------------------------------------------
// Bond co-signs (frozen Bond coSignCount = 2 staff witnesses + the student's own signature = 3 slots)
// ---------------------------------------------------------------------------

export type BondSlot = "student" | "hm" | "seniorHm";
export const BOND_SLOT_ROLE: Record<Exclude<BondSlot, "student">, string> = {
  hm: "HOUSEMASTER",
  seniorHm: "DEAN_OF_BOARDING",
};
export interface BondSigns {
  studentAt: unknown;
  hmAt: unknown;
  seniorHmAt: unknown;
}
export function bondSignedCount(s: BondSigns): number {
  return (s.studentAt ? 1 : 0) + (s.hmAt ? 1 : 0) + (s.seniorHmAt ? 1 : 0);
}
export function bondFullySigned(s: BondSigns): boolean {
  return bondSignedCount(s) === 3;
}
export function bondStatusLabel(s: BondSigns): string {
  const n = bondSignedCount(s);
  return n === 3 ? "Signed · in force" : `Awaiting ${3 - n} signature${3 - n === 1 ? "" : "s"}`;
}

// ---------------------------------------------------------------------------
// Penalty DISPLAY (Kofi OQ6 — DISPLAY ONLY, no billing read, no invoice write) — the #1 scope guard
// ---------------------------------------------------------------------------

/** The 3× boarding-fee-per-unauthorised-day multiplier (General SHS Rules). */
export const PENALTY_MULTIPLIER = 3 as const;

export interface PenaltySnapshot {
  /** Unauthorised days off the roll (snapshot). */
  days: number | null;
  /** Boarding fee per day, GHS (snapshot at deboardinization — NOT a live billing read). */
  perDayAmount: number | null;
  /** Head-discretion adjusted figure, GHS (null = no adjustment). */
  adjustedAmount?: number | null;
  /** Head-discretion adjustment reason (free text). */
  adjustmentReason?: string | null;
}

export interface PenaltyDisplay {
  days: number;
  perDayAmount: number;
  base: number; // days × perDay
  multiplier: typeof PENALTY_MULTIPLIER;
  computed: number; // days × perDay × 3
  finalAmount: number; // adjusted figure if the Head overrode, else computed
  adjusted: boolean;
  adjustmentReason: string | null;
}

/**
 * Compute the 3× penalty for DISPLAY (AC H1/H5). Pure and DB-free: days × per-day × 3, with the
 * optional Head-discretion override applied to finalAmount. Returns null when the snapshot is
 * incomplete (nothing to display). This NEVER reads a boarding-fee balance and NEVER writes an
 * invoices/finance row — fee_penalty_invoice_id stays NULL and the surface shows "penalty pending —
 * billing not yet wired."
 */
export function computePenaltyDisplay(p: PenaltySnapshot): PenaltyDisplay | null {
  if (p.days == null || p.perDayAmount == null) return null;
  const base = p.days * p.perDayAmount;
  const computed = base * PENALTY_MULTIPLIER;
  const adjusted = p.adjustedAmount != null;
  return {
    days: p.days,
    perDayAmount: p.perDayAmount,
    base,
    multiplier: PENALTY_MULTIPLIER,
    computed,
    finalAmount: adjusted ? (p.adjustedAmount as number) : computed,
    adjusted,
    adjustmentReason: p.adjustmentReason ?? null,
  };
}

/** Human GHS label (2 dp, en-GH grouping) for the penalty column. */
export function ghs(amount: number): string {
  return `GHS ${amount.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** The one-line calculation string the penalty table renders (surface verbatim shape). */
export function penaltyCalcLine(p: PenaltyDisplay): string {
  const dayLabel = `${p.days} day${p.days === 1 ? "" : "s"}`;
  let line = `${dayLabel} × ${ghs(p.perDayAmount)} boarding/day × ${p.multiplier} = ${ghs(p.computed)}`;
  if (p.adjusted) {
    line += ` → adjusted ${ghs(p.finalAmount)} (Head's discretion${p.adjustmentReason ? `, ${p.adjustmentReason}` : ""})`;
  }
  return line;
}

// ---------------------------------------------------------------------------
// Auto-escalation — a derived PROMPT (HM decides), NEVER an automatic rung write (Kofi OQ7 / AC K)
// ---------------------------------------------------------------------------

export interface EscalationPrompt {
  /** The rung the counts make ELIGIBLE (never auto-written) — null when nothing is eligible. */
  eligible: "WARNING" | "BOND" | null;
  message: string | null;
}

/**
 * Auto-escalation eligibility (AC K). 3 open Notes → "Warning eligible"; 2 open Warnings → "Bond
 * eligible". This is a PROMPT the HM acts on — it returns a suggestion and writes NOTHING (the ledger
 * is unchanged until the HM logs the rung). Bond eligibility (2 Warnings) outranks Warning eligibility.
 */
export function deriveEscalation(openNotes: number, openWarnings: number): EscalationPrompt {
  if (openWarnings >= 2) {
    return { eligible: "BOND", message: "2 open warnings — Bond eligible (HM decides, not auto-logged)" };
  }
  if (openNotes >= 3) {
    return { eligible: "WARNING", message: "3 open notes — Warning eligible (HM decides, not auto-logged)" };
  }
  return { eligible: null, message: null };
}

// ---------------------------------------------------------------------------
// Parent-notify SMS body (Warning+ → console) — Kofi OQ / AC I
// ---------------------------------------------------------------------------

const SEVERITY_SMS_LABEL: Record<InfractionSeverity, string> = {
  NOTE: "a note",
  WARNING: "a written warning",
  BOND: "a bond of good behaviour",
  SUSPENSION: "an external suspension",
  DEBOARDINIZATION: "deboardinization from the boarding house",
};

/** The console SMS body sent to a parent at Warning+ (AC I1). Short, GSM-7, no PII beyond the name. */
export function disciplineParentSms(
  studentName: string,
  severity: InfractionSeverity,
  schoolName: string,
): string {
  return `${schoolName}: ${studentName} has received ${SEVERITY_SMS_LABEL[severity]} under the boarding discipline ladder. Please contact the Housemaster. Do not reply.`;
}

// ---------------------------------------------------------------------------
// Display helpers (ref codes / severity chips)
// ---------------------------------------------------------------------------

export const SEVERITY_ROMAN: Record<InfractionSeverity, string> = {
  NOTE: "i",
  WARNING: "ii",
  BOND: "iii",
  SUSPENSION: "iv",
  DEBOARDINIZATION: "v",
};

/** A human ref code, e.g. debRefCode(2026, 3) → "DEB-2026-003". */
export function refCode(prefix: string, year: number, seq: number): string {
  return `${prefix}-${year}-${String(seq).padStart(3, "0")}`;
}
