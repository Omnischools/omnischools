"use server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/lib/db";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor, type ActiveSchool } from "@/lib/auth/server";
import { getCurrentUser, type AppUser } from "@/lib/auth";
import { hasAnyRole, BOARDING_ROLES, BOARDING_SCHOOL_SCOPED_ROLES, canAccessHouse } from "@/lib/access";
import { safeRevalidate } from "@/lib/revalidate";
import {
  boardingVisit,
  boardingApprovedVisitor,
  boardingCalendarEvent,
  students,
  houses,
} from "@/db/schema";
import { getVisitingPolicy } from "@/lib/boarding/config";
import {
  approvedVisitorInputSchema,
  recordVisitInputSchema,
  verifyAgainstList,
  canAuthorise,
  canDepart,
  departAfterArrive,
  MAX_APPROVED_VISITORS,
} from "@/lib/boarding/visiting";
import { sendCohortReminder, sendVisitNotification, runOverstaySweep } from "@/lib/boarding/visiting-notify";

type ActionResult = { ok: boolean; error?: string; message?: string };
const forbidden: ActionResult = { ok: false, error: "Your role cannot perform this action." };
const PATH = "/senior/boarding/operations/visiting";

interface Ctx {
  school: ActiveSchool;
  user: AppUser;
  canPastoral: boolean;
}

/** Shared guard: signed-in staff holding a BOARDING role, else null (mirrors the exeat/resumption action). */
async function ctx(): Promise<Ctx | null> {
  const { school } = await requireSchool();
  const user = await getCurrentUser();
  if (!user || !hasAnyRole(user.roles, BOARDING_ROLES)) return null;
  return { school, user, canPastoral: hasAnyRole(user.roles, BOARDING_SCHOOL_SCOPED_ROLES) };
}

/** The House a student belongs to, checked against the actor's house scope. */
async function studentHouse(
  tx: Tx,
  schoolId: string,
  studentId: string,
  user: AppUser,
): Promise<{ ok: true; houseId: string } | { ok: false; error: string }> {
  const [stu] = await tx
    .select({ residency: students.residency, status: students.status, houseId: students.houseId })
    .from(students)
    .where(and(eq(students.schoolId, schoolId), eq(students.id, studentId)))
    .limit(1);
  if (!stu || !stu.houseId) return { ok: false, error: "That student is not in a House." };
  if (stu.status !== "ACTIVE" || stu.residency !== "BOARDER") {
    return { ok: false, error: "Only an active boarder can be recorded on the Visitor's Book." };
  }
  const [house] = await tx
    .select({ hmUserId: houses.hmUserId })
    .from(houses)
    .where(and(eq(houses.schoolId, schoolId), eq(houses.id, stu.houseId)))
    .limit(1);
  if (!canAccessHouse(user.roles, user.id, house?.hmUserId)) {
    return { ok: false, error: "You can only manage the House you are assigned to." };
  }
  return { ok: true, houseId: stu.houseId };
}

// ===========================================================================
// Approved-visitor CRUD (AC B) — add/remove ≤ max 6, PENDING_REVIEW → APPROVED, Dean-gate on pastoral.
// ===========================================================================

/** Add an approved visitor to a student's list (max 6 app-enforced — AC B1/B2). Defaults PENDING_REVIEW. */
export async function addApprovedVisitor(input: unknown): Promise<ActionResult> {
  const c = await ctx();
  if (!c) return forbidden;
  const parsed = approvedVisitorInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid visitor." };
  const v = parsed.data;
  const { school, user } = c;
  const actor = await resolveActor(school.id);

  const out = await withSchool(school.id, async (tx): Promise<ActionResult> => {
    const access = await studentHouse(tx, school.id, v.studentId, user);
    if (!access.ok) return { ok: false, error: access.error };

    // Max-6 cap — app-enforced (no DB cardinality constraint); the 7th is rejected (AC B2).
    const existing = await tx
      .select({ id: boardingApprovedVisitor.id })
      .from(boardingApprovedVisitor)
      .where(and(eq(boardingApprovedVisitor.schoolId, school.id), eq(boardingApprovedVisitor.studentId, v.studentId)));
    if (existing.length >= MAX_APPROVED_VISITORS) {
      return { ok: false, error: `Max ${MAX_APPROVED_VISITORS} approved visitors per student — remove one first.` };
    }
    // A plain HM may add a pastoral-flagged entry but it is Dean-gated at approval (B4).
    const [row] = await tx
      .insert(boardingApprovedVisitor)
      .values({
        schoolId: school.id,
        studentId: v.studentId,
        name: v.name,
        relationship: v.relationship,
        phone: v.phone ?? null,
        idHint: v.idHint ?? null,
        pastoralReview: v.pastoralReview ?? false,
        note: v.note ?? null,
        addedByUserId: actor.id ?? undefined,
      })
      .returning({ id: boardingApprovedVisitor.id });

    await recordAudit(tx, {
      schoolId: school.id,
      actorUserId: actor.id ?? undefined,
      actorRole: actor.role,
      actionType: "BOARDING_APPROVED_VISITOR_ADDED",
      entityType: "boarding_approved_visitor",
      entityId: row.id,
      // PII discipline: relationship + pastoral flag are audited, NEVER the name/phone/ID hint (AC J4).
      after: { studentId: v.studentId, relationship: v.relationship, pastoralReview: v.pastoralReview ?? false },
    });
    return { ok: true, message: "Approved visitor added · pending review." };
  });
  if (out.ok) safeRevalidate(PATH);
  return out;
}

