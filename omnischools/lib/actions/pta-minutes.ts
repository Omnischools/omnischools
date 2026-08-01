"use server";
/**
 * PTA minutes mutations (SHS module 4.7 / INCR-53 · the post-meeting record). WIRES `canActAsPtaOfficer` a
 * SECOND time: the Secretary drafts (`resolvePtaWriteAccess`) and the Chair adopts (`resolvePtaChairAccess`),
 * both server-loaded by IDENTITY through the minute→meeting→ptas join — NEVER a request-supplied pta_id or a
 * bare KnownAppRole. A Secretary of PTA-A cannot touch PTA-B's minutes; a hand-crafted POST that never
 * rendered the editor is refused here.
 *
 * 🔴 THE R451 IMMUTABILITY FENCE — the module's headline invariant. EVERY mutating action loads the parent
 * minute's `status` and REFUSES (`adoptedFenceError`) if it is ADOPTED: no UPDATE/DELETE of the minute, no
 * UPDATE/DELETE/INSERT anywhere in its agenda-item / action / resolution subtree. An adopted minute admits
 * ZERO mutation; corrections are a FUTURE amending minute. `markDistributed` is the ONE exception (it stamps
 * distributed_at on an adopted minute per R458) and is the only action that does not call the fence.
 *
 * DERIVED, never stored (R450/R453/R454): the draft-create gate is "meeting ENDED" (now ≥ end); the adopt
 * gate is "meeting WRITE-LOCKED" (now ≥ end + grace); the resolution number is assigned AT ADOPTION per
 * (pta × academic period), NNN=MAX+1 under the UNIQUE guard. Each write records ONE audit row with the
 * verbatim SHOWN entityType (pta_minutes / pta_agenda_item / pta_action_item / pta_resolution) — METADATA
 * ONLY. No triggers (portability) — this all lives here.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { withSchool, isUniqueViolation } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { safeRevalidate } from "@/lib/revalidate";
import type { Tx } from "@/lib/db";
import {
  loadMeetingScope,
  parsePtaAgenda,
  resolvePtaWriteAccess,
  type PtaMeetingScope,
} from "@/lib/pta/meeting-data";
import { resolvePtaChairAccess, loadResolutionSeqStart } from "@/lib/pta/minutes-data";
import {
  coalesceGraceHours,
  isPtaMeetingEnded,
  isPtaMeetingWriteLocked,
} from "@/lib/pta/meeting-clock";
import {
  adoptedFenceError,
  resolutionQuorumError,
  resolutionHasVotes,
  ownerXorError,
  validateMinutesForReview,
  resolutionScopeToken,
  formatResolutionNo,
  slugToken,
  type Classification,
} from "@/lib/pta/minutes";
import {
  academicPeriod,
  ptaMinutes,
  ptaAgendaItem,
  ptaActionItem,
  ptaResolution,
} from "@/db/schema";

type Result = { ok: boolean; error?: string; minutesId?: string };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const minutesPath = (meetingId: string) => `/senior/pta/meetings/${meetingId}/minutes`;

// ── shared loaders — resolve the parent minute's status + the meeting scope (server-derived pta_id) ──

interface MinutesForWrite {
  minutesId: string;
  status: string;
  meetingId: string;
  scope: PtaMeetingScope;
}

async function loadMinutesForWrite(
  tx: Tx,
  schoolId: string,
  minutesId: string,
): Promise<MinutesForWrite | null> {
  const [m] = await tx
    .select({ status: ptaMinutes.status, meetingId: ptaMinutes.meetingId })
    .from(ptaMinutes)
    .where(and(eq(ptaMinutes.schoolId, schoolId), eq(ptaMinutes.id, minutesId)))
    .limit(1);
  if (!m) return null;
  const scope = await loadMeetingScope(tx, schoolId, m.meetingId);
  if (!scope) return null;
  return { minutesId, status: m.status, meetingId: m.meetingId, scope };
}

interface AgendaItemForWrite extends MinutesForWrite {
  agendaItemId: string;
  classification: Classification | null;
}

async function loadAgendaItemForWrite(
  tx: Tx,
  schoolId: string,
  agendaItemId: string,
): Promise<AgendaItemForWrite | null> {
  const [ai] = await tx
    .select({
      minutesId: ptaAgendaItem.minutesId,
      classification: ptaAgendaItem.classification,
      status: ptaMinutes.status,
      meetingId: ptaMinutes.meetingId,
    })
    .from(ptaAgendaItem)
    .innerJoin(ptaMinutes, and(eq(ptaMinutes.schoolId, ptaAgendaItem.schoolId), eq(ptaMinutes.id, ptaAgendaItem.minutesId)))
    .where(and(eq(ptaAgendaItem.schoolId, schoolId), eq(ptaAgendaItem.id, agendaItemId)))
    .limit(1);
  if (!ai) return null;
  const scope = await loadMeetingScope(tx, schoolId, ai.meetingId);
  if (!scope) return null;
  return {
    minutesId: ai.minutesId,
    status: ai.status,
    meetingId: ai.meetingId,
    scope,
    agendaItemId,
    classification: (ai.classification as Classification | null) ?? null,
  };
}

/** The Secretary draft-side gate (identity ∥ break-glass) — reuses the INCR-52 write access decision. */
async function draftGate(
  tx: Tx,
  schoolId: string,
  scope: PtaMeetingScope,
  viewer: { userId: string | null; roles: readonly string[] },
): Promise<boolean> {
  const { canWrite } = await resolvePtaWriteAccess(tx, schoolId, scope, viewer);
  return canWrite;
}

