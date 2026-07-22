"use server";
/**
 * Sickbay VISIT write path (SHS module 4.4 / INCR-22a · visit-record §01/§02/§04).
 *
 * Mirrors lib/actions/sickbay-config.ts EXACTLY: `authorizeClinicalWrite()` is the FIRST statement of
 * every mutation, then a Zod parse, then a `withSchool` transaction with `recordAudit` inside the
 * same tx, and every id is re-resolved server-side (a client id is never trusted). No trigger, no
 * derived state column — every rule that spans rows lives in lib/sickbay/{visits,vitals}.ts and is
 * unit-tested there; this file fetches rows, calls those, and writes.
 *
 * 🔴 Authz (R39/R40). Clinical WRITE = SICKBAY_CLINICAL_WRITE_ROLES = [MATRON] — NOT ADMIN (the
 * proprietor/IT is not a clinician) and NOT HEADMASTER (he reads but must never author an
 * impression). A hand-crafted POST from either is refused here, before any query runs. The attending
 * clinician pointer targets the GLOBAL ref_user, so the DB cannot check it belongs to this school —
 * `holdsMatronRole()` is the ONLY tenancy guard on it (Sarah's INCR-21 advisory 2). Do not weaken it.
 *
 * The attendance-MEDICAL hook (22b · R46) fires from exactly two places in this file — the ADMIT
 * disposition and the REFER disposition, NEVER a DISCHARGE — and always AFTER the clinical
 * transaction has committed (R54). `markSickbayMedical` cannot throw; it returns a named skip. This
 * file therefore still writes no attendance row itself, holds no attendance column name, and issues
 * NO DELETE anywhere (R37).
 */
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withSchool, isUniqueViolation } from "@/lib/db/rls";
import type { Tx } from "@/lib/db";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { getCurrentUser } from "@/lib/auth";
import { hasAnyRole, SICKBAY_CLINICAL_WRITE_ROLES } from "@/lib/access";
import { safeRevalidate } from "@/lib/revalidate";
import {
  sickbayVisit,
  sickbayVitalReading,
  sickbayAdmission,
  sickbayDoctorConsult,
  sickbayBed,
  students,
} from "@/db/schema";
import { getSickbayConfig, holdsMatronRole } from "@/lib/sickbay/config";
import { dispositionGuard, isolationGuard, voidGuard } from "@/lib/sickbay/visits";
import { openVisitCollisionError } from "@/lib/sickbay/board-copy";
import { VITAL_BOUNDS, isEmptyReading } from "@/lib/sickbay/vitals";
import { markSickbayMedical } from "@/lib/attendance/mark";

type Result = { ok: boolean; error?: string; id?: string };
const TODAY_PATH = "/senior/sickbay/today";
const visitPath = (id: string) => `/senior/sickbay/visits/${id}`;

/**
 * R46 — the attendance-M hook, fired ONLY for ADMIT and REFER, and only after the clinical write has
 * committed (R54: best-effort, outside the transaction; the visit is the medico-legal record).
 * DISCHARGE is deliberately absent: a 20-minute headache is not an attendance event, and the mark
 * would become a row every class teacher can read about a student who never missed a lesson.
 *
 * The result is not surfaced through the action's return value — the §04 disposition card DERIVES its
 * one honest attendance line from the stored row on the next render (R65), so a skip is visible on
 * the page rather than in a toast that disappears.
 */
async function fireAttendanceHook(
  schoolId: string,
  actor: { id: string | null; role: string },
  visit: { id: string; studentId: string },
  at: Date,
): Promise<void> {
  await markSickbayMedical({ schoolId, studentId: visit.studentId, visitId: visit.id, at, actor });
  safeRevalidate("/attendance");
}

/**
 * The shared clinical-write gate. A HEADMASTER or ADMIN reaching any of these directly — form POST,
 * fetch, replayed server-action id — is refused here (Z1), even though both can READ the surface.
 */
async function authorizeClinicalWrite(): Promise<
  | { ok: true; schoolId: string; actor: { id: string | null; role: string } }
  | { ok: false; error: string }
