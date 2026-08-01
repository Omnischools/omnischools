/**
 * SERVER-ONLY PTA dues collection report (SHS module 4.7 / INCR-54a · R467–R469). Reads the REUSED billing
 * engine THROUGH the `pta_dues_charge` bridge — Expected = Σ rate_snapshot, Collected = Σ dues-invoice
 * paid_amount, Outstanding = Σ balance_amount — per tier + per PTA-instance, plus the aged (>30d)
 * escalation queue. Imports the DB driver via withSchool → NEVER import from a client component
 * ([[reports-data-is-server-only]]); the page passes pre-formatted PRIMITIVES to the client bits.
 *
 * 🔴 R468 cross-category = EXISTENCE-ONLY: `hasOtherArrears` is an EXISTS(a non-dues invoice with balance>0
 * for that student) BOOLEAN — the query NEVER selects or returns the other-category amount (the surface's
 * "GHS 800" is superseded; the spec wins). A PTA Treasurer learns a family also owes elsewhere WITHOUT
 * seeing tuition figures.
 *
 * READ gate (R469): management (PTA_CONFIG_WRITE_ROLES) reads school-wide; a Treasurer reads only the PTAs
 * where they hold that office (server-loaded); NO bare role. Honesty (R471): dues_enabled=false → no
 * charges exist → an empty report, never a fabricated Collected/Expected figure.
 */
import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import type { Tx } from "@/lib/db";
import { num, round2 } from "@/lib/fees-helpers";
import {
  academicPeriod,
  classes,
  houses,
  invoiceLineItems,
  invoices,
  ptas,
  ptaDuesCharge,
  ptaOfficer,
  ptaTiersConfig,
  students,
} from "@/db/schema";
import { coalescePtaTiers, type PtaDuesCadence, type PtaTierType } from "./defaults";
import { resolveDuesReportAccess, type DuesReportAccess } from "./dues";

const TREASURER_OFFICE = "Treasurer";

export type DuesAccent = "navy" | "gold" | "green" | "terra";
const TIER_META: Record<PtaTierType, { label: string; accent: DuesAccent; kind: "instances" | "buckets" }> = {
  FORM: { label: "Form PTA", accent: "navy", kind: "instances" },
  HOUSE: { label: "House PTA", accent: "gold", kind: "instances" },
  GENERAL: { label: "General PTA", accent: "green", kind: "buckets" },
  EMERGENCY: { label: "Emergency PTA", accent: "terra", kind: "instances" },
};

export interface DuesInstance {
  ptaId: string;
  label: string;
  charges: number;
  paidCount: number;
  partialCount: number;
  unpaidCount: number;
  expected: number;
  collected: number;
  outstanding: number;
  collectedPct: number;
}
export interface DuesTierReport {
  tierType: PtaTierType;
  label: string;
  accent: DuesAccent;
  kind: "instances" | "buckets";
  charges: number;
  expected: number;
  collected: number;
  outstanding: number;
  collectedPct: number;
  paidCount: number;
  partialCount: number;
  unpaidCount: number;
  instances: DuesInstance[];
}
export interface DuesAgedRow {
  subjectStudentId: string;
  studentName: string;
  ptaLabel: string;
  tierLabel: string;
  duesInvoiceId: string;
  invoiceNumber: string;
  outstanding: number;
  ageDays: number;
  /** R468 — EXISTENCE ONLY. True iff a NON-dues invoice with balance>0 exists for this student. NO amount. */
  hasOtherArrears: boolean;
}
export interface DuesReport {
  schoolWide: boolean;
  hasData: boolean;
  summary: { expected: number; collected: number; outstanding: number; aged: number; collectedPct: number };
  tiers: DuesTierReport[];
  aged: DuesAgedRow[];
}

/** The PTA ids where a user holds a CURRENT Treasurer office (server-loaded — never request-supplied). */
async function loadTreasurerPtaIds(tx: Tx, schoolId: string, userId: string): Promise<string[]> {
  const rows = await tx
    .select({ ptaId: ptaOfficer.ptaId })
    .from(ptaOfficer)
    .where(
      and(
        eq(ptaOfficer.schoolId, schoolId),
        eq(ptaOfficer.personUserId, userId),
        eq(ptaOfficer.office, TREASURER_OFFICE),
        isNull(ptaOfficer.endedAt),
      ),
    );
  return [...new Set(rows.map((r) => r.ptaId))];
}

