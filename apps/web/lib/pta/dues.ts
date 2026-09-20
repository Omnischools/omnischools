/**
 * PTA dues — PURE, DB-free, unit-tested (dues.test.ts) core of INCR-54a (SHS module 4.7). The
 * billing-engine link is REUSED (fee_category / invoice / invoice_line_item / payment / receipt via
 * lib/actions/fees.ts + billing.ts); this file holds only the decisions that must be provable without a
 * database:
 *   • `resolveInForceRate` — the FORWARD-ONLY rate (R463): the config-history row with the greatest
 *     effective_from ≤ the billed period's start; null when no enabled/positive rate is in force.
 *   • `representativeSibling` / `billingUnits` — Form = PER_STUDENT (one per active student); General =
 *     PER_FAMILY (one per household → the rank-1 sibling; a household-less student = family-of-one). The
 *     rank ordering mirrors lib/actions/billing.ts (enrolledOn ?? createdAt, then id).
 *   • `duesChargeKey` / `filterNewUnits` — the idempotency crux (R462): a key mirroring the bridge's 3
 *     partial-unique indexes, so a re-run over already-billed units yields ZERO new charges.
 *   • `resolveDuesReportAccess` — the report READ gate (R469): management (PTA_CONFIG_WRITE_ROLES) reads
 *     school-wide; a Treasurer reads their OWN PTAs (server-loaded office ids); NO bare role alone.
 *
 * Nothing here touches the DB, imports a driver, or renders — lib/actions/pta-dues.ts and
 * lib/pta/dues-data.ts consume these.
 */
import { hasAnyRole, PTA_CONFIG_WRITE_ROLES } from "@/lib/access";
import type { PtaDuesBasis, PtaDuesCadence } from "./defaults";

// ─────────────────────────────────────────────────────────────── forward-only rate (R463)

export interface DuesHistoryRow {
  effectiveFrom: string; // "YYYY-MM-DD"
  duesEnabled: boolean;
  duesAmount: number | null;
  duesBasis: PtaDuesBasis | null;
  duesCadence: PtaDuesCadence | null;
}

export interface DuesRateInForce {
  amount: number;
  basis: PtaDuesBasis;
  cadence: PtaDuesCadence;
}

/**
 * The dues contract IN FORCE at `periodStartISO` (R463): the history row with the GREATEST
 * effective_from that is ≤ the billed period's start. A later row NEVER re-rates an issued invoice, so
 * the caller passes the period's start date and gets the frozen snapshot. Returns null when no row is in
 * force, the in-force row has dues DISABLED, or its amount/basis/cadence is missing/non-positive — the
 * honest "no rate in force → generate nothing" (R471). Ties on effective_from resolve to the LAST row in
 * the array, so the caller should pass rows ordered by (effective_from, changed_at) ascending.
 */
export function resolveInForceRate(
  rows: readonly DuesHistoryRow[],
  periodStartISO: string,
): DuesRateInForce | null {
  let chosen: DuesHistoryRow | null = null;
  for (const r of rows) {
    if (r.effectiveFrom <= periodStartISO) {
      if (chosen == null || r.effectiveFrom >= chosen.effectiveFrom) chosen = r;
    }
  }
  if (!chosen || !chosen.duesEnabled) return null;
  if (chosen.duesAmount == null || chosen.duesAmount <= 0) return null;
  if (!chosen.duesBasis || !chosen.duesCadence) return null;
  return { amount: chosen.duesAmount, basis: chosen.duesBasis, cadence: chosen.duesCadence };
}

// ─────────────────────────────────────────────────────────── sibling rank + billing units (R461)

export interface ScopeStudent {
  id: string;
  householdId: string | null;
  enrolledOn: string | null; // "YYYY-MM-DD"
  createdAtISO: string; // ISO timestamp fallback when enrolledOn is null
}

/** The ordering key mirrors lib/actions/billing.ts exactly: `${enrolledOn ?? createdAt-date}|${id}`. */
function rankKey(s: ScopeStudent): string {
  return `${s.enrolledOn ?? s.createdAtISO.slice(0, 10)}|${s.id}`;
}

/** The rank-1 (representative) sibling of a household — the earliest by enrolment, id as the tie-break. */
export function representativeSibling(members: readonly ScopeStudent[]): string | null {
  if (members.length === 0) return null;
  return [...members].sort((a, b) => rankKey(a).localeCompare(rankKey(b)))[0].id;
}

