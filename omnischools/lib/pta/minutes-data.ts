/**
 * SERVER-ONLY PTA minutes read (SHS module 4.7 / INCR-53). Loads the status-aware minutes view: the R454
 * DERIVED preamble (REUSED from the INCR-52 register reader — nothing preamble-shaped is stored), the agenda-
 * item subtree (classification + narrative), the single ACTION / RESOLUTION child per item, the R448 derived
 * outcome, the R453 provisional/frozen resolution number, and the R455 validator state. Imports the DB driver
 * via withSchool — NEVER import from a client component ([[reports-data-is-server-only]]); the page passes
 * plain pre-formatted primitives to the client editor. Tenant-scoped; RLS is the boundary.
 *
 * The preamble (PTA/meeting name, date/times/location, Chair, Secretary, attendance aggregates, quorum) is
 * DERIVED from the register + officers at read (R454) by delegating to `getPtaMeeting`; it is stable once
 * adopted because adoption waits for the meeting write-lock (R450). The Chair adopt-access is server-loaded
 * here (never request-supplied) and computed by the PURE `computeChairAccess` (lib/pta/minutes.ts).
 */
import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import type { Tx } from "@/lib/db";
import {
  ptaMinutes,
  ptaAgendaItem,
  ptaActionItem,
  ptaResolution,
  ptaOfficer,
  ptaMeeting,
  users,
} from "@/db/schema";
import { getPtaMeeting, loadMeetingScope } from "./meeting-data";
import { coalesceExOfficio, fmtISODate } from "./officers";
import { coalesceGraceHours, derivePtaMeetingClock, isPtaMeetingEnded } from "./meeting-clock";
import {
  CHAIR_OFFICE,
  computeChairAccess,
  resolutionOutcome,
  resolutionHasVotes,
  validateMinutesForReview,
  nextResolutionSeqStart,
  resolutionScopeToken,
  formatResolutionNo,
  slugToken,
  type MinutesStatus,
  type Classification,
  type MinutesValidation,
  type AgendaItemForValidation,
} from "./minutes";

export type { MinutesStatus, Classification, MinutesValidation };

// ── view types (plain serializable — the page passes these to the client editor) ─────────────────────

export interface MinutesActionView {
  id: string;
  agendaItemId: string;
  description: string;
  ownerName: string | null;
  ownerUserId: string | null;
  externalName: string | null;
  deadlineISO: string | null;
  deadlineLabel: string; // "20 Jun 2026" / "Ongoing"
  status: "PENDING" | "DONE";
}

export interface MinutesResolutionView {
  id: string;
  agendaItemId: string;
  resolutionNo: string | null; // frozen once adopted; NULL while drafting
  provisionalNo: string; // the {scope}-{period}-{NNN} preview while draft/review (R453)
  resolutionText: string;
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
  binding: boolean;
  outcome: "PASSED" | "NOT_PASSED";
  hasVotes: boolean;
}

export interface MinutesAgendaItemView {
  id: string;
  seqNo: number;
  title: string;
  classification: Classification | null;
  narrative: string | null;
  action: MinutesActionView | null;
  resolution: MinutesResolutionView | null;
}

export interface MinutesPreamble {
  label: string;
  tierLabel: string;
  meetingType: string;
  dateLabel: string;
  timeLabel: string;
  location: string | null;
  periodLabel: string | null;
  chairName: string | null;
  secretaryName: string | null;
  parentsPresent: number;
  parentsLate: number;
  parentsAbsent: number;
  parentsTotal: number;
  teacherPresent: number;
  teacherTotal: number;
  quorumRule: string;
  quorumMet: boolean | null;
  quorumPct: number | null;
}

