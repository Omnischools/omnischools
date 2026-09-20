/**
 * PTA meeting-invite SMS body — PURE, DB-free, unit-tested (meeting-invite-sms.test.ts). The #297
 * State-1 console-notify counterpart to boarding's arrivalSms: `lib/actions/pta-meeting.ts` collects
 * the parent-roster phones INSIDE its convene tx and, AFTER commit, pairs each with THIS body.
 *
 * 🔴 SCOPE FENCE (owner-ratified: send-only, no RSVP). Meeting details ONLY — NO payment link, NO dues
 * figure, NO RSVP / reply-to instruction. GSM-7 (plain ASCII — no em-dash / smart quotes), capped at
 * two segments so a bulk run's cost is bounded regardless of a long meeting type / location.
 */

/** Two GSM-7 segments = 153 × 2 chars (a single segment is 160; concatenation drops to 153 each). */
const TWO_SEGMENT_CAP = 306;

export interface PtaMeetingInviteInput {
  schoolName: string;
  ptaLabel: string; // "Form 2 Science PTA" / "General PTA" / "Emergency PTA"
  meetingType: string; // the free-text display label
  dateLabel: string; // pre-formatted ASCII date, e.g. "Thu 14 May 2026"
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
  location: string | null;
}

export function ptaMeetingInviteSms(i: PtaMeetingInviteInput): string {
  const build = (loc: string | null): string => {
    const where = loc && loc.trim() ? ` at ${loc.trim()}` : "";
    return `${i.schoolName}: ${i.ptaLabel} - ${i.meetingType} on ${i.dateLabel}, ${i.startTime}-${i.endTime}${where}. Please attend.`;
  };
  let body = build(i.location);
  // Keep the two-segment invariant: drop the optional location first, then hard-cap (bounded inputs).
  if (body.length > TWO_SEGMENT_CAP) body = build(null);
  // ponytail: hard 2-seg slice as a last resort; representative Ghanaian labels never reach it.
  return body.length > TWO_SEGMENT_CAP ? body.slice(0, TWO_SEGMENT_CAP) : body;
}
