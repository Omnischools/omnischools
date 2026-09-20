/**
 * PLC CPD points derivation (SHS module 4.6 / INCR-48 · R393) — PURE, DB-FREE, self-contained, unit-
 * tested (points.test.ts). The ONE place per-member × per-session CPD points are computed, and the crux
 * of the 48/49 boundary (R391): INCR-48 DISPLAYS this as a "will award" preview; INCR-49 will import
 * THIS FILE UNCHANGED to ACCRUE the same numbers to the plc_cpd_* ledger — so display == accrual by
 * construction. Keep it free of the db AND of clock/time-of-day maths: the caller passes primitives
 * (submission ms + a precomputed window-close ms + booleans). Do not add imports here.
 *
 * 🔴 R392 SUPERSEDES the surface's "+1.0 fixed facilitator" bonus + "5.0 total": the facilitator is an
 * ORDINARY attendee (earns the attended point, has NO reflection arm), capped at pts_per_attended_session.
 * The surface's card is internally double-counted — the honest derived total for the mock's 8 attendees
 * is 4.0 attended now, ceiling 7.5 (NOT 5.0). See points.test.ts.
 */

/** Capture surfaces P/L/A; E/M are storable-not-rejected and earn 0 (R383). "present" = NO attendance row. */
export type PlcAttendanceState = "present" | "late" | "absent" | "excused" | "medical";

/** The 4 reflection sub-states the register chip renders (Lucy §4.4). */
export type PlcReflectionState = "na" | "pending" | "submitted" | "confirmed";

/** attended = Present (no row) OR Late (Late == Present for CPD, R393). Absent / E / M earn nothing. */
export function isAttended(state: PlcAttendanceState): boolean {
  return state === "present" || state === "late";
}

export interface PlcPointsRates {
  ptsPerAttendedSession: number;
  ptsPerReflection: number;
  /** Reflections whose submitted_at (ms) is AFTER this instant earn nothing (R393 submitted ≤ window_close). */
  reflectionWindowCloseMs: number;
}

export interface PlcMemberSessionInput {
  userId: string;
  isFacilitator: boolean;
  attendance: PlcAttendanceState;
  /** The member's reflection submitted_at as ms, or null when they have not submitted. */
  reflectionSubmittedAtMs: number | null;
  /** The facilitator has stamped confirmed_at on this member's reflection (R389). */
  reflectionConfirmed: boolean;
}

export interface PlcMemberSessionPoints {
  userId: string;
  attended: boolean;
  attendedPts: number;
  reflectionPts: number;
  reflectionState: PlcReflectionState;
  /** The ceiling this member could reach this session (attended point + reflection point, capped). */
  possiblePts: number;
  total: number;
}

/** Round a points sum to 2dp so 0.5 + 0.5 prints as 1 (not 1.0000000002). */
const round2 = (n: number): number => Math.round(n * 100) / 100;

export function memberSessionPoints(
  m: PlcMemberSessionInput,
  rates: PlcPointsRates,
): PlcMemberSessionPoints {
  const attended = isAttended(m.attendance);
  const attendedPts = attended ? rates.ptsPerAttendedSession : 0;

  // The reflection arm (R393): attended, NOT the facilitator (R392 — no reflection arm), submitted within
  // the window (submitted ≤ window_close) AND facilitator-confirmed (R389). Any one missing → 0.
  const submittedWithinWindow =
    m.reflectionSubmittedAtMs !== null && m.reflectionSubmittedAtMs <= rates.reflectionWindowCloseMs;
  const reflectionEarns =
    attended && !m.isFacilitator && submittedWithinWindow && m.reflectionConfirmed;
  const reflectionPts = reflectionEarns ? rates.ptsPerReflection : 0;

  // The cap (R393): facilitator = the attended point only (no reflection arm); a member = attended +
  // reflection (max_pts_per_session). Facilitator never earns a reflection point, so this is defensive.
  const memberCap = round2(rates.ptsPerAttendedSession + rates.ptsPerReflection);
  const cap = m.isFacilitator ? rates.ptsPerAttendedSession : memberCap;
  const total = round2(Math.min(attendedPts + reflectionPts, cap));

  // The still-reachable ceiling for this member this session (drives the "of X" preview denominator).
  const possiblePts = attended ? cap : 0;

  // The 4-way reflection sub-state (Lucy §4.4): N/A for the facilitator + any absent member.
  let reflectionState: PlcReflectionState;
  if (m.isFacilitator || !attended) reflectionState = "na";
  else if (m.reflectionSubmittedAtMs === null) reflectionState = "pending";
  else if (!m.reflectionConfirmed) reflectionState = "submitted";
  else reflectionState = "confirmed";

  return { userId: m.userId, attended, attendedPts, reflectionPts, reflectionState, possiblePts, total };
}

export interface PlcSessionPointsSummary {
  perMember: PlcMemberSessionPoints[];
  attendedCount: number;
  absentCount: number;
  /** Attended non-facilitators whose reflection has NOT yet earned (pending or awaiting-confirm). */
  reflectionsPending: number;
  /** Attended non-facilitators whose reflection is confirmed-in-window (has its point). */
  reflectionsConfirmed: number;
  /** The attended-arm subtotal (every P/L member × pts_per_attended_session). */
  attendedPtsTotal: number;
  /** The reflection-arm subtotal (confirmed-in-window non-facilitators × pts_per_reflection). */
  reflectionPtsTotal: number;
  /** The points that WOULD post right now — the honest "will award" preview, NEVER auto-posted here (49). */
  awardedPts: number;
  /** The maximum this session could reach if every attendee reflects + is confirmed in-window. */
  ceilingPts: number;
}

/** Roll the per-member points into the session preview panel + the KPIs (denominator = this held session). */
export function sessionPointsSummary(
  members: PlcMemberSessionInput[],
  rates: PlcPointsRates,
): PlcSessionPointsSummary {
  const perMember = members.map((m) => memberSessionPoints(m, rates));
  let attendedCount = 0;
  let absentCount = 0;
  let reflectionsPending = 0;
  let reflectionsConfirmed = 0;
  let attendedPtsTotal = 0;
  let reflectionPtsTotal = 0;
  let ceilingPts = 0;
  for (const p of perMember) {
    if (p.attended) attendedCount++;
    else absentCount++;
    attendedPtsTotal += p.attendedPts;
    reflectionPtsTotal += p.reflectionPts;
    ceilingPts += p.possiblePts;
    if (p.reflectionState === "confirmed") reflectionsConfirmed++;
    else if (p.reflectionState === "pending" || p.reflectionState === "submitted") reflectionsPending++;
  }
  return {
    perMember,
    attendedCount,
    absentCount,
    reflectionsPending,
    reflectionsConfirmed,
    attendedPtsTotal: round2(attendedPtsTotal),
    reflectionPtsTotal: round2(reflectionPtsTotal),
    awardedPts: round2(attendedPtsTotal + reflectionPtsTotal),
    ceilingPts: round2(ceilingPts),
  };
}
