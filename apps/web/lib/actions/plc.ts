"use server";
/**
 * PLC setup mutations (SHS module 4.6 / INCR-47 · the config spine).
 *
 * Every mutation is gated server-side to PLC_CONFIG_WRITE_ROLES (PD_COORDINATOR / ADMIN / HEADMASTER)
 * — the UI hides the controls for a read-only staffer, but this server re-check is the real boundary
 * (a hand-crafted POST that never touched the UI is still refused). Each writes ONE audit_log row with
 * a before→after snapshot; entityType is exactly one of the four SHOWN strings plc_programme / plc /
 * plc_membership / plc_term_focus (attendees are STAFF — no pastoral PII, no REDACTED family).
 *
 * Config only. NO session / attendance / reflection / ledger / NTC write path (scope fence R380 — those
 * are INCR-48/49). Validation lives here, never a DB trigger (portability).
 */
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { assertAnyRole, requireSchool, resolveActor } from "@/lib/auth/server";
import { PLC_CONFIG_WRITE_ROLES } from "@/lib/access";
import { getCurrentPeriod } from "@/lib/boarding/period";
import { safeRevalidate } from "@/lib/revalidate";
import { plc, plcMembership, plcProgramme, plcTermFocus } from "@/db/schema";
import type { Tx } from "@/lib/db";

type Result = { ok: boolean; error?: string };
const SETUP_PATH = "/senior/plc/setup";
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * The shared write gate — re-checked on EVERY action, so a read-only staffer or any other role is
 * refused before a single row is touched. `assertAnyRole` throws on a failed check.
 */
async function authorizePlcWrite(): Promise<{
  schoolId: string;
  actor: { id: string | null; role: string };
}> {
  const { school } = await requireSchool();
  await assertAnyRole(PLC_CONFIG_WRITE_ROLES);
  const actor = await resolveActor(school.id);
  return { schoolId: school.id, actor };
}

/**
 * Auto-ensure an ACTIVE membership row for a user (R374): a re-join upserts the SAME
 * (school, plc, user) row — left_at toggles, one row per triple ever. Returns whether it opened/reopened.
 */
async function ensureMembership(
  tx: Tx,
  schoolId: string,
  plcId: string,
  userId: string,
): Promise<{ opened: boolean }> {
  const [existing] = await tx
    .select({ id: plcMembership.id, leftAt: plcMembership.leftAt })
    .from(plcMembership)
    .where(
      and(
        eq(plcMembership.schoolId, schoolId),
        eq(plcMembership.plcId, plcId),
        eq(plcMembership.userId, userId),
      ),
    )
    .limit(1);
  if (!existing) {
    await tx.insert(plcMembership).values({ schoolId, plcId, userId });
    return { opened: true };
  }
  if (existing.leftAt) {
    await tx
      .update(plcMembership)
      .set({ leftAt: null, joinedAt: new Date() })
      .where(eq(plcMembership.id, existing.id));
    return { opened: true };
  }
  return { opened: false };
}

// ---- 1) Programme cadence — day + start + length + weeks (singleton upsert) ----

const CadenceSchema = z.object({
  sessionDay: z.coerce.number().int().min(1).max(7),
  sessionStart: z.string().regex(HHMM, "Start time must be HH:MM."),
  sessionLengthMin: z.coerce.number().int().min(1).max(600),
  weeksPerSemester: z.coerce.number().int().min(1).max(60),
});

export async function updatePlcCadence(input: unknown): Promise<Result> {
  const gate = await authorizePlcWrite();
  const parsed = CadenceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the cadence details." };
  }
  const d = parsed.data;
  try {
    await withSchool(gate.schoolId, async (tx) => {
      const [before] = await tx
        .select({
          sessionDay: plcProgramme.sessionDay,
          sessionStart: plcProgramme.sessionStart,
          sessionLengthMin: plcProgramme.sessionLengthMin,
          weeksPerSemester: plcProgramme.weeksPerSemester,
        })
        .from(plcProgramme)
        .where(eq(plcProgramme.schoolId, gate.schoolId))
        .limit(1);
      await tx
        .insert(plcProgramme)
        .values({ schoolId: gate.schoolId, ...d, configuredAt: new Date(), updatedAt: new Date() })
        // configured_at is deliberately NOT in the update set — first save stamps it, later saves keep it.
        .onConflictDoUpdate({ target: plcProgramme.schoolId, set: { ...d, updatedAt: new Date() } });
      await recordAudit(tx, {
        schoolId: gate.schoolId,
        actorUserId: gate.actor.id ?? undefined,
        actorRole: gate.actor.role,
        actionType: before ? "updated" : "created",
        entityType: "plc_programme",
        entityId: gate.schoolId,
        before: before ?? null,
        after: d,
        reason: "PLC programme cadence updated",
      });
    });
    safeRevalidate(SETUP_PATH);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not save the cadence." };
  }
}