> {
  const { school } = await requireSchool();
  const user = await getCurrentUser();
  if (!user || !hasAnyRole(user.roles, SICKBAY_CLINICAL_WRITE_ROLES)) {
    return {
      ok: false,
      error: "Only the Matron can record clinical information in the sickbay.",
    };
  }
  const actor = await resolveActor(school.id);
  return { ok: true, schoolId: school.id, actor };
}

/** The visit columns every guard reads — re-resolved server-side inside the tx, never trusted. */
async function loadVisit(tx: Tx, schoolId: string, visitId: string) {
  const [v] = await tx
    .select()
    .from(sickbayVisit)
    .where(and(eq(sickbayVisit.schoolId, schoolId), eq(sickbayVisit.id, visitId)))
    .limit(1);
  return v ?? null;
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

// ============================================================================
// W1 — New visit (QUEUED)
// ============================================================================

const CreateSchema = z.object({
  studentId: z.string().uuid(),
  presentingComplaint: z.string().trim().min(1).max(4000),
  // R38 — the external actor who brought/reported the student. TEXT, never an FK to a prefect
  // student: an FK there would place one student's identity as an ACTOR in another's clinical record.
  intakeReportedBy: z.string().trim().max(120).nullish(),
});

/**
 * Open a visit. The student id is re-resolved to an ACTIVE student OF THIS SCHOOL (RLS + the explicit
 * predicate + the composite FK are three layers; a client-supplied student from another school cannot
 * survive any of them). The partial unique `uniq_sickbay_open_visit_student` — not an app check —
 * is what refuses a second open visit for a student under the concurrent double-open race (R58).
 */
export async function createVisit(input: unknown): Promise<Result> {
  const auth = await authorizeClinicalWrite();
  if (!auth.ok) return auth;
  const parsed = CreateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Record a presenting complaint to open the visit." };
  const d = parsed.data;

  try {
    const id = await withSchool(auth.schoolId, async (tx) => {
      const [student] = await tx
        .select({ id: students.id, status: students.status })
        .from(students)
        .where(and(eq(students.schoolId, auth.schoolId), eq(students.id, d.studentId)))
        .limit(1);
      if (!student) throw new NamedError("That student is not in this school.");
      if (student.status !== "ACTIVE") throw new NamedError("That student is not active.");

      const now = new Date();
      const [row] = await tx
        .insert(sickbayVisit)
        .values({
          schoolId: auth.schoolId,
          studentId: student.id,
          presentedAt: now,
          presentingComplaint: d.presentingComplaint,
          intakeReportedBy: d.intakeReportedBy || null,
          recordedByUserId: auth.actor.id ?? null,
        })
        .returning({ id: sickbayVisit.id });
      await audit(tx, auth.schoolId, auth.actor, {
        actionType: "created",
        entityType: "sickbay_visit",
        entityId: row.id,
        after: { studentId: student.id, presentedAt: now },
        reason: "Sickbay visit opened",
      });
      return row.id;
    });
    safeRevalidate(TODAY_PATH);
    return { ok: true, id };
  } catch (err) {
    if (err instanceof NamedError) return { ok: false, error: err.message };
    if (isUniqueViolation(err)) {
      // R75b — `uniq_sickbay_open_visit_student` fired. Until 22c there was no board, so
      // "this student already has an open visit" left the matron with nowhere to go looking; now
      // there is somewhere, so the error NAMES THE DAY and the id comes back beside it for the form
      // to link. ONE extra select, only on the collision path.
      const open = await withSchool(auth.schoolId, async (tx) =>
        tx
          .select({ id: sickbayVisit.id, presentedAt: sickbayVisit.presentedAt })
          .from(sickbayVisit)
          .where(
            and(
              eq(sickbayVisit.schoolId, auth.schoolId),
              eq(sickbayVisit.studentId, d.studentId),
              isNull(sickbayVisit.disposition),
              isNull(sickbayVisit.voidedAt),
            ),
          )
          .limit(1),
      );
      return open[0]
        ? {
            ok: false,
            error: openVisitCollisionError(open[0].presentedAt, new Date()),
            id: open[0].id,
          }
        : { ok: false, error: "This student already has an open sickbay visit." };
    }
    return { ok: false, error: "Could not open the visit." };
  }
}

// ============================================================================
// W2 — Begin visit (the wait clock stops here, R33)
// ============================================================================

const IdSchema = z.object({ visitId: z.string().uuid() });

/**
 * Begin the visit: stamp `started_at` (IN_PROGRESS) and set the attending clinician to the acting
 * matron. The wait clock stops at this instant (R33), not at assessment. Re-resolved server-side.
 */
export async function beginVisit(input: unknown): Promise<Result> {
  const auth = await authorizeClinicalWrite();
  if (!auth.ok) return auth;
  const parsed = IdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid visit." };

  try {
    await withSchool(auth.schoolId, async (tx) => {
      const v = await loadVisit(tx, auth.schoolId, parsed.data.visitId);
      if (!v) throw new NamedError("That visit no longer exists.");
      if (v.voidedAt) throw new NamedError("That visit was voided.");
      if (v.disposition) throw new NamedError("That visit is already closed.");
      if (v.startedAt) throw new NamedError("That visit has already begun.");
      const now = new Date();
      await tx
        .update(sickbayVisit)
        .set({ startedAt: now, attendingUserId: auth.actor.id ?? null, updatedAt: now })
        .where(and(eq(sickbayVisit.schoolId, auth.schoolId), eq(sickbayVisit.id, v.id)));
      await audit(tx, auth.schoolId, auth.actor, {
        actionType: "updated",
        entityType: "sickbay_visit",
        entityId: v.id,
        before: { startedAt: v.startedAt },
        after: { startedAt: now, attendingUserId: auth.actor.id ?? null },
        reason: "Sickbay visit begun",
      });
    });
    safeRevalidate(visitPath(parsed.data.visitId));
    // …and the board, because this is what removes the student from its queue (INCR-22c): the
    // client router cache would otherwise show her still waiting when the matron navigates back.
    safeRevalidate(TODAY_PATH);
    return { ok: true, id: parsed.data.visitId };
  } catch (err) {
    if (err instanceof NamedError) return { ok: false, error: err.message };
    return { ok: false, error: "Could not begin the visit." };
  }
}

// ============================================================================
// W6 — Save assessment (folded into the visit row, R43/Kofi⟂Lucy-3)
// ============================================================================

const AssessSchema = z.object({
  visitId: z.string().uuid(),
  // R43 — `working_impression`, never `diagnosis`. Free text, required when an assessment is written.
  workingImpression: z.string().trim().min(1).max(2000),
  redFlagsScreened: z.string().trim().max(2000).nullish(),
  hydrationStatus: z.string().trim().max(2000).nullish(),
  plan: z.string().trim().max(2000).nullish(),
  // INERT — stored, rendered, NEVER evaluated. No notification, no job, no cluster (R43).
  escalationTriggers: z.string().trim().max(2000).nullish(),
});

/**
 * Record (or amend) the matron's assessment. It lives as columns ON the visit row (one assessment
 * per visit, one author, written once) — a separate 1:1 table would buy a join and an orphan state
 * and nothing else. `working_impression` is a clinical IMPRESSION, not a diagnosis, and there is no
 * structured vocabulary, code list or picker anywhere near it (R43). Audit keeps a before/after
 * SNAPSHOT, not a patch (the INCR-21 Dex D2 lesson).
 */
export async function assessVisit(input: unknown): Promise<Result> {
  const auth = await authorizeClinicalWrite();
  if (!auth.ok) return auth;
  const parsed = AssessSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Record a working impression to save the assessment." };
  }
  const d = parsed.data;

  try {
    await withSchool(auth.schoolId, async (tx) => {
      const v = await loadVisit(tx, auth.schoolId, d.visitId);
      if (!v) throw new NamedError("That visit no longer exists.");
      if (v.voidedAt) throw new NamedError("That visit was voided.");
      if (!v.startedAt) throw new NamedError("Begin the visit before recording an assessment.");
      const now = new Date();
      await tx
        .update(sickbayVisit)
        .set({
          workingImpression: d.workingImpression,
          redFlagsScreened: d.redFlagsScreened || null,
          hydrationStatus: d.hydrationStatus || null,
          plan: d.plan || null,
          escalationTriggers: d.escalationTriggers || null,
          assessedAt: now,
          updatedAt: now,
        })
        .where(and(eq(sickbayVisit.schoolId, auth.schoolId), eq(sickbayVisit.id, v.id)));
      await audit(tx, auth.schoolId, auth.actor, {
        actionType: "updated",
        entityType: "sickbay_visit",
        entityId: v.id,
        before: {
          workingImpression: v.workingImpression,
          redFlagsScreened: v.redFlagsScreened,
          hydrationStatus: v.hydrationStatus,
          plan: v.plan,
          escalationTriggers: v.escalationTriggers,
        },
        after: {
          workingImpression: d.workingImpression,
          redFlagsScreened: d.redFlagsScreened || null,
          hydrationStatus: d.hydrationStatus || null,
          plan: d.plan || null,
          escalationTriggers: d.escalationTriggers || null,
        },
        reason: "Sickbay assessment recorded",
      });
    });
    safeRevalidate(visitPath(d.visitId));
    return { ok: true, id: d.visitId };
  } catch (err) {
    if (err instanceof NamedError) return { ok: false, error: err.message };
    return { ok: false, error: "Could not save the assessment." };
  }
}