export interface PtaMinutesView {
  meetingId: string;
  minutesId: string | null; // null = no draft created yet
  status: MinutesStatus | null;
  tierType: string;
  preamble: MinutesPreamble;
  agendaItems: MinutesAgendaItemView[];
  validator: MinutesValidation;
  belowQuorum: boolean; // quorum_met !== true → the RESOLUTION classification is disabled (R452)
  meetingEnded: boolean; // now ≥ end (the draft-create gate, R450)
  writeLocked: boolean; // now ≥ end + grace (the adopt gate, R450)
  lockLabel: string;
  canDraft: boolean; // Secretary ∥ break-glass (the draft-side actions)
  canAdopt: boolean; // Chair ∥ break-glass (adopt / return-to-draft)
  adoptedAt: string | null;
  adoptedByName: string | null;
  distributedAt: string | null;
}

// ── the Chair adopt-access — server-loads the offices held in THIS pta, then the PURE decision ────────

export async function resolvePtaChairAccess(
  tx: Tx,
  schoolId: string,
  ptaId: string,
  viewer: { userId: string | null; roles: readonly string[] },
): Promise<boolean> {
  let heldOffices: string[] = [];
  if (viewer.userId) {
    const rows = await tx
      .select({ office: ptaOfficer.office })
      .from(ptaOfficer)
      .where(
        and(
          eq(ptaOfficer.schoolId, schoolId),
          eq(ptaOfficer.ptaId, ptaId),
          eq(ptaOfficer.personUserId, viewer.userId),
          isNull(ptaOfficer.endedAt),
        ),
      );
    heldOffices = rows.map((r) => r.office);
  }
  return computeChairAccess({ heldOffices, viewer });
}

/**
 * Load the frozen/provisional resolution-number cursor for a (pta × academic period): the highest NNN over
 * the ADOPTED resolutions of that scope. Shared by the read (provisional preview) and adopt (real assignment).
 */
export async function loadResolutionSeqStart(
  tx: Tx,
  schoolId: string,
  ptaId: string,
  academicPeriodId: string,
): Promise<number> {
  const rows = await tx
    .select({ no: ptaResolution.resolutionNo })
    .from(ptaResolution)
    .innerJoin(ptaAgendaItem, and(eq(ptaAgendaItem.schoolId, ptaResolution.schoolId), eq(ptaAgendaItem.id, ptaResolution.agendaItemId)))
    .innerJoin(ptaMinutes, and(eq(ptaMinutes.schoolId, ptaAgendaItem.schoolId), eq(ptaMinutes.id, ptaAgendaItem.minutesId)))
    .innerJoin(ptaMeeting, and(eq(ptaMeeting.schoolId, ptaMinutes.schoolId), eq(ptaMeeting.id, ptaMinutes.meetingId)))
    .where(
      and(
        eq(ptaResolution.schoolId, schoolId),
        eq(ptaMeeting.ptaId, ptaId),
        eq(ptaMeeting.academicPeriodId, academicPeriodId),
      ),
    );
  return nextResolutionSeqStart(rows.map((r) => r.no));
}

// ── the status-aware read ─────────────────────────────────────────────────────────────────────────────