// ---- 2) CPD contract — the 4 editable scalars (singleton upsert) ----

const ContractSchema = z.object({
  ptsPerAttendedSession: z.coerce.number().min(0).max(10),
  ptsPerReflection: z.coerce.number().min(0).max(10),
  reflectionWindowHours: z.coerce.number().int().min(1).max(336),
  annualPlcTarget: z.coerce.number().min(0).max(100),
});

export async function updatePlcContract(input: unknown): Promise<Result> {
  const gate = await authorizePlcWrite();
  const parsed = ContractSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the CPD contract." };
  }
  const d = parsed.data;
  // numeric() columns take strings; ints stay numbers.
  const set = {
    ptsPerAttendedSession: String(d.ptsPerAttendedSession),
    ptsPerReflection: String(d.ptsPerReflection),
    reflectionWindowHours: d.reflectionWindowHours,
    annualPlcTarget: String(d.annualPlcTarget),
  };
  try {
    await withSchool(gate.schoolId, async (tx) => {
      const [before] = await tx
        .select({
          ptsPerAttendedSession: plcProgramme.ptsPerAttendedSession,
          ptsPerReflection: plcProgramme.ptsPerReflection,
          reflectionWindowHours: plcProgramme.reflectionWindowHours,
          annualPlcTarget: plcProgramme.annualPlcTarget,
        })
        .from(plcProgramme)
        .where(eq(plcProgramme.schoolId, gate.schoolId))
        .limit(1);
      await tx
        .insert(plcProgramme)
        .values({ schoolId: gate.schoolId, ...set, configuredAt: new Date(), updatedAt: new Date() })
        .onConflictDoUpdate({ target: plcProgramme.schoolId, set: { ...set, updatedAt: new Date() } });
      await recordAudit(tx, {
        schoolId: gate.schoolId,
        actorUserId: gate.actor.id ?? undefined,
        actorRole: gate.actor.role,
        actionType: before ? "updated" : "created",
        entityType: "plc_programme",
        entityId: gate.schoolId,
        before: before ?? null,
        after: set,
        reason: "PLC CPD contract updated",
      });
    });
    safeRevalidate(SETUP_PATH);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not save the CPD contract." };
  }
}

// ---- 3) Create a PLC (type/name/facilitator/members/optional focus/optional override) ----

const OverrideSchema = z
  .object({
    overrideFrequency: z.enum(["WEEKLY", "BIWEEKLY"]).nullish(),
    overrideSessionDay: z.coerce.number().int().min(1).max(7).nullish(),
  })
  .transform((o) => ({
    overrideFrequency: o.overrideFrequency ?? null,
    // A day without a frequency is meaningless (null = inherit); drop it.
    overrideSessionDay: o.overrideFrequency ? (o.overrideSessionDay ?? null) : null,
  }));

const CreatePlcSchema = z.object({
  type: z.enum(["subject", "cross-cutting", "new-teacher"]),
  name: z.string().trim().min(1, "The PLC needs a name.").max(120),
  facilitatorUserId: z.string().uuid().nullish(),
  memberUserIds: z.array(z.string().uuid()).max(200).optional().default([]),
  focus: z.string().trim().max(500).nullish(),
  overrideFrequency: z.enum(["WEEKLY", "BIWEEKLY"]).nullish(),
  overrideSessionDay: z.coerce.number().int().min(1).max(7).nullish(),
});