// ============================================================================
// W5 — Update vitals (append-only, R44)
// ============================================================================

const num = (k: keyof typeof VITAL_BOUNDS, dp = 0) =>
  z.coerce
    .number()
    .min(VITAL_BOUNDS[k].min, `${LABEL[k]} must be between ${VITAL_BOUNDS[k].min} and ${VITAL_BOUNDS[k].max}.`)
    .max(VITAL_BOUNDS[k].max, `${LABEL[k]} must be between ${VITAL_BOUNDS[k].min} and ${VITAL_BOUNDS[k].max}.`)
    .refine((v) => (dp === 0 ? Number.isInteger(v) : true), `${LABEL[k]} must be a whole number.`)
    .nullish();

const LABEL: Record<keyof typeof VITAL_BOUNDS, string> = {
  tempC: "Temperature",
  systolic: "Systolic",
  diastolic: "Diastolic",
  pulseBpm: "Heart rate",
  spo2Pct: "SpO₂",
  painScore: "Pain",
};

const VitalsSchema = z.object({
  visitId: z.string().uuid(),
  tempC: num("tempC", 1),
  systolic: num("systolic"),
  diastolic: num("diastolic"),
  pulseBpm: num("pulseBpm"),
  spo2Pct: num("spo2Pct"),
  painScore: num("painScore"),
  context: z.string().trim().max(32).nullish(),
  // ≤ now and ≥ now − 12h enforced below (a back-dated 06:30 round reading is legitimate; a future
  // reading is a typo).
  takenAt: z.coerce.date().nullish(),
});

