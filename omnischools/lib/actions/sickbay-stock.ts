"use server";
/**
 * Sickbay §3 WRITE path (SHS module 4.4 / INCR-24a · setup §3) — standing orders, per-drug stock, and
 * the controlled-substance movement ledger. Mirrors lib/actions/sickbay-config.ts EXACTLY:
 * `authorizeStockWrite()` is the FIRST statement of every mutation, then a Zod parse, then a
 * `withSchool` transaction with `recordAudit` inside the same tx, and every id is re-resolved
 * server-side (a client id is never trusted).
 *
 * 🔴 Authz (R165). §3 WRITE = SICKBAY_STOCK_WRITE_ROLES = [ADMIN, MATRON] — the ONE gate where the
 * MATRON GAINS write and the HEADMASTER LOSES it (§1/§2 are ADMIN/HEADMASTER). A hand-crafted call from
 * a HEADMASTER — who can READ this screen — is refused HERE, before any query runs.
 *
 * 🔴 Risk 4 (R162). NO `student_id`, no student-identifying text reaches any table here — a drug beside
 * a student on a screen the ADMIN can read is a re-identification. The stock row is form + quantity; the
 * movement ledger is drug · type · qty · date · actor · witness — never a patient.
 *
 * 🔴 The controlled register is DERIVED and APPEND-ONLY (R152). Movements are RECEIPT / WASTAGE /
 * ADJUSTMENT only (administrations are read from the MAR, one source of truth); there is no edit or
 * delete path — a correction is a new ADJUSTMENT row. A controlled WASTAGE requires a WITNESS (the
 * diversion point): a second in-school N&MC clinician via `assertSchoolClinician({ requireNmc })`, never
 * free text, never the person recording it.
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withSchool } from "@/lib/db/rls";
import type { Tx } from "@/lib/db";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { getCurrentUser } from "@/lib/auth";
import { hasAnyRole, SICKBAY_STOCK_WRITE_ROLES } from "@/lib/access";
import { safeRevalidate } from "@/lib/revalidate";
import {
  sickbayControlledMovement,
  sickbayStandingOrder,
  sickbayStockItem,
} from "@/db/schema";
import { assertSchoolClinician } from "@/lib/sickbay/clinician";
import { controlledMovementWitnessError } from "@/lib/sickbay/stock";

type Result = { ok: boolean; error?: string; id?: string };
const SETUP_PATH = "/senior/sickbay/setup";

/**
 * The shared §3 write gate. A HEADMASTER or any non-[ADMIN,MATRON] role reaching any of these
 * directly — form POST, fetch, replayed server-action id — is refused here, before any query. Same
 * shape as `authorizeWrite` in sickbay-config.ts; the role set is the [ADMIN, MATRON] §3 seam (R165).
 */
async function authorizeStockWrite(): Promise<
  | { ok: true; schoolId: string; actor: { id: string | null; role: string } }
  | { ok: false; error: string }
> {
  const { school } = await requireSchool();
  const user = await getCurrentUser();
  if (!user || !hasAnyRole(user.roles, SICKBAY_STOCK_WRITE_ROLES)) {
    return {
      ok: false,
      error: "Only an Administrator or the Matron can change the standing orders and drug stock.",
    };
  }
  const actor = await resolveActor(school.id);
  return { ok: true, schoolId: school.id, actor };
}

const audit = (
  tx: Tx,
  schoolId: string,
  actor: { id: string | null; role: string },
  entry: {
    actionType: string;
    entityType: string;
    entityId: string;
    before?: unknown;
    after?: unknown;
    reason: string;
  },
) =>
  recordAudit(tx, {
    schoolId,
    actorUserId: actor.id ?? undefined,
    actorRole: actor.role,
    ...entry,
  });

// ============================================================================
// Standing orders (R159) — the Matron's first-line clinical authority
// ============================================================================

// `orderedByDoctorName` is a COPIED TEXT string (the doctor who authorised the order), NEVER a
// ref_user (R21) and never a gate (R160): the matron administers under her own authority; a MAR row
// cites the order via source=STANDING_ORDER, and the doctor's name is provenance only.
const StandingOrderBody = {
  complaint: z.string().trim().min(1).max(64),
  treatment: z.string().trim().min(1).max(240),
  escalation: z.string().trim().max(160).nullish(),
  orderedByDoctorName: z.string().trim().max(96).nullish(),
  active: z.boolean().default(true),
};
const CreateStandingOrderSchema = z.object(StandingOrderBody);
const EditStandingOrderSchema = z.object({ id: z.string().uuid(), ...StandingOrderBody });