/** Remove an approved visitor (AC B6 — past visits keep the snapshot with approved_visitor_id nulled). */
export async function removeApprovedVisitor(visitorId: string): Promise<ActionResult> {
  const c = await ctx();
  if (!c) return forbidden;
  if (!z.string().uuid().safeParse(visitorId).success) return { ok: false, error: "Invalid visitor id." };
  const { school, user } = c;
  const actor = await resolveActor(school.id);

  const out = await withSchool(school.id, async (tx): Promise<ActionResult> => {
    const [row] = await tx
      .select({ studentId: boardingApprovedVisitor.studentId, relationship: boardingApprovedVisitor.relationship })
      .from(boardingApprovedVisitor)
      .where(and(eq(boardingApprovedVisitor.schoolId, school.id), eq(boardingApprovedVisitor.id, visitorId)))
      .limit(1);
    if (!row) return { ok: false, error: "That visitor is not on the list." };
    const access = await studentHouse(tx, school.id, row.studentId, user);
    if (!access.ok) return { ok: false, error: access.error };

    await tx
      .delete(boardingApprovedVisitor)
      .where(and(eq(boardingApprovedVisitor.schoolId, school.id), eq(boardingApprovedVisitor.id, visitorId)));
    await recordAudit(tx, {
      schoolId: school.id,
      actorUserId: actor.id ?? undefined,
      actorRole: actor.role,
      actionType: "BOARDING_APPROVED_VISITOR_REMOVED",
      entityType: "boarding_approved_visitor",
      entityId: visitorId,
      before: { studentId: row.studentId, relationship: row.relationship },
    });
    return { ok: true, message: "Approved visitor removed." };
  });
  if (out.ok) safeRevalidate(PATH);
  return out;
}

/** Approve a PENDING_REVIEW visitor → APPROVED (AC B3). A pastoral-flagged entry is Dean-gated (B4 stub). */
export async function approveApprovedVisitor(visitorId: string): Promise<ActionResult> {
  const c = await ctx();
  if (!c) return forbidden;
  if (!z.string().uuid().safeParse(visitorId).success) return { ok: false, error: "Invalid visitor id." };
  const { school, user, canPastoral } = c;
  const actor = await resolveActor(school.id);

  const out = await withSchool(school.id, async (tx): Promise<ActionResult> => {
    const [row] = await tx
      .select({
        studentId: boardingApprovedVisitor.studentId,
        status: boardingApprovedVisitor.status,
        pastoralReview: boardingApprovedVisitor.pastoralReview,
      })
      .from(boardingApprovedVisitor)
      .where(and(eq(boardingApprovedVisitor.schoolId, school.id), eq(boardingApprovedVisitor.id, visitorId)))
      .limit(1);
    if (!row) return { ok: false, error: "That visitor is not on the list." };
    const access = await studentHouse(tx, school.id, row.studentId, user);
    if (!access.ok) return { ok: false, error: access.error };
    if (row.pastoralReview && !canPastoral) {
      return { ok: false, error: "A pastoral-sensitive visitor needs the Dean of Boarding to approve." };
    }
    if (row.status === "APPROVED") return { ok: true, message: "Already approved." };

    await tx
      .update(boardingApprovedVisitor)
      .set({ status: "APPROVED", approvedByUserId: actor.id ?? undefined, approvedAt: new Date() })
      .where(and(eq(boardingApprovedVisitor.schoolId, school.id), eq(boardingApprovedVisitor.id, visitorId)));
    await recordAudit(tx, {
      schoolId: school.id,
      actorUserId: actor.id ?? undefined,
      actorRole: actor.role,
      actionType: "BOARDING_APPROVED_VISITOR_APPROVED",
      entityType: "boarding_approved_visitor",
      entityId: visitorId,
      after: { studentId: row.studentId, pastoralReview: row.pastoralReview },
    });
    return { ok: true, message: "Approved visitor confirmed." };
  });
  if (out.ok) safeRevalidate(PATH);
  return out;
}

