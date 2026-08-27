"use server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { withSchool, withoutTenantScope } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { getCurrentUser } from "@/lib/auth";
import { hasAnyRole, BOARDING_ROLES, canAccessHouse } from "@/lib/access";
import { flushSms, type SmsIntent } from "@/lib/sms";
import { safeRevalidate } from "@/lib/revalidate";
import { hashRsvpToken, DOB_ATTEMPT_CAP } from "@/lib/boarding/rsvp-token";
import {
  students,
  houses,
  studentGuardians,
  boardingCalendarEvent,
  boardingVisit,
  boardingVisitRsvpToken,
} from "@/db/schema";

/**
 * INCR #298 part B — the public tokenised parent RSVP link.
 *
 * Staff issue a per-(ward × visiting-day) link; it is SMS'd to the ward's STORED guardian phone (never a
 * request-supplied number). The parent opens it and passes a second factor — the ward's DATE OF BIRTH
 * (owner decision) — to submit an RSVP. The raw token is NEVER stored: only its SHA-256 hash lives in
 * `boarding_visit_rsvp_token.token_hash` (the raw lives only in the SMS link). The public submit runs
 * unauthenticated, so it resolves school/student/event FROM THE TOKEN under `withoutTenantScope` and
 * writes ONE idempotent `boarding_visit` at RSVP/FLAGGED scoped to the token's own school — it never
 * trusts a request-supplied school/student, and never exposes any other student or the visitor book.
 *
 * Defenses: the 192-bit token is unguessable; the low-entropy DOB is fenced by a per-token attempt cap
 * (`attempts`, capped here) so a leaked token can't be DOB-brute-forced; expiry + revocation bound the
 * link's life. (Turnstile server-verify is deferred to #302 — the attempt cap is the interim fence.)
 */

const VISIT_PATH = "/senior/boarding/operations/visiting";
const GENERIC_SUBMIT_ERROR = "This link is invalid, has expired, or the details don't match.";

type Result = { ok: boolean; error?: string; message?: string };

// ===========================================================================
// Staff: issue a parent RSVP link (BOARDING_ROLES + own-House, ACTIVE boarder, has DOB + guardian)
// ===========================================================================

const IssueSchema = z.object({
  studentId: z.string().uuid(),
  calendarEventId: z.string().uuid(),
});

export async function issueRsvpToken(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  const user = await getCurrentUser();
  if (!user || !hasAnyRole(user.roles, BOARDING_ROLES)) {
    return { ok: false, error: "Your role cannot issue parent links." };
  }
  const parsed = IssueSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { studentId, calendarEventId } = parsed.data;
  const actor = await resolveActor(school.id);

  // The SMS link is the ENTIRE payload here (unlike the receipt, which supplements a PDF). If the public
  // base URL is unset the link would be a useless relative path and the parent permanently stranded with
  // a committed dead token — so fail BEFORE minting anything (Dex MINOR-1).
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  if (!base) {
    return { ok: false, error: "The public site address isn't configured, so a parent link can't be created yet. Contact support." };
  }

  // Generated OUTSIDE the tx so only the hash is ever persisted; the raw exists only here + the SMS.
  const raw = randomBytes(24).toString("base64url"); // 192-bit CSPRNG
  const tokenHash = hashRsvpToken(raw);

  const sms: SmsIntent[] = [];
  const outcome = await withSchool(school.id, async (tx) => {
    const [stu] = await tx
      .select({
        houseId: students.houseId,
        status: students.status,
        residency: students.residency,
        firstName: students.firstName,
        dob: students.dateOfBirth,
      })
      .from(students)
      .where(and(eq(students.schoolId, school.id), eq(students.id, studentId)))
      .limit(1);
    if (!stu || !stu.houseId) return { error: "That boarder is not in a House." };
    if (stu.status !== "ACTIVE" || stu.residency !== "BOARDER") {
      return { error: "Only an active boarder can be sent a parent link." };
    }
    // DOB is the second factor — a ward without one on file can never pass it, so refuse to issue.
    if (!stu.dob) {
      return { error: "This boarder has no date of birth on file — add it before issuing the link (it is the parent's verification factor)." };
    }
    const [house] = await tx
      .select({ hmUserId: houses.hmUserId })
      .from(houses)
      .where(and(eq(houses.schoolId, school.id), eq(houses.id, stu.houseId)))
      .limit(1);
    if (!canAccessHouse(user.roles, user.id, house?.hmUserId)) {
      return { error: "You can only manage the House you are assigned to." };
    }

    const [ev] = await tx
      .select({ id: boardingCalendarEvent.id, date: boardingCalendarEvent.eventDate })
      .from(boardingCalendarEvent)
      .where(
        and(
          eq(boardingCalendarEvent.schoolId, school.id),
          eq(boardingCalendarEvent.id, calendarEventId),
          eq(boardingCalendarEvent.eventType, "VISITING"),
        ),
      )
      .limit(1);
    if (!ev) return { error: "That visiting event does not exist." };
    // Expire at the end of the event day (Ghana = UTC+0, so the explicit Z is end-of-day Accra).
    const expiresAt = new Date(`${ev.date}T23:59:59Z`);

    // The ward's STORED primary guardian is the only delivery target (never a request-supplied number).
    const [g] = await tx
      .select({ id: studentGuardians.id, phone: studentGuardians.phone })
      .from(studentGuardians)
      .where(
        and(
          eq(studentGuardians.schoolId, school.id),
          eq(studentGuardians.studentId, studentId),
          eq(studentGuardians.isPrimary, true),
        ),
      )
      .limit(1);
    if (!g) return { error: "This boarder has no primary guardian on file to send the link to." };

    const [row] = await tx
      .insert(boardingVisitRsvpToken)
      .values({
        schoolId: school.id,
        studentId,
        calendarEventId: ev.id,
        tokenHash,
        issuedToPhone: g.phone,
        guardianId: g.id,
        issuedByUserId: actor.id ?? undefined,
        expiresAt,
      })
      .returning({ id: boardingVisitRsvpToken.id });

    await recordAudit(tx, {
      schoolId: school.id,
      actorUserId: actor.id ?? undefined,
      actorRole: actor.role,
      actionType: "BOARDING_RSVP_TOKEN_ISSUED",
      entityType: "student",
      entityId: studentId,
      after: { tokenId: row.id, calendarEventId: ev.id },
      reason: "Parent RSVP link issued",
    });

    const link = `${base}/rsvp/${raw}`;
    const sender = school.shortName ?? "Omnischools";
    sms.push({
      to: g.phone,
      body: `${sender}: Confirm your visit for ${stu.firstName}'s visiting day. Open the link and enter your child's date of birth to RSVP: ${link}`,
    });
    return { ok: true as const };
  });

  if ("error" in outcome) return { ok: false, error: outcome.error };
  await flushSms(sms); // #253 — SMS goes out only after the token tx commits.
  safeRevalidate(VISIT_PATH);
  return { ok: true, message: "Link texted to the guardian's phone on file." };
}

