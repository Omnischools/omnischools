/**
 * PURE NHIS card identity shaping (SHS module 4.4 / INCR-25a) — the DERIVED status and the
 * holder-≠-student holder line. No DB import, so it is unit-tested without a database and shared
 * safely by the server reader (nhis-reads.ts) and the client console (nhis-card-console.tsx): the
 * client imports these TYPES and formatters, never a `*-reads` module.
 *
 * 🔴 Status is DERIVED, never stored (R183): a stored status can disagree with its own `valid_to`
 * (the R10 stored-count failure again). `card_number` is stored VERBATIM elsewhere — NOTHING here
 * reformats it.
 *
 * 🚫 There is NO school-wide roll-up anywhere (the forbidden STPSHS `1,108/1,200 · 92.3%` matrix,
 * R182): no function here takes a set of cards and returns a count or a rate.
 */

export type NhisHolderKind = "STUDENT" | "GUARDIAN";
export type NhisStatus = "ACTIVE" | "EXPIRING" | "EXPIRED" | "UNKNOWN";

/** ≤ this many days to `valid_to` renders "Expiring" (a money/eligibility-adjacent boundary). */
export const NHIS_EXPIRING_DAYS = 30;

/**
 * 🔴 R183 — the card status, DERIVED from `valid_to` vs `asOf`, never stored. `validTo` is a civil
 * date string `YYYY-MM-DD` (drizzle `date`). Both sides are pinned to UTC midnight so the diff is a
 * whole-day count independent of the server clock's time-of-day (Ghana is UTC+0, so the UTC civil
 * date equals the Accra civil date).
 *
 *   valid_to absent            → UNKNOWN (a card on file with no recorded expiry — never asserted expired)
 *   days < 0                   → EXPIRED
 *   0 ≤ days ≤ 30              → EXPIRING (valid THROUGH today counts as expiring, not expired)
 *   else                       → ACTIVE
 *
 * The two pinned boundaries (a unit test reds if either moves): exactly 30 days = EXPIRING (31 = ACTIVE),
 * and the expiry edge — valid_to == today = EXPIRING (still valid today), valid_to == yesterday = EXPIRED.
 */
export function nhisCardStatus(validTo: string | null, asOf: Date): NhisStatus {
  if (!validTo) return "UNKNOWN";
  const end = Date.parse(`${validTo}T00:00:00Z`);
  if (Number.isNaN(end)) return "UNKNOWN";
  const today = Date.parse(`${asOf.toISOString().slice(0, 10)}T00:00:00Z`);
  const days = Math.round((end - today) / 86_400_000);
  if (days < 0) return "EXPIRED";
  if (days <= NHIS_EXPIRING_DAYS) return "EXPIRING";
  return "ACTIVE";
}

/**
 * 🔴 S2 — the card-holder ≠ student case. When `holder_kind = GUARDIAN` the card is the guardian's
 * (the mother's household card is common) and the student is a dependent minor, so the surface renders
 * `{card_number} · {holder_name} · {student_name} (minor)` faithfully (§02 holder line
 * `NHIS-9842-1276-5503 · A. Aidoo · Yaa Aidoo (minor)`). The TEXT `holder_name` is the source of truth
 * — a guardian FK is best-effort only, so this reads the text, never a join. `card_number` verbatim.
 */
export function formatNhisHolderLine(
  card: { cardNumber: string; holderName: string | null; holderKind: NhisHolderKind },
  studentName: string,
): string {
  if (card.holderKind === "GUARDIAN") {
    const holder = card.holderName?.trim() || "Guardian";
    return `${card.cardNumber} · ${holder} · ${studentName} (minor)`;
  }
  // Holder IS the student: the holder name (if the matron typed the student's own name) or the student.
  const holder = card.holderName?.trim() || studentName;
  return `${card.cardNumber} · ${holder}`;
}

/** The one client-safe card view — pre-shaped strings/scalars + the derived status, never a DB row. */
export interface NhisCardView {
  id: string;
  cardNumber: string;
  holderName: string | null;
  holderKind: NhisHolderKind;
  validFrom: string | null;
  validTo: string | null;
  studentGuardianId: string | null;
  status: NhisStatus;
  holderLine: string;
}