// ── 1) createDraftMinutes — meeting ENDED + Secretary; seeds one agenda item per agenda_json item ────

const CreateSchema = z.object({ meetingId: z.string().uuid() });

export async function createDraftMinutes(input: unknown): Promise<Result> {
  const parsed = CreateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Missing the meeting." };
  const { meetingId } = parsed.data;
  const { school, user } = await requireSchool();
  const actor = await resolveActor(school.id);
  const now = new Date();
  let revalidate = false;
  try {
    const res = await withSchool(school.id, async (tx): Promise<Result> => {
      const scope = await loadMeetingScope(tx, school.id, meetingId);
      if (!scope) return { ok: false, error: "That meeting no longer exists." };
      if (!(await draftGate(tx, school.id, scope, { userId: user.id, roles: user.roles }))) {
        return { ok: false, error: "Only the PTA's Secretary can draft these minutes." };
      }
      if (!isPtaMeetingEnded(scope.meetingDate, scope.endTime, now)) {
        return { ok: false, error: "You can start minutes once the meeting has ended." };
      }
      // 1:1 (R445) — if a minute already exists, return it (idempotent; never a 2nd draft, never a mutation).
      const [existing] = await tx
        .select({ id: ptaMinutes.id })
        .from(ptaMinutes)
        .where(and(eq(ptaMinutes.schoolId, school.id), eq(ptaMinutes.meetingId, meetingId)))
        .limit(1);
      if (existing) return { ok: true, minutesId: existing.id };

      const [row] = await tx
        .insert(ptaMinutes)
        .values({ schoolId: school.id, meetingId, status: "DRAFT", secretaryId: actor.id ?? undefined })
        .returning({ id: ptaMinutes.id });

      // Seed one agenda item per agenda_json item (R446), in order.
      const agenda = parsePtaAgenda(scope.agendaJson);
      if (agenda.length > 0) {
        await tx.insert(ptaAgendaItem).values(
          agenda.map((it, i) => ({
            schoolId: school.id,
            minutesId: row.id,
            seqNo: i + 1,
            title: it.text,
          })),
        );
      }
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "created",
        entityType: "pta_minutes",
        entityId: row.id,
        after: { meetingId, status: "DRAFT", seededItems: agenda.length },
        reason: "PTA minutes drafting started",
      });
      revalidate = true;
      return { ok: true, minutesId: row.id };
    });
    if (res.ok && revalidate) safeRevalidate(minutesPath(meetingId));
    return res;
  } catch {
    return { ok: false, error: "Could not start the minutes." };
  }
}

// ── 2) saveAgendaItem — classify (below-quorum RESOLUTION refused) + narrative; reclassify-away deletes ──

const SaveItemSchema = z.object({
  agendaItemId: z.string().uuid(),
  classification: z.enum(["DISCUSSION", "ACTION", "RESOLUTION"]).nullable().optional(),
  narrative: z.string().trim().max(8000).nullable().optional(),
});