/**
 * Append one reading. R44: at least one measure, plausibility bounds as TYPO guards (zod, not a DB
 * CHECK — a CHECK rejects the genuine extreme reading the record most needs). Append-only: there is
 * no update, no delete, no void, no `updated_at`. Units are fixed, so there is no unit to store.
 */
export async function addVitals(input: unknown): Promise<Result> {
  const auth = await authorizeClinicalWrite();
  if (!auth.ok) return auth;
  const parsed = VitalsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the readings." };
  }
  const d = parsed.data;

  const reading = {
    tempC: d.tempC ?? null,
    systolic: d.systolic ?? null,
    diastolic: d.diastolic ?? null,
    pulseBpm: d.pulseBpm ?? null,
    spo2Pct: d.spo2Pct ?? null,
    painScore: d.painScore ?? null,
  };
  if (isEmptyReading(reading)) return { ok: false, error: "Record at least one reading." };
  if ((reading.systolic === null) !== (reading.diastolic === null)) {
    return { ok: false, error: "Record both blood-pressure numbers, or neither." };
  }
  const now = new Date();
  const takenAt = d.takenAt ?? now;
  if (takenAt.getTime() > now.getTime()) return { ok: false, error: "A reading cannot be in the future." };
  if (takenAt.getTime() < now.getTime() - 12 * 3600_000) {
    return { ok: false, error: "A reading cannot be more than 12 hours old." };
  }

  try {
    const id = await withSchool(auth.schoolId, async (tx) => {
      const v = await loadVisit(tx, auth.schoolId, d.visitId);
      if (!v) throw new NamedError("That visit no longer exists.");
      if (v.voidedAt) throw new NamedError("That visit was voided.");
      const [row] = await tx
        .insert(sickbayVitalReading)
        .values({
          schoolId: auth.schoolId,
          visitId: v.id,
          takenAt,
          takenByUserId: auth.actor.id ?? null,
          context: d.context || null,
          // numeric(3,1) round-trips as a string in pg; store the fixed-dp form.
          tempC: reading.tempC === null ? null : reading.tempC.toFixed(1),
          systolic: reading.systolic,
          diastolic: reading.diastolic,
          pulseBpm: reading.pulseBpm,
          spo2Pct: reading.spo2Pct,
          painScore: reading.painScore,
        })
        .returning({ id: sickbayVitalReading.id });
      await audit(tx, auth.schoolId, auth.actor, {
        actionType: "created",
        entityType: "sickbay_vital_reading",
        entityId: row.id,
        after: { ...reading, takenAt },
        reason: "Sickbay vitals recorded",
      });
      return row.id;
    });
    safeRevalidate(visitPath(d.visitId));
    return { ok: true, id };
  } catch (err) {
    if (err instanceof NamedError) return { ok: false, error: err.message };
    return { ok: false, error: "Could not save the readings." };
  }
}

