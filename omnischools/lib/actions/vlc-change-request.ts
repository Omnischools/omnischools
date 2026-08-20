"use server";
/**
 * VLC curriculum-library structural change requests (SHS module 4.5 / issue #296) — the propose/decide
 * workflow that gates the THREE structural ops (add / reorder / remove) on a taught value behind
 * HEADMASTER approval. Owner-ratified: an ADMIN (in VLC_CONFIG_WRITE_ROLES) PROPOSES but CANNOT
 * self-approve; the approver is HEADMASTER only; apply-on-approval is pragmatic + NON-destructive
 * (remove is a soft-archive — never a delete, which would cascade session/attendance history away).
 *
 * Two gates, both re-checked server-side on every action (the UI hides controls, but this is the real
 * boundary): PROPOSE = VLC_CONFIG_WRITE_ROLES (Dean/Admin); DECIDE = VLC_CONFIG_APPROVE_ROLES
 * (Headmaster). Every write is tenant-scoped via withSchool (RLS is the boundary) and audited
 * (entityType vlc_value_change_request — SHOWN; no pastoral PII). Cross-row validation (the capstone
 * guard, the reorder set-equality, the ATOMIC ordinal renumber) lives here, never a DB trigger.
 */
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withSchool } from "@/lib/db/rls";
import type { Tx } from "@/lib/db";
import { recordAudit } from "@/lib/db/audit";
import { assertAnyRole, requireSchool, resolveActor } from "@/lib/auth/server";
import { VLC_CONFIG_APPROVE_ROLES, VLC_CONFIG_WRITE_ROLES } from "@/lib/access";
import { safeRevalidate } from "@/lib/revalidate";
import { vlcSessionTemplate, vlcValue, vlcValueChangeRequest } from "@/db/schema";
import {
  AddValuePayloadSchema,
  ReorderPayloadSchema,
  RemovePayloadSchema,
  planReorder,
  validateReorderOrder,
  type AddValuePayload,
  type ReorderPayload,
  type RemovePayload,
} from "@/lib/vlc/change-request";

type Result = { ok: boolean; error?: string };
const SETUP_PATH = "/senior/vlc/setup";

type Actor = { id: string | null; role: string };

/** PROPOSE gate — Dean/Admin. Re-checked on every propose action; a Headmaster/Form Master is refused. */
async function authorizePropose(): Promise<{ schoolId: string; actor: Actor }> {
  const { school } = await requireSchool();
  await assertAnyRole(VLC_CONFIG_WRITE_ROLES);
  const actor = await resolveActor(school.id);
  return { schoolId: school.id, actor };
}

/** DECIDE gate — HEADMASTER only. An Admin (who may propose) and the proposing Dean both fail here. */
async function authorizeDecide(): Promise<{ schoolId: string; actor: Actor }> {
  const { school } = await requireSchool();
  await assertAnyRole(VLC_CONFIG_APPROVE_ROLES);
  const actor = await resolveActor(school.id);
  return { schoolId: school.id, actor };
}

/** Count ACTIVE capstone values (a soft-archived capstone does not block a new one). */
async function activeCapstoneCount(tx: Tx, schoolId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(vlcValue)
    .where(and(eq(vlcValue.schoolId, schoolId), eq(vlcValue.active, true), eq(vlcValue.isCapstone, true)));
  return row?.n ?? 0;
}

/** Insert one PROPOSED change request and audit it. Shared by the three propose actions. */
async function insertRequest(
  gate: { schoolId: string; actor: Actor },
  op: "ADD" | "REORDER" | "REMOVE",
  payload: unknown,
  reason: string,
): Promise<void> {
  await withSchool(gate.schoolId, async (tx) => {
    const [row] = await tx
      .insert(vlcValueChangeRequest)
      .values({
        schoolId: gate.schoolId,
        op,
        payload,
        state: "PROPOSED",
        proposedByUserId: gate.actor.id ?? undefined,
        proposedAt: new Date(),
      })
      .returning({ id: vlcValueChangeRequest.id });
    await recordAudit(tx, {
      schoolId: gate.schoolId,
      actorUserId: gate.actor.id ?? undefined,
      actorRole: gate.actor.role,
      actionType: "created",
      entityType: "vlc_value_change_request",
      entityId: row?.id,
      before: null,
      after: { op, payload, state: "PROPOSED" },
      reason,
    });
  });
  safeRevalidate(SETUP_PATH);
}

