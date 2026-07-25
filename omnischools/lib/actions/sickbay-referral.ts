"use server";
/**
 * Sickbay REFERRAL write path (SHS module 4.4 / INCR-25b · referral-log §01/§02 + today §04).
 *
 * Mirrors lib/actions/sickbay-visit.ts EXACTLY: `authorizeClinicalWrite()` is the FIRST statement of
 * every mutation, then a Zod parse, then a `withSchool` transaction with `recordAudit` inside the same
 * tx, and every id is re-resolved server-side (a client id is never trusted). No trigger, no derived
 * state column — every rule that spans rows lives in lib/sickbay/{referrals,medical-hold}.ts and is
 * unit-tested there; this file fetches rows, calls those, and writes.
 *
 * 🔴 Authz (R195). Clinical WRITE = SICKBAY_CLINICAL_WRITE_ROLES = [MATRON] — NOT ADMIN, NOT
 * HEADMASTER. A hand-crafted POST from either is refused here, before any query runs.
 *
 * 🔴 R184 — the NHIS SNAPSHOT: `recordReferral` COPIES `nhis_card_number` + `nhis_valid` off the live
 * `student_nhis_card` at creation and never live-reads it again (a renewal must not retro-cover a past
 * ER visit). 🔴 R191 — the HM co-sign is a REAL role check (`holdsSchoolRole(HEADMASTER)`), the app-
 * layer tenancy guard on the global ref_user pointer. 🔴 Every audit snapshot MASKS/OMITS PII (the
 * feed is ADMIN-readable): no diagnosis, no full NHIS number, no menses note, no cost item label
 * reaches `before`/`after` (the 25a `maskNhisCard` precedent).
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withSchool } from "@/lib/db/rls";
import type { Tx } from "@/lib/db";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { getCurrentUser } from "@/lib/auth";
import { hasAnyRole, SICKBAY_CLINICAL_WRITE_ROLES } from "@/lib/access";
import { safeRevalidate } from "@/lib/revalidate";
import {
  sickbayReferral,
  sickbayReferralCostLine,
  sickbayReferralUpdate,
  sickbayHospital,
  sickbayVisit,
  studentNhisCard,
} from "@/db/schema";
import { holdsSchoolRole } from "@/lib/sickbay/clinician";
import { maskNhisCard } from "@/lib/sickbay/nhis";
import {
  snapshotNhis,
  transitionGuard,
  voidReferralGuard,
  type ReferralStatus,
} from "@/lib/sickbay/referrals";

type Result = { ok: boolean; error?: string; id?: string };
const LIST_PATH = "/senior/sickbay/referrals";
const TODAY_PATH = "/senior/sickbay/today";
const refPath = (id: string) => `/senior/sickbay/referrals/${id}`;

async function authorizeClinicalWrite(): Promise<
  { ok: true; schoolId: string; actor: { id: string | null; role: string } } | { ok: false; error: string }
> {
  const { school } = await requireSchool();
  const user = await getCurrentUser();
  if (!user || !hasAnyRole(user.roles, SICKBAY_CLINICAL_WRITE_ROLES)) {
    return { ok: false, error: "Only the Matron can record a referral." };
  }
  const actor = await resolveActor(school.id);
  return { ok: true, schoolId: school.id, actor };
}

const audit = (
  tx: Tx,
  schoolId: string,
  actor: { id: string | null; role: string },
  entry: { actionType: string; entityType: string; entityId: string; before?: unknown; after?: unknown; reason: string },
) => recordAudit(tx, { schoolId, actorUserId: actor.id ?? undefined, actorRole: actor.role, ...entry });

async function loadReferral(tx: Tx, schoolId: string, referralId: string) {
  const [r] = await tx
    .select()
    .from(sickbayReferral)
    .where(and(eq(sickbayReferral.schoolId, schoolId), eq(sickbayReferral.id, referralId)))
    .limit(1);
  return r ?? null;
}

class NamedError extends Error {}

// ============================================================================
// W1 — Record referral OUT (R187, R184, R191)
// ============================================================================

const CreateSchema = z.object({
  visitId: z.string().uuid(),
  hospitalId: z.string().uuid(),
  // R191 — the HM co-sign is required for an off-site referral; the app checks the role.
  hmAuthorisedByUserId: z.string().uuid(),
  accompaniedByUserId: z.string().uuid().nullish(),
  transportMode: z.string().trim().max(60).nullish(),
  hospitalWard: z.string().trim().max(120).nullish(),
  hospitalBed: z.string().trim().max(60).nullish(),
  attendingClinicianName: z.string().trim().max(160).nullish(),
  expectedReturnAt: z.coerce.date().nullish(),
  // FROZEN write-once ER handoff (R187). `reasonReferredOut` is the one REQUIRED field.
  reasonReferredOut: z.string().trim().min(1).max(4000),
  preReferralCare: z.string().trim().max(4000).nullish(),
  handoffLabs: z.string().trim().max(4000).nullish(),
  lastMeal: z.string().trim().max(2000).nullish(),
  mensesNote: z.string().trim().max(2000).nullish(),
  travelNote: z.string().trim().max(2000).nullish(),
});

export async function recordReferral(input: unknown): Promise<Result> {
  const auth = await authorizeClinicalWrite();
  if (!auth.ok) return auth;
  const parsed = CreateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Record the reason for referral to log it." };
  const d = parsed.data;

  // R191 — the co-signer MUST hold HEADMASTER in this school (app-layer; the DB cannot check role on a
  // global ref_user pointer). Checked BEFORE the write.
  if (!(await holdsSchoolRole(auth.schoolId, d.hmAuthorisedByUserId, "HEADMASTER"))) {
    return { ok: false, error: "The authorising co-signer must be the Headmaster of this school." };
  }

  try {
    const id = await withSchool(auth.schoolId, async (tx) => {
      // Re-resolve the visit server-side: a REFER-disposition, un-voided visit OF THIS SCHOOL (R187).
      const [visit] = await tx
        .select({ id: sickbayVisit.id, studentId: sickbayVisit.studentId, disposition: sickbayVisit.disposition, voidedAt: sickbayVisit.voidedAt })
        .from(sickbayVisit)
        .where(and(eq(sickbayVisit.schoolId, auth.schoolId), eq(sickbayVisit.id, d.visitId)))
        .limit(1);
      if (!visit) throw new NamedError("That visit no longer exists.");
      if (visit.voidedAt) throw new NamedError("That visit was voided.");
      if (visit.disposition !== "REFER") throw new NamedError("A referral hangs off a referred visit — refer the visit first.");

      // One referral per visit (app check — the picker only offers un-referred visits; this closes the race window).
      const [existing] = await tx
        .select({ id: sickbayReferral.id })
        .from(sickbayReferral)
        .where(and(eq(sickbayReferral.schoolId, auth.schoolId), eq(sickbayReferral.visitId, d.visitId)))
        .limit(1);
      if (existing) throw new NamedError("This visit already has a referral.");

      // Re-resolve the hospital: active + this school's (RESTRICT FK is the DB backstop).
      const [hospital] = await tx
        .select({ id: sickbayHospital.id, active: sickbayHospital.active })
        .from(sickbayHospital)
        .where(and(eq(sickbayHospital.schoolId, auth.schoolId), eq(sickbayHospital.id, d.hospitalId)))
        .limit(1);
      if (!hospital || !hospital.active) throw new NamedError("Pick an active referral hospital.");

      const now = new Date();

      // 🔴 R184 — SNAPSHOT the NHIS card (copied text/bool), never a live join later.
      const [card] = await tx
        .select({ cardNumber: studentNhisCard.cardNumber, validTo: studentNhisCard.validTo })
        .from(studentNhisCard)
        .where(and(eq(studentNhisCard.schoolId, auth.schoolId), eq(studentNhisCard.studentId, visit.studentId)))
        .limit(1);
      const nhis = snapshotNhis(card ?? null, now);

      const [row] = await tx
        .insert(sickbayReferral)
        .values({
          schoolId: auth.schoolId,
          studentId: visit.studentId,
          visitId: visit.id,
          hospitalId: hospital.id,
          status: "REFERRED",
          departedAt: now,
          accompaniedByUserId: d.accompaniedByUserId || null,
          hmAuthorisedByUserId: d.hmAuthorisedByUserId,
          hmAuthorisedAt: now,
          recordedByUserId: auth.actor.id ?? null,
          transportMode: d.transportMode || null,
          hospitalWard: d.hospitalWard || null,
          hospitalBed: d.hospitalBed || null,
          attendingClinicianName: d.attendingClinicianName || null,
          expectedReturnAt: d.expectedReturnAt ?? null,
          nhisCardNumber: nhis.nhisCardNumber,
          nhisValid: nhis.nhisValid,
          reasonReferredOut: d.reasonReferredOut,
          preReferralCare: d.preReferralCare || null,
          handoffLabs: d.handoffLabs || null,
          lastMeal: d.lastMeal || null,
          mensesNote: d.mensesNote || null,
          travelNote: d.travelNote || null,
        })
        .returning({ id: sickbayReferral.id });

      // 🔴 PII-masked audit — no reason/menses/full NHIS in an ADMIN-readable feed (the 25a precedent).
      await audit(tx, auth.schoolId, auth.actor, {
        actionType: "created",
        entityType: "sickbay_referral",
        entityId: row.id,
        after: {
          studentId: visit.studentId,
          visitId: visit.id,
          hospitalId: hospital.id,
          status: "REFERRED",
          nhisCard: maskNhisCard(nhis.nhisCardNumber),
        },
        reason: "Sickbay referral created",
      });
      return row.id;
    });
    // The medical hold now UNIONS this open referral (medical-hold.ts) — day 2+ marks on register INSERT,
    // no scheduler. Today's mark was already written by the visit's REFER disposition (22b). Off-campus
    // fact is now live for the boarding in-House arm (INCR-28).
    safeRevalidate(LIST_PATH);
    safeRevalidate(TODAY_PATH);
    return { ok: true, id };
  } catch (err) {
    if (err instanceof NamedError) return { ok: false, error: err.message };
    return { ok: false, error: "Could not record the referral." };
  }
}

// ============================================================================
// W3 — Add ward update (R189, APPEND-ONLY)
// ============================================================================

const UpdateSchema = z.object({
  referralId: z.string().uuid(),
  // R21/R38 — the external clinician is TEXT, never a ref_user. The transcriber is the matron.
  clinicianName: z.string().trim().max(160).nullish(),
  clinicianAffiliation: z.string().trim().max(160).nullish(),
  body: z.string().trim().min(1).max(4000),
  occurredAt: z.coerce.date().nullish(),
});

export async function recordReferralUpdate(input: unknown): Promise<Result> {
  const auth = await authorizeClinicalWrite();
  if (!auth.ok) return auth;
  const parsed = UpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Record what the hospital reported to add an update." };
  const d = parsed.data;

  try {
    const id = await withSchool(auth.schoolId, async (tx) => {
      const r = await loadReferral(tx, auth.schoolId, d.referralId);
      if (!r) throw new NamedError("That referral no longer exists.");
      const now = new Date();
      const [row] = await tx
        .insert(sickbayReferralUpdate)
        .values({
          schoolId: auth.schoolId,
          referralId: r.id,
          occurredAt: d.occurredAt ?? now,
          clinicianName: d.clinicianName || null,
          clinicianAffiliation: d.clinicianAffiliation || null,
          body: d.body,
          recordedByUserId: auth.actor.id ?? null,
        })
        .returning({ id: sickbayReferralUpdate.id });
      // No `body` in the audit (clinical hearsay in an ADMIN-readable feed) — the fact + author only.
      await audit(tx, auth.schoolId, auth.actor, {
        actionType: "created",
        entityType: "sickbay_referral_update",
        entityId: row.id,
        after: { referralId: r.id, clinicianName: d.clinicianName || null },
        reason: "Sickbay referral update logged",
      });
      return row.id;
    });
    safeRevalidate(refPath(d.referralId));
    return { ok: true, id };
  } catch (err) {
    if (err instanceof NamedError) return { ok: false, error: err.message };
    return { ok: false, error: "Could not add the update." };
  }
}

// ============================================================================
// W2 — Status transitions (R188) — advance + mark returned + void
// ============================================================================

const AdvanceSchema = z.object({
  referralId: z.string().uuid(),
  toStatus: z.enum(["INPATIENT", "RETURNING"]),
  hospitalWard: z.string().trim().max(120).nullish(),
  hospitalBed: z.string().trim().max(60).nullish(),
  expectedReturnAt: z.coerce.date().nullish(),
});

/** Advance the clinical-location status (REFERRED→INPATIENT, INPATIENT→RETURNING) — legal transitions only. */
export async function advanceReferralStatus(input: unknown): Promise<Result> {
  const auth = await authorizeClinicalWrite();
  if (!auth.ok) return auth;
  const parsed = AdvanceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Pick a valid status." };
  const d = parsed.data;

  try {
    await withSchool(auth.schoolId, async (tx) => {
      const r = await loadReferral(tx, auth.schoolId, d.referralId);
      if (!r) throw new NamedError("That referral no longer exists.");
      if (r.voidedAt) throw new NamedError("That referral was voided.");
      const err = transitionGuard(r.status as ReferralStatus, d.toStatus);
      if (err) throw new NamedError(err);
      const now = new Date();
      await tx
        .update(sickbayReferral)
        .set({
          status: d.toStatus,
          ...(d.hospitalWard != null ? { hospitalWard: d.hospitalWard || null } : {}),
          ...(d.hospitalBed != null ? { hospitalBed: d.hospitalBed || null } : {}),
          ...(d.expectedReturnAt != null ? { expectedReturnAt: d.expectedReturnAt } : {}),
          updatedAt: now,
        })
        .where(and(eq(sickbayReferral.schoolId, auth.schoolId), eq(sickbayReferral.id, r.id)));
      await audit(tx, auth.schoolId, auth.actor, {
        actionType: "updated",
        entityType: "sickbay_referral",
        entityId: r.id,
        before: { status: r.status },
        after: { status: d.toStatus },
        reason: "Sickbay referral status updated",
      });
    });
    safeRevalidate(refPath(d.referralId));
    safeRevalidate(LIST_PATH);
    safeRevalidate(TODAY_PATH);
    return { ok: true, id: d.referralId };
  } catch (err) {
    if (err instanceof NamedError) return { ok: false, error: err.message };
    return { ok: false, error: "Could not update the referral." };
  }
}