// ============================================================================
// W12/W13 — Dispose without an admission (REFER or a walk-in DISCHARGE)
// ============================================================================

const DisposeSchema = z.object({
  visitId: z.string().uuid(),
  disposition: z.enum(["DISCHARGE", "REFER"]),
  // NO free-text note here. `sickbay_visit` has no column for one, and a field that is parsed,
  // audited and then unstorable is exactly the "appears to record, does not record" control the
  // omit-not-fake rule forbids — on the increment whose premise is that the visit IS the
  // medico-legal record. R34 already REQUIRES `working_impression` before a REFER, so the clinical
  // reasoning has a real home. Adding the column is INCR-25's call (it owns the referral event).
});

/**
 * Close a visit as DISCHARGE (a walk-in seen and sent home) or REFER (terminal at 22 — no hospital
 * FK, no transport, no return; those are INCR-25's referral EVENT). ADMIT does NOT come through here:
 * it needs the admission row in the same transaction (R35), so it has its own action below.
 *
 * The dispositionGuard enforces R34 (started · complaint · attending-is-matron · impression for
 * REFER) and R36 (immutable once set). The attending-is-matron answer is `holdsMatronRole()` on the
 * attending pointer — the only tenancy guard on that global ref_user FK.
 */
export async function disposeVisit(input: unknown): Promise<Result> {
  const auth = await authorizeClinicalWrite();
  if (!auth.ok) return auth;
  const parsed = DisposeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Pick a disposition." };
  const d = parsed.data;

  try {
    const closed = await withSchool(auth.schoolId, async (tx) => {
      const v = await loadVisit(tx, auth.schoolId, d.visitId);
      if (!v) throw new NamedError("That visit no longer exists.");
      const attendingIsMatron = v.attendingUserId
        ? await holdsMatronRole(auth.schoolId, v.attendingUserId)
        : false;
      const err = dispositionGuard(v, d.disposition, { attendingIsMatron, admissionsAllowed: true });
      if (err) throw new NamedError(err);
      const now = new Date();
      await tx
        .update(sickbayVisit)
        .set({ disposition: d.disposition, dispositionAt: now, updatedAt: now })
        .where(and(eq(sickbayVisit.schoolId, auth.schoolId), eq(sickbayVisit.id, v.id)));
      await audit(tx, auth.schoolId, auth.actor, {
        actionType: "updated",
        entityType: "sickbay_visit",
        entityId: v.id,
        before: { disposition: null },
        after: { disposition: d.disposition, dispositionAt: now },
        reason: `Sickbay visit ${d.disposition === "REFER" ? "referred" : "discharged"}`,
      });
      return { id: v.id, studentId: v.studentId, at: now };
    });
    // R46 — REFER marks the day, DISCHARGE does not. A student at Asankrangwa Govt. Hospital is
    // definitively not in class and definitively not unauthorised-absent; a walk-in sent back to
    // class missed nothing.
    if (d.disposition === "REFER") {
      await fireAttendanceHook(auth.schoolId, auth.actor, closed, closed.at);
    }
    safeRevalidate(visitPath(d.visitId));
    return { ok: true, id: d.visitId };
  } catch (err) {
    if (err instanceof NamedError) return { ok: false, error: err.message };
    return { ok: false, error: "Could not record the disposition." };
  }
}

