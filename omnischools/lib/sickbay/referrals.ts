/**
 * Sickbay REFERRAL lifecycle — PURE, DB-free, unit-tested (referrals.test.ts). SHS module 4.4 /
 * INCR-25b. The R24 precedent applied to the referred-out record: every rule that spans rows lives
 * HERE as a function of plain values, and `lib/actions/sickbay-referral.ts` is the thin server shell
 * that fetches rows, calls these, and writes. No trigger, no DB CHECK (portability).
 *
 * 🔴 R190 — the string `diagnos` appears in NO type, key or helper here. The referral stores no
 * clinical-label column; the "Diagnosis" line live-reads the visit's `working_impression`.
 */
import { civilDate } from "./visits";
import { nhisCardStatus } from "./nhis";

/** Mirrors db/schema/_enums.ts `sickbay_referral_status` (R188) — the clinical-LOCATION lifecycle. */
export type ReferralStatus = "REFERRED" | "INPATIENT" | "RETURNING" | "RETURNED";

/**
 * R188 — the ONLY legal transitions, app-enforced (no trigger). An illegal jump is refused
 * server-side. `Mark returned` is the transition to RETURNED (legal from any open state); `advance`
 * moves REFERRED→INPATIENT and INPATIENT→RETURNING. Nothing leaves RETURNED (it is the record).
 */
export const LEGAL_TRANSITIONS: Record<ReferralStatus, readonly ReferralStatus[]> = {
  REFERRED: ["INPATIENT", "RETURNED"],
  INPATIENT: ["RETURNING", "RETURNED"],
  RETURNING: ["RETURNED"],
  RETURNED: [],
};

const STATUS_LABEL: Record<ReferralStatus, string> = {
  REFERRED: "Referred",
  INPATIENT: "Inpatient",
  RETURNING: "Returning",
  RETURNED: "Returned",
};

/**
 * The legal-transition DECISION — a NAMED error or null (the `dispositionGuard` idiom). An illegal
 * jump reads back what is and is not allowed rather than failing opaquely; a no-op (from === to) is
 * itself refused so a double-click cannot re-audit a state as if it changed.
 */
export function transitionGuard(from: ReferralStatus, to: ReferralStatus): string | null {
  if (from === to) return `This referral is already ${STATUS_LABEL[to].toLowerCase()}.`;
  if (!LEGAL_TRANSITIONS[from].includes(to)) {
    return `A referral cannot move from ${STATUS_LABEL[from].toLowerCase()} to ${STATUS_LABEL[to].toLowerCase()}.`;
  }
  return null;
}

/**
 * R188 — VOID is a RETRACT while the referral is not yet the record: legal only while
 * `status ≠ RETURNED AND voided_at IS NULL`. A returned referral is the closed off-campus record and
 * cannot be voided; a re-void is refused.
 */
export function voidReferralGuard(referral: {
  status: ReferralStatus;
  voidedAt: Date | null;
}): string | null {
  if (referral.voidedAt) return "This referral has already been voided.";
  if (referral.status === "RETURNED") {
    return "This referral is closed as returned — a returned referral is the record and cannot be voided.";
  }
  return null;
}

/**
 * 🔴 R187 — the FROZEN write-once ER handoff. These columns are set ONCE at creation and refused on
 * any later edit (a receiving doctor's verbatim recall must not be rewritten by a later vitals/chronic
 * edit). There is no handoff-edit action, so write-once is structural; this guard is the belt-and-
 * braces that a status/return/ward UPDATE patch can NEVER carry a handoff key. Unit-pinned.
 */
export const HANDOFF_FIELDS = [
  "reasonReferredOut",
  "preReferralCare",
  "handoffLabs",
  "lastMeal",
  "mensesNote",
  "travelNote",
] as const;

/**
 * Returns the first frozen handoff key present in an update patch, or null. A non-null result is a bug.
 * Dex #3 — this is the SPEC GUARD, unit-pinned with no runtime caller ON PURPOSE: write-once is
 * guaranteed structurally (no edit action carries a handoff key), so wiring this into the write path
 * would be dead defense. It stays as the executable statement of the R187 invariant.
 */
export function handoffKeyInPatch(patch: Record<string, unknown>): string | null {
  return HANDOFF_FIELDS.find((k) => k in patch) ?? null;
}

/**
 * 🔴 R192/R193 — the OFF-CAMPUS predicate: a referral counts as "student out right now" while its
 * status is one of the three open states and it is not voided. This is the shape INCR-28's boarding
 * in-House arm and the medical-hold UNION both read. Excludes RETURNED and voided by construction.
 */
export const OPEN_REFERRAL_STATUSES: readonly ReferralStatus[] = ["REFERRED", "INPATIENT", "RETURNING"];

export function isReferredOut(status: ReferralStatus, voidedAt: Date | null): boolean {
  return voidedAt === null && OPEN_REFERRAL_STATUSES.includes(status);
}

/**
 * 🔴 R184 — the NHIS SNAPSHOT decision, copied (never joined) at creation: a later card renewal must
 * not retro-cover a past ER visit. Given the LIVE card at referral time, return the frozen text +
 * bool the referral row stores. No card ⇒ both null (a referral with no NHIS on file is legal).
 * `nhis_valid` snapshots "the card was usable at referral" — anything the derived status calls not
 * EXPIRED (ACTIVE/EXPIRING/UNKNOWN-on-file) was presentable at the ER.
 */