export async function createStandingOrder(input: unknown): Promise<Result> {
  const auth = await authorizeStockWrite();
  if (!auth.ok) return auth;
  const parsed = CreateStandingOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the standing-order details." };
  const d = parsed.data;
  try {
    const id = await withSchool(auth.schoolId, async (tx) => {
      const [row] = await tx
        .insert(sickbayStandingOrder)
        .values({
          schoolId: auth.schoolId,
          complaint: d.complaint,
          treatment: d.treatment,
          escalation: d.escalation || null,
          orderedByDoctorName: d.orderedByDoctorName || null,
          active: d.active,
          createdByUserId: auth.actor.id ?? null,
        })
        .returning({ id: sickbayStandingOrder.id });
      await audit(tx, auth.schoolId, auth.actor, {
        actionType: "created",
        entityType: "sickbay_standing_order",
        entityId: row.id,
        after: { complaint: d.complaint, treatment: d.treatment, active: d.active },
        reason: `Standing order added · ${d.complaint}`,
      });
      return row.id;
    });
    safeRevalidate(SETUP_PATH);
    return { ok: true, id };
  } catch {
    return { ok: false, error: "Could not save the standing order." };
  }
}

export async function editStandingOrder(input: unknown): Promise<Result> {
  const auth = await authorizeStockWrite();
  if (!auth.ok) return auth;
  const parsed = EditStandingOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the standing-order details." };
  const d = parsed.data;
  try {
    const res = await withSchool(auth.schoolId, async (tx): Promise<Result> => {
      const [before] = await tx
        .select()
        .from(sickbayStandingOrder)
        .where(
          and(
            eq(sickbayStandingOrder.schoolId, auth.schoolId),
            eq(sickbayStandingOrder.id, d.id),
          ),
        )
        .limit(1);
      if (!before) return { ok: false, error: "That standing order no longer exists." };
      await tx
        .update(sickbayStandingOrder)
        .set({
          complaint: d.complaint,
          treatment: d.treatment,
          escalation: d.escalation || null,
          orderedByDoctorName: d.orderedByDoctorName || null,
          active: d.active,
          updatedAt: new Date(),
        })
        .where(
          and(eq(sickbayStandingOrder.schoolId, auth.schoolId), eq(sickbayStandingOrder.id, d.id)),
        );
      await audit(tx, auth.schoolId, auth.actor, {
        actionType: "updated",
        entityType: "sickbay_standing_order",
        entityId: d.id,
        before: { complaint: before.complaint, treatment: before.treatment, active: before.active },
        after: { complaint: d.complaint, treatment: d.treatment, active: d.active },
        reason: `Standing order updated · ${d.complaint}`,
      });
      return { ok: true };
    });
    if (!res.ok) return res;
    safeRevalidate(SETUP_PATH);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not save the standing order." };
  }
}

const SetActiveSchema = z.object({ id: z.string().uuid(), active: z.boolean() });

/** Deactivate (or reactivate) a standing order — config, an ordinary update, NOT an append-only record. */
export async function setStandingOrderActive(input: unknown): Promise<Result> {
  const auth = await authorizeStockWrite();
  if (!auth.ok) return auth;
  const parsed = SetActiveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid standing order." };
  const { id, active } = parsed.data;
  try {
    const res = await withSchool(auth.schoolId, async (tx): Promise<Result> => {
      const [before] = await tx
        .select({ complaint: sickbayStandingOrder.complaint, active: sickbayStandingOrder.active })
        .from(sickbayStandingOrder)
        .where(
          and(eq(sickbayStandingOrder.schoolId, auth.schoolId), eq(sickbayStandingOrder.id, id)),
        )
        .limit(1);
      if (!before) return { ok: false, error: "That standing order no longer exists." };
      await tx
        .update(sickbayStandingOrder)
        .set({ active, updatedAt: new Date() })
        .where(
          and(eq(sickbayStandingOrder.schoolId, auth.schoolId), eq(sickbayStandingOrder.id, id)),
        );
      await audit(tx, auth.schoolId, auth.actor, {
        actionType: "updated",
        entityType: "sickbay_standing_order",
        entityId: id,
        before: { active: before.active },
        after: { active },
        reason: `Standing order ${active ? "reactivated" : "deactivated"} · ${before.complaint}`,
      });
      return { ok: true };
    });
    if (!res.ok) return res;
    safeRevalidate(SETUP_PATH);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not change the standing order." };
  }
}

// ============================================================================
// Drug stock (R161) — PER-DRUG, school-level, NEVER per-student (R162 Risk 4)
// ============================================================================