// ============================================================================
// W8 — Admit patient (ADMIT + the admission row in ONE transaction, R35)
// ============================================================================

const AdmitSchema = z.object({
  visitId: z.string().uuid(),
  bedId: z.string().uuid(),
  isIsolation: z.boolean(),
  expectedDischargeAt: z.coerce.date().nullish(),
  dischargeCriteria: z.string().trim().max(4000).nullish(),
  // R63 — the "no silent overnight stays" rule. App-required.
  overnightPlan: z.string().trim().min(1).max(2000),
});

/**
 * Admit: write the disposition ADMIT and the admission row in ONE transaction (R35). Mode C refuses
 * ADMIT AT THE ACTION (R55), not in the UI — `capabilities.admissions` is the derived flag, never a
 * mode string. R57 forces `admission.is_isolation` to equal the bed's — no overflow in either pool.
 * The three exclusivity invariants (one open admission per bed · per student · one per visit) are
 * partial unique indexes, so the concurrent double-admit race is refused by the DB (R58), and a
 * caught unique violation reads the state back as a named error.
 */
export async function admitPatient(input: unknown): Promise<Result> {
  const auth = await authorizeClinicalWrite();
  if (!auth.ok) return auth;
  const parsed = AdmitSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Give the bed and an overnight plan to admit." };
  }
  const d = parsed.data;
  const config = await getSickbayConfig(auth.schoolId);

  try {
    const admitted = await withSchool(auth.schoolId, async (tx) => {
      const v = await loadVisit(tx, auth.schoolId, d.visitId);
      if (!v) throw new NamedError("That visit no longer exists.");
      const attendingIsMatron = v.attendingUserId
        ? await holdsMatronRole(auth.schoolId, v.attendingUserId)
        : false;
      const guardErr = dispositionGuard(v, "ADMIT", {
        attendingIsMatron,
        admissionsAllowed: config.capabilities.admissions,
      });
      if (guardErr) throw new NamedError(guardErr);

      // The bed is re-resolved server-side (never a client-supplied number): active, this school's,
      // and in the pool the admission claims (R57).
      const [bed] = await tx
        .select({ id: sickbayBed.id, isIsolation: sickbayBed.isIsolation, active: sickbayBed.active })
        .from(sickbayBed)
        .where(and(eq(sickbayBed.schoolId, auth.schoolId), eq(sickbayBed.id, d.bedId)))
        .limit(1);
      if (!bed || !bed.active) throw new NamedError("That bed is not available.");
      const isoErr = isolationGuard(bed.isIsolation, d.isIsolation);
      if (isoErr) throw new NamedError(isoErr);

      const now = new Date();
      const [adm] = await tx
        .insert(sickbayAdmission)
        .values({
          schoolId: auth.schoolId,
          visitId: v.id,
          studentId: v.studentId,
          bedId: bed.id,
          admittedAt: now,
          admittedByUserId: auth.actor.id ?? null,
          isIsolation: bed.isIsolation,
          expectedDischargeAt: d.expectedDischargeAt ?? null,
          dischargeCriteria: d.dischargeCriteria || null,
          overnightPlan: d.overnightPlan,
        })
        .returning({ id: sickbayAdmission.id });

      await tx
        .update(sickbayVisit)
        .set({ disposition: "ADMIT", dispositionAt: now, updatedAt: now })
        .where(and(eq(sickbayVisit.schoolId, auth.schoolId), eq(sickbayVisit.id, v.id)));

      await audit(tx, auth.schoolId, auth.actor, {
        actionType: "created",
        entityType: "sickbay_admission",
        entityId: adm.id,
        after: { visitId: v.id, bedId: bed.id, isIsolation: bed.isIsolation, admittedAt: now },
        reason: "Sickbay admission opened",
      });
      return { id: v.id, studentId: v.studentId, at: now };
    });
    // R46/R54 — the mark is written AFTER the clinical commit and cannot roll it back. R48's PULL arm
    // then carries days 2, 3 and 4 of this admission with no scheduler anywhere.
    await fireAttendanceHook(auth.schoolId, auth.actor, admitted, admitted.at);
    safeRevalidate(visitPath(d.visitId));
    safeRevalidate(TODAY_PATH);
    return { ok: true, id: admitted.id };
  } catch (err) {
    if (err instanceof NamedError) return { ok: false, error: err.message };
    if (isUniqueViolation(err)) {
      // One of the three partial uniques: bed taken, student already admitted, or visit already
      // admitted. Read from fresh rows on reload — retry is the honest advice.
      return {
        ok: false,
        error: "That bed or student is already admitted. Reload and try again.",
      };
    }
    return { ok: false, error: "Could not admit the patient." };
  }
}

