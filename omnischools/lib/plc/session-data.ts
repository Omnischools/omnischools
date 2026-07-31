/**
 * SERVER-ONLY PLC session-register read (SHS module 4.6 / INCR-48). Loads a single PLC's single-date live
 * register and DERIVES everything the surface renders (the lifecycle clock, the present-by-default
 * attendance, the CPD-points preview via the shared lib/plc/points.ts, the reflection sub-states, and the
 * term KPIs) plus a landing list. Imports the DB driver via withSchool — NEVER import from a client
 * component; the page passes plain serializable primitives to the client interactives
 * ([[reports-data-is-server-only]]). Tenant-scoped; RLS is the boundary.
 *
 * EVERYTHING DERIVES (R381/R390/R391) — nothing below is stored: "held" = the plc_session row exists (no
 * status/started_at column); the lifecycle windows + write-lock (session-clock); present = active
 * membership − not-present rows (Late == Present); the whole CPD panel + KPIs (points.ts — the SAME module
 * INCR-49 will accrue with, so display == accrual). A missing programme coalesces to the frozen Friday
 * defaults; a missing session → a coherent not-held view (the page offers the facilitator "Open session"),
 * never a throw. Reflection ANSWERS are SHOWN (staff CPD ≠ pastoral) — the register may show them; the
 * audit trail never carries an answer body (that discipline lives in the actions).
 */
import "server-only";
import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, notInArray, or } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import { getCurrentPeriod } from "@/lib/boarding/period";
import { NON_STAFF_ROLE_CODES, roleLabel } from "@/lib/staff-roles";
import { addMinutes } from "@/lib/senior/time";
import type { Tx } from "@/lib/db";
import {
  plc,
  plcMembership,
  plcProgramme,
  plcSession,
  plcSessionAttendance,
  plcSessionReflection,
  plcTermFocus,
  roleAssignments,
  roles,
  users,
} from "@/db/schema";
import {
  coalescePlcProgramme,
  plcTypeOf,
  PLC_TYPE_SEMANTICS,
  type PlcProgramme,
} from "./defaults";
import {
  cadenceDateForWeek,
  derivePlcSessionClock,
  plcSessionInstant,
  type PlcSessionClock,
} from "./session-clock";
import {
  isAttended,
  sessionPointsSummary,
  type PlcAttendanceState,
  type PlcMemberSessionInput,
  type PlcReflectionState,
  type PlcSessionPointsSummary,
} from "./points";

const HOUR_MS = 3_600_000;

const PROGRAMME_COLS = {
  sessionDay: plcProgramme.sessionDay,
  sessionStart: plcProgramme.sessionStart,
  sessionLengthMin: plcProgramme.sessionLengthMin,
  weeksPerSemester: plcProgramme.weeksPerSemester,
  ptsPerAttendedSession: plcProgramme.ptsPerAttendedSession,
  ptsPerReflection: plcProgramme.ptsPerReflection,
  reflectionWindowHours: plcProgramme.reflectionWindowHours,
  annualPlcTarget: plcProgramme.annualPlcTarget,
  configuredAt: plcProgramme.configuredAt,
} as const;

// ── formatting + mapping helpers ──────────────────────────────────────────────────────────────────

