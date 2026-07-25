"use server";
/**
 * The MAR WRITE path (SHS module 4.4 / INCR-24b · the clinical crux). Mirrors lib/actions/sickbay-stock.ts:
 * the authz gate is the FIRST statement, then a Zod parse, then server-side re-resolution of EVERY id (a
 * client id is never trusted), then a single `withSchool` INSERT with `recordAudit` in the same tx.
 *
 * 🔴 APPEND-ONLY IS STRUCTURAL (R142/R146). This module exports EXACTLY ONE write — `recordMedAdmin` —
 * and its ONLY verb against `sickbay_med_admin` is INSERT. There is no `.update`/`.delete` of the MAR and
 * no void column anywhere; the absence IS the constraint. A CORRECTION is `recordMedAdmin` again with
 * `correctsAdminId` + a required `amendmentNote`; the corrected row stays byte-unchanged; chains allowed.
 *
 * 🔴 AUTHZ (R170). Write = SICKBAY_CLINICAL_WRITE_ROLES = [MATRON]; gated like the VISIT via `withSchool`,
 * NOT `withStaffScope` (R164 — the MAR is the acute/round clinical graph, not the chronic grant boundary).
 * A HEADMASTER (who READS the record) hand-crafting this call is refused HERE, before any query runs.
 *
 * 🔴 SERVER-RESOLVED SNAPSHOTS (R172). `is_controlled` / `stock_item_id` / `dispensed_qty` are NEVER
 * client-trusted: `is_controlled` is COPIED from the re-resolved `sickbay_stock_item.is_controlled`, so a
 * client forging `is_controlled=false` on a controlled drug still records `true` and still hits the
 * witness gate. `administered_by` is the SESSION ACTOR (`resolveActor`), never a client administrator
 * (R170 — a matron cannot attribute her dose to another). A CHRONIC round dose re-resolves
 * `chronic_med_id → entry → student_id` (never a client `studentId`), and pins the drug/dose from the plan.
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { getCurrentUser } from "@/lib/auth";
import { hasAnyRole, SICKBAY_CLINICAL_WRITE_ROLES } from "@/lib/access";
import { safeRevalidate } from "@/lib/revalidate";
import {
  sickbayChronicEntry,
  sickbayChronicMed,
  sickbayDoctorConsult,
  sickbayMedAdmin,
  sickbayStandingOrder,
  sickbayStockItem,
  sickbayVisit,
  students,
} from "@/db/schema";
import { assertSchoolClinician } from "@/lib/sickbay/clinician";
import { medAdminWitnessError, sourcePointerMismatch } from "@/lib/sickbay/med-admin";

type Result = { ok: boolean; error?: string; id?: string };
const ROUNDS_PATH = "/senior/sickbay/rounds";

/**
 * The MAR write gate. A HEADMASTER, ADMIN, grantee or any non-MATRON reaching this directly — form POST,
 * fetch, replayed server-action id — is refused here, before any query. Same shape as `authorizeStockWrite`
 * in sickbay-stock.ts; the role set is the [MATRON] clinical-write seam (R164/R170).
 */
async function authorizeMedAdminWrite(): Promise<
  | { ok: true; schoolId: string; actor: { id: string | null; role: string } }
  | { ok: false; error: string }
> {
  const { school } = await requireSchool();
  const user = await getCurrentUser();
  if (!user || !hasAnyRole(user.roles, SICKBAY_CLINICAL_WRITE_ROLES)) {
    return { ok: false, error: "Only the Matron can record a medication administration." };
  }
  const actor = await resolveActor(school.id);
  return { ok: true, schoolId: school.id, actor };
}

const RecordSchema = z.object({
  source: z.enum(["CHRONIC", "STANDING_ORDER", "DOCTOR_ORDERED", "AD_HOC"]),
  status: z.enum(["GIVEN", "REFUSED", "HELD", "OMITTED"]),
  // Pointers + context — all re-resolved server-side; a client id is never trusted.
  studentId: z.string().uuid().nullish(),
  visitId: z.string().uuid().nullish(),
  slotId: z.string().uuid().nullish(),
  chronicMedId: z.string().uuid().nullish(),
  standingOrderId: z.string().uuid().nullish(),
  consultId: z.string().uuid().nullish(),
  stockItemId: z.string().uuid().nullish(),
  // Snapshots (R144) — required, but OVERRIDDEN from the plan for a CHRONIC dose (authoritative).
  drugName: z.string().trim().min(1).max(120),
  doseLabel: z.string().trim().min(1).max(120),
  route: z.string().trim().max(48).nullish(),
  administeredAt: z.coerce.date().optional(),
  dispensedQty: z.coerce.number().min(0).max(1_000_000).nullish(),
  witnessUserId: z.string().uuid().nullish(),
  witnessOverrideReason: z.string().trim().max(240).nullish(),
  notes: z.string().trim().max(1000).nullish(),
  correctsAdminId: z.string().uuid().nullish(),
  amendmentNote: z.string().trim().max(500).nullish(),
});