// ============================================================================
// W11 — Discharge from the ward (the admission ends; the disposition stays ADMIT, R36)
// ============================================================================

const DischargeSchema = z.object({
  admissionId: z.string().uuid(),
  dischargeNote: z.string().trim().max(2000).nullish(),
});

/**
 * End an open admission. `disposition` STAYS `ADMIT` — the visit's outcome WAS an admission; "ward
 * discharge" is the stay ending, not the disposition changing (R36 · Lucy W11). The attendance
 * backfill this triggers is 22b, deliberately NOT here.
 */
export async function dischargeFromWard(input: unknown): Promise<Result> {
  const auth = await authorizeClinicalWrite();
  if (!auth.ok) return auth;
  const parsed = DischargeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid admission." };
  const d = parsed.data;

  try {
    const visitId = await withSchool(auth.schoolId, async (tx) => {
      const [adm] = await tx
        .select()
        .from(sickbayAdmission)
        .where(and(eq(sickbayAdmission.schoolId, auth.schoolId), eq(sickbayAdmission.id, d.admissionId)))
        .limit(1);
      if (!adm) throw new NamedError("That admission no longer exists.");
      if (adm.dischargedAt) throw new NamedError("That admission is already discharged.");
      const now = new Date();
      await tx
        .update(sickbayAdmission)
        .set({ dischargedAt: now, dischargedByUserId: auth.actor.id ?? null, dischargeNote: d.dischargeNote || null })
        .where(and(eq(sickbayAdmission.schoolId, auth.schoolId), eq(sickbayAdmission.id, adm.id)));
      await audit(tx, auth.schoolId, auth.actor, {
        actionType: "updated",
        entityType: "sickbay_admission",
        entityId: adm.id,
        before: { dischargedAt: null },
        after: { dischargedAt: now },
        reason: "Sickbay ward discharge",
      });
      return adm.visitId;
    });
    safeRevalidate(visitPath(visitId));
    safeRevalidate(TODAY_PATH);
    return { ok: true, id: visitId };
  } catch (err) {
    if (err instanceof NamedError) return { ok: false, error: err.message };
    return { ok: false, error: "Could not discharge from the ward." };
  }
}

// ============================================================================
// W-void — Void a visit (legal ONLY while open, R37; no DELETE anywhere)
// ============================================================================

const VoidSchema = z.object({
  visitId: z.string().uuid(),
  reason: z.string().trim().min(1).max(500),
});

/**
 * Void an OPEN visit (R37) — an open visit on the wrong student is an active attendance-coercion
 * source, so it must be retractable, and a reason is required. A CLOSED visit is the record and
 * cannot be voided. Nothing is hard-deleted. Because void is legal only while `disposition IS NULL`
 * and only ADMIT/REFER write attendance, voiding can never touch an attendance row by construction.
 */