// ===========================================================================
// Visit gate-check (AC C/D) — RSVP / arrive (list-check → VERIFIED|FLAGGED) → depart. Walk-ins insert
// fresh; named RSVPs upsert on uniq_boarding_visit_rsvp. Never a hard turn-away.
// ===========================================================================

async function requireVisitingEvent(
  tx: Tx,
  schoolId: string,
  eventId: string,
): Promise<{ id: string } | null> {
  const [ev] = await tx
    .select({ id: boardingCalendarEvent.id })
    .from(boardingCalendarEvent)
    .where(
      and(
        eq(boardingCalendarEvent.schoolId, schoolId),
        eq(boardingCalendarEvent.id, eventId),
        eq(boardingCalendarEvent.eventType, "VISITING"),
      ),
    )
    .limit(1);
  return ev ?? null;
}

/**
 * Record a visit at the gate (AC C/D). A chosen approved-visitor takes the list-check path (VERIFIED on
 * an APPROVED match, FLAGGED on a PENDING one — never silently VERIFIED); a walk-in is FLAGGED and
 * inserts a fresh row (NULL approved_visitor_id, NULL-distinct so walk-ins coexist). Named RSVPs upsert
 * on uniq_boarding_visit_rsvp (re-RSVP idempotency — D6). ARRIVE stamps arrived_at; a walk-in ARRIVE
 * lands directly at ARRIVED (D5). House-scoped, audited, atomic. Never fee/discipline-gated (OQ-F).
 */