export function snapshotNhis(
  card: { cardNumber: string; validTo: string | null } | null,
  at: Date,
): { nhisCardNumber: string | null; nhisValid: boolean | null } {
  if (!card) return { nhisCardNumber: null, nhisValid: null };
  return { nhisCardNumber: card.cardNumber, nhisValid: nhisCardStatus(card.validTo, at) !== "EXPIRED" };
}

/**
 * R187/R64.4 — the pure reference formatter. There is NO stored generated `referral_ref` column;
 * `R-{YYYY-MM-DD}-{seq}` is produced from facts already on the row (the departure civil date + the
 * student-code tail), and routing is by the server-resolved id. `R-2026-05-14-0817`.
 */
export function formatReferralRef(departedAt: Date | null, studentCode: string, createdAt: Date): string {
  const date = civilDate(departedAt ?? createdAt);
  const seq = studentCode.replace(/\D/g, "").slice(-4) || studentCode.slice(-4);
  return `R-${date}-${seq}`;
}

const hhmm = (d: Date) =>
  `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;

/** Whole civil days from `from` to `to` (Ghana = UTC+0, so the UTC date IS the civil date). */
function civilDayDiff(from: Date, to: Date): number {
  const a = Date.parse(`${civilDate(from)}T00:00:00Z`);
  const b = Date.parse(`${civilDate(to)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * R188 — the DAY pill, all DERIVED, never stored:
 *   REFERRED/INPATIENT open → `Day {n} · since {hhmm}` (day 1 = the departure day)
 *   RETURNING open          → `Returning`
 *   RETURNED same civil day → `Outpatient · returned same day`
 *   RETURNED later          → `Returned {DD Mon}`
 */
export function referralDayLabel(
  referral: { status: ReferralStatus; departedAt: Date | null; returnedAt: Date | null },
  now: Date,
): string {
  const { status, departedAt, returnedAt } = referral;
  if (status === "RETURNED" && returnedAt) {
    if (departedAt && civilDate(departedAt) === civilDate(returnedAt)) {
      return "Outpatient · returned same day";
    }
    return `Returned ${MON.format(returnedAt)}`;
  }
  if (status === "RETURNING") return "Returning";
  if (!departedAt) return STATUS_LABEL[status];
  return `Day ${civilDayDiff(departedAt, now) + 1} · since ${hhmm(departedAt)}`;
}

const MON = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

export { STATUS_LABEL as REFERRAL_STATUS_LABEL };

// ============================================================================
// INCR-27 — the 30-day history (§R4) + the NHIS reconciliation (§R5) pure helpers.
// ============================================================================

/**
 * The NHIS coverage tri-state a referral line renders, DERIVED from the FROZEN snapshot `nhis_valid`
 * (R184) plus whether the referral left any out-of-pocket gap (Σ cost-line out_of_pocket):
 *   nhis_valid === false          → Expired (the card was not usable at admission)
 *   valid, some out-of-pocket     → Partial (covered, but with a gap NHIS did not fill)
 *   valid, zero out-of-pocket     → Yes (fully covered)
 * A referral with no card on file (`nhis_valid === null`) reads Partial when it carries a gap, Yes
 * otherwise — the payment fact, never a clinical one.
 */
export type NhisTriState = "YES" | "PARTIAL" | "EXPIRED";

export function nhisTriState(nhisValid: boolean | null, outOfPocket: number): NhisTriState {
  if (nhisValid === false) return "EXPIRED";
  return outOfPocket > 0 ? "PARTIAL" : "YES";
}

export const NHIS_TRISTATE_LABEL: Record<NhisTriState, string> = {
  YES: "Yes",
  PARTIAL: "Partial",
  EXPIRED: "Expired",
};

/** The four range facets on the 30-day history filter strip (§R4.2). */
export type HistoryRange = "30d" | "90d" | "term" | "year";

export const HISTORY_RANGE_LABEL: Record<HistoryRange, string> = {
  "30d": "30 days",
  "90d": "90 days",
  term: "This term",
  year: "This year",
};

export const HISTORY_RANGES: readonly HistoryRange[] = ["30d", "90d", "term", "year"];

export function parseHistoryRange(raw: string | undefined): HistoryRange {
  return (HISTORY_RANGES as readonly string[]).includes(raw ?? "") ? (raw as HistoryRange) : "30d";
}

/**
 * The inclusive start of a history range, all UTC (Ghana = UTC+0). `30d`/`90d` are rolling day
 * windows; `term`/`year` use the Ghanaian SHS academic calendar as a heuristic — the most recent
 * term boundary (Sep / Jan / May 1) and the most recent academic-year boundary (Sep 1). A precise
 * term needs the academic_periods table; this is the honest approximation until a surface asks for it
 * (ponytail: swap in the real period boundaries if term drift ever matters).
 */
export function historyWindowStart(range: HistoryRange, now: Date): Date {
  const y = now.getUTCFullYear();
  if (range === "30d") return new Date(now.getTime() - 30 * 86_400_000);
  if (range === "90d") return new Date(now.getTime() - 90 * 86_400_000);
  if (range === "year") {
    // Academic year starts 1 Sep; before Sep, it began last year.
    return new Date(Date.UTC(now.getUTCMonth() >= 8 ? y : y - 1, 8, 1));
  }
  // term: most recent of 1 Sep / 1 Jan / 1 May.
  const boundaries = [
    Date.UTC(y, 8, 1), // Sep
    Date.UTC(y, 4, 1), // May
    Date.UTC(y, 0, 1), // Jan
  ];
  const t = now.getTime();
  const start = boundaries.find((b) => b <= t) ?? Date.UTC(y - 1, 8, 1);
  return new Date(start);
}