export async function voidVisit(input: unknown): Promise<Result> {
  const auth = await authorizeClinicalWrite();
  if (!auth.ok) return auth;
  const parsed = VoidSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Give a reason for voiding this visit." };
  const d = parsed.data;

  try {
    await withSchool(auth.schoolId, async (tx) => {
      const v = await loadVisit(tx, auth.schoolId, d.visitId);
      if (!v) throw new NamedError("That visit no longer exists.");
      const err = voidGuard(v, d.reason);
      if (err) throw new NamedError(err);
      const now = new Date();
      await tx
        .update(sickbayVisit)
        .set({ voidedAt: now, voidedByUserId: auth.actor.id ?? null, voidReason: d.reason, updatedAt: now })
        .where(and(eq(sickbayVisit.schoolId, auth.schoolId), eq(sickbayVisit.id, v.id)));
      await audit(tx, auth.schoolId, auth.actor, {
        actionType: "voided",
        entityType: "sickbay_visit",
        entityId: v.id,
        before: { voidedAt: null },
        after: { voidedAt: now, reason: d.reason },
        reason: "Sickbay visit voided",
      });
    });
    safeRevalidate(TODAY_PATH);
    return { ok: true, id: d.visitId };
  } catch (err) {
    if (err instanceof NamedError) return { ok: false, error: err.message };
    return { ok: false, error: "Could not void the visit." };
  }
}

// ============================================================================
// W7 — Log a doctor consult (R60 — hearsay with attribution, authorises NOTHING)
// ============================================================================

const ConsultSchema = z.object({
  visitId: z.string().uuid(),
  // R38/R60 — the external clinician is TEXT, never a ref_user: an unauthenticated external actor is
  // not an authorisation subject. There is deliberately no approved_by / signature field, and no
  // action is gated on a consult existing.
  clinicianName: z.string().trim().min(1).max(120),
  clinicianAffiliation: z.string().trim().max(120).nullish(),
  mode: z.enum(["PHONE", "IN_PERSON"]),
  note: z.string().trim().min(1).max(4000),
  occurredAt: z.coerce.date().nullish(),
});

/**
 * Record a consult with the visiting/on-call doctor — a SEPARATE artefact from the matron's own
 * assessment, because it is a different person's clinical opinion. It is HEARSAY WITH ATTRIBUTION
 * (`recorded_by_user_id` = the matron who transcribed) and it CANNOT be a co-sign or a gate (R60).
 * Append-only: a correction is a second row.
 */
export async function addConsult(input: unknown): Promise<Result> {
  const auth = await authorizeClinicalWrite();
  if (!auth.ok) return auth;
  const parsed = ConsultSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Record the doctor's name and what was said." };
  const d = parsed.data;

  try {
    const id = await withSchool(auth.schoolId, async (tx) => {
      const v = await loadVisit(tx, auth.schoolId, d.visitId);
      if (!v) throw new NamedError("That visit no longer exists.");
      if (v.voidedAt) throw new NamedError("That visit was voided.");
      const now = new Date();
      const [row] = await tx
        .insert(sickbayDoctorConsult)
        .values({
          schoolId: auth.schoolId,
          visitId: v.id,
          occurredAt: d.occurredAt ?? now,
          mode: d.mode,
          clinicianName: d.clinicianName,
          clinicianAffiliation: d.clinicianAffiliation || null,
          note: d.note,
          recordedByUserId: auth.actor.id ?? null,
        })
        .returning({ id: sickbayDoctorConsult.id });
      await audit(tx, auth.schoolId, auth.actor, {
        actionType: "created",
        entityType: "sickbay_doctor_consult",
        entityId: row.id,
        after: { clinicianName: d.clinicianName, mode: d.mode },
        reason: "Sickbay doctor consult logged",
      });
      return row.id;
    });
    safeRevalidate(visitPath(d.visitId));
    return { ok: true, id };
  } catch (err) {
    if (err instanceof NamedError) return { ok: false, error: err.message };
    return { ok: false, error: "Could not log the consult." };
  }
}

/** Thrown inside a tx to surface a NAMED business error and roll the whole thing back. */
class NamedError extends Error {}