export async function createPlc(input: unknown): Promise<Result> {
  const gate = await authorizePlcWrite();
  const parsed = CreatePlcSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the PLC details." };
  }
  const d = parsed.data;
  const override = OverrideSchema.parse({
    overrideFrequency: d.overrideFrequency,
    overrideSessionDay: d.overrideSessionDay,
  });
  const facilitatorUserId = d.facilitatorUserId ?? null;
  const focus = d.focus?.trim() || null;
  try {
    await withSchool(gate.schoolId, async (tx) => {
      const [row] = await tx
        .insert(plc)
        .values({
          schoolId: gate.schoolId,
          type: d.type,
          name: d.name,
          facilitatorUserId,
          overrideFrequency: override.overrideFrequency,
          overrideSessionDay: override.overrideSessionDay,
        })
        .returning({ id: plc.id });
      const plcId = row.id;

      // Open a membership row per member; the facilitator ALWAYS holds an active membership (R374).
      const memberSet = new Set(d.memberUserIds);
      if (facilitatorUserId) memberSet.add(facilitatorUserId);
      for (const userId of memberSet) await ensureMembership(tx, gate.schoolId, plcId, userId);

      if (focus) {
        const period = await getCurrentPeriod(tx, gate.schoolId);
        if (period) {
          await tx.insert(plcTermFocus).values({
            schoolId: gate.schoolId,
            plcId,
            academicPeriodId: period.periodId,
            focus,
            setByUserId: gate.actor.id ?? undefined,
          });
        }
      }

      await recordAudit(tx, {
        schoolId: gate.schoolId,
        actorUserId: gate.actor.id ?? undefined,
        actorRole: gate.actor.role,
        actionType: "created",
        entityType: "plc",
        entityId: plcId,
        after: {
          type: d.type,
          name: d.name,
          facilitatorUserId,
          memberCount: memberSet.size,
          override: override.overrideFrequency,
        },
        reason: `PLC created · ${d.name}`,
      });
    });
    safeRevalidate(SETUP_PATH);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not create the PLC." };
  }
}

// ---- 4) Rename a PLC ----

const RenameSchema = z.object({
  plcId: z.string().uuid(),
  name: z.string().trim().min(1, "The PLC needs a name.").max(120),
});

export async function renamePlc(input: unknown): Promise<Result> {
  const gate = await authorizePlcWrite();
  const parsed = RenameSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the PLC name." };
  }
  const { plcId, name } = parsed.data;
  return mutatePlc(gate, plcId, "PLC renamed", async (tx, before) => {
    await tx
      .update(plc)
      .set({ name, updatedAt: new Date() })
      .where(and(eq(plc.schoolId, gate.schoolId), eq(plc.id, plcId)));
    return { before: { name: before.name }, after: { name } };
  });
}

// ---- 5) Archive a PLC (soft — set archived_at, NEVER delete) ----

const PlcIdSchema = z.object({ plcId: z.string().uuid() });

export async function archivePlc(input: unknown): Promise<Result> {
  const gate = await authorizePlcWrite();
  const parsed = PlcIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That PLC no longer exists." };
  const { plcId } = parsed.data;
  return mutatePlc(gate, plcId, "PLC archived", async (tx) => {
    await tx
      .update(plc)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(plc.schoolId, gate.schoolId), eq(plc.id, plcId)));
    return { before: { archived: false }, after: { archived: true } };
  }, "archived");
}

// ---- 6) Assign / clear the facilitator (auto-ensures their active membership, R374) ----

const FacilitatorSchema = z.object({
  plcId: z.string().uuid(),
  facilitatorUserId: z.string().uuid().nullish(),
});

export async function setPlcFacilitator(input: unknown): Promise<Result> {
  const gate = await authorizePlcWrite();
  const parsed = FacilitatorSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the facilitator." };
  const { plcId } = parsed.data;
  const facilitatorUserId = parsed.data.facilitatorUserId ?? null;
  return mutatePlc(gate, plcId, "PLC facilitator assigned", async (tx, before) => {
    await tx
      .update(plc)
      .set({ facilitatorUserId, updatedAt: new Date() })
      .where(and(eq(plc.schoolId, gate.schoolId), eq(plc.id, plcId)));
    // R374: the facilitator must always hold an active membership.
    if (facilitatorUserId) {
      const { opened } = await ensureMembership(tx, gate.schoolId, plcId, facilitatorUserId);
      if (opened) {
        await recordAudit(tx, {
          schoolId: gate.schoolId,
          actorUserId: gate.actor.id ?? undefined,
          actorRole: gate.actor.role,
          actionType: "created",
          entityType: "plc_membership",
          entityId: plcId,
          after: { userId: facilitatorUserId, via: "facilitator-auto-ensure" },
          reason: "PLC membership opened (facilitator)",
        });
      }
    }
    return {
      before: { facilitatorUserId: before.facilitatorUserId },
      after: { facilitatorUserId },
    };
  });
}