export async function saveAgendaItem(input: unknown): Promise<Result> {
  const parsed = SaveItemSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the item details." };
  const d = parsed.data;
  const { school, user } = await requireSchool();
  const actor = await resolveActor(school.id);
  let revalidate: string | null = null;
  try {
    const res = await withSchool(school.id, async (tx): Promise<Result> => {
      const ctx = await loadAgendaItemForWrite(tx, school.id, d.agendaItemId);
      if (!ctx) return { ok: false, error: "That item no longer exists." };
      if (!(await draftGate(tx, school.id, ctx.scope, { userId: user.id, roles: user.roles }))) {
        return { ok: false, error: "Only the PTA's Secretary can edit these minutes." };
      }
      const fence = adoptedFenceError(ctx.status);
      if (fence) return { ok: false, error: fence };
      if (d.classification === "RESOLUTION") {
        const qErr = resolutionQuorumError(ctx.scope.quorumMet);
        if (qErr) return { ok: false, error: qErr };
      }
      revalidate = minutesPath(ctx.meetingId);

      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (d.classification !== undefined) set.classification = d.classification;
      if (d.narrative !== undefined) set.narrative = d.narrative?.trim() || null;
      await tx
        .update(ptaAgendaItem)
        .set(set)
        .where(and(eq(ptaAgendaItem.schoolId, school.id), eq(ptaAgendaItem.id, d.agendaItemId)));

      // Reclassify-away-from-ACTION/RESOLUTION deletes the spawned child (R449).
      if (d.classification !== undefined) {
        if (d.classification !== "ACTION") {
          await tx.delete(ptaActionItem).where(and(eq(ptaActionItem.schoolId, school.id), eq(ptaActionItem.agendaItemId, d.agendaItemId)));
        }
        if (d.classification !== "RESOLUTION") {
          await tx.delete(ptaResolution).where(and(eq(ptaResolution.schoolId, school.id), eq(ptaResolution.agendaItemId, d.agendaItemId)));
        }
      }
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "updated",
        entityType: "pta_agenda_item",
        entityId: d.agendaItemId,
        before: { classification: ctx.classification },
        after: { classification: d.classification ?? ctx.classification, narrativeSet: d.narrative !== undefined },
        reason: "PTA agenda item classified / minuted",
      });
      return { ok: true };
    });
    if (res.ok && revalidate) safeRevalidate(revalidate);
    return res;
  } catch {
    return { ok: false, error: "Could not save the item." };
  }
}

// ── 3) upsertActionItem — the single ACTION child; owner person_user_id XOR external_name ─────────────

const ActionSchema = z.object({
  agendaItemId: z.string().uuid(),
  description: z.string().trim().min(1, "Describe the action.").max(2000),
  personUserId: z.string().uuid().nullable().optional(),
  externalName: z.string().trim().max(200).nullable().optional(),
  deadline: z.string().regex(DATE).nullable().optional(),
});

export async function upsertActionItem(input: unknown): Promise<Result> {
  const parsed = ActionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the action." };
  const d = parsed.data;
  const ownerErr = ownerXorError(d.personUserId, d.externalName);
  if (ownerErr) return { ok: false, error: ownerErr };
  const { school, user } = await requireSchool();
  const actor = await resolveActor(school.id);
  let revalidate: string | null = null;
  try {
    const res = await withSchool(school.id, async (tx): Promise<Result> => {
      const ctx = await loadAgendaItemForWrite(tx, school.id, d.agendaItemId);
      if (!ctx) return { ok: false, error: "That item no longer exists." };
      if (!(await draftGate(tx, school.id, ctx.scope, { userId: user.id, roles: user.roles }))) {
        return { ok: false, error: "Only the PTA's Secretary can edit these minutes." };
      }
      const fence = adoptedFenceError(ctx.status);
      if (fence) return { ok: false, error: fence };
      if (ctx.classification !== "ACTION") return { ok: false, error: "Classify this item as an Action first." };
      revalidate = minutesPath(ctx.meetingId);

      const personUserId = d.personUserId ?? null;
      const externalName = personUserId ? null : d.externalName?.trim() || null;
      const [existing] = await tx
        .select({ id: ptaActionItem.id })
        .from(ptaActionItem)
        .where(and(eq(ptaActionItem.schoolId, school.id), eq(ptaActionItem.agendaItemId, d.agendaItemId)))
        .limit(1);

      if (existing) {
        await tx
          .update(ptaActionItem)
          .set({ description: d.description, personUserId, externalName, deadline: d.deadline ?? null, updatedAt: new Date() })
          .where(and(eq(ptaActionItem.schoolId, school.id), eq(ptaActionItem.id, existing.id)));
      } else {
        await tx.insert(ptaActionItem).values({
          schoolId: school.id,
          agendaItemId: d.agendaItemId,
          description: d.description,
          personUserId,
          externalName,
          deadline: d.deadline ?? null,
        });
      }
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: existing ? "updated" : "created",
        entityType: "pta_action_item",
        entityId: existing?.id ?? d.agendaItemId,
        after: { agendaItemId: d.agendaItemId, hasOwner: true, ongoing: d.deadline == null },
        reason: "PTA action item recorded",
      });
      return { ok: true };
    });
    if (res.ok && revalidate) safeRevalidate(revalidate);
    return res;
  } catch {
    return { ok: false, error: "Could not save the action." };
  }
}