function initialsOf(s: string | null | undefined, fallback = "—"): string {
  const parts = (s ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

const fmtDate = (iso: string): string =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${iso}T00:00:00Z`),
  );

const fmtDateTime = (d: Date): string =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC",
  }).format(d);

/** Stored enum → the points model's attendance state. A stray PRESENT row (mark-present deletes) ⇒ present. */
function toAttendanceState(raw: string | undefined | null): PlcAttendanceState {
  switch (raw) {
    case "LATE":
      return "late";
    case "ABSENT":
      return "absent";
    case "EXCUSED":
      return "excused";
    case "MEDICAL":
      return "medical";
    default:
      return "present";
  }
}

/** The P/L/A capture status the register cluster renders (E/M fold to "absent" — they earn 0 like an absence). */
function captureStatus(state: PlcAttendanceState): "present" | "late" | "absent" {
  return state === "late" ? "late" : state === "present" ? "present" : "absent";
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ── the agenda shape (agenda_json {items:[{text,durationMin?,done}]}, R385) ─────────────────────────

export interface PlcAgendaItem {
  text: string;
  durationMin: number | null;
  done: boolean;
}

/** Defensive parse of the jsonb agenda — the shape is app-owned, so tolerate a legacy/empty payload. */
export function parseAgenda(json: unknown): PlcAgendaItem[] {
  const items = (json as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return [];
  return items
    .map((it): PlcAgendaItem => {
      const o = (it ?? {}) as { text?: unknown; durationMin?: unknown; done?: unknown };
      return {
        text: typeof o.text === "string" ? o.text : "",
        durationMin: typeof o.durationMin === "number" && Number.isFinite(o.durationMin) ? o.durationMin : null,
        done: o.done === true,
      };
    })
    .filter((it) => it.text.trim().length > 0);
}

// ── view types (plain serializable — the page passes these to the client interactives) ──────────────

export interface PlcSessionMemberView {
  userId: string;
  name: string;
  initials: string;
  roleLabel: string;
  isFacilitator: boolean;
  status: "present" | "late" | "absent";
  reflectionState: PlcReflectionState;
  attendedPts: number;
  reflectionPts: number;
  /** The reflection ANSWERS (SHOWN — staff CPD ≠ pastoral), for the facilitator confirm panel; null if none. */
  reflection: {
    q1: string | null;
    q2: string | null;
    q3: string | null;
    submittedLabel: string;
    confirmed: boolean;
  } | null;
}

export interface PlcTermProgress {
  held: number;
  target: number;
  avgAttendancePct: number | null;
  reflectionRatePct: number | null;
  cpdDispensed: number;
  memberCount: number;
}

interface PlcSessionViewBase {
  plcId: string;
  plcName: string;
  typeLabel: string;
  iconInitials: string;
  sessionDate: string;
  dateLabel: string;
  facilitatorUserId: string | null;
  facilitatorName: string | null;
  facilitatorRoleLabel: string | null;
  termFocus: string | null;
  periodLabel: string | null;
  clock: PlcSessionClock;
}

export interface PlcHeldSessionView extends PlcSessionViewBase {
  held: true;
  sessionId: string;
  topic: string | null;
  agenda: PlcAgendaItem[];
  members: PlcSessionMemberView[];
  points: PlcSessionPointsSummary;
  termProgress: PlcTermProgress;
  topCpd: { name: string; pts: number }[];
}

export interface PlcNotHeldSessionView extends PlcSessionViewBase {
  held: false;
  memberCount: number;
}

export type PlcSessionView = PlcHeldSessionView | PlcNotHeldSessionView | null;

// ── the single-session read (the register page) ─────────────────────────────────────────────────────

export async function getPlcSession(
  schoolId: string,
  plcId: string,
  sessionDate: string,
  now: Date = new Date(),
): Promise<PlcSessionView> {
  return withSchool(schoolId, async (tx) => {
    const [plcRow] = await tx
      .select({
        id: plc.id,
        type: plc.type,
        name: plc.name,
        facilitatorUserId: plc.facilitatorUserId,
      })
      .from(plc)
      .where(and(eq(plc.schoolId, schoolId), eq(plc.id, plcId), isNull(plc.archivedAt)))
      .limit(1);
    if (!plcRow) return null;

    const [progRow] = await tx
      .select(PROGRAMME_COLS)
      .from(plcProgramme)
      .where(eq(plcProgramme.schoolId, schoolId))
      .limit(1);
    const programme = coalescePlcProgramme(progRow ?? null);

    const period = await getCurrentPeriod(tx, schoolId);

    // Term focus (R375) — the PLC's free-text focus for the current period → the register HEADLINE.
    const [focusRow] = period
      ? await tx
          .select({ focus: plcTermFocus.focus })
          .from(plcTermFocus)
          .where(
            and(
              eq(plcTermFocus.schoolId, schoolId),
              eq(plcTermFocus.plcId, plcId),
              eq(plcTermFocus.academicPeriodId, period.periodId),
            ),
          )
          .limit(1)
      : [];

    // Facilitator name + representative role label (looked up with the member roles below).
    const [session] = await tx
      .select({
        id: plcSession.id,
        topic: plcSession.topic,
        agendaJson: plcSession.agendaJson,
      })
      .from(plcSession)
      .where(
        and(
          eq(plcSession.schoolId, schoolId),
          eq(plcSession.plcId, plcId),
          eq(plcSession.sessionDate, sessionDate),
        ),
      )
      .limit(1);
    const held = !!session;
    const clock = derivePlcSessionClock(programme, sessionDate, held, now);

    // Active membership roster (open row = left_at IS NULL, real member = user_id NOT NULL).
    const memberRows = await tx
      .select({ userId: plcMembership.userId, name: users.fullName })
      .from(plcMembership)
      .innerJoin(users, eq(plcMembership.userId, users.id))
      .where(
        and(
          eq(plcMembership.schoolId, schoolId),
          eq(plcMembership.plcId, plcId),
          isNull(plcMembership.leftAt),
          isNotNull(plcMembership.userId),
        ),
      );
    const members = memberRows.filter((m): m is { userId: string; name: string | null } => !!m.userId);

    // Representative role label per member + facilitator (one active role, for the row context).
    const roleTargetIds = [...new Set(members.map((m) => m.userId).concat(plcRow.facilitatorUserId ?? []))];
    const roleLabelByUser = new Map<string, string>();
    const nameByUser = new Map<string, string>(members.map((m) => [m.userId, m.name ?? "—"]));
    let facilitatorName: string | null = null;
    if (roleTargetIds.length > 0) {
      const today = now.toISOString().slice(0, 10);
      const roleRows = await tx
        .select({ userId: roleAssignments.userId, name: users.fullName, code: roles.code, label: roles.label })
        .from(roleAssignments)
        .innerJoin(users, eq(roleAssignments.userId, users.id))
        .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
        .where(
          and(
            eq(roleAssignments.schoolId, schoolId),
            inArray(roleAssignments.userId, roleTargetIds),
            notInArray(roles.code, NON_STAFF_ROLE_CODES),
            lte(roleAssignments.startDate, today),
            or(isNull(roleAssignments.endDate), gte(roleAssignments.endDate, today)),
          ),
        )
        .orderBy(roles.code);
      for (const r of roleRows) {
        if (!roleLabelByUser.has(r.userId)) roleLabelByUser.set(r.userId, roleLabel(r.code, r.label));
        if (r.name) nameByUser.set(r.userId, r.name);
        if (r.userId === plcRow.facilitatorUserId && r.name) facilitatorName = r.name;
      }
    }

    const base: PlcSessionViewBase = {
      plcId,
      plcName: plcRow.name,
      typeLabel: PLC_TYPE_SEMANTICS[plcTypeOf(plcRow.type)].label,
      iconInitials: initialsOf(plcRow.name, "P"),
      sessionDate,
      dateLabel: fmtDate(sessionDate),
      facilitatorUserId: plcRow.facilitatorUserId ?? null,
      facilitatorName: facilitatorName ?? (plcRow.facilitatorUserId ? nameByUser.get(plcRow.facilitatorUserId) ?? null : null),
      facilitatorRoleLabel: plcRow.facilitatorUserId ? roleLabelByUser.get(plcRow.facilitatorUserId) ?? null : null,
      termFocus: focusRow?.focus ?? null,
      periodLabel: period?.periodLabel ?? null,
      clock,
    };

    if (!session) {
      return { held: false, ...base, memberCount: members.length } satisfies PlcNotHeldSessionView;
    }

    // Attendance + reflection rows for THIS session.
    const attRows = await tx
      .select({ userId: plcSessionAttendance.userId, status: plcSessionAttendance.status })
      .from(plcSessionAttendance)
      .where(and(eq(plcSessionAttendance.schoolId, schoolId), eq(plcSessionAttendance.sessionId, session.id)));
    const statusByUser = new Map(attRows.filter((r) => r.userId).map((r) => [r.userId as string, r.status]));

    const reflRows = await tx
      .select({
        userId: plcSessionReflection.userId,
        q1: plcSessionReflection.q1,
        q2: plcSessionReflection.q2,
        q3: plcSessionReflection.q3,
        submittedAt: plcSessionReflection.submittedAt,
        confirmedAt: plcSessionReflection.confirmedAt,
      })
      .from(plcSessionReflection)
      .where(and(eq(plcSessionReflection.schoolId, schoolId), eq(plcSessionReflection.sessionId, session.id)));
    const reflByUser = new Map(reflRows.filter((r) => r.userId).map((r) => [r.userId as string, r]));

    const facilitatorUserId = plcRow.facilitatorUserId ?? null;
    const rates = {
      ptsPerAttendedSession: programme.ptsPerAttendedSession,
      ptsPerReflection: programme.ptsPerReflection,
      reflectionWindowCloseMs: clock.reflectionWindowCloseMs,
    };
    const pointsInput: PlcMemberSessionInput[] = members.map((m) => {
      const refl = reflByUser.get(m.userId);
      return {
        userId: m.userId,
        isFacilitator: m.userId === facilitatorUserId,
        attendance: toAttendanceState(statusByUser.get(m.userId)),
        reflectionSubmittedAtMs: refl ? refl.submittedAt.getTime() : null,
        reflectionConfirmed: !!refl?.confirmedAt,
      };
    });
    const points = sessionPointsSummary(pointsInput, rates);
    const pointsByUser = new Map(points.perMember.map((p) => [p.userId, p]));

    const memberViews: PlcSessionMemberView[] = members
      .map((m): PlcSessionMemberView => {
        const state = toAttendanceState(statusByUser.get(m.userId));
        const pp = pointsByUser.get(m.userId)!;
        const refl = reflByUser.get(m.userId);
        return {
          userId: m.userId,
          name: nameByUser.get(m.userId) ?? m.name ?? "—",
          initials: initialsOf(nameByUser.get(m.userId) ?? m.name),
          roleLabel: roleLabelByUser.get(m.userId) ?? "Teaching staff",
          isFacilitator: m.userId === facilitatorUserId,
          status: captureStatus(state),
          reflectionState: pp.reflectionState,
          attendedPts: pp.attendedPts,
          reflectionPts: pp.reflectionPts,
          reflection: refl
            ? {
                q1: refl.q1,
                q2: refl.q2,
                q3: refl.q3,
                submittedLabel: fmtDateTime(refl.submittedAt),
                confirmed: !!refl.confirmedAt,
              }
            : null,
        };
      })
      .sort((a, b) => Number(b.isFacilitator) - Number(a.isFacilitator) || a.name.localeCompare(b.name));

    // ── term progress + top-CPD, DERIVED across the current period's held sessions (reuses points.ts;
    //    denominator = held-sessions-only, R393). ponytail: uses the CURRENT active roster for every past
    //    session (per-session membership-at-time is INCR-49's job for the real ledger). ──
    const term = await deriveTermProgress(tx, schoolId, plcId, period?.periodId ?? null, programme, members, facilitatorUserId, nameByUser);

    return {
      held: true,
      ...base,
      sessionId: session.id,
      topic: session.topic,
      agenda: parseAgenda(session.agendaJson),
      members: memberViews,
      points,
      termProgress: term.progress,
      topCpd: term.topCpd,
    } satisfies PlcHeldSessionView;
  });
}

/** Roll the period's held sessions into the two side cards — reuses the SAME points.ts as the live panel. */
async function deriveTermProgress(
  tx: Tx,
  schoolId: string,
  plcId: string,
  periodId: string | null,
  programme: PlcProgramme,
  members: { userId: string; name: string | null }[],
  facilitatorUserId: string | null,
  nameByUser: Map<string, string>,
): Promise<{ progress: PlcTermProgress; topCpd: { name: string; pts: number }[] }> {
  const memberCount = members.length;
  const empty: PlcTermProgress = {
    held: 0,
    target: programme.weeksPerSemester,
    avgAttendancePct: null,
    reflectionRatePct: null,
    cpdDispensed: 0,
    memberCount,
  };
  if (!periodId) return { progress: empty, topCpd: [] };

  const periodSessions = await tx
    .select({ id: plcSession.id, sessionDate: plcSession.sessionDate })
    .from(plcSession)
    .where(
      and(
        eq(plcSession.schoolId, schoolId),
        eq(plcSession.plcId, plcId),
        eq(plcSession.academicPeriodId, periodId),
      ),
    );
  if (periodSessions.length === 0) return { progress: empty, topCpd: [] };

  const sids = periodSessions.map((s) => s.id);
  const attRows = await tx
    .select({ sessionId: plcSessionAttendance.sessionId, userId: plcSessionAttendance.userId, status: plcSessionAttendance.status })
    .from(plcSessionAttendance)
    .where(and(eq(plcSessionAttendance.schoolId, schoolId), inArray(plcSessionAttendance.sessionId, sids)));
  const reflRows = await tx
    .select({
      sessionId: plcSessionReflection.sessionId,
      userId: plcSessionReflection.userId,
      submittedAt: plcSessionReflection.submittedAt,
      confirmedAt: plcSessionReflection.confirmedAt,
    })
    .from(plcSessionReflection)
    .where(and(eq(plcSessionReflection.schoolId, schoolId), inArray(plcSessionReflection.sessionId, sids)));

  const closeHHMM = addMinutes(programme.sessionStart, programme.sessionLengthMin);
  let cpdDispensed = 0;
  let pctSum = 0;
  let reflPossible = 0;
  let reflConfirmed = 0;
  const cpdByUser = new Map<string, number>();

  for (const sess of periodSessions) {
    const statusBy = new Map(attRows.filter((r) => r.sessionId === sess.id && r.userId).map((r) => [r.userId as string, r.status]));
    const reflBy = new Map(reflRows.filter((r) => r.sessionId === sess.id && r.userId).map((r) => [r.userId as string, r]));
    const windowCloseMs = plcSessionInstant(sess.sessionDate, closeHHMM).getTime() + programme.reflectionWindowHours * HOUR_MS;
    const input: PlcMemberSessionInput[] = members.map((m) => {
      const refl = reflBy.get(m.userId);
      return {
        userId: m.userId,
        isFacilitator: m.userId === facilitatorUserId,
        attendance: toAttendanceState(statusBy.get(m.userId)),
        reflectionSubmittedAtMs: refl ? refl.submittedAt.getTime() : null,
        reflectionConfirmed: !!refl?.confirmedAt,
      };
    });
    const summary = sessionPointsSummary(input, {
      ptsPerAttendedSession: programme.ptsPerAttendedSession,
      ptsPerReflection: programme.ptsPerReflection,
      reflectionWindowCloseMs: windowCloseMs,
    });
    cpdDispensed += summary.awardedPts;
    pctSum += memberCount ? (summary.attendedCount / memberCount) * 100 : 0;
    reflPossible += input.filter((m) => isAttended(m.attendance) && !m.isFacilitator).length;
    reflConfirmed += summary.reflectionsConfirmed;
    for (const p of summary.perMember) cpdByUser.set(p.userId, (cpdByUser.get(p.userId) ?? 0) + p.total);
  }

  const held = periodSessions.length;
  const topCpd = [...cpdByUser.entries()]
    .map(([userId, pts]) => ({ name: nameByUser.get(userId) ?? "—", pts: round2(pts) }))
    .filter((r) => r.pts > 0)
    .sort((a, b) => b.pts - a.pts)
    .slice(0, 5);

  return {
    progress: {
      held,
      target: programme.weeksPerSemester,
      avgAttendancePct: held ? Math.round(pctSum / held) : null,
      reflectionRatePct: reflPossible ? Math.round((reflConfirmed / reflPossible) * 100) : null,
      cpdDispensed: round2(cpdDispensed),
      memberCount,
    },
    topCpd,
  };
}

// ── the landing read (the facilitator's PLCs + this week's state + recent held sessions) ────────────

export interface PlcLandingCard {
  plcId: string;
  name: string;
  typeLabel: string;
  isFacilitator: boolean;
  /** The viewer may OPEN/run this PLC's session (facilitator ∥ break-glass). */
  canOpen: boolean;
  sessionDate: string;
  dateLabel: string;
  state: "scheduled" | "held" | "missed";
}

export interface PlcRecentSession {
  plcId: string;
  plcName: string;
  sessionDate: string;
  dateLabel: string;
  present: number;
  memberCount: number;
  awardedPts: number;
}

export interface PlcSessionsLanding {
  today: string;
  dayName: string;
  cards: PlcLandingCard[];
  recent: PlcRecentSession[];
  configured: boolean;
}

export async function getPlcSessionsLanding(
  schoolId: string,
  viewer: { userId: string | null; roles: readonly string[] },
  seesAllPlcs: boolean,
  now: Date = new Date(),
): Promise<PlcSessionsLanding> {
  return withSchool(schoolId, async (tx) => {
    const [progRow] = await tx
      .select(PROGRAMME_COLS)
      .from(plcProgramme)
      .where(eq(plcProgramme.schoolId, schoolId))
      .limit(1);
    const programme = coalescePlcProgramme(progRow ?? null);

    const plcRows = await tx
      .select({
        id: plc.id,
        type: plc.type,
        name: plc.name,
        facilitatorUserId: plc.facilitatorUserId,
        overrideSessionDay: plc.overrideSessionDay,
      })
      .from(plc)
      .where(and(eq(plc.schoolId, schoolId), isNull(plc.archivedAt)));

    // The PLCs the viewer is an active member of (drives "my PLCs" for a non-facilitator too).
    const myMemberships = viewer.userId
      ? await tx
          .select({ plcId: plcMembership.plcId })
          .from(plcMembership)
          .where(
            and(
              eq(plcMembership.schoolId, schoolId),
              eq(plcMembership.userId, viewer.userId),
              isNull(plcMembership.leftAt),
            ),
          )
      : [];
    const myPlcIds = new Set(myMemberships.map((m) => m.plcId));

    const visible = plcRows.filter(
      (p) => seesAllPlcs || p.facilitatorUserId === viewer.userId || myPlcIds.has(p.id),
    );

    // This week's cadence date per PLC (effective day = override ∥ programme). Which of those are held?
    const cardDates = visible.map((p) => ({
      plc: p,
      date: cadenceDateForWeek(p.overrideSessionDay ?? programme.sessionDay, now),
    }));
    const heldSet = new Set<string>();
    if (cardDates.length > 0) {
      const heldRows = await tx
        .select({ plcId: plcSession.id, plc: plcSession.plcId, date: plcSession.sessionDate })
        .from(plcSession)
        .where(
          and(
            eq(plcSession.schoolId, schoolId),
            inArray(
              plcSession.plcId,
              cardDates.map((c) => c.plc.id),
            ),
            inArray(
              plcSession.sessionDate,
              [...new Set(cardDates.map((c) => c.date))],
            ),
          ),
        );
      for (const r of heldRows) heldSet.add(`${r.plc}|${r.date}`);
    }

    const cards: PlcLandingCard[] = cardDates
      .map(({ plc: p, date }) => {
        const held = heldSet.has(`${p.id}|${date}`);
        const clock = derivePlcSessionClock(programme, date, held, now);
        return {
          plcId: p.id,
          name: p.name,
          typeLabel: PLC_TYPE_SEMANTICS[plcTypeOf(p.type)].label,
          isFacilitator: p.facilitatorUserId === viewer.userId,
          canOpen: seesAllPlcs || p.facilitatorUserId === viewer.userId,
          sessionDate: date,
          dateLabel: fmtDate(date),
          state: clock.state,
        };
      })
      .sort((a, b) => Number(b.isFacilitator) - Number(a.isFacilitator) || a.name.localeCompare(b.name));

    // Recent held sessions across the visible PLCs — present derived (memberCount − not-present rows).
    const visibleIds = visible.map((p) => p.id);
    let recent: PlcRecentSession[] = [];
    if (visibleIds.length > 0) {
      const recentRows = await tx
        .select({ id: plcSession.id, plcId: plcSession.plcId, name: plc.name, sessionDate: plcSession.sessionDate })
        .from(plcSession)
        .innerJoin(plc, and(eq(plc.schoolId, plcSession.schoolId), eq(plc.id, plcSession.plcId)))
        .where(and(eq(plcSession.schoolId, schoolId), inArray(plcSession.plcId, visibleIds)))
        .orderBy(desc(plcSession.sessionDate))
        .limit(16);
      const recentIds = recentRows.map((r) => r.id);
      const recentPlcIds = [...new Set(recentRows.map((r) => r.plcId))];

      // Active member count per PLC + not-present rows per session.
      const memberCounts = new Map<string, number>();
      if (recentPlcIds.length > 0) {
        const mc = await tx
          .select({ plcId: plcMembership.plcId, userId: plcMembership.userId })
          .from(plcMembership)
          .where(
            and(
              eq(plcMembership.schoolId, schoolId),
              inArray(plcMembership.plcId, recentPlcIds),
              isNull(plcMembership.leftAt),
              isNotNull(plcMembership.userId),
            ),
          );
        for (const r of mc) memberCounts.set(r.plcId, (memberCounts.get(r.plcId) ?? 0) + 1);
      }
      const notPresentBySession = new Map<string, number>();
      if (recentIds.length > 0) {
        const np = await tx
          .select({ sessionId: plcSessionAttendance.sessionId })
          .from(plcSessionAttendance)
          .where(
            and(
              eq(plcSessionAttendance.schoolId, schoolId),
              inArray(plcSessionAttendance.sessionId, recentIds),
              notInArray(plcSessionAttendance.status, ["PRESENT", "LATE"]),
            ),
          );
        for (const r of np) notPresentBySession.set(r.sessionId, (notPresentBySession.get(r.sessionId) ?? 0) + 1);
      }
      recent = recentRows.map((r) => {
        const memberCount = memberCounts.get(r.plcId) ?? 0;
        const present = Math.max(0, memberCount - (notPresentBySession.get(r.id) ?? 0));
        return {
          plcId: r.plcId,
          plcName: r.name,
          sessionDate: r.sessionDate,
          dateLabel: fmtDate(r.sessionDate),
          present,
          memberCount,
          awardedPts: round2(present * programme.ptsPerAttendedSession),
        };
      });
    }

    return {
      today: now.toISOString().slice(0, 10),
      dayName: programme.dayName,
      cards,
      recent,
      configured: programme.configured,
    };
  });
}