// ---- 7) Add a member (open a membership row) ----

const MemberSchema = z.object({ plcId: z.string().uuid(), userId: z.string().uuid() });

export async function addPlcMember(input: unknown): Promise<Result> {
  const gate = await authorizePlcWrite();
  const parsed = MemberSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the member." };
  const { plcId, userId } = parsed.data;
  try {
    const res = await withSchool(gate.schoolId, async (tx): Promise<Result> => {
      const [row] = await tx
        .select({ id: plc.id })
        .from(plc)
        .where(and(eq(plc.schoolId, gate.schoolId), eq(plc.id, plcId), isNull(plc.archivedAt)))
        .limit(1);
      if (!row) return { ok: false, error: "That PLC no longer exists." };
      const { opened } = await ensureMembership(tx, gate.schoolId, plcId, userId);
      await recordAudit(tx, {
        schoolId: gate.schoolId,
        actorUserId: gate.actor.id ?? undefined,
        actorRole: gate.actor.role,
        actionType: opened ? "created" : "updated",
        entityType: "plc_membership",
        entityId: plcId,
        after: { userId },
        reason: "PLC member added",
      });
      return { ok: true };
    });
    if (!res.ok) return res;
    safeRevalidate(SETUP_PATH);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not add the member." };
  }
}

// ---- 8) Remove a member (close the membership row — never delete) ----

export async function removePlcMember(input: unknown): Promise<Result> {
  const gate = await authorizePlcWrite();
  const parsed = MemberSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the member." };
  const { plcId, userId } = parsed.data;
  try {
    const res = await withSchool(gate.schoolId, async (tx): Promise<Result> => {
      const [p] = await tx
        .select({ facilitatorUserId: plc.facilitatorUserId })
        .from(plc)
        .where(and(eq(plc.schoolId, gate.schoolId), eq(plc.id, plcId)))
        .limit(1);
      if (!p) return { ok: false, error: "That PLC no longer exists." };
      // R374: the facilitator must keep an active membership — reassign first.
      if (p.facilitatorUserId === userId) {
        return { ok: false, error: "Reassign the facilitator before removing them." };
      }
      await tx
        .update(plcMembership)
        .set({ leftAt: new Date() })
        .where(
          and(
            eq(plcMembership.schoolId, gate.schoolId),
            eq(plcMembership.plcId, plcId),
            eq(plcMembership.userId, userId),
            isNull(plcMembership.leftAt),
          ),
        );
      await recordAudit(tx, {
        schoolId: gate.schoolId,
        actorUserId: gate.actor.id ?? undefined,
        actorRole: gate.actor.role,
        actionType: "removed",
        entityType: "plc_membership",
        entityId: plcId,
        before: { userId },
        after: null,
        reason: "PLC member removed",
      });
      return { ok: true };
    });
    if (!res.ok) return res;
    safeRevalidate(SETUP_PATH);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not remove the member." };
  }
}

// ---- 9) Per-PLC cadence override (null = inherit the programme) ----

const CadenceOverrideSchema = z
  .object({
    plcId: z.string().uuid(),
    overrideFrequency: z.enum(["WEEKLY", "BIWEEKLY"]).nullish(),
    overrideSessionDay: z.coerce.number().int().min(1).max(7).nullish(),
  })
  .transform((o) => ({
    plcId: o.plcId,
    overrideFrequency: o.overrideFrequency ?? null,
    overrideSessionDay: o.overrideFrequency ? (o.overrideSessionDay ?? null) : null,
  }));

export async function setPlcCadenceOverride(input: unknown): Promise<Result> {
  const gate = await authorizePlcWrite();
  const parsed = CadenceOverrideSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the cadence override." };
  const { plcId, overrideFrequency, overrideSessionDay } = parsed.data;
  return mutatePlc(gate, plcId, "PLC cadence override set", async (tx, before) => {
    await tx
      .update(plc)
      .set({ overrideFrequency, overrideSessionDay, updatedAt: new Date() })
      .where(and(eq(plc.schoolId, gate.schoolId), eq(plc.id, plcId)));
    return {
      before: {
        overrideFrequency: before.overrideFrequency,
        overrideSessionDay: before.overrideSessionDay,
      },
      after: { overrideFrequency, overrideSessionDay },
    };
  });
}

