import "../_loadenv";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  auditLog,
  schools,
  sickbayControlledMovement,
  sickbayStandingOrder,
  sickbayStockItem,
  users,
} from "@/db/schema";

/**
 * Sickbay §3 (INCR-24a) demo seed for Asankrangwa — a couple of stock items, one standing order, and a
 * controlled RECEIPT so the setup §3 surface renders real derived data: a reorder count, a status pill,
 * and a running controlled balance.
 *
 * 🔴 Risk 4 (R162) — NO student anywhere: a stock row is form + quantity, the register is drug · qty ·
 * actor · witness. Nothing here names a patient.
 *
 * MARKER-SCOPED + RE-RUN-SAFE. The three §3 tables belong to this module alone, so a school-scoped wipe
 * is safe here in the way a `where schoolId` on a shared table never is (repo memory
 * `seed-cleanup-must-be-scoped`). It touches NOTHING outside them. Run AFTER `pnpm db:seed-sickbay`
 * (it reuses that seed's Senior + Assistant Matron for the receipt's actor + witness).
 *
 * `pnpm db:seed-medication`
 */

const GES_CODE = "WR-WAW-014";
const MATRON_PHONE = "+233244000005";
const ASSISTANT_PHONE = "+233244000006";

async function main() {
  const [school] = await db
    .select({ id: schools.id })
    .from(schools)
    .where(eq(schools.gesCode, GES_CODE));
  if (!school) {
    console.error("✗ Asankrangwa not seeded yet — run `pnpm db:seed` first.");
    process.exit(1);
  }
  const schoolId = school.id;

  // ---- 1) Marker-scoped cleanup — the three §3 tables for this school only, in FK order ----
  await db.delete(sickbayControlledMovement).where(eq(sickbayControlledMovement.schoolId, schoolId));
  await db.delete(sickbayStockItem).where(eq(sickbayStockItem.schoolId, schoolId));
  await db.delete(sickbayStandingOrder).where(eq(sickbayStandingOrder.schoolId, schoolId));

  // The two matrons seeded by db:seed-sickbay. The witness of a controlled movement must be an N&MC
  // clinician (R155) and NOT the recorder — only Mrs Akua Bediako (MATRON_PHONE) carries the licence
  // (N-04827), so she is the WITNESS and Ms Grace Antwi (ASSISTANT_PHONE) is the recording ACTOR. The
  // reverse (Akua as both) would be self-witness, and Grace as witness would fail requireNmc — i.e. a
  // state the real `recordControlledMovement` refuses (Quinn 24a MINOR-3, fidelity).
  const matrons = await db
    .select({ id: users.id, phone: users.phone })
    .from(users)
    .where(inArray(users.phone, [MATRON_PHONE, ASSISTANT_PHONE]));
  const matronId = matrons.find((m) => m.phone === ASSISTANT_PHONE)?.id ?? null; // recorder (actor)
  const witnessId = matrons.find((m) => m.phone === MATRON_PHONE)?.id ?? null; // N&MC witness (N-04827)

  // ---- 2) One standing order (the Matron's own authority — provenance not permission, R160) ----
  await db.insert(sickbayStandingOrder).values({
    schoolId,
    complaint: "Headache · uncomplicated",
    treatment: "Paracetamol 500mg → 1–2 tabs · rest 30 min · review",
    escalation: "Refer if fever > 38.5°C or no relief after two doses.",
    orderedByDoctorName: "Dr K. Mensah",
    active: true,
  });

  // ---- 3) Two stock items — one plain (OK), one flagged CONTROLLED by the school (O3) ----
  const [plain] = await db
    .insert(sickbayStockItem)
    .values({
      schoolId,
      drugName: "Paracetamol 500mg",
      formLabel: "500mg tablet",
      unit: "tablets",
      qtyOnHand: "412",
      reorderPoint: "200",
      lastRestockedAt: new Date("2026-04-28T09:00:00Z"),
      isControlled: false,
      active: true,
    })
    .returning({ id: sickbayStockItem.id });

  const [controlled] = await db
    .insert(sickbayStockItem)
    .values({
      schoolId,
      // The school flags this controlled (R151 / O3 — no seeded national narcotics schedule).
      drugName: "Diazepam 5mg",
      formLabel: "5mg tablet",
      unit: "tablets",
      qtyOnHand: "8",
      reorderPoint: "10",
      lastRestockedAt: new Date("2026-04-15T09:00:00Z"),
      isControlled: true,
      active: true,
    })
    .returning({ id: sickbayStockItem.id });

  // ---- 4) A controlled RECEIPT — the derived balance = +20 (no MAR administrations at 24a) ----
  await db.insert(sickbayControlledMovement).values({
    schoolId,
    stockItemId: controlled.id,
    movementType: "RECEIPT",
    quantity: "20",
    occurredAt: new Date("2026-04-15T09:00:00Z"),
    actorUserId: matronId,
    witnessUserId: witnessId,
    batchRef: "PH-2026-0418",
    reason: "Opening controlled-cabinet stock",
  });

  await db.insert(auditLog).values({
    schoolId,
    actorRole: "MATRON",
    actionType: "created",
    entityType: "sickbay_stock_item",
    entityId: schoolId,
    afterState: { standingOrders: 1, stockItems: 2, controlledReceipts: 1 },
    reason: "Sickbay medication §3 demo seed (INCR-24a)",
  });

  console.log(
    `✓ Seeded sickbay §3 — 1 standing order, 2 stock items (Paracetamol 412/200 OK · Diazepam 8/10 ` +
      `Reorder, controlled), 1 controlled receipt (+20). Reorder count derives to 1; controlled ` +
      `balance derives to 20.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("✗ Sickbay medication seed failed:", err);
    process.exit(1);
  });