// ── PROPOSE — add / reorder / remove (Dean/Admin; NO immediate effect on vlc_value) ─────────────────

/** Propose adding a value + its two session templates. No row lands on vlc_value until the HM approves. */
export async function proposeAddValue(input: unknown): Promise<Result> {
  const gate = await authorizePropose();
  const parsed = AddValuePayloadSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the new value details." };
  }
  const p = normalizeAdd(parsed.data);
  try {
    // Fast feedback: refuse a second capstone at propose time (the guard is re-checked at apply — the
    // active set can change between propose and approve, so apply is the real fence).
    if (p.capstone) {
      const blocked = await withSchool(gate.schoolId, (tx) => activeCapstoneCount(tx, gate.schoolId));
      if (blocked > 0) {
        return { ok: false, error: "This school already has a capstone value. Only one is allowed." };
      }
    }
    await insertRequest(gate, "ADD", p, `Proposed new value · ${p.nameEn}`);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not submit the proposal." };
  }
}

/** Propose a new ordering. The payload is the FULL ordered value_id[] (validated to equal the active set). */
export async function proposeReorderValues(input: unknown): Promise<Result> {
  const gate = await authorizePropose();
  const parsed = ReorderPayloadSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the proposed order." };
  }
  try {
    const res = await withSchool(gate.schoolId, async (tx): Promise<Result> => {
      const activeIds = await activeValueIds(tx, gate.schoolId);
      const err = validateReorderOrder(parsed.data.order, activeIds);
      if (err) return { ok: false, error: err };
      return { ok: true };
    });
    if (!res.ok) return res;
    await insertRequest(gate, "REORDER", { order: parsed.data.order }, "Proposed a new value order");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not submit the proposal." };
  }
}

/** Propose removing (soft-archiving) a value. On approval it is archived, NEVER deleted. */
export async function proposeRemoveValue(input: unknown): Promise<Result> {
  const gate = await authorizePropose();
  const parsed = RemovePayloadSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the value to remove." };
  }
  try {
    const res = await withSchool(gate.schoolId, async (tx): Promise<Result> => {
      const [row] = await tx
        .select({ id: vlcValue.id, nameEn: vlcValue.nameEn })
        .from(vlcValue)
        .where(and(eq(vlcValue.schoolId, gate.schoolId), eq(vlcValue.id, parsed.data.valueId), eq(vlcValue.active, true)))
        .limit(1);
      if (!row) return { ok: false, error: "That value no longer exists." };
      return { ok: true, error: row.nameEn };
    });
    if (!res.ok) return { ok: false, error: res.error };
    await insertRequest(gate, "REMOVE", { valueId: parsed.data.valueId }, `Proposed removing value · ${res.error}`);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not submit the proposal." };
  }
}

// ── DECIDE — approve (applies) / reject (no change), HM only, idempotent ─────────────────────────────

const IdSchema = z.object({ id: z.string().uuid() });
const RejectSchema = z.object({
  id: z.string().uuid(),
  note: z.string().trim().max(240).nullish(),
});

/**
 * Approve a PROPOSED request and APPLY it in ONE transaction (apply-on-approval). Idempotent: an
 * already-APPROVED/REJECTED request is locked FOR UPDATE and short-circuits with no re-apply (no double
 * insert, no re-renumber). Apply-time validation re-runs (capstone / reorder set-equality / still-active)
 * so a request that went stale between propose and approve is refused WITHOUT flipping state.
 */