export interface BillingUnit {
  subjectStudentId: string;
  householdId: string | null;
}

/**
 * The charges to create for a PTA's scope (R461):
 *   • PER_STUDENT → one unit per active student (household not carried — the charge stores null).
 *   • PER_FAMILY  → one unit per household (the rank-1 sibling as subject); a household-less student is a
 *     family-of-one keyed on itself.
 * Deterministic (household order follows first appearance) so a re-run over the same roster is stable.
 */
export function billingUnits(
  students: readonly ScopeStudent[],
  basis: PtaDuesBasis,
): BillingUnit[] {
  if (basis === "PER_STUDENT") {
    return students.map((s) => ({ subjectStudentId: s.id, householdId: null }));
  }
  // PER_FAMILY — group by household, first-appearance order; household-less → family-of-one.
  const byHousehold = new Map<string, ScopeStudent[]>();
  const units: BillingUnit[] = [];
  for (const s of students) {
    if (s.householdId == null) {
      units.push({ subjectStudentId: s.id, householdId: null });
    } else {
      const arr = byHousehold.get(s.householdId);
      if (arr) arr.push(s);
      else byHousehold.set(s.householdId, [s]);
    }
  }
  for (const [householdId, members] of byHousehold) {
    const rep = representativeSibling(members);
    if (rep) units.push({ subjectStudentId: rep, householdId });
  }
  return units;
}

// ───────────────────────────────────────────────────────────────── idempotency keys (R462)

export interface DuesChargeKeyInput {
  ptaId: string;
  basis: PtaDuesBasis;
  academicPeriodId: string | null;
  academicYear: string;
  subjectStudentId: string;
  householdId: string | null;
}

/**
 * A string key mirroring the bridge's THREE partial-unique idempotency indexes (R462):
 *   • PER_STUDENT           → (pta, academic_period_id, student)
 *   • PER_FAMILY w/ house   → (pta, academic_year, household)
 *   • PER_FAMILY family-of-1 → (pta, academic_year, student)
 * Two units with the same key would collide on the DB unique, so the generator skips a unit whose key is
 * already present → a re-run creates 0 new charges.
 */
export function duesChargeKey(u: DuesChargeKeyInput): string {
  if (u.basis === "PER_STUDENT") {
    return `${u.ptaId}|PER_STUDENT|${u.academicPeriodId ?? ""}|${u.subjectStudentId}`;
  }
  return u.householdId != null
    ? `${u.ptaId}|PER_FAMILY|${u.academicYear}|H:${u.householdId}`
    : `${u.ptaId}|PER_FAMILY|${u.academicYear}|S:${u.subjectStudentId}`;
}

/** Drop units whose idempotency key is already billed — the primary idempotency (DB unique is backstop). */
export function filterNewUnits<T extends DuesChargeKeyInput>(
  units: readonly T[],
  existingKeys: ReadonlySet<string>,
): T[] {
  return units.filter((u) => !existingKeys.has(duesChargeKey(u)));
}

// ───────────────────────────────────────────────────────────────── report read gate (R469)

export interface DuesReportAccess {
  canView: boolean;
  /** true → management reads EVERY tier/PTA; false → scoped to `ptaIds` (a Treasurer's own PTAs). */
  schoolWide: boolean;
  ptaIds: string[];
}

/**
 * The Treasurer report READ gate (R469): management (ADMIN / HEADMASTER via PTA_CONFIG_WRITE_ROLES) reads
 * school-wide; otherwise the caller reads only the PTAs where they hold a Treasurer office (SERVER-loaded
 * ids, never request-supplied). A bare KnownAppRole alone (TEACHER / FORM_MASTER / PARENT) with no held
 * office sees NOTHING — the [[builds-widen-ratified-authz-and-self-bless]] fence: the officer arm keys on
 * identity, not a role.
 */
export function resolveDuesReportAccess(args: {
  roles: readonly string[];
  treasurerPtaIds: readonly string[];
}): DuesReportAccess {
  if (hasAnyRole(args.roles, PTA_CONFIG_WRITE_ROLES)) {
    return { canView: true, schoolWide: true, ptaIds: [] };
  }
  const ptaIds = [...args.treasurerPtaIds];
  return { canView: ptaIds.length > 0, schoolWide: false, ptaIds };
}
