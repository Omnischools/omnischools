/**
 * SERVER-ONLY read API for sickbay §3 (SHS module 4.4 / INCR-24a) — standing orders, the per-drug stock
 * register, and the DERIVED controlled-substance register. Imports the DB driver via `withSchool`, so it
 * must NEVER be imported by a client component: the setup page fetches through these readers, and the
 * client `stock-console` receives the PRE-FORMATTED view types from ./stock (never a `*-reads` import).
 *
 * 🔴 Risk 4 (R162) — NOT ONE of these readers selects a `student_id` or any student-identifying text.
 * §3 is a config screen the ADMIN and HEADMASTER can read, so a drug beside a student here is a
 * re-identification. The stock reader selects form + quantity + flags; the controlled register selects
 * drug · type · qty · date · actor · witness. The MAR contribution to the balance is a SUM of
 * `dispensed_qty` with the `student_id` column deliberately never in the projection.
 *
 * 🔴 The controlled balance is DERIVED each read (R152), never stored: Σ RECEIPT + Σ ADJUSTMENT(±) −
 * Σ WASTAGE − Σ(controlled GIVEN MAR dispensed_qty). The MAR term is JOINED by `stock_item_id` (R168):
 * 24b SWITCHED the join key from the mutable `drug_name` snapshot to the 0061 `stock_item_id` column, so
 * a tablet and a syrup of the same drug keep separate balances and a later rename cannot orphan history.
 */
import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import {
  sickbayControlledMovement,
  sickbayMedAdmin,
  sickbayStandingOrder,
  sickbayStockItem,
  users,
} from "@/db/schema";
import {
  deriveControlledBalance,
  reorderCount,
  stockStatus,
  type ControlledBlockView,
  type ControlledMovementView,
  type StandingOrderView,
  type StockItemView,
} from "./stock";

/** All standing orders for the school, most-recently-created first. */
export async function getStandingOrders(schoolId: string): Promise<StandingOrderView[]> {
  return withSchool(schoolId, async (tx) => {
    const rows = await tx
      .select({
        id: sickbayStandingOrder.id,
        complaint: sickbayStandingOrder.complaint,
        treatment: sickbayStandingOrder.treatment,
        escalation: sickbayStandingOrder.escalation,
        orderedByDoctorName: sickbayStandingOrder.orderedByDoctorName,
        active: sickbayStandingOrder.active,
        createdAt: sickbayStandingOrder.createdAt,
      })
      .from(sickbayStandingOrder)
      .where(eq(sickbayStandingOrder.schoolId, schoolId));
    return rows
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((r) => ({
        id: r.id,
        complaint: r.complaint,
        treatment: r.treatment,
        escalation: r.escalation,
        orderedByDoctorName: r.orderedByDoctorName,
        active: r.active,
      }));
  });
}

/** The stock register + the DERIVED reorder count (N-DIV-1). NO student anywhere (R162). */
export async function getStockRegister(
  schoolId: string,
): Promise<{ items: StockItemView[]; reorderCount: number }> {
  return withSchool(schoolId, async (tx) => {
    const rows = await tx
      .select({
        id: sickbayStockItem.id,
        drugName: sickbayStockItem.drugName,
        formLabel: sickbayStockItem.formLabel,
        unit: sickbayStockItem.unit,
        qtyOnHand: sickbayStockItem.qtyOnHand,
        reorderPoint: sickbayStockItem.reorderPoint,
        lastRestockedAt: sickbayStockItem.lastRestockedAt,
        isControlled: sickbayStockItem.isControlled,
        active: sickbayStockItem.active,
      })
      .from(sickbayStockItem)
      .where(eq(sickbayStockItem.schoolId, schoolId));
    const items: StockItemView[] = rows
      .map((r) => {
        // numeric round-trips as a string in pg — Number() at the boundary, once.
        const qtyOnHand = Number(r.qtyOnHand);
        const reorderPoint = r.reorderPoint === null ? null : Number(r.reorderPoint);
        return {
          id: r.id,
          drugName: r.drugName,
          formLabel: r.formLabel,
          unit: r.unit,
          qtyOnHand,
          reorderPoint,
          lastRestockedAt: r.lastRestockedAt,
          isControlled: r.isControlled,
          active: r.active,
          status: stockStatus(qtyOnHand, reorderPoint),
        };
      })
      .sort((a, b) => a.drugName.localeCompare(b.drugName));
    return { items, reorderCount: reorderCount(items) };
  });
}

/**
 * The controlled-substance register — one block per controlled item, each with its DERIVED balance and
 * an append-only movement list. The MAR-derived controlled GIVEN administrations are JOINed by
 * `stock_item_id` (R168 — the 0061 column) so a 24b administration appears here and deducts from the
 * right item's balance.
 *
 * 🔴 R168 — 24b SWITCHED the MAR join key from the mutable `drug_name` snapshot to `stock_item_id`. The
 * old `drug_name` match attributed a drug stocked as two form rows (tablet + syrup) to BOTH, and a later
 * rename orphaned the history; `stock_item_id` (RESTRICT-FK'd to the exact item) fixes both. A controlled
 * dose ALWAYS names its stock item (the `med_admin_controlled_needs_stock_item` CHECK), so no controlled
 * GIVEN administration is lost by the tighter join.
 */