// 🔴 No `student_id`, no student text (R162). `qtyOnHand`/`reorderPoint` are numeric strings for pg.
const StockBody = {
  drugName: z.string().trim().min(1).max(120),
  formLabel: z.string().trim().max(120).nullish(),
  unit: z.string().trim().max(48).nullish(),
  qtyOnHand: z.coerce.number().min(0).max(1_000_000).default(0),
  reorderPoint: z.coerce.number().min(0).max(1_000_000).nullish(),
  // The school flags a controlled item (R151 / O3 — no seeded national schedule).
  isControlled: z.boolean().default(false),
  lastRestockedAt: z.coerce.date().nullish(),
  active: z.boolean().default(true),
};
const CreateStockSchema = z.object(StockBody);
const EditStockSchema = z.object({ id: z.string().uuid(), ...StockBody });

const num = (n: number | null | undefined) => (n == null ? null : String(n));

export async function createStockItem(input: unknown): Promise<Result> {
  const auth = await authorizeStockWrite();
  if (!auth.ok) return auth;
  const parsed = CreateStockSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the stock-item details." };
  const d = parsed.data;
  try {
    const id = await withSchool(auth.schoolId, async (tx) => {
      const [row] = await tx
        .insert(sickbayStockItem)
        .values({
          schoolId: auth.schoolId,
          drugName: d.drugName,
          formLabel: d.formLabel || null,
          unit: d.unit || null,
          qtyOnHand: String(d.qtyOnHand),
          reorderPoint: num(d.reorderPoint),
          isControlled: d.isControlled,
          lastRestockedAt: d.lastRestockedAt ?? null,
          active: d.active,
        })
        .returning({ id: sickbayStockItem.id });
      await audit(tx, auth.schoolId, auth.actor, {
        actionType: "created",
        entityType: "sickbay_stock_item",
        entityId: row.id,
        after: { drugName: d.drugName, qtyOnHand: d.qtyOnHand, isControlled: d.isControlled },
        reason: `Stock item added · ${d.drugName}`,
      });
      return row.id;
    });
    safeRevalidate(SETUP_PATH);
    return { ok: true, id };
  } catch {
    return { ok: false, error: "Could not save the stock item." };
  }
}

export async function editStockItem(input: unknown): Promise<Result> {
  const auth = await authorizeStockWrite();
  if (!auth.ok) return auth;
  const parsed = EditStockSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the stock-item details." };
  const d = parsed.data;
  try {
    const res = await withSchool(auth.schoolId, async (tx): Promise<Result> => {
      const [before] = await tx
        .select()
        .from(sickbayStockItem)
        .where(and(eq(sickbayStockItem.schoolId, auth.schoolId), eq(sickbayStockItem.id, d.id)))
        .limit(1);
      if (!before) return { ok: false, error: "That stock item no longer exists." };
      await tx
        .update(sickbayStockItem)
        .set({
          drugName: d.drugName,
          formLabel: d.formLabel || null,
          unit: d.unit || null,
          qtyOnHand: String(d.qtyOnHand),
          reorderPoint: num(d.reorderPoint),
          isControlled: d.isControlled,
          lastRestockedAt: d.lastRestockedAt ?? null,
          active: d.active,
          updatedAt: new Date(),
        })
        .where(and(eq(sickbayStockItem.schoolId, auth.schoolId), eq(sickbayStockItem.id, d.id)));
      await audit(tx, auth.schoolId, auth.actor, {
        actionType: "updated",
        entityType: "sickbay_stock_item",
        entityId: d.id,
        before: { qtyOnHand: before.qtyOnHand, isControlled: before.isControlled },
        after: { drugName: d.drugName, qtyOnHand: d.qtyOnHand, isControlled: d.isControlled },
        reason: `Stock item updated · ${d.drugName}`,
      });
      return { ok: true };
    });
    if (!res.ok) return res;
    safeRevalidate(SETUP_PATH);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not save the stock item." };
  }
}

// ============================================================================
// Controlled-substance movements (R152) — APPEND-ONLY: RECEIPT / WASTAGE / ADJUSTMENT
// ============================================================================

const MovementSchema = z
  .object({
    stockItemId: z.string().uuid(),
    movementType: z.enum(["RECEIPT", "WASTAGE", "ADJUSTMENT"]),
    // RECEIPT/WASTAGE are positive amounts; ADJUSTMENT is a SIGNED delta (the ± in the balance) and
    // may be negative, but never zero (a no-op movement is not a record).
    quantity: z.coerce.number().refine((n) => n !== 0, "Quantity cannot be zero."),
    occurredAt: z.coerce.date(),
    batchRef: z.string().trim().max(96).nullish(),
    reason: z.string().trim().max(240).nullish(),
    witnessUserId: z.string().uuid().nullish(),
  })
  .refine((d) => d.movementType === "ADJUSTMENT" || d.quantity > 0, {
    message: "A receipt or wastage quantity must be greater than zero.",
    path: ["quantity"],
  });