export async function approveChangeRequest(input: unknown): Promise<Result> {
  const gate = await authorizeDecide();
  const parsed = IdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const requestId = parsed.data.id;
  try {
    const res = await withSchool(gate.schoolId, async (tx): Promise<Result> => {
      // FOR UPDATE serialises two Headmasters racing the same request — the loser re-reads APPROVED and
      // short-circuits, so the change is applied exactly once.
      const [req] = await tx
        .select({ op: vlcValueChangeRequest.op, state: vlcValueChangeRequest.state, payload: vlcValueChangeRequest.payload })
        .from(vlcValueChangeRequest)
        .where(and(eq(vlcValueChangeRequest.schoolId, gate.schoolId), eq(vlcValueChangeRequest.id, requestId)))
        .for("update")
        .limit(1);
      if (!req) return { ok: false, error: "That request no longer exists." };
      if (req.state !== "PROPOSED") {
        // Idempotent no-op — already decided, DO NOT re-apply.
        return { ok: false, error: `This request was already ${req.state.toLowerCase()}.` };
      }

      const applied = await applyChange(tx, gate.schoolId, req.op, req.payload);
      if (!applied.ok) return applied; // stale/invalid — leave state PROPOSED for the HM to re-examine

      const now = new Date();
      await tx
        .update(vlcValueChangeRequest)
        .set({ state: "APPROVED", decidedByUserId: gate.actor.id ?? null, decidedAt: now, appliedAt: now, updatedAt: now })
        .where(and(eq(vlcValueChangeRequest.schoolId, gate.schoolId), eq(vlcValueChangeRequest.id, requestId)));
      await recordAudit(tx, {
        schoolId: gate.schoolId,
        actorUserId: gate.actor.id ?? undefined,
        actorRole: gate.actor.role,
        actionType: "approved",
        entityType: "vlc_value_change_request",
        entityId: requestId,
        before: { state: "PROPOSED", op: req.op },
        after: { state: "APPROVED", op: req.op, appliedAt: now },
        reason: `Approved & applied ${req.op} change`,
      });
      return { ok: true };
    });
    if (res.ok) safeRevalidate(SETUP_PATH);
    return res;
  } catch {
    return { ok: false, error: "Could not apply the change." };
  }
}

/** Reject a PROPOSED request — records the decision + optional note, makes NO curriculum change. Idempotent. */
export async function rejectChangeRequest(input: unknown): Promise<Result> {
  const gate = await authorizeDecide();
  const parsed = RejectSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const note = parsed.data.note?.trim() || null;
  try {
    const res = await withSchool(gate.schoolId, async (tx): Promise<Result> => {
      const [req] = await tx
        .select({ op: vlcValueChangeRequest.op, state: vlcValueChangeRequest.state })
        .from(vlcValueChangeRequest)
        .where(and(eq(vlcValueChangeRequest.schoolId, gate.schoolId), eq(vlcValueChangeRequest.id, parsed.data.id)))
        .for("update")
        .limit(1);
      if (!req) return { ok: false, error: "That request no longer exists." };
      if (req.state !== "PROPOSED") return { ok: false, error: `This request was already ${req.state.toLowerCase()}.` };
      const now = new Date();
      await tx
        .update(vlcValueChangeRequest)
        .set({ state: "REJECTED", decidedByUserId: gate.actor.id ?? null, decidedAt: now, decisionNote: note, updatedAt: now })
        .where(and(eq(vlcValueChangeRequest.schoolId, gate.schoolId), eq(vlcValueChangeRequest.id, parsed.data.id)));
      await recordAudit(tx, {
        schoolId: gate.schoolId,
        actorUserId: gate.actor.id ?? undefined,
        actorRole: gate.actor.role,
        actionType: "rejected",
        entityType: "vlc_value_change_request",
        entityId: parsed.data.id,
        before: { state: "PROPOSED", op: req.op },
        after: { state: "REJECTED", op: req.op, note },
        reason: `Rejected ${req.op} change`,
      });
      return { ok: true };
    });
    if (res.ok) safeRevalidate(SETUP_PATH);
    return res;
  } catch {
    return { ok: false, error: "Could not reject the request." };
  }
}

// ── apply helpers (INSIDE the approve tx) ────────────────────────────────────────────────────────────

/** Apply the structural change to vlc_value in the approve transaction. Re-validates before mutating. */
async function applyChange(tx: Tx, schoolId: string, op: string, payload: unknown): Promise<Result> {
  if (op === "ADD") return applyAdd(tx, schoolId, normalizeAdd(AddValuePayloadSchema.parse(payload)));
  if (op === "REORDER") return applyReorder(tx, schoolId, ReorderPayloadSchema.parse(payload));
  if (op === "REMOVE") return applyRemove(tx, schoolId, RemovePayloadSchema.parse(payload));
  return { ok: false, error: "Unknown change type." };
}