// ===========================================================================
// Staff: revoke a link early (BOARDING_ROLES + own-House)
// ===========================================================================

const RevokeSchema = z.object({ tokenId: z.string().uuid() });

export async function revokeRsvpToken(input: unknown): Promise<Result> {
  const { school } = await requireSchool();
  const user = await getCurrentUser();
  if (!user || !hasAnyRole(user.roles, BOARDING_ROLES)) {
    return { ok: false, error: "Your role cannot revoke parent links." };
  }
  const parsed = RevokeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { tokenId } = parsed.data;
  const actor = await resolveActor(school.id);

  const outcome = await withSchool(school.id, async (tx) => {
    const [t] = await tx
      .select({ id: boardingVisitRsvpToken.id, studentId: boardingVisitRsvpToken.studentId, revokedAt: boardingVisitRsvpToken.revokedAt })
      .from(boardingVisitRsvpToken)
      .where(and(eq(boardingVisitRsvpToken.schoolId, school.id), eq(boardingVisitRsvpToken.id, tokenId)))
      .limit(1);
    if (!t) return { error: "That link does not exist." };
    // Own-House fence via the ward — ALWAYS enforced. A ward off any House (houseId null) yields a null
    // hmUserId, so canAccessHouse denies a plain HOUSEMASTER (fail-closed) while still allowing a
    // school-scoped role (Admin/Headmaster/Dean) — never an unfenced revoke (Quinn MINOR).
    const [stu] = await tx
      .select({ houseId: students.houseId })
      .from(students)
      .where(and(eq(students.schoolId, school.id), eq(students.id, t.studentId)))
      .limit(1);
    let hmUserId: string | null | undefined;
    if (stu?.houseId) {
      const [house] = await tx
        .select({ hmUserId: houses.hmUserId })
        .from(houses)
        .where(and(eq(houses.schoolId, school.id), eq(houses.id, stu.houseId)))
        .limit(1);
      hmUserId = house?.hmUserId;
    }
    if (!canAccessHouse(user.roles, user.id, hmUserId)) {
      return { error: "You can only manage the House you are assigned to." };
    }
    if (t.revokedAt) return { ok: true as const }; // idempotent
    await tx
      .update(boardingVisitRsvpToken)
      .set({ revokedAt: new Date() })
      .where(and(eq(boardingVisitRsvpToken.schoolId, school.id), eq(boardingVisitRsvpToken.id, tokenId)));
    await recordAudit(tx, {
      schoolId: school.id,
      actorUserId: actor.id ?? undefined,
      actorRole: actor.role,
      actionType: "BOARDING_RSVP_TOKEN_REVOKED",
      entityType: "student",
      entityId: t.studentId,
      after: { tokenId },
      reason: "Parent RSVP link revoked",
    });
    return { ok: true as const };
  });

  if ("error" in outcome) return { ok: false, error: outcome.error };
  safeRevalidate(VISIT_PATH);
  return { ok: true };
}

// ===========================================================================
// Public (UNAUTHENTICATED): submit a parent RSVP. Scope comes from the token ONLY.
// ===========================================================================

