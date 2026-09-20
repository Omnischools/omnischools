"use server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor, assertWriteAccess } from "@/lib/auth/server";
import { safeRevalidate } from "@/lib/revalidate";
import type { Tx } from "@/lib/db";
import { inboxRoutingRules } from "@/db/schema";

type Result = { ok: boolean; error?: string; id?: string };

const ROUTING_PATH = "/settings/inbox/routing";

/** Fallback always sorts last — a position no realistic rule count will reach. */
const FALLBACK_POSITION = 32_000;
const FALLBACK_NAME = "Fallback · unmatched threads";

/** Trim a string; empty/whitespace → null. */
const nz = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : v;
  return s ? (s as string) : null;
};

/** A uuid or "" (the "leave unassigned" option) → uuid | null. */
const assignee = z
  .string()
  .uuid()
  .or(z.literal(""))
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

/** Shared condition + action fields for create/update. */
const ruleFields = {
  name: z.string().min(1, "Give the rule a name").max(80),
  matchTopic: z.string().max(40).optional().nullable(),
  matchClass: z.string().max(80).optional().nullable(),
  matchKeywords: z.string().max(400).optional().nullable(),
  assignToUserId: assignee,
  notifyAllAdmins: z.coerce.boolean().optional().nullable(),
};

// --------------------------------------------------------------- fallback row
/**
 * Guarantee the school has exactly one fallback rule, creating the default if
 * missing. Returns the fallback's id. Safe to call from a page render.
 */
export async function ensureFallback(): Promise<Result> {
  const { school } = await requireSchool();
  try {
    const id = await withSchool(school.id, async (tx) => {
      const existing = await getFallback(tx, school.id);
      if (existing) return existing.id;
      const [created] = await tx
        .insert(inboxRoutingRules)
        .values({
          schoolId: school.id,
          name: FALLBACK_NAME,
          position: FALLBACK_POSITION,
          enabled: true,
          isFallback: true,
          assignToUserId: null, // leave unassigned by default
          notifyAllAdmins: true,
        })
        .returning({ id: inboxRoutingRules.id });
      return created.id;
    });
    return { ok: true, id };
  } catch {
    return { ok: false, error: "Could not set up the fallback rule." };
  }
}

async function getFallback(tx: Tx, schoolId: string) {
  const [row] = await tx
    .select()
    .from(inboxRoutingRules)
    .where(
      and(
        eq(inboxRoutingRules.schoolId, schoolId),
        eq(inboxRoutingRules.isFallback, true),
      ),
    )
    .limit(1);
  return row;
}

/** Count of the school's non-fallback rules — the position the next one takes. */
async function nonFallbackCount(tx: Tx, schoolId: string): Promise<number> {
  const rows = await tx
    .select({ id: inboxRoutingRules.id })
    .from(inboxRoutingRules)
    .where(
      and(
        eq(inboxRoutingRules.schoolId, schoolId),
        eq(inboxRoutingRules.isFallback, false),
      ),
    );
  return rows.length;
}

// ----------------------------------------------------------------- create
const CreateRuleSchema = z.object(ruleFields);

export async function createRule(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  await assertWriteAccess();
  const parsed = CreateRuleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const d = parsed.data;
  const actor = await resolveActor(school.id);
  try {
    const id = await withSchool(school.id, async (tx) => {
      const position = await nonFallbackCount(tx, school.id);
      const [created] = await tx
        .insert(inboxRoutingRules)
        .values({
          schoolId: school.id,
          name: d.name.trim(),
          position,
          enabled: true,
          isFallback: false,
          matchTopic: nz(d.matchTopic),
          matchClass: nz(d.matchClass),
          matchKeywords: nz(d.matchKeywords),
          assignToUserId: d.assignToUserId,
          notifyAllAdmins: !!d.notifyAllAdmins,
        })
        .returning({ id: inboxRoutingRules.id });
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "created",
        entityType: "inbox_routing_rule",
        entityId: created.id,
        after: { name: d.name.trim(), position },
        reason: "Routing rule created",
      });
      return created.id;
    });
    safeRevalidate(ROUTING_PATH);
    return { ok: true, id };
  } catch {
    return { ok: false, error: "Could not create the rule." };
  }
}

