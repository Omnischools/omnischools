"use server";
/**
 * PTA structure-setup mutations (SHS module 4.7 / INCR-50 · the config spine).
 *
 * Every mutation is gated server-side to PTA_CONFIG_WRITE_ROLES (ADMIN / HEADMASTER) — the surface is
 * admin-only, so the UI never renders for anyone else, but this server re-check is the real boundary (a
 * hand-crafted POST that never touched the UI is still refused). Each writes ONE audit_log row with the
 * verbatim SHOWN entityType (pta_tiers_config / ptas / pta_dues_config_history).
 *
 * Scope fence (R418): config + idempotent generation + forward-only dues-rate history ONLY. NO officers-
 * as-roles, NO meetings, NO invoices, NO parent path (INCR-51/52/54/55). Validation lives here, never a
 * DB trigger (portability): the Emergency invariant (R414), forward-only dues (R413) and the idempotent
 * generation (R411/R412) are all app-layer; the DB CHECK / partial-unique indexes are the backstop.
 */
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { assertAnyRole, requireSchool, resolveActor } from "@/lib/auth/server";
import { PTA_CONFIG_WRITE_ROLES } from "@/lib/access";
import { safeRevalidate } from "@/lib/revalidate";
import { classes, houses, ptas, ptaDuesConfigHistory, ptaTiersConfig } from "@/db/schema";
import {
  coalescePtaTiers,
  ptaTierDefault,
  reconcilePtas,
  type PtaOp,
  type PtaTierType,
} from "@/lib/pta/defaults";

type Result = { ok: boolean; error?: string };
const SETUP_PATH = "/senior/pta/setup";

const TierTypeSchema = z.enum(["FORM", "HOUSE", "GENERAL", "EMERGENCY"]);

/** The shared write gate — re-checked on EVERY action before a single row is touched. */
async function authorizePtaWrite(): Promise<{
  schoolId: string;
  actor: { id: string | null; role: string };
}> {
  const { school } = await requireSchool();
  await assertAnyRole(PTA_CONFIG_WRITE_ROLES);
  const actor = await resolveActor(school.id);
  return { schoolId: school.id, actor };
}

// ---- 1) Per-tier config upsert (active / frequency / officers / quorum / tier_settings) ----
// Dues are DELIBERATELY out of this path: they change ONLY through changePtaDues (the forward-only,
// reason-mandatory, history-appending flow, R413), never as a side-effect of a cadence save.

const SaveTierSchema = z.object({
  tierType: TierTypeSchema,
  active: z.boolean(),
  frequencyNorm: z.string().trim().max(200).optional().default(""),
  officerRoles: z.array(z.string().trim().min(1).max(80)).max(20).optional().default([]),
  quorumRule: z.string().trim().max(300).optional().default(""),
  tierSettings: z.record(z.string(), z.string().max(200)).optional().default({}),
});

export async function savePtaTier(input: unknown): Promise<Result> {
  const gate = await authorizePtaWrite();
  const parsed = SaveTierSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the tier details." };
  }
  const d = parsed.data;

  // R414 — an Emergency tier carries NO standing officers (DB CHECK is the backstop; this is the primary).
  if (d.tierType === "EMERGENCY" && d.officerRoles.length > 0) {
    return { ok: false, error: "The Emergency tier has no standing officers." };
  }
  const officerRoles = d.tierType === "EMERGENCY" ? [] : d.officerRoles;
  const set = {
    active: d.active,
    frequencyNorm: d.frequencyNorm || null,
    officerRoles,
    quorumRule: d.quorumRule || null,
    tierSettings: d.tierSettings,
  };

  try {
    await withSchool(gate.schoolId, async (tx) => {
      const [before] = await tx
        .select({
          active: ptaTiersConfig.active,
          frequencyNorm: ptaTiersConfig.frequencyNorm,
          officerRoles: ptaTiersConfig.officerRoles,
          quorumRule: ptaTiersConfig.quorumRule,
          tierSettings: ptaTiersConfig.tierSettings,
        })
        .from(ptaTiersConfig)
        .where(and(eq(ptaTiersConfig.schoolId, gate.schoolId), eq(ptaTiersConfig.tierType, d.tierType)))
        .limit(1);
      await tx
        .insert(ptaTiersConfig)
        .values({ schoolId: gate.schoolId, tierType: d.tierType, ...set, configuredAt: new Date() })
        // configured_at is deliberately NOT in the update set — first save stamps it, later saves keep it.
        .onConflictDoUpdate({
          target: [ptaTiersConfig.schoolId, ptaTiersConfig.tierType],
          set: { ...set, updatedAt: new Date() },
        });
      await recordAudit(tx, {
        schoolId: gate.schoolId,
        actorUserId: gate.actor.id ?? undefined,
        actorRole: gate.actor.role,
        actionType: before ? "updated" : "created",
        entityType: "pta_tiers_config",
        entityId: gate.schoolId,
        before: before ?? null,
        after: { tierType: d.tierType, ...set },
        reason: `PTA ${d.tierType} tier configured`,
      });
    });
    safeRevalidate(SETUP_PATH);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not save the tier." };
  }
}