export async function recordVisit(input: unknown): Promise<ActionResult> {
  const c = await ctx();
  if (!c) return forbidden;
  const parsed = recordVisitInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid visit." };
  const v = parsed.data;
  const { school, user } = c;
  const actor = await resolveActor(school.id);
  const now = new Date();

  const out = await withSchool(
    school.id,
    async (tx): Promise<ActionResult & { visitId?: string; fireArrival?: boolean }> => {
      const access = await studentHouse(tx, school.id, v.studentId, user);
      if (!access.ok) return { ok: false, error: access.error };

      let eventId: string | null = null;
      if (v.calendarEventId) {
        const ev = await requireVisitingEvent(tx, school.id, v.calendarEventId);
        if (!ev) return { ok: false, error: "That visiting event does not exist." };
        eventId = ev.id;
      }

      const arriving = v.action === "ARRIVE";
      let visitorName: string;
      let visitorPhone: string | null;
      let relationship: string | null;
      let verification: "VERIFIED" | "FLAGGED";
      let approvedVisitorId: string | null = null;

      if (v.approvedVisitorId) {
        // List-check path — the chosen approved visitor must belong to THIS student (tenant-scoped).
        const [av] = await tx
          .select({
            id: boardingApprovedVisitor.id,
            name: boardingApprovedVisitor.name,
            phone: boardingApprovedVisitor.phone,
            relationship: boardingApprovedVisitor.relationship,
            status: boardingApprovedVisitor.status,
          })
          .from(boardingApprovedVisitor)
          .where(
            and(
              eq(boardingApprovedVisitor.schoolId, school.id),
              eq(boardingApprovedVisitor.id, v.approvedVisitorId),
              eq(boardingApprovedVisitor.studentId, v.studentId),
            ),
          )
          .limit(1);
        if (!av) return { ok: false, error: "That visitor is not on this student's approved list." };
        approvedVisitorId = av.id;
        visitorName = av.name;
        visitorPhone = av.phone;
        relationship = av.relationship;
        verification = verifyAgainstList({ status: av.status as "PENDING_REVIEW" | "APPROVED" });
      } else {
        // Walk-in — not on the list → FLAGGED (never silently VERIFIED, never a hard turn-away).
        visitorName = v.visitorName!;
        visitorPhone = v.phone ?? null;
        relationship = v.relationship ?? null;
        verification = "FLAGGED";
      }

      const values = {
        schoolId: school.id,
        studentId: v.studentId,
        houseId: access.houseId,
        calendarEventId: eventId,
        approvedVisitorId,
        visitorName,
        visitorPhone,
        relationship,
        status: (arriving ? "ARRIVED" : "RSVP") as "RSVP" | "ARRIVED",
        verification,
        zoneKey: v.zoneKey ?? null,
        note: v.note ?? null,
        rsvpByUserId: actor.id ?? undefined,
        arrivedAt: arriving ? now : null,
        arrivedByUserId: arriving ? actor.id ?? undefined : undefined,
      };

      let visitId: string;
      if (approvedVisitorId && eventId) {
        // Named RSVP — upsert on uniq_boarding_visit_rsvp (collapses a re-RSVP for the same visitor — D6).
        const [row] = await tx
          .insert(boardingVisit)
          .values(values)
          .onConflictDoUpdate({
            target: [
              boardingVisit.schoolId,
              boardingVisit.studentId,
              boardingVisit.calendarEventId,
              boardingVisit.approvedVisitorId,
            ],
            set: {
              visitorName,
              visitorPhone,
              relationship,
              verification,
              zoneKey: v.zoneKey ?? null,
              note: v.note ?? null,
              // Only advance the stamp when arriving; a re-RSVP never rewinds an ARRIVED row.
              ...(arriving ? { status: "ARRIVED" as const, arrivedAt: now, arrivedByUserId: actor.id ?? undefined } : {}),
            },
          })
          .returning({ id: boardingVisit.id, status: boardingVisit.status, arrivedAt: boardingVisit.arrivedAt });
        visitId = row.id;
      } else {
        // Walk-in — ALWAYS a fresh row (NULL approved_visitor_id is NULL-distinct; never onConflict).
        const [row] = await tx.insert(boardingVisit).values(values).returning({ id: boardingVisit.id });
        visitId = row.id;
      }

      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: arriving ? "BOARDING_VISIT_ARRIVED" : "BOARDING_VISIT_RSVP",
        entityType: "boarding_visit",
        entityId: visitId,
        // No visitor name/phone/ID hint in the audit payload (AC J4).
        after: { studentId: v.studentId, verification, walkIn: !approvedVisitorId, action: v.action },
      });
      return { ok: true, visitId, fireArrival: arriving, message: arriving ? "Arrival stamped." : "RSVP recorded." };
    },
  );

  if (!out.ok) return out;
  if (out.fireArrival && out.visitId) {
    const policy = await getVisitingPolicy(school.id);
    await withSchool(school.id, (tx) =>
      sendVisitNotification(tx, school.id, out.visitId!, "ARRIVAL_CONFIRM", policy, actor.id).then(() => undefined),
    );
  }
  safeRevalidate(PATH);
  return { ok: true, message: out.message };
}

async function loadVisit(
  tx: Tx,
  schoolId: string,
  visitId: string,
) {
  const [row] = await tx
    .select({
      id: boardingVisit.id,
      houseId: boardingVisit.houseId,
      studentId: boardingVisit.studentId,
      status: boardingVisit.status,
      verification: boardingVisit.verification,
      arrivedAt: boardingVisit.arrivedAt,
    })
    .from(boardingVisit)
    .where(and(eq(boardingVisit.schoolId, schoolId), eq(boardingVisit.id, visitId)))
    .limit(1);
  return row ?? null;
}