// ── 4) upsertResolution — the single RESOLUTION child; REFUSED below quorum (R452) ───────────────────

const ResolutionSchema = z.object({
  agendaItemId: z.string().uuid(),
  resolutionText: z.string().trim().min(1, "Enter the resolution wording.").max(8000),
  votesFor: z.coerce.number().int().min(0).max(100000),
  votesAgainst: z.coerce.number().int().min(0).max(100000),
  votesAbstain: z.coerce.number().int().min(0).max(100000),
  binding: z.boolean().optional(),
});

export async function upsertResolution(input: unknown): Promise<Result> {
  const parsed = ResolutionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the resolution." };
  const d = parsed.data;
  const { school, user } = await requireSchool();
  const actor = await resolveActor(school.id);
  let revalidate: string | null = null;
  try {
    const res = await withSchool(school.id, async (tx): Promise<Result> => {
      const ctx = await loadAgendaItemForWrite(tx, school.id, d.agendaItemId);
      if (!ctx) return { ok: false, error: "That item no longer exists." };
      if (!(await draftGate(tx, school.id, ctx.scope, { userId: user.id, roles: user.roles }))) {
        return { ok: false, error: "Only the PTA's Secretary can edit these minutes." };
      }
      const fence = adoptedFenceError(ctx.status);
      if (fence) return { ok: false, error: fence };
      // R452 — a resolution requires a strictly-confirmed quorum.
      const qErr = resolutionQuorumError(ctx.scope.quorumMet);
      if (qErr) return { ok: false, error: qErr };
      if (ctx.classification !== "RESOLUTION") return { ok: false, error: "Classify this item as a Resolution first." };
      revalidate = minutesPath(ctx.meetingId);

      const binding = d.binding ?? ctx.scope.tierType === "GENERAL"; // app default TRUE for GENERAL (R448)
      const [existing] = await tx
        .select({ id: ptaResolution.id })
        .from(ptaResolution)
        .where(and(eq(ptaResolution.schoolId, school.id), eq(ptaResolution.agendaItemId, d.agendaItemId)))
        .limit(1);

      if (existing) {
        await tx
          .update(ptaResolution)
          .set({
            resolutionText: d.resolutionText,
            votesFor: d.votesFor,
            votesAgainst: d.votesAgainst,
            votesAbstain: d.votesAbstain,
            binding,
            updatedAt: new Date(),
          })
          .where(and(eq(ptaResolution.schoolId, school.id), eq(ptaResolution.id, existing.id)));
      } else {
        await tx.insert(ptaResolution).values({
          schoolId: school.id,
          agendaItemId: d.agendaItemId,
          resolutionText: d.resolutionText,
          votesFor: d.votesFor,
          votesAgainst: d.votesAgainst,
          votesAbstain: d.votesAbstain,
          binding,
          // resolution_no stays NULL until adoption (R453).
        });
      }
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: existing ? "updated" : "created",
        entityType: "pta_resolution",
        entityId: existing?.id ?? d.agendaItemId,
        after: { agendaItemId: d.agendaItemId, votesFor: d.votesFor, votesAgainst: d.votesAgainst, binding },
        reason: "PTA resolution recorded",
      });
      return { ok: true };
    });
    if (res.ok && revalidate) safeRevalidate(revalidate);
    return res;
  } catch {
    return { ok: false, error: "Could not save the resolution." };
  }
}