// ---- 2) The forward-only dues change (R413) — appends history + updates the current rate ----

const DuesSchema = z.object({
  tierType: TierTypeSchema,
  duesEnabled: z.boolean(),
  duesAmount: z.coerce.number().min(0).max(1_000_000).nullish(),
  duesBasis: z.enum(["PER_STUDENT", "PER_FAMILY"]).nullish(),
  duesCadence: z.enum(["PER_TERM", "PER_YEAR", "ONE_OFF"]).nullish(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick an effective date."),
  reason: z.string().trim().min(1, "A reason is required for a dues change."),
});

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function changePtaDues(input: unknown): Promise<Result> {
  const gate = await authorizePtaWrite();
  const parsed = DuesSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the dues change." };
  }
  const d = parsed.data;

  // R414 — the Emergency tier has NO standing dues (ad-hoc levies are convened at INCR-52).
  if (d.tierType === "EMERGENCY") {
    return { ok: false, error: "The Emergency tier collects no standing dues." };
  }
  // R413 — reason mandatory (the Zod .min(1) already rejects empty/whitespace after trim).
  const reason = d.reason.trim();
  if (!reason) return { ok: false, error: "A reason is required for a dues change." };
  // R413 — forward-only: backdating is REJECTED; today or the future is allowed.
  if (d.effectiveFrom < todayISO()) {
    return { ok: false, error: "Dues changes can't be backdated — pick today or a future date." };
  }

  // Normalise the contract: enabled needs a positive amount + basis + cadence; disabled clears them.
  let duesAmount: string | null = null;
  let duesBasis: "PER_STUDENT" | "PER_FAMILY" | null = null;
  let duesCadence: "PER_TERM" | "PER_YEAR" | "ONE_OFF" | null = null;
  if (d.duesEnabled) {
    if (!d.duesAmount || d.duesAmount <= 0) {
      return { ok: false, error: "Enter a dues amount greater than zero." };
    }
    if (!d.duesBasis || !d.duesCadence) {
      return { ok: false, error: "Choose how dues are charged and how often." };
    }
    duesAmount = d.duesAmount.toFixed(2);
    duesBasis = d.duesBasis;
    duesCadence = d.duesCadence;
  }
  const duesSet = { duesEnabled: d.duesEnabled, duesAmount, duesBasis, duesCadence };

  try {
    await withSchool(gate.schoolId, async (tx) => {
      // Ensure the config row exists (a dues-first change lands a COMPLETE row, not empty officers),
      // then update the CURRENT rate. onConflict keeps the existing non-dues config untouched.
      const dflt = ptaTierDefault(d.tierType);
      await tx
        .insert(ptaTiersConfig)
        .values({
          schoolId: gate.schoolId,
          tierType: d.tierType,
          active: dflt.active,
          frequencyNorm: dflt.frequencyNorm,
          officerRoles: dflt.officerRoles,
          quorumRule: dflt.quorumRule,
          ...duesSet,
          configuredAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [ptaTiersConfig.schoolId, ptaTiersConfig.tierType],
          set: { ...duesSet, updatedAt: new Date() },
        });

      // Append the immutable, forward-only history row (a full snapshot of the contract at the change).
      await tx.insert(ptaDuesConfigHistory).values({
        schoolId: gate.schoolId,
        tierType: d.tierType,
        ...duesSet,
        effectiveFrom: d.effectiveFrom,
        reason,
        changedByUserId: gate.actor.id ?? undefined,
      });

      await recordAudit(tx, {
        schoolId: gate.schoolId,
        actorUserId: gate.actor.id ?? undefined,
        actorRole: gate.actor.role,
        actionType: "created",
        entityType: "pta_dues_config_history",
        entityId: gate.schoolId,
        after: {
          tierType: d.tierType,
          duesEnabled: d.duesEnabled,
          duesAmount,
          duesBasis,
          duesCadence,
          effectiveFrom: d.effectiveFrom,
          reason,
        },
        reason: `PTA ${d.tierType} dues change · effective ${d.effectiveFrom} · ${reason}`,
      });
    });
    safeRevalidate(SETUP_PATH);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not record the dues change." };
  }
}