const ReturnSchema = z.object({
  referralId: z.string().uuid(),
  returnNote: z.string().trim().max(2000).nullish(),
});

/** W2 — Mark returned: transition to RETURNED, stamp `returned_at`. The hold drops the NEXT civil day (R193). */
export async function markReferralReturned(input: unknown): Promise<Result> {
  const auth = await authorizeClinicalWrite();
  if (!auth.ok) return auth;
  const parsed = ReturnSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid referral." };
  const d = parsed.data;

  try {
    await withSchool(auth.schoolId, async (tx) => {
      const r = await loadReferral(tx, auth.schoolId, d.referralId);
      if (!r) throw new NamedError("That referral no longer exists.");
      if (r.voidedAt) throw new NamedError("That referral was voided.");
      const err = transitionGuard(r.status as ReferralStatus, "RETURNED");
      if (err) throw new NamedError(err);
      const now = new Date();
      await tx
        .update(sickbayReferral)
        .set({ status: "RETURNED", returnedAt: now, returnNote: d.returnNote || null, updatedAt: now })
        .where(and(eq(sickbayReferral.schoolId, auth.schoolId), eq(sickbayReferral.id, r.id)));
      await audit(tx, auth.schoolId, auth.actor, {
        actionType: "updated",
        entityType: "sickbay_referral",
        entityId: r.id,
        before: { status: r.status, returnedAt: null },
        after: { status: "RETURNED", returnedAt: now },
        reason: "Sickbay referral marked returned",
      });
    });
    // Mark returned closes the medical hold next civil day and returns the student to the in-House count.
    safeRevalidate(refPath(d.referralId));
    safeRevalidate(LIST_PATH);
    safeRevalidate(TODAY_PATH);
    safeRevalidate("/attendance");
    return { ok: true, id: d.referralId };
  } catch (err) {
    if (err instanceof NamedError) return { ok: false, error: err.message };
    return { ok: false, error: "Could not mark the referral returned." };
  }
}