// ── 5) submitForReview — DRAFT → CHAIR_REVIEW (R455 validation) ──────────────────────────────────────

const IdSchema = z.object({ minutesId: z.string().uuid() });

/** Load the subtree in the shape R455 validation consumes. */
async function loadValidationInput(tx: Tx, schoolId: string, minutesId: string) {
  const items = await tx
    .select({ id: ptaAgendaItem.id, classification: ptaAgendaItem.classification })
    .from(ptaAgendaItem)
    .where(and(eq(ptaAgendaItem.schoolId, schoolId), eq(ptaAgendaItem.minutesId, minutesId)))
    .orderBy(asc(ptaAgendaItem.seqNo));
  const ids = items.map((i) => i.id);
  const actions = ids.length
    ? await tx
        .select({ agendaItemId: ptaActionItem.agendaItemId, personUserId: ptaActionItem.personUserId, externalName: ptaActionItem.externalName, deadline: ptaActionItem.deadline })
        .from(ptaActionItem)
        .where(and(eq(ptaActionItem.schoolId, schoolId), inArray(ptaActionItem.agendaItemId, ids)))
    : [];
  const resolutions = ids.length
    ? await tx
        .select({ agendaItemId: ptaResolution.agendaItemId, votesFor: ptaResolution.votesFor, votesAgainst: ptaResolution.votesAgainst, votesAbstain: ptaResolution.votesAbstain })
        .from(ptaResolution)
        .where(and(eq(ptaResolution.schoolId, schoolId), inArray(ptaResolution.agendaItemId, ids)))
    : [];
  const actionByItem = new Map(actions.map((a) => [a.agendaItemId, a]));
  const resByItem = new Map(resolutions.map((r) => [r.agendaItemId, r]));
  return items.map((it) => {
    const c = (it.classification as Classification | null) ?? null;
    const a = actionByItem.get(it.id);
    const r = resByItem.get(it.id);
    return {
      classification: c,
      action: c === "ACTION" ? { hasOwner: !!(a && (a.personUserId || (a.externalName && a.externalName.trim()))), hasDeadline: !!a?.deadline } : null,
      resolution: c === "RESOLUTION" ? { hasVotes: !!(r && resolutionHasVotes(r.votesFor, r.votesAgainst, r.votesAbstain)) } : null,
    };
  });
}

export async function submitForReview(input: unknown): Promise<Result> {
  const parsed = IdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Missing the minutes." };
  const { minutesId } = parsed.data;
  const { school, user } = await requireSchool();
  const actor = await resolveActor(school.id);
  let revalidate: string | null = null;
  try {
    const res = await withSchool(school.id, async (tx): Promise<Result> => {
      const ctx = await loadMinutesForWrite(tx, school.id, minutesId);
      if (!ctx) return { ok: false, error: "Those minutes no longer exist." };
      if (!(await draftGate(tx, school.id, ctx.scope, { userId: user.id, roles: user.roles }))) {
        return { ok: false, error: "Only the PTA's Secretary can submit these minutes." };
      }
      const fence = adoptedFenceError(ctx.status);
      if (fence) return { ok: false, error: fence };
      if (ctx.status !== "DRAFT") return { ok: false, error: "These minutes are already with the Chair." };

      const items = await loadValidationInput(tx, school.id, minutesId);
      const v = validateMinutesForReview(items, ctx.scope.quorumMet);
      if (!v.canSubmit) return { ok: false, error: v.blocker ?? "The minutes aren't ready to submit." };

      revalidate = minutesPath(ctx.meetingId);
      await tx
        .update(ptaMinutes)
        .set({ status: "CHAIR_REVIEW", updatedAt: new Date() })
        .where(and(eq(ptaMinutes.schoolId, school.id), eq(ptaMinutes.id, minutesId)));
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "updated",
        entityType: "pta_minutes",
        entityId: minutesId,
        before: { status: "DRAFT" },
        after: { status: "CHAIR_REVIEW" },
        reason: "PTA minutes submitted for Chair review",
      });
      return { ok: true, minutesId };
    });
    if (res.ok && revalidate) safeRevalidate(revalidate);
    return res;
  } catch {
    return { ok: false, error: "Could not submit the minutes." };
  }
}