// ---- 3) Generate PTAs — the EXPLICIT idempotent reconcile (R411/R412) ----

/** Build the scope match for a close/reopen op (tier + typed scope, tenant-scoped). */
function scopeWhere(schoolId: string, op: PtaOp) {
  return and(
    eq(ptas.schoolId, schoolId),
    eq(ptas.tierType, op.tierType),
    op.classId ? eq(ptas.classId, op.classId) : isNull(ptas.classId),
    op.houseId ? eq(ptas.houseId, op.houseId) : isNull(ptas.houseId),
  );
}

export async function generatePtas(): Promise<Result> {
  const gate = await authorizePtaWrite();
  try {
    const summary = await withSchool(gate.schoolId, async (tx) => {
      const tierRows = await tx
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
        .where(eq(ptaTiersConfig.schoolId, gate.schoolId));
      const tiers = coalescePtaTiers(tierRows).map((t) => ({ tierType: t.tierType, active: t.active }));

      const activeClasses = await tx
        .select({ id: classes.id })
        .from(classes)
        .where(and(eq(classes.schoolId, gate.schoolId), eq(classes.active, true)));
      const activeHouses = await tx
        .select({ id: houses.id })
        .from(houses)
        .where(and(eq(houses.schoolId, gate.schoolId), eq(houses.active, true)));

      const existing = await tx
        .select({
          tierType: ptas.tierType,
          classId: ptas.classId,
          houseId: ptas.houseId,
          status: ptas.status,
        })
        .from(ptas)
        .where(eq(ptas.schoolId, gate.schoolId));

      const ops = reconcilePtas(
        tiers,
        activeClasses,
        activeHouses,
        existing.map((e) => ({
          tierType: e.tierType as PtaTierType,
          classId: e.classId,
          houseId: e.houseId,
          status: e.status as "ACTIVE" | "CLOSED",
        })),
      );

      const inserts = ops.filter((o) => o.action === "insert");
      const closes = ops.filter((o) => o.action === "close");
      const reopens = ops.filter((o) => o.action === "reopen");

      if (inserts.length > 0) {
        await tx
          .insert(ptas)
          .values(
            inserts.map((o) => ({
              schoolId: gate.schoolId,
              tierType: o.tierType,
              classId: o.classId,
              houseId: o.houseId,
            })),
          )
          // Idempotency backstop — the partial-unique indexes reject a duplicate scope (PTA50-8).
          .onConflictDoNothing();
      }
      for (const o of closes) {
        await tx.update(ptas).set({ status: "CLOSED", updatedAt: new Date() }).where(scopeWhere(gate.schoolId, o));
      }
      for (const o of reopens) {
        await tx.update(ptas).set({ status: "ACTIVE", updatedAt: new Date() }).where(scopeWhere(gate.schoolId, o));
      }

      const counts = { created: inserts.length, closed: closes.length, reopened: reopens.length };
      // Only audit when generation actually changed something (a no-op re-run writes nothing).
      if (inserts.length + closes.length + reopens.length > 0) {
        await recordAudit(tx, {
          schoolId: gate.schoolId,
          actorUserId: gate.actor.id ?? undefined,
          actorRole: gate.actor.role,
          actionType: "generated",
          entityType: "ptas",
          entityId: gate.schoolId,
          after: counts,
          reason: `PTAs generated · +${counts.created} · closed ${counts.closed} · reopened ${counts.reopened}`,
        });
      }
      return counts;
    });
    safeRevalidate(SETUP_PATH);
    const total = summary.created + summary.closed + summary.reopened;
    return {
      ok: true,
      error:
        total === 0
          ? "Already up to date — no changes."
          : `Done · +${summary.created} created · ${summary.closed} closed · ${summary.reopened} reopened.`,
    };
  } catch {
    return { ok: false, error: "Could not generate the PTAs." };
  }
}