const VoidSchema = z.object({ referralId: z.string().uuid(), reason: z.string().trim().min(1).max(500) });

/** Void = retract while `status ≠ RETURNED AND voided_at IS NULL` (R188). No hard delete anywhere. */
export async function voidReferral(input: unknown): Promise<Result> {
  const auth = await authorizeClinicalWrite();
  if (!auth.ok) return auth;
  const parsed = VoidSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Give a reason for voiding this referral." };
  const d = parsed.data;

  try {
    await withSchool(auth.schoolId, async (tx) => {
      const r = await loadReferral(tx, auth.schoolId, d.referralId);
      if (!r) throw new NamedError("That referral no longer exists.");
      const err = voidReferralGuard({ status: r.status as ReferralStatus, voidedAt: r.voidedAt });
      if (err) throw new NamedError(err);
      const now = new Date();
      await tx
        .update(sickbayReferral)
        .set({ voidedAt: now, voidedByUserId: auth.actor.id ?? null, voidReason: d.reason, updatedAt: now })
        .where(and(eq(sickbayReferral.schoolId, auth.schoolId), eq(sickbayReferral.id, r.id)));
      await audit(tx, auth.schoolId, auth.actor, {
        actionType: "voided",
        entityType: "sickbay_referral",
        entityId: r.id,
        before: { voidedAt: null },
        after: { voidedAt: now, reason: d.reason },
        reason: "Sickbay referral voided",
      });
    });
    safeRevalidate(refPath(d.referralId));
    safeRevalidate(LIST_PATH);
    safeRevalidate(TODAY_PATH);
    safeRevalidate("/attendance");
    return { ok: true, id: d.referralId };
  } catch (err) {
    if (err instanceof NamedError) return { ok: false, error: err.message };
    return { ok: false, error: "Could not void the referral." };
  }
}