// ── 6) returnToDraft — CHAIR_REVIEW → DRAFT (Chair) ──────────────────────────────────────────────────

export async function returnToDraft(input: unknown): Promise<Result> {
  const parsed = IdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Missing the minutes." };
  const { minutesId } = parsed.data;
  const { school, user } = await requireSchool();
  const actor = await resolveActor(school.id);
  let revalidate: string | null = null;
  try {
    const res = await withSchool(school.id, async (tx): Promise<Result> => {
      const ctx = await loadMinutesForWrite(tx, school.id, minutesId);
      if (!ctx) return { ok: false, error: "Those minutes no longer exist." };
      if (!(await resolvePtaChairAccess(tx, school.id, ctx.scope.ptaId, { userId: user.id, roles: user.roles }))) {
        return { ok: false, error: "Only the PTA Chair can return these minutes to the Secretary." };
      }
      const fence = adoptedFenceError(ctx.status);
      if (fence) return { ok: false, error: fence };
      if (ctx.status !== "CHAIR_REVIEW") return { ok: false, error: "Only minutes in Chair review can be returned to draft." };

      revalidate = minutesPath(ctx.meetingId);
      await tx
        .update(ptaMinutes)
        .set({ status: "DRAFT", updatedAt: new Date() })
        .where(and(eq(ptaMinutes.schoolId, school.id), eq(ptaMinutes.id, minutesId)));
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "updated",
        entityType: "pta_minutes",
        entityId: minutesId,
        before: { status: "CHAIR_REVIEW" },
        after: { status: "DRAFT" },
        reason: "PTA minutes returned to the Secretary",
      });
      return { ok: true, minutesId };
    });
    if (res.ok && revalidate) safeRevalidate(revalidate);
    return res;
  } catch {
    return { ok: false, error: "Could not return the minutes to draft." };
  }
}

// ── 7) adoptMinutes — write-locked + Chair; stamps + assigns resolution numbers (R453) ───────────────