export async function getMinutesView(
  schoolId: string,
  meetingId: string,
  viewer: { userId: string | null; roles: readonly string[] },
  now: Date = new Date(),
): Promise<PtaMinutesView | null> {
  // Reuse the INCR-52 register reader for the R454 preamble (name/date/times/location/officers/attendance/
  // quorum) — nothing preamble-shaped is stored on the minutes.
  const meeting = await getPtaMeeting(schoolId, meetingId, viewer, now);
  if (!meeting) return null;

  return withSchool(schoolId, async (tx) => {
    const scope = await loadMeetingScope(tx, schoolId, meetingId);
    if (!scope) return null;

    const secretaryOffice = coalesceExOfficio(scope.tierSettings).exOfficioOffice;
    const allRows = [...meeting.teacherRows, ...meeting.parentRows];
    const chairName = allRows.find((r) => r.officerTag === CHAIR_OFFICE)?.name ?? null;
    const secretaryName =
      allRows.find(
        (r) => r.officerTag === secretaryOffice || r.officerTag === `${secretaryOffice} (ex-officio)`,
      )?.name ?? null;

    const parentsPresent = meeting.parentRows.filter((r) => r.status === "present").length;
    const parentsLate = meeting.parentRows.filter((r) => r.status === "late").length;
    const parentsAbsent = meeting.parentRows.filter((r) => r.status === "absent").length;

    const grace = coalesceGraceHours(scope.tierSettings);
    const clock = derivePtaMeetingClock(scope.meetingDate, scope.startTime, scope.endTime, grace, now);
    const meetingEnded = isPtaMeetingEnded(scope.meetingDate, scope.endTime, now);
    const canAdopt = await resolvePtaChairAccess(tx, schoolId, scope.ptaId, viewer);

    const preamble: MinutesPreamble = {
      label: meeting.label,
      tierLabel: meeting.tierLabel,
      meetingType: meeting.meetingType,
      dateLabel: meeting.dateLabel,
      timeLabel: meeting.timeLabel,
      location: meeting.location,
      periodLabel: meeting.periodLabel,
      chairName,
      secretaryName,
      parentsPresent,
      parentsLate,
      parentsAbsent,
      parentsTotal: meeting.quorum.totalParents,
      teacherPresent: meeting.quorum.teacherPresent,
      teacherTotal: meeting.quorum.teacherTotal,
      quorumRule: meeting.quorum.ruleText,
      quorumMet: meeting.quorum.quorumMet,
      quorumPct: meeting.quorum.pct,
    };

    const [m] = await tx
      .select({
        id: ptaMinutes.id,
        status: ptaMinutes.status,
        adoptedAt: ptaMinutes.adoptedAt,
        adoptedByUserId: ptaMinutes.adoptedByUserId,
        distributedAt: ptaMinutes.distributedAt,
      })
      .from(ptaMinutes)
      .where(and(eq(ptaMinutes.schoolId, schoolId), eq(ptaMinutes.meetingId, meetingId)))
      .limit(1);

    const belowQuorum = scope.quorumMet !== true;
    const commonTail = {
      meetingId,
      tierType: scope.tierType,
      preamble,
      belowQuorum,
      meetingEnded,
      writeLocked: clock.writeLocked,
      lockLabel: clock.lockLabel,
      canDraft: meeting.canWrite,
      canAdopt,
    };

    if (!m) {
      return {
        ...commonTail,
        minutesId: null,
        status: null,
        agendaItems: [],
        validator: validateMinutesForReview([], scope.quorumMet),
        adoptedAt: null,
        adoptedByName: null,
        distributedAt: null,
      } satisfies PtaMinutesView;
    }

    // Agenda subtree, ordered by display seq.
    const items = await tx
      .select({
        id: ptaAgendaItem.id,
        seqNo: ptaAgendaItem.seqNo,
        title: ptaAgendaItem.title,
        classification: ptaAgendaItem.classification,
        narrative: ptaAgendaItem.narrative,
      })
      .from(ptaAgendaItem)
      .where(and(eq(ptaAgendaItem.schoolId, schoolId), eq(ptaAgendaItem.minutesId, m.id)))
      .orderBy(ptaAgendaItem.seqNo);
    const ids = items.map((i) => i.id);

    const actionRows = ids.length
      ? await tx
          .select({
            id: ptaActionItem.id,
            agendaItemId: ptaActionItem.agendaItemId,
            description: ptaActionItem.description,
            personUserId: ptaActionItem.personUserId,
            externalName: ptaActionItem.externalName,
            ownerFullName: users.fullName,
            deadline: ptaActionItem.deadline,
            status: ptaActionItem.status,
          })
          .from(ptaActionItem)
          .leftJoin(users, eq(users.id, ptaActionItem.personUserId))
          .where(and(eq(ptaActionItem.schoolId, schoolId), inArray(ptaActionItem.agendaItemId, ids)))
      : [];
    const resolutionRows = ids.length
      ? await tx
          .select({
            id: ptaResolution.id,
            agendaItemId: ptaResolution.agendaItemId,
            resolutionNo: ptaResolution.resolutionNo,
            resolutionText: ptaResolution.resolutionText,
            votesFor: ptaResolution.votesFor,
            votesAgainst: ptaResolution.votesAgainst,
            votesAbstain: ptaResolution.votesAbstain,
            binding: ptaResolution.binding,
          })
          .from(ptaResolution)
          .where(and(eq(ptaResolution.schoolId, schoolId), inArray(ptaResolution.agendaItemId, ids)))
      : [];

    const actionByItem = new Map(actionRows.map((a) => [a.agendaItemId, a]));
    const resolutionByItem = new Map(resolutionRows.map((r) => [r.agendaItemId, r]));

    // Provisional resolution numbers (R453) — number the draft's resolutions in seq order after the
    // highest ADOPTED number of this (pta × period). Once adopted the row carries its frozen `resolutionNo`.
    const scopeTok = resolutionScopeToken(scope.tierType, scope.className, scope.houseName, scope.ptaId);
    const periodTok = slugToken(meeting.periodLabel ?? "");
    const seqStart = await loadResolutionSeqStart(tx, schoolId, scope.ptaId, scope.academicPeriodId);
    let resIdx = 0;

    const agendaItems: MinutesAgendaItemView[] = items.map((it) => {
      const a = actionByItem.get(it.id);
      const r = resolutionByItem.get(it.id);
      const classification = (it.classification as Classification | null) ?? null;

      const action: MinutesActionView | null =
        classification === "ACTION" && a
          ? {
              id: a.id,
              agendaItemId: a.agendaItemId,
              description: a.description,
              ownerName: a.ownerFullName ?? a.externalName ?? null,
              ownerUserId: a.personUserId,
              externalName: a.externalName,
              deadlineISO: a.deadline,
              deadlineLabel: a.deadline ? (fmtISODate(a.deadline) ?? a.deadline) : "Ongoing",
              status: a.status as "PENDING" | "DONE",
            }
          : null;

      let resolution: MinutesResolutionView | null = null;
      if (classification === "RESOLUTION" && r) {
        const provisionalNo = formatResolutionNo(scopeTok, periodTok, seqStart + resIdx);
        resIdx += 1;
        resolution = {
          id: r.id,
          agendaItemId: r.agendaItemId,
          resolutionNo: r.resolutionNo,
          provisionalNo,
          resolutionText: r.resolutionText,
          votesFor: r.votesFor,
          votesAgainst: r.votesAgainst,
          votesAbstain: r.votesAbstain,
          binding: r.binding,
          outcome: resolutionOutcome(r.votesFor, r.votesAgainst),
          hasVotes: resolutionHasVotes(r.votesFor, r.votesAgainst, r.votesAbstain),
        };
      }

      return {
        id: it.id,
        seqNo: it.seqNo,
        title: it.title,
        classification,
        narrative: it.narrative,
        action,
        resolution,
      };
    });

    const validationInput: AgendaItemForValidation[] = agendaItems.map((it) => ({
      classification: it.classification,
      action: it.classification === "ACTION" ? { hasOwner: !!it.action?.ownerName, hasDeadline: !!it.action?.deadlineISO } : null,
      resolution: it.classification === "RESOLUTION" ? { hasVotes: !!it.resolution?.hasVotes } : null,
    }));
    const validator = validateMinutesForReview(validationInput, scope.quorumMet);

    let adoptedByName: string | null = null;
    if (m.adoptedByUserId) {
      const [u] = await tx.select({ name: users.fullName }).from(users).where(eq(users.id, m.adoptedByUserId)).limit(1);
      adoptedByName = u?.name ?? null;
    }

    return {
      ...commonTail,
      minutesId: m.id,
      status: m.status as MinutesStatus,
      agendaItems,
      validator,
      adoptedAt: m.adoptedAt ? m.adoptedAt.toISOString() : null,
      adoptedByName,
      distributedAt: m.distributedAt ? m.distributedAt.toISOString() : null,
    } satisfies PtaMinutesView;
  });
}