// ----------------------------------------------------------------- update
const UpdateRuleSchema = z.object({ id: z.string().uuid(), ...ruleFields });

export async function updateRule(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  await assertWriteAccess();
  const parsed = UpdateRuleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const d = parsed.data;
  const actor = await resolveActor(school.id);
  try {
    const outcome = await withSchool(school.id, async (tx) => {
      const [existing] = await tx
        .select()
        .from(inboxRoutingRules)
        .where(
          and(
            eq(inboxRoutingRules.id, d.id),
            eq(inboxRoutingRules.schoolId, school.id),
          ),
        )
        .limit(1);
      if (!existing) return { error: "Rule not found." };
      // A fallback rule keeps being a fallback — only its action is editable here.
      if (existing.isFallback) {
        return { error: "Use the fallback card to edit the fallback rule." };
      }
      await tx
        .update(inboxRoutingRules)
        .set({
          name: d.name.trim(),
          matchTopic: nz(d.matchTopic),
          matchClass: nz(d.matchClass),
          matchKeywords: nz(d.matchKeywords),
          assignToUserId: d.assignToUserId,
          notifyAllAdmins: !!d.notifyAllAdmins,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(inboxRoutingRules.id, d.id),
            eq(inboxRoutingRules.schoolId, school.id),
          ),
        );
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "updated",
        entityType: "inbox_routing_rule",
        entityId: d.id,
        after: { name: d.name.trim() },
        reason: "Routing rule edited",
      });
      return { ok: true as const };
    });
    if ("error" in outcome) return { ok: false, error: outcome.error };
    safeRevalidate(ROUTING_PATH);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not update the rule." };
  }
}

// ----------------------------------------------------------------- toggle
const ToggleRuleSchema = z.object({ id: z.string().uuid(), enabled: z.coerce.boolean() });

export async function toggleRule(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  await assertWriteAccess();
  const parsed = ToggleRuleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  try {
    await withSchool(school.id, (tx) =>
      tx
        .update(inboxRoutingRules)
        .set({ enabled: parsed.data.enabled, updatedAt: new Date() })
        .where(
          and(
            eq(inboxRoutingRules.id, parsed.data.id),
            eq(inboxRoutingRules.schoolId, school.id),
            eq(inboxRoutingRules.isFallback, false),
          ),
        ),
    );
    safeRevalidate(ROUTING_PATH);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not update the rule." };
  }
}

// ----------------------------------------------------------------- delete
const DeleteRuleSchema = z.object({ id: z.string().uuid() });

export async function deleteRule(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  await assertWriteAccess();
  const parsed = DeleteRuleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const actor = await resolveActor(school.id);
  try {
    const outcome = await withSchool(school.id, async (tx) => {
      const [existing] = await tx
        .select()
        .from(inboxRoutingRules)
        .where(
          and(
            eq(inboxRoutingRules.id, parsed.data.id),
            eq(inboxRoutingRules.schoolId, school.id),
          ),
        )
        .limit(1);
      if (!existing) return { error: "Rule not found." };
      if (existing.isFallback) return { error: "The fallback rule can't be deleted." };
      await tx
        .delete(inboxRoutingRules)
        .where(
          and(
            eq(inboxRoutingRules.id, parsed.data.id),
            eq(inboxRoutingRules.schoolId, school.id),
          ),
        );
      // Re-pack the remaining non-fallback rules to 0..n-1 (preserve order).
      const remaining = await tx
        .select({ id: inboxRoutingRules.id })
        .from(inboxRoutingRules)
        .where(
          and(
            eq(inboxRoutingRules.schoolId, school.id),
            eq(inboxRoutingRules.isFallback, false),
          ),
        )
        .orderBy(asc(inboxRoutingRules.position));
      for (let i = 0; i < remaining.length; i++) {
        await tx
          .update(inboxRoutingRules)
          .set({ position: i })
          .where(eq(inboxRoutingRules.id, remaining[i].id));
      }
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "deleted",
        entityType: "inbox_routing_rule",
        entityId: parsed.data.id,
        before: { name: existing.name },
        reason: "Routing rule deleted",
      });
      return { ok: true as const };
    });
    if ("error" in outcome) return { ok: false, error: outcome.error };
    safeRevalidate(ROUTING_PATH);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not delete the rule." };
  }
}