// ============================================================================
// W — Add cost line (R185, F2) — diagnosis-free, NO invoice write (billing_line_item_id stays NULL)
// ============================================================================

const CostSchema = z.object({
  referralId: z.string().uuid(),
  itemLabel: z.string().trim().max(200).nullish(),
  provider: z.string().trim().max(200).nullish(),
  nhisCovered: z.boolean(),
  outOfPocketAmount: z.coerce.number().min(0).max(10_000_000).nullish(),
});

export async function addReferralCostLine(input: unknown): Promise<Result> {
  const auth = await authorizeClinicalWrite();
  if (!auth.ok) return auth;
  const parsed = CostSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the cost line." };
  const d = parsed.data;

  try {
    const id = await withSchool(auth.schoolId, async (tx) => {
      const r = await loadReferral(tx, auth.schoolId, d.referralId);
      if (!r) throw new NamedError("That referral no longer exists.");
      const [row] = await tx
        .insert(sickbayReferralCostLine)
        .values({
          schoolId: auth.schoolId,
          referralId: r.id,
          itemLabel: d.itemLabel || null,
          provider: d.provider || null,
          nhisCovered: d.nhisCovered,
          outOfPocketAmount: d.outOfPocketAmount == null ? null : String(d.outOfPocketAmount),
          // 🔴 D6/F2 — NO invoice write in 4.4. billing_line_item_id STAYS NULL (never set here).
        })
        .returning({ id: sickbayReferralCostLine.id });
      // Omit the item label from the audit feed (a drug name is an A4 diagnosis leak); cost facts only.
      await audit(tx, auth.schoolId, auth.actor, {
        actionType: "created",
        entityType: "sickbay_referral_cost_line",
        entityId: row.id,
        after: { referralId: r.id, provider: d.provider || null, nhisCovered: d.nhisCovered, outOfPocketAmount: d.outOfPocketAmount ?? null },
        reason: "Sickbay referral cost line added",
      });
      return row.id;
    });
    safeRevalidate(refPath(d.referralId));
    return { ok: true, id };
  } catch (err) {
    if (err instanceof NamedError) return { ok: false, error: err.message };
    return { ok: false, error: "Could not add the cost line." };
  }
}