/** The report READ decision (R469) for a page/layout gate — resolves the Treasurer's own PTAs server-side. */
export async function resolveDuesAccess(
  schoolId: string,
  viewer: { userId: string | null; roles: readonly string[] },
): Promise<DuesReportAccess> {
  // Management short-circuits without a DB hit; a non-manager needs their held Treasurer offices.
  const quick = resolveDuesReportAccess({ roles: viewer.roles, treasurerPtaIds: [] });
  if (quick.schoolWide || !viewer.userId) {
    return resolveDuesReportAccess({ roles: viewer.roles, treasurerPtaIds: [] });
  }
  const treasurerPtaIds = await withSchool(schoolId, (tx) =>
    loadTreasurerPtaIds(tx, schoolId, viewer.userId as string),
  );
  return resolveDuesReportAccess({ roles: viewer.roles, treasurerPtaIds });
}

const OPEN_STATUSES = ["ISSUED", "PARTIAL", "OVERDUE"] as const;

/** The whole dues collection report, pre-formatted. Access is resolved by resolveDuesAccess (R469). */
export async function getDuesReport(schoolId: string, access: DuesReportAccess): Promise<DuesReport> {
  const empty: DuesReport = {
    schoolWide: access.schoolWide,
    hasData: false,
    summary: { expected: 0, collected: 0, outstanding: 0, aged: 0, collectedPct: 0 },
    tiers: [],
    aged: [],
  };
  if (!access.canView) return empty;
  if (!access.schoolWide && access.ptaIds.length === 0) return empty;

  return withSchool(schoolId, async (tx) => {
    const scope = access.schoolWide ? undefined : inArray(ptaDuesCharge.ptaId, access.ptaIds);

    // A dues charge → its line item → its (non-voided) invoice → its PTA (+ class/House label), aggregated
    // per PTA instance: Expected = Σ rate_snapshot, Collected = Σ paid_amount, Outstanding = Σ balance (R467).
    const instanceRows = await tx
      .select({
        ptaId: ptas.id,
        tierType: ptas.tierType,
        className: classes.name,
        houseName: houses.name,
        charges: sql<number>`count(*)::int`,
        expected: sql<string>`coalesce(sum(${ptaDuesCharge.rateSnapshot}), 0)`,
        collected: sql<string>`coalesce(sum(${invoices.paidAmount}), 0)`,
        outstanding: sql<string>`coalesce(sum(${invoices.balanceAmount}), 0)`,
        paidCount: sql<number>`sum(case when ${invoices.status} = 'PAID' then 1 else 0 end)::int`,
        partialCount: sql<number>`sum(case when ${invoices.paidAmount} > 0 and ${invoices.balanceAmount} > 0 then 1 else 0 end)::int`,
        unpaidCount: sql<number>`sum(case when ${invoices.paidAmount} = 0 and ${invoices.status} <> 'PAID' then 1 else 0 end)::int`,
      })
      .from(ptaDuesCharge)
      .innerJoin(
        invoiceLineItems,
        and(
          eq(invoiceLineItems.schoolId, ptaDuesCharge.schoolId),
          eq(invoiceLineItems.id, ptaDuesCharge.lineItemId),
        ),
      )
      .innerJoin(
        invoices,
        and(
          eq(invoices.schoolId, ptaDuesCharge.schoolId),
          eq(invoices.id, invoiceLineItems.invoiceId),
          sql`${invoices.status} <> 'VOIDED'`,
        ),
      )
      .innerJoin(ptas, and(eq(ptas.schoolId, ptaDuesCharge.schoolId), eq(ptas.id, ptaDuesCharge.ptaId)))
      .leftJoin(classes, and(eq(classes.schoolId, ptas.schoolId), eq(classes.id, ptas.classId)))
      .leftJoin(houses, and(eq(houses.schoolId, ptas.schoolId), eq(houses.id, ptas.houseId)))
      .where(and(eq(ptaDuesCharge.schoolId, schoolId), ...(scope ? [scope] : [])))
      .groupBy(ptas.id, ptas.tierType, classes.name, houses.name);

    // ── Aged escalation (>30d) — per outstanding dues invoice; hasOtherArrears is EXISTENCE-ONLY (R468) ──
    const agedRows = await tx
      .select({
        subjectStudentId: ptaDuesCharge.subjectStudentId,
        firstName: students.firstName,
        lastName: students.lastName,
        tierType: ptas.tierType,
        className: classes.name,
        houseName: houses.name,
        invoiceId: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        outstanding: invoices.balanceAmount,
        ageDays: sql<number>`floor(extract(epoch from (now() - ${invoices.issuedAt})) / 86400)::int`,
        hasOtherArrears: sql<boolean>`exists (
          select 1 from ${invoices} oi
          where oi.school_id = ${ptaDuesCharge.schoolId}
            and oi.student_id = ${ptaDuesCharge.subjectStudentId}
            and oi.balance_amount > 0
            and oi.status in ('ISSUED', 'PARTIAL', 'OVERDUE')
            and not exists (
              select 1 from ${ptaDuesCharge} odc
              join ${invoiceLineItems} oili
                on oili.school_id = odc.school_id and oili.id = odc.line_item_id
              where oili.school_id = oi.school_id and oili.invoice_id = oi.id
            )
        )`,
      })
      .from(ptaDuesCharge)
      .innerJoin(
        invoiceLineItems,
        and(
          eq(invoiceLineItems.schoolId, ptaDuesCharge.schoolId),
          eq(invoiceLineItems.id, ptaDuesCharge.lineItemId),
        ),
      )
      .innerJoin(
        invoices,
        and(
          eq(invoices.schoolId, ptaDuesCharge.schoolId),
          eq(invoices.id, invoiceLineItems.invoiceId),
          inArray(invoices.status, [...OPEN_STATUSES]),
          sql`${invoices.balanceAmount} > 0`,
          sql`${invoices.issuedAt} < now() - interval '30 days'`,
        ),
      )
      .innerJoin(ptas, and(eq(ptas.schoolId, ptaDuesCharge.schoolId), eq(ptas.id, ptaDuesCharge.ptaId)))
      .innerJoin(students, and(eq(students.schoolId, ptaDuesCharge.schoolId), eq(students.id, ptaDuesCharge.subjectStudentId)))
      .leftJoin(classes, and(eq(classes.schoolId, ptas.schoolId), eq(classes.id, ptas.classId)))
      .leftJoin(houses, and(eq(houses.schoolId, ptas.schoolId), eq(houses.id, ptas.houseId)))
      .where(and(eq(ptaDuesCharge.schoolId, schoolId), ...(scope ? [scope] : [])))
      .orderBy(sql`${invoices.issuedAt} asc`);

    // ── Fold instance rows into per-tier reports ──
    const labelOf = (tt: PtaTierType, className: string | null, houseName: string | null) =>
      tt === "FORM"
        ? `${className ?? "Class"} PTA`
        : tt === "HOUSE"
          ? `${houseName ?? "House"} PTA`
          : tt === "GENERAL"
            ? "General PTA"
            : "Emergency PTA";
    const pct = (collected: number, expected: number) =>
      expected > 0 ? Math.round((collected / expected) * 100) : 0;

    const byTier = new Map<PtaTierType, DuesTierReport>();
    for (const r of instanceRows) {
      const tt = r.tierType as PtaTierType;
      const meta = TIER_META[tt];
      let tier = byTier.get(tt);
      if (!tier) {
        tier = {
          tierType: tt,
          label: meta.label,
          accent: meta.accent,
          kind: meta.kind,
          charges: 0,
          expected: 0,
          collected: 0,
          outstanding: 0,
          collectedPct: 0,
          paidCount: 0,
          partialCount: 0,
          unpaidCount: 0,
          instances: [],
        };
        byTier.set(tt, tier);
      }
      const expected = round2(num(r.expected));
      const collected = round2(num(r.collected));
      const outstanding = round2(num(r.outstanding));
      tier.instances.push({
        ptaId: r.ptaId,
        label: labelOf(tt, r.className, r.houseName),
        charges: r.charges,
        paidCount: r.paidCount,
        partialCount: r.partialCount,
        unpaidCount: r.unpaidCount,
        expected,
        collected,
        outstanding,
        collectedPct: pct(collected, expected),
      });
      tier.charges += r.charges;
      tier.expected = round2(tier.expected + expected);
      tier.collected = round2(tier.collected + collected);
      tier.outstanding = round2(tier.outstanding + outstanding);
      tier.paidCount += r.paidCount;
      tier.partialCount += r.partialCount;
      tier.unpaidCount += r.unpaidCount;
    }
    const tiers = [...byTier.values()].sort(
      (a, b) => tierOrder(a.tierType) - tierOrder(b.tierType),
    );
    for (const t of tiers) {
      t.collectedPct = pct(t.collected, t.expected);
      t.instances.sort((a, b) => a.collectedPct - b.collectedPct || a.label.localeCompare(b.label));
    }

    const summary = tiers.reduce(
      (acc, t) => ({
        expected: round2(acc.expected + t.expected),
        collected: round2(acc.collected + t.collected),
        outstanding: round2(acc.outstanding + t.outstanding),
        aged: acc.aged,
        collectedPct: 0,
      }),
      { expected: 0, collected: 0, outstanding: 0, aged: 0, collectedPct: 0 },
    );
    const aged: DuesAgedRow[] = agedRows.map((r) => ({
      subjectStudentId: r.subjectStudentId,
      studentName: `${r.firstName} ${r.lastName}`.trim(),
      ptaLabel: labelOf(r.tierType as PtaTierType, r.className, r.houseName),
      tierLabel: TIER_META[r.tierType as PtaTierType].label,
      duesInvoiceId: r.invoiceId,
      invoiceNumber: r.invoiceNumber,
      outstanding: round2(num(r.outstanding)),
      ageDays: r.ageDays,
      hasOtherArrears: r.hasOtherArrears,
    }));
    summary.aged = round2(aged.reduce((s, r) => s + r.outstanding, 0));
    summary.collectedPct = pct(summary.collected, summary.expected);

    return {
      schoolWide: access.schoolWide,
      hasData: tiers.length > 0,
      summary,
      tiers,
      aged,
    };
  });
}