export async function getControlledRegister(schoolId: string): Promise<ControlledBlockView[]> {
  return withSchool(schoolId, async (tx) => {
    const items = await tx
      .select({
        id: sickbayStockItem.id,
        drugName: sickbayStockItem.drugName,
        formLabel: sickbayStockItem.formLabel,
        unit: sickbayStockItem.unit,
      })
      .from(sickbayStockItem)
      .where(and(eq(sickbayStockItem.schoolId, schoolId), eq(sickbayStockItem.isControlled, true)));
    if (items.length === 0) return [];
    const itemIds = items.map((i) => i.id);

    const movements = await tx
      .select({
        id: sickbayControlledMovement.id,
        stockItemId: sickbayControlledMovement.stockItemId,
        movementType: sickbayControlledMovement.movementType,
        quantity: sickbayControlledMovement.quantity,
        occurredAt: sickbayControlledMovement.occurredAt,
        actorUserId: sickbayControlledMovement.actorUserId,
        witnessUserId: sickbayControlledMovement.witnessUserId,
        batchRef: sickbayControlledMovement.batchRef,
        reason: sickbayControlledMovement.reason,
      })
      .from(sickbayControlledMovement)
      .where(
        and(
          eq(sickbayControlledMovement.schoolId, schoolId),
          inArray(sickbayControlledMovement.stockItemId, itemIds),
        ),
      )
      .orderBy(asc(sickbayControlledMovement.occurredAt));

    // 🔴 The MAR contribution — controlled GIVEN administrations. NO patient column in the projection
    // (R162): only the stock item it deducts from, the quantity, when, by whom and witnessed by whom.
    // R168 — matched by `stock_item_id`, not the mutable `drug_name` snapshot.
    const administrations = await tx
      .select({
        id: sickbayMedAdmin.id,
        stockItemId: sickbayMedAdmin.stockItemId,
        dispensedQty: sickbayMedAdmin.dispensedQty,
        administeredAt: sickbayMedAdmin.administeredAt,
        actorUserId: sickbayMedAdmin.administeredByUserId,
        witnessUserId: sickbayMedAdmin.witnessUserId,
        witnessOverrideReason: sickbayMedAdmin.witnessOverrideReason,
      })
      .from(sickbayMedAdmin)
      .where(
        and(
          eq(sickbayMedAdmin.schoolId, schoolId),
          eq(sickbayMedAdmin.isControlled, true),
          eq(sickbayMedAdmin.status, "GIVEN"),
          inArray(sickbayMedAdmin.stockItemId, itemIds),
        ),
      )
      .orderBy(asc(sickbayMedAdmin.administeredAt));

    const userIds = [
      ...new Set(
        [
          ...movements.flatMap((m) => [m.actorUserId, m.witnessUserId]),
          ...administrations.flatMap((a) => [a.actorUserId, a.witnessUserId]),
        ].filter((id): id is string => id !== null),
      ),
    ];
    const userRows = userIds.length
      ? await tx.select({ id: users.id, name: users.fullName }).from(users).where(inArray(users.id, userIds))
      : [];
    const nameOf = (id: string | null) =>
      id === null ? null : (userRows.find((u) => u.id === id)?.name ?? null);

    return items.map((item) => {
      const rows: ControlledMovementView[] = [
        ...movements
          .filter((m) => m.stockItemId === item.id)
          .map((m) => ({
            id: m.id,
            kind: m.movementType as ControlledMovementView["kind"],
            occurredAt: m.occurredAt,
            // WASTAGE subtracts; RECEIPT/ADJUSTMENT keep their sign (ADJUSTMENT may already be negative).
            quantity: m.movementType === "WASTAGE" ? -Number(m.quantity) : Number(m.quantity),
            actorName: nameOf(m.actorUserId),
            witnessName: nameOf(m.witnessUserId),
            witnessOverrideReason: null,
            batchRef: m.batchRef,
            reason: m.reason,
          })),
        ...administrations
          .filter((a) => a.stockItemId === item.id)
          .map((a) => ({
            id: a.id,
            kind: "ADMINISTERED" as const,
            occurredAt: a.administeredAt,
            quantity: -Number(a.dispensedQty ?? 0), // an administration deducts
            actorName: nameOf(a.actorUserId),
            witnessName: nameOf(a.witnessUserId),
            witnessOverrideReason: a.witnessOverrideReason,
            batchRef: null,
            reason: null,
          })),
      ].sort((x, y) => x.occurredAt.getTime() - y.occurredAt.getTime());

      const balance = deriveControlledBalance({
        receipt: sum(movements, item.id, "RECEIPT"),
        adjustment: sum(movements, item.id, "ADJUSTMENT"),
        wastage: sum(movements, item.id, "WASTAGE"),
        administered: administrations
          .filter((a) => a.stockItemId === item.id)
          .reduce((t, a) => t + Number(a.dispensedQty ?? 0), 0),
      });

      return {
        stockItemId: item.id,
        drugName: item.drugName,
        formLabel: item.formLabel,
        unit: item.unit,
        balance,
        movements: rows,
      };
    });
  });
}

/** Σ of a movement type's raw (unsigned) quantity for one item — the sign is applied in the formula. */
function sum(
  movements: readonly { stockItemId: string; movementType: string; quantity: string }[],
  itemId: string,
  type: string,
): number {
  return movements
    .filter((m) => m.stockItemId === itemId && m.movementType === type)
    .reduce((t, m) => t + Number(m.quantity), 0);
}