/** Stamp arrival on an existing RSVP (AC D1) — in-stamp + fires the arrival console SMS. */
export async function arriveVisit(visitId: string, zoneKey?: string): Promise<ActionResult> {
  const c = await ctx();
  if (!c) return forbidden;
  if (!z.string().uuid().safeParse(visitId).success) return { ok: false, error: "Invalid visit id." };
  const { school, user } = c;
  const actor = await resolveActor(school.id);
  const now = new Date();

  const out = await withSchool(school.id, async (tx): Promise<ActionResult & { fire?: boolean }> => {
    const visit = await loadVisit(tx, school.id, visitId);
    if (!visit) return { ok: false, error: "That visit does not exist." };
    const [house] = await tx.select({ hmUserId: houses.hmUserId }).from(houses).where(and(eq(houses.schoolId, school.id), eq(houses.id, visit.houseId))).limit(1);
    if (!canAccessHouse(user.roles, user.id, house?.hmUserId)) return { ok: false, error: "You can only manage your own House." };
    if (visit.status !== "RSVP") return { ok: false, error: "This visit has already arrived." };

    await tx
      .update(boardingVisit)
      .set({ status: "ARRIVED", arrivedAt: now, arrivedByUserId: actor.id ?? undefined, ...(zoneKey ? { zoneKey } : {}) })
      .where(and(eq(boardingVisit.schoolId, school.id), eq(boardingVisit.id, visitId)));
    await recordAudit(tx, {
      schoolId: school.id,
      actorUserId: actor.id ?? undefined,
      actorRole: actor.role,
      actionType: "BOARDING_VISIT_ARRIVED",
      entityType: "boarding_visit",
      entityId: visitId,
      after: { studentId: visit.studentId },
    });
    return { ok: true, fire: true, message: "Arrival stamped." };
  });
  if (!out.ok) return out;
  if (out.fire) {
    const policy = await getVisitingPolicy(school.id);
    await withSchool(school.id, (tx) =>
      sendVisitNotification(tx, school.id, visitId, "ARRIVAL_CONFIRM", policy, actor.id).then(() => undefined),
    );
  }
  safeRevalidate(PATH);
  return { ok: true, message: out.message };
}

/** Stamp departure (AC D2/D3/D4) — out-stamp, rejected before an arrival, departed_at ≥ arrived_at. */
export async function departVisit(visitId: string): Promise<ActionResult> {
  const c = await ctx();
  if (!c) return forbidden;
  if (!z.string().uuid().safeParse(visitId).success) return { ok: false, error: "Invalid visit id." };
  const { school, user } = c;
  const actor = await resolveActor(school.id);
  const now = new Date();

  const out = await withSchool(school.id, async (tx): Promise<ActionResult> => {
    const visit = await loadVisit(tx, school.id, visitId);
    if (!visit) return { ok: false, error: "That visit does not exist." };
    const [house] = await tx.select({ hmUserId: houses.hmUserId }).from(houses).where(and(eq(houses.schoolId, school.id), eq(houses.id, visit.houseId))).limit(1);
    if (!canAccessHouse(user.roles, user.id, house?.hmUserId)) return { ok: false, error: "You can only manage your own House." };
    if (!canDepart({ status: visit.status, arrivedAt: visit.arrivedAt })) {
      return { ok: false, error: "Cannot depart a visitor who has not arrived (record the arrival first)." };
    }
    if (visit.arrivedAt && !departAfterArrive(visit.arrivedAt, now)) {
      return { ok: false, error: "Departure cannot be before arrival." };
    }
    await tx
      .update(boardingVisit)
      .set({ status: "DEPARTED", departedAt: now, departedByUserId: actor.id ?? undefined })
      .where(and(eq(boardingVisit.schoolId, school.id), eq(boardingVisit.id, visitId)));
    await recordAudit(tx, {
      schoolId: school.id,
      actorUserId: actor.id ?? undefined,
      actorRole: actor.role,
      actionType: "BOARDING_VISIT_DEPARTED",
      entityType: "boarding_visit",
      entityId: visitId,
      after: { studentId: visit.studentId },
    });
    return { ok: true, message: "Departure stamped." };
  });
  if (out.ok) safeRevalidate(PATH);
  return out;
}

/**
 * HM override to admit a FLAGGED visit → HM_AUTHORISED (AC C4/C5/C6). Records the authoriser stamp; does
 * NOT create an approved-visitor row (list-CHECK not list-RECORD). Never a hard turn-away.
 */