// ---- 10) Per-PLC term focus (free text, upsert per current academic period) ----

const FocusSchema = z.object({
  plcId: z.string().uuid(),
  focus: z.string().trim().max(500),
});

export async function setPlcTermFocus(input: unknown): Promise<Result> {
  const gate = await authorizePlcWrite();
  const parsed = FocusSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the focus." };
  }
  const { plcId } = parsed.data;
  const focus = parsed.data.focus.trim();
  if (!focus) return { ok: false, error: "The focus can't be empty." };
  try {
    const res = await withSchool(gate.schoolId, async (tx): Promise<Result> => {
      const [p] = await tx
        .select({ id: plc.id })
        .from(plc)
        .where(and(eq(plc.schoolId, gate.schoolId), eq(plc.id, plcId), isNull(plc.archivedAt)))
        .limit(1);
      if (!p) return { ok: false, error: "That PLC no longer exists." };
      const period = await getCurrentPeriod(tx, gate.schoolId);
      if (!period) {
        return { ok: false, error: "Configure the academic calendar before setting a term focus." };
      }
      const [before] = await tx
        .select({ focus: plcTermFocus.focus })
        .from(plcTermFocus)
        .where(
          and(
            eq(plcTermFocus.schoolId, gate.schoolId),
            eq(plcTermFocus.plcId, plcId),
            eq(plcTermFocus.academicPeriodId, period.periodId),
          ),
        )
        .limit(1);
      await tx
        .insert(plcTermFocus)
        .values({
          schoolId: gate.schoolId,
          plcId,
          academicPeriodId: period.periodId,
          focus,
          setByUserId: gate.actor.id ?? undefined,
        })
        .onConflictDoUpdate({
          target: [plcTermFocus.schoolId, plcTermFocus.plcId, plcTermFocus.academicPeriodId],
          set: { focus, setByUserId: gate.actor.id ?? undefined, updatedAt: new Date() },
        });
      await recordAudit(tx, {
        schoolId: gate.schoolId,
        actorUserId: gate.actor.id ?? undefined,
        actorRole: gate.actor.role,
        actionType: before ? "updated" : "created",
        entityType: "plc_term_focus",
        entityId: plcId,
        before: before ?? null,
        after: { focus, periodId: period.periodId },
        reason: `PLC term focus set · ${period.periodLabel}`,
      });
      return { ok: true };
    });
    if (!res.ok) return res;
    safeRevalidate(SETUP_PATH);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not save the focus." };
  }
}

// ---- shared: load a PLC, run a mutation, audit it as `plc` ----

type PlcBefore = {
  name: string;
  facilitatorUserId: string | null;
  overrideFrequency: string | null;
  overrideSessionDay: number | null;
};

async function mutatePlc(
  gate: { schoolId: string; actor: { id: string | null; role: string } },
  plcId: string,
  reason: string,
  fn: (
    tx: Tx,
    before: PlcBefore,
  ) => Promise<{ before: Record<string, unknown>; after: Record<string, unknown> }>,
  actionType: string = "updated",
): Promise<Result> {
  try {
    const res = await withSchool(gate.schoolId, async (tx): Promise<Result> => {
      const [before] = await tx
        .select({
          name: plc.name,
          facilitatorUserId: plc.facilitatorUserId,
          overrideFrequency: plc.overrideFrequency,
          overrideSessionDay: plc.overrideSessionDay,
        })
        .from(plc)
        .where(and(eq(plc.schoolId, gate.schoolId), eq(plc.id, plcId), isNull(plc.archivedAt)))
        .limit(1);
      if (!before) return { ok: false, error: "That PLC no longer exists." };
      const diff = await fn(tx, before);
      await recordAudit(tx, {
        schoolId: gate.schoolId,
        actorUserId: gate.actor.id ?? undefined,
        actorRole: gate.actor.role,
        actionType,
        entityType: "plc",
        entityId: plcId,
        before: diff.before,
        after: diff.after,
        reason,
      });
      return { ok: true };
    });
    if (!res.ok) return res;
    safeRevalidate(SETUP_PATH);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not update the PLC." };
  }
}