function tierOrder(tt: PtaTierType): number {
  return ["FORM", "HOUSE", "GENERAL", "EMERGENCY"].indexOf(tt);
}

export interface DuesGenerateOptions {
  tiers: { tierType: PtaTierType; label: string; cadence: PtaDuesCadence }[];
  terms: { periodId: string; label: string; academicYear: string }[];
  years: string[];
}

/**
 * The admin-only generate-dues affordance's options (ADMIN / HEADMASTER, gated by the page): the
 * dues-ENABLED tiers (Emergency excluded — no standing dues), plus the school's terms (for a per-term
 * tier) and academic years (for a per-year tier). HONEST: a tier with dues off never appears.
 */
export async function getDuesGenerateOptions(schoolId: string): Promise<DuesGenerateOptions> {
  return withSchool(schoolId, async (tx) => {
    const cfgRows = await tx
      .select({
        tierType: ptaTiersConfig.tierType,
        active: ptaTiersConfig.active,
        frequencyNorm: ptaTiersConfig.frequencyNorm,
        officerRoles: ptaTiersConfig.officerRoles,
        quorumRule: ptaTiersConfig.quorumRule,
        duesEnabled: ptaTiersConfig.duesEnabled,
        duesAmount: ptaTiersConfig.duesAmount,
        duesBasis: ptaTiersConfig.duesBasis,
        duesCadence: ptaTiersConfig.duesCadence,
        tierSettings: ptaTiersConfig.tierSettings,
        configuredAt: ptaTiersConfig.configuredAt,
      })
      .from(ptaTiersConfig)
      .where(eq(ptaTiersConfig.schoolId, schoolId));
    const tiers = coalescePtaTiers(cfgRows)
      .filter((t) => t.duesEnabled && t.tierType !== "EMERGENCY" && t.duesCadence)
      .map((t) => ({
        tierType: t.tierType,
        label: TIER_META[t.tierType].label,
        cadence: t.duesCadence as PtaDuesCadence,
      }));

    const periodRows = await tx
      .select({
        periodId: academicPeriod.periodId,
        label: academicPeriod.periodLabel,
        academicYear: academicPeriod.academicYear,
        startsOn: academicPeriod.startsOn,
      })
      .from(academicPeriod)
      .where(eq(academicPeriod.schoolId, schoolId))
      .orderBy(desc(academicPeriod.startsOn));
    const terms = periodRows.map((p) => ({
      periodId: p.periodId,
      label: `${p.label} · ${p.academicYear}`,
      academicYear: p.academicYear,
    }));
    const years = [...new Set(periodRows.map((p) => p.academicYear))];

    return { tiers, terms, years };
  });
}
