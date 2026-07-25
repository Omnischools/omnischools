"use server";
/**
 * Sickbay setup §04 WRITE path (SHS module 4.4 / INCR-25a) — the referral hospitals a school routes
 * serious cases to. Mirrors lib/actions/sickbay-config.ts EXACTLY: `authorizeConfigWrite()` is the
 * FIRST statement of every mutation, then a Zod parse, then a `withSchool` transaction with
 * `recordAudit` inside the same tx, and every id is re-resolved server-side (a client id is never
 * trusted).
 *
 * 🔴 Authz (R18 / W4). §04 WRITE = SICKBAY_CONFIG_WRITE_ROLES = [ADMIN, HEADMASTER] — the SAME config
 * gate as §1/§2. The MATRON READS hospitals but CANNOT write them (config is the Headmaster's; a
 * hand-crafted MATRON POST is refused HERE, before any query runs).
 *
 * 🔴 R186 — the at-most-one-primary rule is APP-LAYER, not a stored exclusive / partial-unique /
 * trigger: setting a hospital primary CLEARS the others in the SAME transaction. The DECISION is the
 * pure, unit-pinned `primariesToClear` (a mutation disabling it reds the test). Retirement is
 * `active = false`, never a DELETE (a hospital with referral history is RESTRICT-protected).
 */
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { withSchool } from "@/lib/db/rls";
import type { Tx } from "@/lib/db";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { getCurrentUser } from "@/lib/auth";
import { hasAnyRole, SICKBAY_CONFIG_WRITE_ROLES } from "@/lib/access";
import { safeRevalidate } from "@/lib/revalidate";
import { sickbayHospital } from "@/db/schema";
import { primariesToClear } from "@/lib/sickbay/hospitals";

type Result = { ok: boolean; error?: string; id?: string };
const SETUP_PATH = "/senior/sickbay/setup";

/**
 * The shared §04 write gate. A MATRON — who READS this section — or any non-[ADMIN, HEADMASTER] role
 * reaching any of these directly (form POST, fetch, replayed server-action id) is refused here, before
 * any query. Same shape and message as `authorizeWrite` in sickbay-config.ts (the §1/§2 config seam).
 */
async function authorizeConfigWrite(): Promise<
  | { ok: true; schoolId: string; actor: { id: string | null; role: string } }
  | { ok: false; error: string }
