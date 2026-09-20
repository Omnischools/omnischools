/**
 * WASSCE SC-12 pure logic — DB-FREE, unit-tested (sc12.test.ts). Two seams live here so both a
 * server-only writer and a server-only reader can share ONE testable definition:
 *   • the AUTO-SUGGEST trigger gate (R226) — consumed by lib/sickbay/sc12-suggest.ts;
 *   • the §4.2 setup-banner projection (R227) — consumed by lib/wassce/setup-data.ts.
 *
 * NO clinical vocabulary anywhere in this file, by construction: the banner projection carries a
 * candidate name, index, SC status and WAEC workflow fields — never a hospital, condition or clinician.
 */

/**
 * R226.1 — the candidate statuses for which a DRAFT SC-12 auto-suggest is meaningful: an ACTIVE WAEC
 * registration. WITHDRAWN/COMPLETED never suggest (the exam is over / the seat is gone).
 */
export const SC12_TRIGGER_STATUSES = ["REGISTERED", "ACTIVE"] as const;

/**
 * R226.1 — suggest a DRAFT SC-12 only when BOTH hold: the student is a live candidate (status ∈
 * {REGISTERED, ACTIVE}) AND that candidate's cohort still has ≥1 paper to sit (`scheduled_date >=
 * today`, computed by the caller against the Accra civil date). A past-only timetable or a
 * non-candidate does NOT fire. This is the single source of the two-part condition — the SQL feeds it
 * `hasUpcomingPaper`; the status half is decided here so a mutation reds the test, not production.
 */
export function sc12TriggerFires(candidateStatus: string, hasUpcomingPaper: boolean): boolean {
  return (SC12_TRIGGER_STATUSES as readonly string[]).includes(candidateStatus) && hasUpcomingPaper;
}

/**
 * R227 — the LIVE, non-DRAFT SC statuses the §4.2 setup banner may surface. DRAFT (the school's private
 * auto-suggested worklist) and the terminal COMPLETED/REJECTED are excluded: the banner speaks only to
 * an active, human-filed WAEC special consideration.
 */
export const SC12_BANNER_STATUSES = ["FILED", "ACKNOWLEDGED", "APPROVED", "SCHEDULED"] as const;

const SC12_STATUS_LABEL: Record<string, string> = {
  FILED: "SC-12 filed",
  ACKNOWLEDGED: "SC-12 acknowledged",
  APPROVED: "SC-12 approved",
  SCHEDULED: "SC-12 make-up scheduled",
};

/** The DB projection the banner reads — WAEC workflow facts only, NO clinical column. */
export type Sc12BannerInput = {
  candidateName: string;
  indexNumber: string;
  status: string;
  waecRef: string | null;
  makeUpScheduledAt: Date | null;
  makeUpCentre: string | null;
  filedAt: Date | null;
};

/** The pre-formatted banner row the page renders — strings only, still zero clinical content. */
export type Sc12BannerRow = {
  candidateName: string;
  indexNumber: string;
  statusLabel: string;
  waecRef: string | null;
  makeUpLabel: string | null;
  filedDateLabel: string | null;
};

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A bare civil DATE — never a clock (R90: a drawn time is stale the morning after it is written, which
 * is exactly the `filed at 11:00` defect the old static banner shipped). Ghana is UTC+0 all year, so
 * the UTC calendar parts ARE the Accra date.
 */
export function sc12FiledDate(d: Date): string {
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * Project the school's live SC-12 rows into the §4.2 banner (R227). Filters to the live statuses (DRAFT
 * and terminal rows dropped — a DRAFT is NEVER shown), and formats each into name + index + SC status +
 * WAEC ref + make-up centre/date + filed DATE. Empty in → empty out (the caller then omits the banner
 * entirely rather than drawing an empty shell). NO clinical field is ever read or emitted.
 */
export function sc12BannerRows(rows: readonly Sc12BannerInput[]): Sc12BannerRow[] {
  const live = new Set<string>(SC12_BANNER_STATUSES);
  return rows
    .filter((r) => live.has(r.status))
    .map((r) => {
      const centre = r.makeUpCentre?.trim() || null;
      const makeUpDate = r.makeUpScheduledAt ? sc12FiledDate(r.makeUpScheduledAt) : null;
      const makeUp = [centre, makeUpDate].filter(Boolean).join(" · ");
      return {
        candidateName: r.candidateName,
        indexNumber: r.indexNumber,
        statusLabel: SC12_STATUS_LABEL[r.status] ?? "SC-12",
        waecRef: r.waecRef?.trim() || null,
        makeUpLabel: makeUp || null,
        filedDateLabel: r.filedAt ? sc12FiledDate(r.filedAt) : null,
      };
    });
}