const SubmitSchema = z.object({
  token: z.string().min(10).max(256),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter your child's date of birth."),
  visitorName: z.string().trim().min(2, "Enter the visitor's name.").max(120),
  note: z.string().trim().max(280).optional(),
});

export type SubmitRsvpResult =
  | { ok: true; wardName: string }
  | { ok: false; error: string };

export async function submitParentRsvp(input: unknown): Promise<SubmitRsvpResult> {
  const parsed = SubmitSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the form and try again." };
  }
  const { token, dob, visitorName, note } = parsed.data;
  const tokenHash = hashRsvpToken(token);

  try {
    const result = await withoutTenantScope(async (tx) => {
      const [t] = await tx
        .select({
          id: boardingVisitRsvpToken.id,
          schoolId: boardingVisitRsvpToken.schoolId,
          studentId: boardingVisitRsvpToken.studentId,
          calendarEventId: boardingVisitRsvpToken.calendarEventId,
          visitId: boardingVisitRsvpToken.visitId,
          expiresAt: boardingVisitRsvpToken.expiresAt,
          revokedAt: boardingVisitRsvpToken.revokedAt,
          attempts: boardingVisitRsvpToken.attempts,
        })
        .from(boardingVisitRsvpToken)
        .where(eq(boardingVisitRsvpToken.tokenHash, tokenHash))
        .limit(1)
        .for("update"); // lock the token row so concurrent submits serialize (no duplicate first-insert)
      // No oracle: a bad/expired/revoked/locked link all return the SAME generic message.
      if (!t || t.revokedAt || t.expiresAt.getTime() < Date.now()) return { kind: "bad" as const };
      if (t.attempts >= DOB_ATTEMPT_CAP) return { kind: "locked" as const };

      // Second factor: the ward's DOB, read scoped to the TOKEN's school+student (never request input).
      const [stu] = await tx
        .select({ dob: students.dateOfBirth, firstName: students.firstName, houseId: students.houseId })
        .from(students)
        .where(and(eq(students.schoolId, t.schoolId), eq(students.id, t.studentId)))
        .limit(1);
      // Fail CLOSED: a missing ward, a null DOB, or a mismatch all bump the counter and return generic.
      if (!stu || !stu.dob || !stu.houseId || stu.dob !== dob) {
        await tx
          .update(boardingVisitRsvpToken)
          .set({ attempts: sql`${boardingVisitRsvpToken.attempts} + 1` })
          .where(eq(boardingVisitRsvpToken.id, t.id));
        return { kind: "bad" as const };
      }

      // Passed. Write ONE idempotent boarding_visit scoped to the TOKEN's school. The token is REUSABLE
      // and lives until the event day ends, and its visit_id points at the SAME row staff progress at the
      // gate — so a replay must be STATE-SAFE: refresh ONLY the parent-editable fields and NEVER force
      // status/verification back. A parent re-opening the live link after arrive/HM-authorise must not
      // rewind that (Quinn MAJOR). First submit lands RSVP/FLAGGED; gate staff verify on arrival.
      let resolvedVisitId: string;
      if (t.visitId) {
        await tx
          .update(boardingVisit)
          .set({ visitorName, note: note ?? null })
          .where(and(eq(boardingVisit.schoolId, t.schoolId), eq(boardingVisit.id, t.visitId)));
        resolvedVisitId = t.visitId;
      } else {
        const [row] = await tx
          .insert(boardingVisit)
          .values({
            schoolId: t.schoolId,
            studentId: t.studentId,
            houseId: stu.houseId,
            calendarEventId: t.calendarEventId,
            approvedVisitorId: null,
            visitorName,
            status: "RSVP",
            verification: "FLAGGED", // parent self-RSVP is never auto-verified; gate staff verify on arrival
            note: note ?? null,
            rsvpByUserId: null, // NULL rsvp_by + a token row = the parent-self-RSVP origin
          })
          .returning({ id: boardingVisit.id });
        resolvedVisitId = row.id;
        await tx
          .update(boardingVisitRsvpToken)
          .set({ visitId: resolvedVisitId })
          .where(eq(boardingVisitRsvpToken.id, t.id));
      }
      // Clear the brute-force counter on success.
      await tx
        .update(boardingVisitRsvpToken)
        .set({ attempts: 0 })
        .where(eq(boardingVisitRsvpToken.id, t.id));

      await recordAudit(tx, {
        schoolId: t.schoolId,
        actionType: "BOARDING_VISIT_RSVP",
        entityType: "boarding_visit",
        entityId: resolvedVisitId,
        after: { origin: "parent-link" },
        reason: "Parent self-RSVP via link",
      });
      return { kind: "ok" as const, wardName: stu.firstName };
    });

    if (result.kind === "ok") return { ok: true, wardName: result.wardName };
    if (result.kind === "locked") {
      return { ok: false, error: "Too many attempts on this link. Please contact the school." };
    }
    return { ok: false, error: GENERIC_SUBMIT_ERROR };
  } catch {
    return { ok: false, error: "Something went wrong. Please try again in a moment." };
  }
}