async function applyAdd(tx: Tx, schoolId: string, p: AddValuePayload): Promise<Result> {
  if (p.capstone && (await activeCapstoneCount(tx, schoolId)) > 0) {
    return { ok: false, error: "This school already has a capstone value — cannot approve a second." };
  }
  const [{ maxOrdinal }] = await tx
    .select({ maxOrdinal: sql<number>`coalesce(max(${vlcValue.ordinal}), 0)::int` })
    .from(vlcValue)
    .where(eq(vlcValue.schoolId, schoolId));
  const [value] = await tx
    .insert(vlcValue)
    .values({
      schoolId,
      ordinal: maxOrdinal + 1,
      nameEn: p.nameEn,
      nameTwi: p.nameTwi ?? null,
      descriptor: p.descriptor ?? null,
      termGroup: p.termGroup,
      isCapstone: p.capstone,
      active: true,
    })
    .returning({ id: vlcValue.id });
  await tx.insert(vlcSessionTemplate).values([
    { schoolId, valueId: value.id, slot: "A", title: p.sessionA.title, prompt: p.sessionA.prompt ?? null, active: true },
    { schoolId, valueId: value.id, slot: "B", title: p.sessionB.title, prompt: p.sessionB.prompt ?? null, active: true },
  ]);
  return { ok: true };
}

async function applyReorder(tx: Tx, schoolId: string, p: ReorderPayload): Promise<Result> {
  const rows = await tx
    .select({ id: vlcValue.id, active: vlcValue.active, ordinal: vlcValue.ordinal })
    .from(vlcValue)
    .where(eq(vlcValue.schoolId, schoolId))
    .for("update");
  const activeIds = rows.filter((r) => r.active).map((r) => r.id);
  const err = validateReorderOrder(p.order, activeIds);
  if (err) return { ok: false, error: err };
  const archivedIds = rows.filter((r) => !r.active).map((r) => r.id);
  const maxOrdinal = rows.reduce((m, r) => Math.max(m, r.ordinal), 0);
  const { shift, placements } = planReorder(p.order, archivedIds, maxOrdinal);

  const now = new Date();
  // Step 1 — evacuate EVERY row by the same constant (bijection; the temp range is disjoint from the
  // final 1..n range), so the single statement never trips UNIQUE(school_id, ordinal).
  await tx
    .update(vlcValue)
    .set({ ordinal: sql`${vlcValue.ordinal} + ${shift}`, updatedAt: now })
    .where(eq(vlcValue.schoolId, schoolId));
  // Step 2 — place each row at its final ordinal (all targets now free + distinct).
  for (const pl of placements) {
    await tx
      .update(vlcValue)
      .set({ ordinal: pl.ordinal, updatedAt: now })
      .where(and(eq(vlcValue.schoolId, schoolId), eq(vlcValue.id, pl.id)));
  }
  return { ok: true };
}

async function applyRemove(tx: Tx, schoolId: string, p: RemovePayload): Promise<Result> {
  // Soft-archive ONLY — a hard delete would CASCADE the value → template → session → attendance chain and
  // destroy session/attendance history. The row and its FK children stay; the reader filters active=false.
  const res = await tx
    .update(vlcValue)
    .set({ active: false, updatedAt: new Date() })
    .where(and(eq(vlcValue.schoolId, schoolId), eq(vlcValue.id, p.valueId), eq(vlcValue.active, true)))
    .returning({ id: vlcValue.id });
  if (res.length === 0) return { ok: false, error: "That value is already removed or no longer exists." };
  return { ok: true };
}

async function activeValueIds(tx: Tx, schoolId: string): Promise<string[]> {
  const rows = await tx
    .select({ id: vlcValue.id })
    .from(vlcValue)
    .where(and(eq(vlcValue.schoolId, schoolId), eq(vlcValue.active, true)));
  return rows.map((r) => r.id);
}

/** Trim + null-coalesce the optional text fields (mirrors the rename/prompt actions' normalization). */
function normalizeAdd(d: AddValuePayload): AddValuePayload {
  return {
    nameEn: d.nameEn,
    nameTwi: d.nameTwi?.trim() || null,
    descriptor: d.descriptor?.trim() || null,
    termGroup: d.termGroup,
    capstone: d.capstone,
    sessionA: { title: d.sessionA.title, prompt: d.sessionA.prompt?.trim() || null },
    sessionB: { title: d.sessionB.title, prompt: d.sessionB.prompt?.trim() || null },
  };
}
