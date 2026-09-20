"use server";
/**
 * PTA officer-matrix mutations (SHS module 4.7 / INCR-51). Assign · edit · end an officer, plus the
 * person-picker search. Every write re-checks PTA_CONFIG_WRITE_ROLES (ADMIN / HEADMASTER, R427 — matrix
 * MANAGEMENT reuses the config gate; read == manage, admin-only) BEFORE any DB work, so a hand-crafted
 * POST that never touched the admin-only UI is still refused. Each write records ONE audit_log row with
 * the verbatim SHOWN entityType `pta_officer`.
 *
 * Scope fence (R430): officer matrix ONLY. The spine (`ptas`, `officer_roles`, `tier_settings`) is read
 * with-coalesce and never written. `canActAsPtaOfficer` is INERT here (matrix management is the config
 * gate, not the identity-gate — that arm lands in 52/53). SMS-on-assign is DEFERRED (persist the row +
 * audit; NO Hubtel send — stop-and-ask). Validation lives here, never a DB trigger (portability): the
 * office ∈ officer_roles + not-ex-officio guard (R420/R424), the exactly-one-holder rule (R419) and the
 * ELECTED term auto-calc (R422) are all app-layer; the partial-unique / CHECK / RLS layers backstop.
 */
import { and, eq, ilike, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { assertAnyRole, requireSchool, resolveActor } from "@/lib/auth/server";
import { PTA_CONFIG_WRITE_ROLES } from "@/lib/access";
import { safeRevalidate } from "@/lib/revalidate";
import {
  ptaOfficer,
  ptas,
  ptaTiersConfig,
  roleAssignments,
  roles,
  students,
  studentGuardians,
  users,
} from "@/db/schema";
import { coalescePtaTiers, type PtaTierType } from "@/lib/pta/defaults";
import {
  addYearsISO,
  assignmentOfficeError,
  coalesceExOfficio,
  exOfficioSlotOffice,
  holderError,
} from "@/lib/pta/officers";

type Result = { ok: boolean; error?: string };
const OFFICERS_PATH = "/senior/pta/officers";

/** The shared write gate — re-checked on EVERY officer action before a single row is touched (R427). */
async function authorizePtaOfficerWrite(): Promise<{
  schoolId: string;
  actor: { id: string | null; role: string };
}> {
  const { school } = await requireSchool();
  await assertAnyRole(PTA_CONFIG_WRITE_ROLES);
  const actor = await resolveActor(school.id);
  return { schoolId: school.id, actor };
}

const TIER_COLS = {
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
} as const;

// ---------------------------------------------------------------------------
// 1) Assign an officer (insert a current row) — SMS DEFERRED (persist only).
// ---------------------------------------------------------------------------
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const AssignSchema = z.object({
  ptaId: z.string().uuid(),
  office: z.string().trim().min(1).max(80),
  personUserId: z.string().uuid().nullish(),
  externalName: z.string().trim().max(120).nullish(),
  assignmentBasis: z.enum(["ELECTED", "APPOINTED"]),
  // R423 — mandatory free-text audit of how appointed.
  electionRef: z.string().trim().min(1, "An election / appointment reference is required.").max(300),
  termStart: z.string().regex(ISO_DATE, "Pick a term start date."),
  // APPOINTED may override the end date; ELECTED ignores it (auto-calc from officer_term_years).
  termEnd: z.string().regex(ISO_DATE).nullish(),
});

export async function assignPtaOfficer(input: unknown): Promise<Result> {
  const gate = await authorizePtaOfficerWrite();
  const parsed = AssignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the assignment." };
  const d = parsed.data;

  // R419 — exactly one holder (a person XOR an external name). App-side; the DB CHECK is at-most-one.
  const he = holderError(d.personUserId, d.externalName);
  if (he) return { ok: false, error: he };

  try {
    return await withSchool(gate.schoolId, async (tx) => {
      const [pta] = await tx
        .select({ id: ptas.id, tierType: ptas.tierType, status: ptas.status })
        .from(ptas)
        .where(and(eq(ptas.schoolId, gate.schoolId), eq(ptas.id, d.ptaId)))
        .limit(1);
      if (!pta) return { ok: false, error: "That PTA no longer exists." };
      if (pta.status !== "ACTIVE") return { ok: false, error: "That PTA is closed." };
      const tt = pta.tierType as PtaTierType;

      const tierRows = await tx.select(TIER_COLS).from(ptaTiersConfig).where(eq(ptaTiersConfig.schoolId, gate.schoolId));
      const tier = coalescePtaTiers(tierRows).find((t) => t.tierType === tt)!;
      const exSlot = exOfficioSlotOffice(tt, tier.tierSettings);

      // R420/R424 — office ∈ officer_roles AND not the ex-officio slot (Secretary is derived).
      const oe = assignmentOfficeError({ office: d.office, officerRoles: tier.officerRoles, exOfficioSlot: exSlot });
      if (oe) return { ok: false, error: oe };

      // R421 — one CURRENT holder per office (the partial-unique backstops a race; this is the friendly path).
      const [held] = await tx
        .select({ id: ptaOfficer.id })
        .from(ptaOfficer)
        .where(and(eq(ptaOfficer.schoolId, gate.schoolId), eq(ptaOfficer.ptaId, d.ptaId), eq(ptaOfficer.office, d.office), isNull(ptaOfficer.endedAt)))
        .limit(1);
      if (held) return { ok: false, error: "That office already has a current holder — end them first." };

      // R422 — ELECTED auto-calcs term_end from officer_term_years (coalesce 2); APPOINTED uses the override.
      const termYears = coalesceExOfficio(tier.tierSettings).officerTermYears;
      const termEnd = d.assignmentBasis === "ELECTED" ? addYearsISO(d.termStart, termYears) : d.termEnd ?? null;

      const personUserId = d.personUserId ?? null;
      const externalName = personUserId ? null : (d.externalName?.trim() || null);

      const [row] = await tx
        .insert(ptaOfficer)
        .values({
          schoolId: gate.schoolId,
          ptaId: d.ptaId,
          office: d.office,
          personUserId,
          externalName,
          assignmentBasis: d.assignmentBasis,
          electionRef: d.electionRef,
          termStart: d.termStart,
          termEnd,
        })
        .returning({ id: ptaOfficer.id });

      await recordAudit(tx, {
        schoolId: gate.schoolId,
        actorUserId: gate.actor.id ?? undefined,
        actorRole: gate.actor.role,
        actionType: "created",
        entityType: "pta_officer",
        entityId: row.id,
        after: {
          ptaId: d.ptaId,
          office: d.office,
          personUserId,
          externalName,
          assignmentBasis: d.assignmentBasis,
          electionRef: d.electionRef,
          termStart: d.termStart,
          termEnd,
        },
        reason: `PTA officer assigned · ${d.office} · ${d.assignmentBasis}`,
      });
      safeRevalidate(OFFICERS_PATH);
      return { ok: true };
    });
  } catch {
    return { ok: false, error: "Could not assign the officer." };
  }
}

// ---------------------------------------------------------------------------
// 2) Edit a current officer's term / reference / basis (holder change = end + assign).
// ---------------------------------------------------------------------------
const EditSchema = z.object({
  officerId: z.string().uuid(),
  assignmentBasis: z.enum(["ELECTED", "APPOINTED"]),
  electionRef: z.string().trim().min(1, "An election / appointment reference is required.").max(300),
  termStart: z.string().regex(ISO_DATE, "Pick a term start date."),
  termEnd: z.string().regex(ISO_DATE).nullish(),
});

export async function editPtaOfficer(input: unknown): Promise<Result> {
  const gate = await authorizePtaOfficerWrite();
  const parsed = EditSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the changes." };
  const d = parsed.data;

  try {
    return await withSchool(gate.schoolId, async (tx) => {
      const [before] = await tx
        .select({
          office: ptaOfficer.office,
          assignmentBasis: ptaOfficer.assignmentBasis,
          electionRef: ptaOfficer.electionRef,
          termStart: ptaOfficer.termStart,
          termEnd: ptaOfficer.termEnd,
        })
        .from(ptaOfficer)
        .where(and(eq(ptaOfficer.schoolId, gate.schoolId), eq(ptaOfficer.id, d.officerId), isNull(ptaOfficer.endedAt)))
        .limit(1);
      if (!before) return { ok: false, error: "That officer is no longer current." };

      await tx
        .update(ptaOfficer)
        .set({
          assignmentBasis: d.assignmentBasis,
          electionRef: d.electionRef,
          termStart: d.termStart,
          termEnd: d.termEnd ?? null,
          updatedAt: new Date(),
        })
        .where(and(eq(ptaOfficer.schoolId, gate.schoolId), eq(ptaOfficer.id, d.officerId)));

      await recordAudit(tx, {
        schoolId: gate.schoolId,
        actorUserId: gate.actor.id ?? undefined,
        actorRole: gate.actor.role,
        actionType: "updated",
        entityType: "pta_officer",
        entityId: d.officerId,
        before,
        after: { office: before.office, assignmentBasis: d.assignmentBasis, electionRef: d.electionRef, termStart: d.termStart, termEnd: d.termEnd ?? null },
        reason: `PTA officer term edited · ${before.office}`,
      });
      safeRevalidate(OFFICERS_PATH);
      return { ok: true };
    });
  } catch {
    return { ok: false, error: "Could not save the changes." };
  }
}

// ---------------------------------------------------------------------------
// 3) End an appointment — soft-end (ended_at + mandatory end_reason; the row is retained as history).
// ---------------------------------------------------------------------------
const EndSchema = z.object({
  officerId: z.string().uuid(),
  endReason: z.string().trim().min(1, "A reason is required to end an appointment.").max(300),
});

export async function endPtaOfficer(input: unknown): Promise<Result> {
  const gate = await authorizePtaOfficerWrite();
  const parsed = EndSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the details." };
  const d = parsed.data;

  try {
    return await withSchool(gate.schoolId, async (tx) => {
      const [before] = await tx
        .select({ office: ptaOfficer.office, ptaId: ptaOfficer.ptaId })
        .from(ptaOfficer)
        .where(and(eq(ptaOfficer.schoolId, gate.schoolId), eq(ptaOfficer.id, d.officerId), isNull(ptaOfficer.endedAt)))
        .limit(1);
      if (!before) return { ok: false, error: "That officer is already ended." };

      await tx
        .update(ptaOfficer)
        .set({ endedAt: new Date(), endReason: d.endReason, updatedAt: new Date() })
        .where(and(eq(ptaOfficer.schoolId, gate.schoolId), eq(ptaOfficer.id, d.officerId), isNull(ptaOfficer.endedAt)));

      await recordAudit(tx, {
        schoolId: gate.schoolId,
        actorUserId: gate.actor.id ?? undefined,
        actorRole: gate.actor.role,
        actionType: "ended",
        entityType: "pta_officer",
        entityId: d.officerId,
        after: { office: before.office, ptaId: before.ptaId, endReason: d.endReason },
        reason: `PTA officer ended · ${before.office} · ${d.endReason}`,
      });
      safeRevalidate(OFFICERS_PATH);
      return { ok: true };
    });
  } catch {
    return { ok: false, error: "Could not end the appointment." };
  }
}

// ---------------------------------------------------------------------------
// 4) Person-picker search — parents of the PTA's scope first, then staff (external is free-text, no search).
// ---------------------------------------------------------------------------
export interface OfficerCandidate {
  userId: string;
  name: string;
  personType: "parent" | "staff";
  context: string; // "Parent · Form 1 GS B" / "Staff · Teacher"
  existingHats: number;
}

const SearchSchema = z.object({ ptaId: z.string().uuid(), query: z.string().trim().max(80) });

export async function searchPtaOfficerCandidates(input: unknown): Promise<OfficerCandidate[]> {
  await authorizePtaOfficerWrite();
  const { school } = await requireSchool();
  const parsed = SearchSchema.safeParse(input);
  if (!parsed.success) return [];
  const { ptaId, query } = parsed.data;
  const like = `%${query.replace(/[%_]/g, (c) => `\\${c}`)}%`;

  return withSchool(school.id, async (tx) => {
    const [pta] = await tx
      .select({ tierType: ptas.tierType, classId: ptas.classId, houseId: ptas.houseId })
      .from(ptas)
      .where(and(eq(ptas.schoolId, school.id), eq(ptas.id, ptaId)))
      .limit(1);
    if (!pta) return [];

    // Guardians (portal-linked only — person_user_id must be a ref_user), scope-first.
    const scopeStudent =
      pta.tierType === "FORM" && pta.classId
        ? eq(students.classId, pta.classId)
        : pta.tierType === "HOUSE" && pta.houseId
          ? eq(students.houseId, pta.houseId)
          : null;

    const guardianRows = await tx
      .selectDistinct({ userId: studentGuardians.userId, name: studentGuardians.name })
      .from(studentGuardians)
      .innerJoin(students, and(eq(studentGuardians.schoolId, students.schoolId), eq(studentGuardians.studentId, students.id)))
      .where(
        and(
          eq(studentGuardians.schoolId, school.id),
          sql`${studentGuardians.userId} IS NOT NULL`,
          ilike(studentGuardians.name, like),
          scopeStudent ?? undefined,
        ),
      )
      .limit(10);

    // Staff (any active non parent/student role).
    const staffRows = await tx
      .selectDistinct({ userId: users.id, name: users.fullName, code: roles.label })
      .from(roleAssignments)
      .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
      .innerJoin(users, eq(roleAssignments.userId, users.id))
      .where(
        and(
          eq(roleAssignments.schoolId, school.id),
          isNull(roleAssignments.endDate),
          ne(roles.code, "PARENT"),
          ne(roles.code, "STUDENT"),
          ilike(users.fullName, like),
        ),
      )
      .limit(10);

    const candidates: OfficerCandidate[] = [];
    for (const g of guardianRows) {
      if (!g.userId) continue;
      candidates.push({ userId: g.userId, name: g.name, personType: "parent", context: `Parent · ${scopeLabel(pta.tierType)}`, existingHats: 0 });
    }
    for (const s of staffRows) {
      candidates.push({ userId: s.userId, name: s.name ?? "Staff member", personType: "staff", context: `Staff · ${s.code ?? "Staff"}`, existingHats: 0 });
    }

    // Annotate each candidate with the number of current officer hats they already hold (school-wide).
    const ids = [...new Set(candidates.map((c) => c.userId))];
    if (ids.length > 0) {
      const hats = await tx
        .select({ userId: ptaOfficer.personUserId, n: sql<number>`count(*)::int` })
        .from(ptaOfficer)
        .where(and(eq(ptaOfficer.schoolId, school.id), isNull(ptaOfficer.endedAt), inArray(ptaOfficer.personUserId, ids)))
        .groupBy(ptaOfficer.personUserId);
      const byUser = new Map(hats.map((h) => [h.userId, h.n]));
      for (const c of candidates) c.existingHats = byUser.get(c.userId) ?? 0;
    }

    // De-dupe (a staff member who is also a linked guardian) — keep the parent framing first.
    const seen = new Set<string>();
    return candidates.filter((c) => (seen.has(c.userId) ? false : (seen.add(c.userId), true))).slice(0, 12);
  });
}

function scopeLabel(tierType: string): string {
  return tierType === "FORM" ? "class parent" : tierType === "HOUSE" ? "House parent" : "school parent";
}