/**
 * Record ONE controlled-stock movement. APPEND-ONLY — there is no edit or delete; a correction is a new
 * ADJUSTMENT row. The balance is DERIVED over these rows (R152), never stored.
 *
 * Movements exist only for a CONTROLLED item (the register is controlled-only; non-controlled stock uses
 * the manual `qty_on_hand` aid). A controlled WASTAGE requires a WITNESS — a second in-school N&MC
 * clinician via `assertSchoolClinician({ requireNmc })`, never the recorder (the diversion point, R152).
 * WASTAGE and ADJUSTMENT require a reason.
 *
 * `assertSchoolClinician` runs BEFORE the write tx (no nested transaction). The movement's actor is the
 * tenant-resolved session identity (`resolveActor`, already gated [ADMIN, MATRON]) — not a client id —
 * so its tenancy needs no separate check; the WITNESS is the client-supplied clinical pointer the DB
 * cannot verify on a global ref_user, so it is the one that passes the seam.
 */
export async function recordControlledMovement(input: unknown): Promise<Result> {
  const auth = await authorizeStockWrite();
  if (!auth.ok) return auth;
  const parsed = MovementSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the movement details." };
  }
  const d = parsed.data;

  // Re-resolve the stock item server-side: it must exist, be this school's, and be flagged controlled
  // (the movement ledger IS the controlled register — a non-controlled item has no derived balance).
  const [item] = await withSchool(auth.schoolId, async (tx) =>
    tx
      .select({
        id: sickbayStockItem.id,
        drugName: sickbayStockItem.drugName,
        isControlled: sickbayStockItem.isControlled,
      })
      .from(sickbayStockItem)
      .where(and(eq(sickbayStockItem.schoolId, auth.schoolId), eq(sickbayStockItem.id, d.stockItemId)))
      .limit(1),
  );
  if (!item) return { ok: false, error: "That stock item no longer exists." };
  if (!item.isControlled) {
    return {
      ok: false,
      error: "Only an item flagged controlled has a movement register. Flag it controlled first.",
    };
  }
  if (d.movementType !== "RECEIPT" && !d.reason) {
    return { ok: false, error: "Give a reason for a wastage or an adjustment." };
  }

  const witnessId = d.witnessUserId || null;
  // The require-witness + self-witness decision is the pure, unit-pinned `controlledMovementWitnessError`
  // (24a MINOR-2 — the guard the `&& false` mutation slipped past). The N&MC/tenancy check stays here
  // (DB-backed — the global `ref_user` can't be checked in SQL).
  const werr = controlledMovementWitnessError(d.movementType, witnessId, auth.actor.id ?? null);
  if (werr === "MISSING_WITNESS") {
    return { ok: false, error: "A controlled wastage needs a witness — a second N&MC clinician." };
  }
  if (werr === "SELF_WITNESS") {
    return { ok: false, error: "The witness must be a second person, not the one recording it." };
  }
  if (witnessId && !(await assertSchoolClinician(auth.schoolId, witnessId, { requireNmc: true }))) {
    return {
      ok: false,
      error: "The witness must be a staff member with an N&MC licence in this school.",
    };
  }

  try {
    const id = await withSchool(auth.schoolId, async (tx) => {
      const [row] = await tx
        .insert(sickbayControlledMovement)
        .values({
          schoolId: auth.schoolId,
          stockItemId: item.id,
          movementType: d.movementType,
          quantity: String(d.quantity),
          occurredAt: d.occurredAt,
          actorUserId: auth.actor.id ?? null,
          witnessUserId: witnessId,
          batchRef: d.batchRef || null,
          reason: d.reason || null,
        })
        .returning({ id: sickbayControlledMovement.id });
      await audit(tx, auth.schoolId, auth.actor, {
        actionType: "created",
        entityType: "sickbay_controlled_movement",
        entityId: row.id,
        // Drug name + qty + witness only — NEVER a student (R162): the movement carries none by construction.
        after: {
          drugName: item.drugName,
          movementType: d.movementType,
          quantity: d.quantity,
          witnessed: !!witnessId,
        },
        reason: `Controlled ${d.movementType.toLowerCase()} · ${item.drugName}`,
      });
      return row.id;
    });
    safeRevalidate(SETUP_PATH);
    return { ok: true, id };
  } catch {
    return { ok: false, error: "Could not record the movement." };
  }
}