/**
 * Record ONE medication administration (given / refused / held / omitted), or a correction of one. The
 * ONLY write in the medication layer and the ONLY verb it issues on the MAR is INSERT (append-only).
 */
export async function recordMedAdmin(input: unknown): Promise<Result> {
  const auth = await authorizeMedAdminWrite();
  if (!auth.ok) return auth;
  const parsed = RecordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the administration details." };
  const d = parsed.data;

  const actorId = auth.actor.id;
  // administered_by is the SESSION ACTOR (R170); it must be an in-school clinician (AC 10). The DB cannot
  // check role on a GLOBAL ref_user pointer — `assertSchoolClinician` is the only tenancy guard on it.
  if (!actorId) return { ok: false, error: "Your clinical identity could not be resolved in this school." };
  if (!(await assertSchoolClinician(auth.schoolId, actorId))) {
    return { ok: false, error: "The administering clinician must hold the Matron role in this school." };
  }

  const chronicMedId = d.chronicMedId || null;
  const standingOrderId = d.standingOrderId || null;
  const consultId = d.consultId || null;

  // R171 — refuse a source↔pointer mismatch FIRST (the DB CHECK is the backstop). CHRONIC's chronic_med_id
  // is OPTIONAL (R163 patient-own-bottle); the others are required and mutually exclusive.
  if (sourcePointerMismatch(d.source, { chronicMedId, standingOrderId, consultId })) {
    return { ok: false, error: "The source does not match its reference. Pick one source and its order/prescription." };
  }

  const correctsAdminId = d.correctsAdminId || null;
  if (correctsAdminId && !d.amendmentNote?.trim()) {
    return { ok: false, error: "A correction needs an amendment note saying what it fixes." };
  }

  // 🔴 R172 — re-resolve EVERY id server-side in one read: the stock item (→ is_controlled, PINNED), the
  // student + drug/dose snapshot (a CHRONIC dose derives them from the plan, never a client studentId),
  // and the existence of each cited pointer. A foreign/forged id resolves to nothing and is refused.
  const resolved = await withSchool(auth.schoolId, async (tx) => {
    let isControlled = false;
    let stockItemId: string | null = null;
    if (d.stockItemId) {
      const [si] = await tx
        .select({ id: sickbayStockItem.id, isControlled: sickbayStockItem.isControlled })
        .from(sickbayStockItem)
        .where(and(eq(sickbayStockItem.schoolId, auth.schoolId), eq(sickbayStockItem.id, d.stockItemId)))
        .limit(1);
      if (!si) return { ok: false as const, error: "That stock item no longer exists." };
      isControlled = si.isControlled; // COPIED — never the client's word (R172)
      stockItemId = si.id;
    }

    let studentId: string;
    let drugName = d.drugName;
    let doseLabel = d.doseLabel;
    if (chronicMedId) {
      const [cm] = await tx
        .select({
          drugName: sickbayChronicMed.drugName,
          doseLabel: sickbayChronicMed.doseLabel,
          studentId: sickbayChronicEntry.studentId,
        })
        .from(sickbayChronicMed)
        .innerJoin(
          sickbayChronicEntry,
          and(
            eq(sickbayChronicEntry.schoolId, auth.schoolId),
            eq(sickbayChronicEntry.id, sickbayChronicMed.entryId),
          ),
        )
        .where(and(eq(sickbayChronicMed.schoolId, auth.schoolId), eq(sickbayChronicMed.id, chronicMedId)))
        .limit(1);
      if (!cm) return { ok: false as const, error: "That prescription no longer exists." };
      studentId = cm.studentId; // authoritative — never a client studentId (R172)
      drugName = cm.drugName; // snapshot pinned from the plan (R144)
      doseLabel = cm.doseLabel;
    } else if (d.visitId) {
      const [v] = await tx
        .select({ studentId: sickbayVisit.studentId })
        .from(sickbayVisit)
        .where(and(eq(sickbayVisit.schoolId, auth.schoolId), eq(sickbayVisit.id, d.visitId)))
        .limit(1);
      if (!v) return { ok: false as const, error: "That visit no longer exists." };
      studentId = v.studentId;
    } else if (d.studentId) {
      const [s] = await tx
        .select({ id: students.id })
        .from(students)
        .where(and(eq(students.schoolId, auth.schoolId), eq(students.id, d.studentId)))
        .limit(1);
      if (!s) return { ok: false as const, error: "That student no longer exists." };
      studentId = s.id;
    } else {
      return { ok: false as const, error: "A dose needs a student, a prescription or a visit." };
    }

    if (standingOrderId) {
      const [so] = await tx
        .select({ id: sickbayStandingOrder.id })
        .from(sickbayStandingOrder)
        .where(and(eq(sickbayStandingOrder.schoolId, auth.schoolId), eq(sickbayStandingOrder.id, standingOrderId)))
        .limit(1);
      if (!so) return { ok: false as const, error: "That standing order no longer exists." };
    }
    if (consultId) {
      const [c] = await tx
        .select({ id: sickbayDoctorConsult.id })
        .from(sickbayDoctorConsult)
        .where(and(eq(sickbayDoctorConsult.schoolId, auth.schoolId), eq(sickbayDoctorConsult.id, consultId)))
        .limit(1);
      if (!c) return { ok: false as const, error: "That doctor consult no longer exists." };
    }
    if (correctsAdminId) {
      const [orig] = await tx
        .select({ id: sickbayMedAdmin.id })
        .from(sickbayMedAdmin)
        .where(and(eq(sickbayMedAdmin.schoolId, auth.schoolId), eq(sickbayMedAdmin.id, correctsAdminId)))
        .limit(1);
      if (!orig) return { ok: false as const, error: "The entry being corrected no longer exists." };
    }

    return { ok: true as const, isControlled, stockItemId, studentId, drugName, doseLabel };
  });
  if (!resolved.ok) return resolved;

  // R173 — dispensed_qty: a controlled GIVEN dose MUST carry a positive quantity (the deduction); a
  // controlled non-GIVEN carries 0 (the all-controlled CHECKs); a non-controlled dose carries nothing.
  let dispensedQty: string | null = null;
  if (resolved.isControlled) {
    if (d.status === "GIVEN") {
      if (d.dispensedQty == null || d.dispensedQty <= 0) {
        return { ok: false, error: "A controlled dose given needs the dispensed quantity." };
      }
      dispensedQty = String(d.dispensedQty);
    } else {
      dispensedQty = "0";
    }
  }

  // 🔴 R174 — the witness/override gate, decided by the PURE, unit-pinned `medAdminWitnessError` (the
  // `&& false`-provable tripwire). The N&MC/tenancy check stays here (DB-backed — a global ref_user
  // cannot be role-checked in SQL). Self-witness is refused; the DB CHECKs are the backstop for both.
  const witnessId = d.witnessUserId || null;
  const controlledGiven = resolved.isControlled && d.status === "GIVEN";
  const overrideReason = controlledGiven ? d.witnessOverrideReason?.trim() || null : null;
  const werr = medAdminWitnessError({
    isControlled: resolved.isControlled,
    status: d.status,
    witnessId,
    overrideReason,
    actorId,
  });
  if (werr === "MISSING_WITNESS_OR_OVERRIDE") {
    return { ok: false, error: "A controlled dose needs a witness or a recorded override reason." };
  }
  if (werr === "SELF_WITNESS") {
    return { ok: false, error: "The witness must be a second clinician, not the one administering the dose." };
  }
  if (witnessId && !(await assertSchoolClinician(auth.schoolId, witnessId, { requireNmc: resolved.isControlled }))) {
    return {
      ok: false,
      error: resolved.isControlled
        ? "The witness must be a staff member with an N&MC licence in this school."
        : "The witness must be a clinician in this school.",
    };
  }

  try {
    const id = await withSchool(auth.schoolId, async (tx) => {
      const [row] = await tx
        .insert(sickbayMedAdmin)
        .values({
          schoolId: auth.schoolId,
          studentId: resolved.studentId,
          visitId: d.visitId || null,
          slotId: d.slotId || null,
          source: d.source,
          chronicMedId,
          standingOrderId,
          consultId,
          drugName: resolved.drugName,
          doseLabel: resolved.doseLabel,
          route: d.route || null,
          isControlled: resolved.isControlled, // server-resolved, PINNED (R172/R144)
          dispensedQty,
          stockItemId: resolved.stockItemId,
          status: d.status,
          administeredAt: d.administeredAt ?? new Date(),
          administeredByUserId: actorId, // the SESSION ACTOR (R170)
          witnessUserId: witnessId,
          witnessOverrideReason: overrideReason,
          notes: d.notes || null,
          correctsAdminId,
          amendmentNote: correctsAdminId ? d.amendmentNote?.trim() ?? null : null,
        })
        .returning({ id: sickbayMedAdmin.id });
      await recordAudit(tx, {
        schoolId: auth.schoolId,
        actorUserId: actorId,
        actorRole: auth.actor.role,
        actionType: correctsAdminId ? "corrected" : "created",
        entityType: "sickbay_med_admin",
        entityId: row.id,
        // Clinical fact only — the student id is on the row for the record; audit carries the drug/status.
        after: { drugName: resolved.drugName, status: d.status, isControlled: resolved.isControlled, source: d.source },
        reason: correctsAdminId
          ? `Medication administration corrected · ${resolved.drugName}`
          : `Medication ${d.status.toLowerCase()} · ${resolved.drugName}`,
      });
      return row.id;
    });
    safeRevalidate(ROUNDS_PATH);
    if (d.visitId) safeRevalidate(`/senior/sickbay/visits/${d.visitId}`);
    return { ok: true, id };
  } catch {
    return { ok: false, error: "Could not record the administration." };
  }
}