export async function adoptMinutes(input: unknown): Promise<Result> {
  const parsed = IdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Missing the minutes." };
  const { minutesId } = parsed.data;
  const { school, user } = await requireSchool();
  const actor = await resolveActor(school.id);
  const now = new Date();
  let revalidate: string | null = null;
  try {
    const res = await withSchool(school.id, async (tx): Promise<Result> => {
      const ctx = await loadMinutesForWrite(tx, school.id, minutesId);
      if (!ctx) return { ok: false, error: "Those minutes no longer exist." };
      if (!(await resolvePtaChairAccess(tx, school.id, ctx.scope.ptaId, { userId: user.id, roles: user.roles }))) {
        return { ok: false, error: "Only the PTA Chair can adopt these minutes." };
      }
      if (ctx.status === "ADOPTED") return { ok: false, error: "These minutes are already adopted." };
      if (ctx.status !== "CHAIR_REVIEW") return { ok: false, error: "Submit these minutes for Chair review first." };
      const grace = coalesceGraceHours(ctx.scope.tierSettings);
      if (!isPtaMeetingWriteLocked(ctx.scope.meetingDate, ctx.scope.endTime, grace, now)) {
        return { ok: false, error: "You can adopt these minutes once the meeting register has locked." };
      }
      // Defensive re-validation (quorum could have been cleared between submit and adopt).
      const items = await loadValidationInput(tx, school.id, minutesId);
      const v = validateMinutesForReview(items, ctx.scope.quorumMet);
      if (!v.canSubmit) return { ok: false, error: v.blocker ?? "The minutes aren't ready to adopt." };

      revalidate = minutesPath(ctx.meetingId);

      // Assign resolution numbers (R453) — NNN = MAX+1 over adopted resolutions of this (pta × period),
      // in agenda-seq order, under the UNIQUE(school_id, resolution_no) guard.
      const [period] = await tx
        .select({ label: academicPeriod.periodLabel })
        .from(academicPeriod)
        .where(and(eq(academicPeriod.schoolId, school.id), eq(academicPeriod.periodId, ctx.scope.academicPeriodId)))
        .limit(1);
      const scopeTok = resolutionScopeToken(ctx.scope.tierType, ctx.scope.className, ctx.scope.houseName, ctx.scope.ptaId);
      const periodTok = slugToken(period?.label ?? "");
      const seqStart = await loadResolutionSeqStart(tx, school.id, ctx.scope.ptaId, ctx.scope.academicPeriodId);

      const resolutions = await tx
        .select({ id: ptaResolution.id })
        .from(ptaResolution)
        .innerJoin(ptaAgendaItem, and(eq(ptaAgendaItem.schoolId, ptaResolution.schoolId), eq(ptaAgendaItem.id, ptaResolution.agendaItemId)))
        .where(and(eq(ptaResolution.schoolId, school.id), eq(ptaAgendaItem.minutesId, minutesId)))
        .orderBy(asc(ptaAgendaItem.seqNo), asc(ptaResolution.createdAt));

      const assigned: string[] = [];
      for (let i = 0; i < resolutions.length; i++) {
        const no = formatResolutionNo(scopeTok, periodTok, seqStart + i);
        await tx
          .update(ptaResolution)
          .set({ resolutionNo: no, updatedAt: new Date() })
          .where(and(eq(ptaResolution.schoolId, school.id), eq(ptaResolution.id, resolutions[i].id)));
        assigned.push(no);
        await recordAudit(tx, {
          schoolId: school.id,
          actorUserId: actor.id ?? undefined,
          actorRole: actor.role,
          actionType: "updated",
          entityType: "pta_resolution",
          entityId: resolutions[i].id,
          after: { resolutionNo: no },
          reason: "PTA resolution number assigned at adoption",
        });
      }

      await tx
        .update(ptaMinutes)
        .set({ status: "ADOPTED", adoptedAt: now, adoptedByUserId: actor.id ?? undefined, updatedAt: now })
        .where(and(eq(ptaMinutes.schoolId, school.id), eq(ptaMinutes.id, minutesId)));
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "updated",
        entityType: "pta_minutes",
        entityId: minutesId,
        before: { status: "CHAIR_REVIEW" },
        after: { status: "ADOPTED", resolutionNos: assigned },
        reason: "PTA minutes adopted",
      });
      return { ok: true, minutesId };
    });
    if (res.ok && revalidate) safeRevalidate(revalidate);
    return res;
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: "A resolution number clashed — reload and try again." };
    return { ok: false, error: "Could not adopt the minutes." };
  }
}

// ── 8) markDistributed — adopted-only; stamps distributed_at (NO sends, R458) ────────────────────────

export async function markDistributed(input: unknown): Promise<Result> {
  const parsed = IdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Missing the minutes." };
  const { minutesId } = parsed.data;
  const { school, user } = await requireSchool();
  const actor = await resolveActor(school.id);
  let revalidate: string | null = null;
  try {
    const res = await withSchool(school.id, async (tx): Promise<Result> => {
      const ctx = await loadMinutesForWrite(tx, school.id, minutesId);
      if (!ctx) return { ok: false, error: "Those minutes no longer exist." };
      if (!(await draftGate(tx, school.id, ctx.scope, { userId: user.id, roles: user.roles }))) {
        return { ok: false, error: "Only the PTA's Secretary can mark these minutes distributed." };
      }
      // R458 — the ONE mutation allowed on an ADOPTED minute (distribution marker only; no immutability fence).
      if (ctx.status !== "ADOPTED") return { ok: false, error: "Only adopted minutes can be distributed." };

      revalidate = minutesPath(ctx.meetingId);
      await tx
        .update(ptaMinutes)
        .set({ distributedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(ptaMinutes.schoolId, school.id), eq(ptaMinutes.id, minutesId)));
      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "updated",
        entityType: "pta_minutes",
        entityId: minutesId,
        after: { distributed: true },
        reason: "PTA minutes marked distributed",
      });
      return { ok: true, minutesId };
    });
    if (res.ok && revalidate) safeRevalidate(revalidate);
    return res;
  } catch {
    return { ok: false, error: "Could not mark the minutes distributed." };
  }
}