// ----------------------------------------------------------------- move
const MoveRuleSchema = z.object({
  id: z.string().uuid(),
  direction: z.enum(["UP", "DOWN"]),
});

export async function moveRule(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  await assertWriteAccess();
  const parsed = MoveRuleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  try {
    await withSchool(school.id, async (tx) => {
      // Order non-fallback rules; swap with the adjacent one (no-op at the ends).
      const rules = await tx
        .select({ id: inboxRoutingRules.id, position: inboxRoutingRules.position })
        .from(inboxRoutingRules)
        .where(
          and(
            eq(inboxRoutingRules.schoolId, school.id),
            eq(inboxRoutingRules.isFallback, false),
          ),
        )
        .orderBy(asc(inboxRoutingRules.position));
      const idx = rules.findIndex((r) => r.id === parsed.data.id);
      if (idx === -1) return;
      const swapWith = parsed.data.direction === "UP" ? idx - 1 : idx + 1;
      if (swapWith < 0 || swapWith >= rules.length) return; // at an end — no-op
      const a = rules[idx];
      const b = rules[swapWith];
      await tx
        .update(inboxRoutingRules)
        .set({ position: b.position })
        .where(eq(inboxRoutingRules.id, a.id));
      await tx
        .update(inboxRoutingRules)
        .set({ position: a.position })
        .where(eq(inboxRoutingRules.id, b.id));
    });
    safeRevalidate(ROUTING_PATH);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not reorder the rules." };
  }
}

// ----------------------------------------------------------------- fallback
const SaveFallbackSchema = z.object({
  assignToUserId: assignee,
  notifyAllAdmins: z.coerce.boolean().optional().nullable(),
});

export async function saveFallback(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  await assertWriteAccess();
  const parsed = SaveFallbackSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const d = parsed.data;
  const actor = await resolveActor(school.id);
  try {
    await withSchool(school.id, async (tx) => {
      const existing = await getFallback(tx, school.id);
      if (existing) {
        await tx
          .update(inboxRoutingRules)
          .set({
            assignToUserId: d.assignToUserId,
            notifyAllAdmins: !!d.notifyAllAdmins,
            updatedAt: new Date(),
          })
          .where(eq(inboxRoutingRules.id, existing.id));
        await recordAudit(tx, {
          schoolId: school.id,
          actorUserId: actor.id ?? undefined,
          actorRole: actor.role,
          actionType: "updated",
          entityType: "inbox_routing_rule",
          entityId: existing.id,
          reason: "Fallback routing rule edited",
        });
      } else {
        const [created] = await tx
          .insert(inboxRoutingRules)
          .values({
            schoolId: school.id,
            name: FALLBACK_NAME,
            position: FALLBACK_POSITION,
            enabled: true,
            isFallback: true,
            assignToUserId: d.assignToUserId,
            notifyAllAdmins: !!d.notifyAllAdmins,
          })
          .returning({ id: inboxRoutingRules.id });
        await recordAudit(tx, {
          schoolId: school.id,
          actorUserId: actor.id ?? undefined,
          actorRole: actor.role,
          actionType: "created",
          entityType: "inbox_routing_rule",
          entityId: created.id,
          reason: "Fallback routing rule created",
        });
      }
    });
    safeRevalidate(ROUTING_PATH);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not save the fallback rule." };
  }
}
