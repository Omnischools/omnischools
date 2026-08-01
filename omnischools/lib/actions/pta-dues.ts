"use server";
/**
 * PTA dues generation (SHS module 4.7 / INCR-54a · R459–R464). The MONEY increment — it REUSES the Basic
 * billing engine (fee_category / invoice / invoice_line_item), NOT a parallel ledger (OC2); the only new
 * table is the `pta_dues_charge` bridge (Wells's schema). Payment RECORDING reuses recordPayment untouched
 * (lib/actions/fees.ts); this file only ISSUES the dues invoices.
 *
 * Authority (R464): the existing issuance authority PTA_CONFIG_WRITE_ROLES (ADMIN / HEADMASTER), re-checked
 * server-side before any DB work — the parent Treasurer does NOT generate. Explicit (tier × period), never
 * cron. Each run:
 *   • idempotently upserts the ONE "PTA dues" fee_category (R459),
 *   • reads the FORWARD-ONLY rate in force at the billed period's start (R463) — no rate → nothing,
 *   • bills PER_STUDENT (Form: one dues invoice + line item + charge per active student) or PER_FAMILY
 *     (General: one per household → rank-1 sibling; household-less = family-of-one), reusing the billing
 *     sibling-rank ordering (R461),
 *   • is IDEMPOTENT (R462): a pre-skip on the bridge's 3 partial-unique keys + onConflictDoNothing backstop
 *     → a re-run creates 0 new charges, and an orphan dues invoice can never persist (R472 correctness).
 *   • writes ONE audit row (entityType "pta_dues_charge").
 *
 * Honesty (R471): dues_enabled=false, or no rate in force → 0 charges/invoices, reported plainly.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { assertAnyRole, requireSchool, resolveActor } from "@/lib/auth/server";
import { PTA_CONFIG_WRITE_ROLES } from "@/lib/access";
import { safeRevalidate } from "@/lib/revalidate";
import { nextInvoiceNumber, toMoney } from "@/lib/fees-helpers";
import {
  academicPeriod,
  feeCategories,
  invoiceLineItems,
  invoices,
  ptas,
  ptaDuesCharge,
  ptaDuesConfigHistory,
  ptaTiersConfig,
  classes,
  houses,
  students,
} from "@/db/schema";
import { coalescePtaTiers, type PtaTierType } from "@/lib/pta/defaults";
import {
  billingUnits,
  duesChargeKey,
  filterNewUnits,
  resolveInForceRate,
  type DuesHistoryRow,
  type ScopeStudent,
} from "@/lib/pta/dues";

const DUES_ROUTE = "/senior/pta/dues";
const DUES_FEE_CATEGORY = "PTA dues";

const GenerateSchema = z.object({
  tierType: z.enum(["FORM", "HOUSE", "GENERAL", "EMERGENCY"]),
  periodId: z.string().uuid().optional().or(z.literal("")),
  academicYear: z.string().trim().min(4).max(12).optional().or(z.literal("")),
});

export type GenerateDuesResult =
  | { ok: true; created: number; skipped: number; note?: string }
  | { ok: false; error: string };

export async function generateDuesInvoices(input: unknown): Promise<GenerateDuesResult> {
  const { school } = await requireSchool();
  await assertAnyRole(PTA_CONFIG_WRITE_ROLES); // R464 — generation ≠ collection; the Treasurer does not generate
  const parsed = GenerateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Choose a tier and period." };
  }
  const d = parsed.data;
  if (d.tierType === "EMERGENCY") {
    return { ok: false, error: "The Emergency tier collects no standing dues." };
  }
  const periodId = d.periodId || null;
  const inputYear = d.academicYear || null;
  if (!periodId && !inputYear) {
    return { ok: false, error: "Choose a term (per-term dues) or an academic year (per-year dues)." };
  }
  const actor = await resolveActor(school.id);

  try {
    const out = await withSchool(school.id, async (tx): Promise<GenerateDuesResult> => {
      // ── The tier's CURRENT dues gate (R471 — dues_enabled=false → nothing) ──
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
        .where(eq(ptaTiersConfig.schoolId, school.id));
      const tier = coalescePtaTiers(cfgRows).find((t) => t.tierType === d.tierType)!;
      if (!tier.duesEnabled) {
        return { ok: true, created: 0, skipped: 0, note: `Dues are not enabled for the ${d.tierType} tier.` };
      }

      // ── Resolve the billed-period context (start date + year + optional term id) ──
      let periodStartISO: string;
      let academicYear: string;
      let resolvedPeriodId: string | null = null;
      if (periodId) {
        const [p] = await tx
          .select({ startsOn: academicPeriod.startsOn, academicYear: academicPeriod.academicYear })
          .from(academicPeriod)
          .where(and(eq(academicPeriod.schoolId, school.id), eq(academicPeriod.periodId, periodId)));
        if (!p) return { ok: false, error: "That term was not found." };
        periodStartISO = p.startsOn;
        academicYear = p.academicYear;
        resolvedPeriodId = periodId;
      } else {
        const [p] = await tx
          .select({ startsOn: sql<string>`min(${academicPeriod.startsOn})` })
          .from(academicPeriod)
          .where(and(eq(academicPeriod.schoolId, school.id), eq(academicPeriod.academicYear, inputYear!)));
        if (!p?.startsOn) return { ok: false, error: "That academic year has no configured periods." };
        periodStartISO = p.startsOn;
        academicYear = inputYear!;
      }

      // ── FORWARD-ONLY rate (R463): the history row in force at the period start ──
      const historyRows = await tx
        .select({
          effectiveFrom: ptaDuesConfigHistory.effectiveFrom,
          duesEnabled: ptaDuesConfigHistory.duesEnabled,
          duesAmount: ptaDuesConfigHistory.duesAmount,
          duesBasis: ptaDuesConfigHistory.duesBasis,
          duesCadence: ptaDuesConfigHistory.duesCadence,
          changedAt: ptaDuesConfigHistory.changedAt,
        })
        .from(ptaDuesConfigHistory)
        .where(
          and(
            eq(ptaDuesConfigHistory.schoolId, school.id),
            eq(ptaDuesConfigHistory.tierType, d.tierType),
          ),
        )
        .orderBy(ptaDuesConfigHistory.effectiveFrom, ptaDuesConfigHistory.changedAt);
      const history: DuesHistoryRow[] = historyRows.map((r) => ({
        effectiveFrom: String(r.effectiveFrom),
        duesEnabled: r.duesEnabled,
        duesAmount: r.duesAmount != null ? Number(r.duesAmount) : null,
        duesBasis: r.duesBasis as DuesHistoryRow["duesBasis"],
        duesCadence: r.duesCadence as DuesHistoryRow["duesCadence"],
      }));
      const rate = resolveInForceRate(history, periodStartISO);
      if (!rate) {
        return {
          ok: true,
          created: 0,
          skipped: 0,
          note: "No dues rate is in force for that period — nothing generated.",
        };
      }
      // The academic_period_id column is set ONLY for a PER_TERM snapshot (schema contract).
      const chargePeriodId = rate.cadence === "PER_TERM" ? resolvedPeriodId : null;
      if (rate.cadence === "PER_TERM" && !chargePeriodId) {
        return { ok: false, error: "Pick a term — this tier bills per term." };
      }
      const amountStr = toMoney(rate.amount);

      // ── The ONE "PTA dues" fee_category (R459) — idempotent upsert, then read its id ──
      await tx
        .insert(feeCategories)
        .values({ schoolId: school.id, name: DUES_FEE_CATEGORY })
        .onConflictDoNothing({ target: [feeCategories.schoolId, feeCategories.name] });
      const [cat] = await tx
        .select({ id: feeCategories.id })
        .from(feeCategories)
        .where(and(eq(feeCategories.schoolId, school.id), eq(feeCategories.name, DUES_FEE_CATEGORY)));

      // ── The active PTAs of this tier (Emergency excluded structurally) ──
      const ptaRows = await tx
        .select({
          id: ptas.id,
          classId: ptas.classId,
          houseId: ptas.houseId,
          className: classes.name,
          houseName: houses.name,
        })
        .from(ptas)
        .leftJoin(classes, and(eq(ptas.schoolId, classes.schoolId), eq(ptas.classId, classes.id)))
        .leftJoin(houses, and(eq(ptas.schoolId, houses.schoolId), eq(ptas.houseId, houses.id)))
        .where(and(eq(ptas.schoolId, school.id), eq(ptas.tierType, d.tierType), eq(ptas.status, "ACTIVE")));
      if (ptaRows.length === 0) {
        return { ok: true, created: 0, skipped: 0, note: `No active ${d.tierType} PTA — generate PTAs first.` };
      }
      const ptaIds = ptaRows.map((p) => p.id);

      // ── Existing charge keys for these PTAs + this period scope (the primary idempotency, R462) ──
      const existingRows = await tx
        .select({
          ptaId: ptaDuesCharge.ptaId,
          subjectStudentId: ptaDuesCharge.subjectStudentId,
          householdId: ptaDuesCharge.householdId,
          basis: ptaDuesCharge.basis,
          academicPeriodId: ptaDuesCharge.academicPeriodId,
          academicYear: ptaDuesCharge.academicYear,
        })
        .from(ptaDuesCharge)
        .where(
          and(
            eq(ptaDuesCharge.schoolId, school.id),
            inArray(ptaDuesCharge.ptaId, ptaIds),
            eq(ptaDuesCharge.basis, rate.basis),
            rate.cadence === "PER_TERM"
              ? eq(ptaDuesCharge.academicPeriodId, chargePeriodId!)
              : eq(ptaDuesCharge.academicYear, academicYear),
          ),
        );
      const existingKeys = new Set(
        existingRows.map((r) =>
          duesChargeKey({
            ptaId: r.ptaId,
            basis: r.basis as "PER_STUDENT" | "PER_FAMILY",
            academicPeriodId: r.academicPeriodId,
            academicYear: r.academicYear,
            subjectStudentId: r.subjectStudentId,
            householdId: r.householdId,
          }),
        ),
      );

      let created = 0;
      let skipped = 0;
      for (const pta of ptaRows) {
        // Scope students: Form → its class; House → its House; General → all active school-wide.
        const scopeWhere =
          pta.classId != null
            ? eq(students.classId, pta.classId)
            : pta.houseId != null
              ? eq(students.houseId, pta.houseId)
              : undefined;
        const scopeRows = await tx
          .select({
            id: students.id,
            householdId: students.householdId,
            enrolledOn: students.enrolledOn,
            createdAt: students.createdAt,
          })
          .from(students)
          .where(
            and(
              eq(students.schoolId, school.id),
              eq(students.status, "ACTIVE"),
              ...(scopeWhere ? [scopeWhere] : []),
            ),
          );
        const scope: ScopeStudent[] = scopeRows.map((s) => ({
          id: s.id,
          householdId: s.householdId,
          enrolledOn: s.enrolledOn ? String(s.enrolledOn) : null,
          createdAtISO: s.createdAt.toISOString(),
        }));

        const units = billingUnits(scope, rate.basis);
        const keyed = units.map((u) => ({
          ...u,
          ptaId: pta.id,
          basis: rate.basis,
          academicPeriodId: chargePeriodId,
          academicYear,
        }));
        const toBill = filterNewUnits(keyed, existingKeys);
        skipped += keyed.length - toBill.length;

        const label =
          pta.className != null
            ? `${pta.className} PTA`
            : pta.houseName != null
              ? `${pta.houseName} PTA`
              : "General PTA";

        for (const u of toBill) {
          // Dedicated dues invoice (R459) → line item → bridge charge. Idempotency backstop: if the charge
          // insert conflicts on a partial-unique (a race), delete the just-made invoice so no orphan dues
          // invoice ever persists (which R472 would misread as tuition). The pre-skip handles re-runs.
          const invoiceNumber = await nextInvoiceNumber(tx, school.id);
          const [inv] = await tx
            .insert(invoices)
            .values({
              schoolId: school.id,
              studentId: u.subjectStudentId,
              invoiceNumber,
              academicYear,
              periodId: chargePeriodId,
              subtotalAmount: amountStr,
              discountAmount: "0.00",
              billedAmount: amountStr,
              paidAmount: "0.00",
              balanceAmount: amountStr,
              status: "ISSUED",
            })
            .returning({ id: invoices.id });
          const [li] = await tx
            .insert(invoiceLineItems)
            .values({
              schoolId: school.id,
              invoiceId: inv.id,
              feeCategoryId: cat?.id ?? null,
              description: `PTA dues · ${label}`,
              amount: amountStr,
            })
            .returning({ id: invoiceLineItems.id });
          const chargeRows = await tx
            .insert(ptaDuesCharge)
            .values({
              schoolId: school.id,
              lineItemId: li.id,
              ptaId: pta.id,
              tierType: d.tierType,
              academicYear,
              academicPeriodId: chargePeriodId,
              basis: rate.basis,
              cadence: rate.cadence,
              subjectStudentId: u.subjectStudentId,
              householdId: u.householdId,
              rateSnapshot: amountStr,
            })
            .onConflictDoNothing()
            .returning({ id: ptaDuesCharge.id });
          if (chargeRows.length === 0) {
            // Lost a race — the charge already exists. Undo the orphan invoice (cascade drops the line item).
            await tx.delete(invoices).where(eq(invoices.id, inv.id));
            skipped++;
            continue;
          }
          created++;
        }
      }

      if (created > 0 || skipped > 0) {
        await recordAudit(tx, {
          schoolId: school.id,
          actorUserId: actor.id ?? undefined,
          actorRole: actor.role,
          actionType: "generated",
          entityType: "pta_dues_charge",
          entityId: school.id,
          after: {
            tierType: d.tierType,
            basis: rate.basis,
            cadence: rate.cadence,
            rate: amountStr,
            academicYear,
            periodId: chargePeriodId,
            created,
            skipped,
          },
          reason: `PTA ${d.tierType} dues generated · +${created} · ${skipped} already billed`,
        });
      }
      return { ok: true, created, skipped };
    });

    if (out.ok) {
      safeRevalidate(DUES_ROUTE);
      safeRevalidate("/fees");
      safeRevalidate("/billing");
    }
    return out;
  } catch {
    return { ok: false, error: "Could not generate dues invoices. Please try again." };
  }
}