> {
  const { school } = await requireSchool();
  const user = await getCurrentUser();
  if (!user || !hasAnyRole(user.roles, SICKBAY_CONFIG_WRITE_ROLES)) {
    return {
      ok: false,
      error: "Only an Administrator or the Headmaster can change the referral hospitals.",
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

// A hospital is config — no student, no PII. `distanceKm` is a numeric string for pg (nullable).
const HospitalBody = {
  name: z.string().trim().min(1).max(160),
  distanceKm: z.coerce.number().min(0).max(100_000).nullish(),
  services: z.string().trim().max(2000).nullish(),
  notes: z.string().trim().max(2000).nullish(),
  isPrimary: z.boolean().default(false),
  acceptsNhis: z.boolean().default(false),
  tags: z.array(z.string().trim().min(1).max(48)).max(16).default([]),
  active: z.boolean().default(true),
};
const CreateSchema = z.object(HospitalBody);
const EditSchema = z.object({ id: z.string().uuid(), ...HospitalBody });

const num = (n: number | null | undefined) => (n == null ? null : String(n));

/**
 * R186 — clear every OTHER hospital that is currently primary when this save sets one. Reads the
 * school's primary flags INSIDE the tx and applies `primariesToClear` (the pure decision). `targetId`
 * is "" on create (no id yet), which clears every existing primary.
 */
async function clearOtherPrimaries(
  tx: Tx,
  schoolId: string,
  targetId: string,
  targetWillBePrimary: boolean,
): Promise<void> {
  if (!targetWillBePrimary) return;
  const rows = await tx
    .select({ id: sickbayHospital.id, isPrimary: sickbayHospital.isPrimary })
    .from(sickbayHospital)
    .where(eq(sickbayHospital.schoolId, schoolId));
  const clear = primariesToClear(rows, targetId, targetWillBePrimary);
  if (clear.length === 0) return;
  await tx
    .update(sickbayHospital)
    .set({ isPrimary: false, updatedAt: new Date() })
    .where(and(eq(sickbayHospital.schoolId, schoolId), inArray(sickbayHospital.id, clear)));
}

export async function createHospital(input: unknown): Promise<Result> {
  const auth = await authorizeConfigWrite();
  if (!auth.ok) return auth;
  const parsed = CreateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the hospital details." };
  const d = parsed.data;
  try {
    const id = await withSchool(auth.schoolId, async (tx) => {
      await clearOtherPrimaries(tx, auth.schoolId, "", d.isPrimary);
      const [row] = await tx
        .insert(sickbayHospital)
        .values({
          schoolId: auth.schoolId,
          name: d.name,
          distanceKm: num(d.distanceKm),
          services: d.services || null,
          notes: d.notes || null,
          isPrimary: d.isPrimary,
          acceptsNhis: d.acceptsNhis,
          tags: d.tags,
          active: d.active,
        })
        .returning({ id: sickbayHospital.id });
      await audit(tx, auth.schoolId, auth.actor, {
        actionType: "created",
        entityType: "sickbay_hospital",
        entityId: row.id,
        after: { name: d.name, isPrimary: d.isPrimary, acceptsNhis: d.acceptsNhis, active: d.active },
        reason: `Referral hospital added · ${d.name}`,
      });
      return row.id;
    });
    safeRevalidate(SETUP_PATH);
    return { ok: true, id };
  } catch {
    return { ok: false, error: "Could not save the hospital." };
  }
}

export async function editHospital(input: unknown): Promise<Result> {
  const auth = await authorizeConfigWrite();
  if (!auth.ok) return auth;
  const parsed = EditSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the hospital details." };
  const d = parsed.data;
  try {
    const res = await withSchool(auth.schoolId, async (tx): Promise<Result> => {
      const [before] = await tx
        .select()
        .from(sickbayHospital)
        .where(and(eq(sickbayHospital.schoolId, auth.schoolId), eq(sickbayHospital.id, d.id)))
        .limit(1);
      if (!before) return { ok: false, error: "That hospital no longer exists." };
      await clearOtherPrimaries(tx, auth.schoolId, d.id, d.isPrimary);
      await tx
        .update(sickbayHospital)
        .set({
          name: d.name,
          distanceKm: num(d.distanceKm),
          services: d.services || null,
          notes: d.notes || null,
          isPrimary: d.isPrimary,
          acceptsNhis: d.acceptsNhis,
          tags: d.tags,
          active: d.active,
          updatedAt: new Date(),
        })
        .where(and(eq(sickbayHospital.schoolId, auth.schoolId), eq(sickbayHospital.id, d.id)));
      await audit(tx, auth.schoolId, auth.actor, {
        actionType: "updated",
        entityType: "sickbay_hospital",
        entityId: d.id,
        before: {
          name: before.name,
          isPrimary: before.isPrimary,
          acceptsNhis: before.acceptsNhis,
          active: before.active,
        },
        after: { name: d.name, isPrimary: d.isPrimary, acceptsNhis: d.acceptsNhis, active: d.active },
        reason: `Referral hospital updated · ${d.name}`,
      });
      return { ok: true };
    });
    if (!res.ok) return res;
    safeRevalidate(SETUP_PATH);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not save the hospital." };
  }
}

const SetActiveSchema = z.object({ id: z.string().uuid(), active: z.boolean() });

/** Retire (or restore) a hospital — R186 `active = false`, never a DELETE (referral history survives). */
export async function setHospitalActive(input: unknown): Promise<Result> {
  const auth = await authorizeConfigWrite();
  if (!auth.ok) return auth;
  const parsed = SetActiveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid hospital." };
  const { id, active } = parsed.data;
  try {
    const res = await withSchool(auth.schoolId, async (tx): Promise<Result> => {
      const [before] = await tx
        .select({
          name: sickbayHospital.name,
          active: sickbayHospital.active,
          isPrimary: sickbayHospital.isPrimary,
        })
        .from(sickbayHospital)
        .where(and(eq(sickbayHospital.schoolId, auth.schoolId), eq(sickbayHospital.id, id)))
        .limit(1);
      if (!before) return { ok: false, error: "That hospital no longer exists." };
      // Retiring the primary drops the primary flag too — a school should not have a retired primary.
      const dropPrimary = !active && before.isPrimary;
      await tx
        .update(sickbayHospital)
        .set({ active, isPrimary: dropPrimary ? false : before.isPrimary, updatedAt: new Date() })
        .where(and(eq(sickbayHospital.schoolId, auth.schoolId), eq(sickbayHospital.id, id)));
      await audit(tx, auth.schoolId, auth.actor, {
        actionType: "updated",
        entityType: "sickbay_hospital",
        entityId: id,
        before: { active: before.active },
        after: { active },
        reason: `Referral hospital ${active ? "restored" : "retired"} · ${before.name}`,
      });
      return { ok: true };
    });
    if (!res.ok) return res;
    safeRevalidate(SETUP_PATH);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not change the hospital." };
  }
}