export async function authoriseVisit(visitId: string): Promise<ActionResult> {
  const c = await ctx();
  if (!c) return forbidden;
  if (!z.string().uuid().safeParse(visitId).success) return { ok: false, error: "Invalid visit id." };
  const { school, user } = c;
  const actor = await resolveActor(school.id);

  const out = await withSchool(school.id, async (tx): Promise<ActionResult> => {
    const visit = await loadVisit(tx, school.id, visitId);
    if (!visit) return { ok: false, error: "That visit does not exist." };
    const [house] = await tx.select({ hmUserId: houses.hmUserId }).from(houses).where(and(eq(houses.schoolId, school.id), eq(houses.id, visit.houseId))).limit(1);
    if (!canAccessHouse(user.roles, user.id, house?.hmUserId)) return { ok: false, error: "You can only manage your own House." };
    if (!canAuthorise(visit.verification)) {
      return { ok: false, error: "Only a flagged visit needs an HM override." };
    }
    await tx
      .update(boardingVisit)
      .set({ verification: "HM_AUTHORISED", authorisedAt: new Date(), authorisedByUserId: actor.id ?? undefined })
      .where(and(eq(boardingVisit.schoolId, school.id), eq(boardingVisit.id, visitId)));
    await recordAudit(tx, {
      schoolId: school.id,
      actorUserId: actor.id ?? undefined,
      actorRole: actor.role,
      actionType: "BOARDING_VISIT_HM_AUTHORISED",
      entityType: "boarding_visit",
      entityId: visitId,
      before: { verification: "FLAGGED" },
      after: { verification: "HM_AUTHORISED", studentId: visit.studentId, listRecorded: false },
    });
    return { ok: true, message: "Visit admitted on HM authorisation (not added to the approved list)." };
  });
  if (out.ok) safeRevalidate(PATH);
  return out;
}

// ===========================================================================
// SMS chain (AC I) — cohort reminder + overstay sweep. Console provider, idempotent, no cost.
// ===========================================================================

/** Send the cohort RSVP reminder (default T-3) — idempotent per (event × kind), console-only (AC I). */
export async function sendVisitingReminder(
  eventId: string,
  kind: "INVITATION" | "REMINDER_T3" | "REMINDER_T1" = "REMINDER_T3",
): Promise<ActionResult> {
  const c = await ctx();
  if (!c) return forbidden;
  if (!z.string().uuid().safeParse(eventId).success) return { ok: false, error: "Invalid event id." };
  const { school, user } = c;
  const actor = await resolveActor(school.id);

  const event = await eventFor(school.id, eventId);
  if (!event) return { ok: false, error: "That visiting event does not exist." };
  const policy = await getVisitingPolicy(school.id);
  const res = await sendCohortReminder(school.id, user.roles, user.id, event, policy, kind, actor.id);
  if (!res.ok) return { ok: false, error: res.error ?? "Could not send the reminder." };
  safeRevalidate(PATH);
  return {
    ok: true,
    message: res.skipped
      ? "Reminder already sent for this visiting Sunday (idempotent — no double-send)."
      : `RSVP reminder sent to ${res.sent} parent${res.sent === 1 ? "" : "s"} (console).`,
  };
}

/** Run the overstay sweep on-read (AC G2) — HM console SMS per overstaying visit, ZERO discipline rows. */
export async function runVisitingOverstayChecks(eventId: string): Promise<ActionResult> {
  const c = await ctx();
  if (!c) return forbidden;
  if (!z.string().uuid().safeParse(eventId).success) return { ok: false, error: "Invalid event id." };
  const { school, user } = c;
  const actor = await resolveActor(school.id);

  const event = await eventFor(school.id, eventId);
  if (!event) return { ok: false, error: "That visiting event does not exist." };
  const policy = await getVisitingPolicy(school.id);
  const summary = await runOverstaySweep(school.id, user.roles, user.id, event, policy, actor.id);
  safeRevalidate(PATH);
  return {
    ok: true,
    message:
      summary.checked === 0
        ? "No visitors overstaying past gate close — nothing to send."
        : `Checked ${summary.checked} overstaying · ${summary.sent} HM reminder SMS sent (console · no discipline written).`,
  };
}

/** Resolve a VISITING calendar event (id + date + formScope) for the SMS actions. */
async function eventFor(schoolId: string, eventId: string) {
  return withSchool(schoolId, async (tx) => {
    const [ev] = await tx
      .select({
        id: boardingCalendarEvent.id,
        eventType: boardingCalendarEvent.eventType,
        eventDate: boardingCalendarEvent.eventDate,
        label: boardingCalendarEvent.label,
        formScope: boardingCalendarEvent.formScope,
        sequence: boardingCalendarEvent.sequence,
      })
      .from(boardingCalendarEvent)
      .where(
        and(
          eq(boardingCalendarEvent.schoolId, schoolId),
          eq(boardingCalendarEvent.id, eventId),
          eq(boardingCalendarEvent.eventType, "VISITING"),
        ),
      )
      .limit(1);
    if (!ev) return null;
    return {
      id: ev.id,
      eventType: "VISITING" as const,
      date: ev.eventDate,
      label: ev.label,
      formScope: ev.formScope,
      sequence: ev.sequence,
    };
  });
}
