/**
 * SERVER-ONLY PLC CPD reads (SHS module 4.6 / INCR-49 · R402/R406) — the teacher's PLC-CPD STATEMENT
 * (own-identity) and the school CPD DASHBOARD (management rollup). Both DERIVE totals from the persisted
 * `plc_cpd_ledger` (no rollup table) and BOTH run `accrueSettledSessions` FIRST (the R398 lazy
 * materialise-on-settle seam) — so a freshly-settled session's points appear on the very next read.
 * Imports the DB driver via withSchool — NEVER import from a client component; the pages pass plain
 * pre-formatted primitives to the presentational components ([[reports-data-is-server-only]]).
 *
 * ⚠ Because the accrual UPSERTS on read, both readers MUST be called from `force-dynamic` pages (never a
 * cached RSC) so the write is not memoised away.
 *
 * PLC 8-pt arm ONLY (R404): the 20-pt multi-source ledger, NTC-sync, the 3-year licence cycle, evidence
 * uploads, forecast/pace and gap-analysis are OMITTED (dropped, not faked). X/8 is NOT clamped at 8
 * (target ≠ cap — a facilitator or keen teacher may exceed it).
 */
import "server-only";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  notInArray,
  or,
} from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import type { Tx } from "@/lib/db";
import { assertAnyRole } from "@/lib/auth/server";
import { PLC_DASHBOARD_READ_ROLES } from "@/lib/access";
import { getCurrentPeriod } from "@/lib/boarding/period";
import { NON_STAFF_ROLE_CODES, roleLabel } from "@/lib/staff-roles";
import {
  academicPeriod,
  plc,
  plcCpdLedger,
  plcMembership,
  plcProgramme,
  plcSession,
  roleAssignments,
  roles,
  users,
} from "@/db/schema";
import { coalescePlcProgramme } from "./defaults";
import { accrueSettledSessions, plcSettleAtMs } from "./ledger";

/**
 * At-risk banding thresholds (R406 — TUNABLE display defaults, NOT accrual gates). A staffer is banded on
 * their accrued PLC points as a fraction of the points MADE AVAILABLE by the held (settled) sessions of
 * their PLCs to date (a PRO-RATA target, held-only — never a dishonest "below 8"):
 *   ratio < 0.5           → at-risk   (below half of what was reachable)
 *   0.5 ≤ ratio < 0.75    → below-pace
 *   ratio ≥ 0.75          → on-track
 */
const AT_RISK_RATIO = 0.5;
const BELOW_PACE_RATIO = 0.75;

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

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: string | number | null | undefined): number => {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

function initialsOf(s: string | null | undefined, fallback = "—"): string {
  const parts = (s ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

const fmtDate = (iso: string): string =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));

/** A representative active staff role label for a user (roleLabel ONLY — no subject/GES-rank/NTC-id). */
async function representativeRoleLabel(
  tx: Tx,
  schoolId: string,
  userId: string,
  today: string,
): Promise<string> {
  const [row] = await tx
    .select({ code: roles.code, label: roles.label })
    .from(roleAssignments)
    .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
    .where(
      and(
        eq(roleAssignments.schoolId, schoolId),
        eq(roleAssignments.userId, userId),
        notInArray(roles.code, NON_STAFF_ROLE_CODES),
        lte(roleAssignments.startDate, today),
        or(isNull(roleAssignments.endDate), gte(roleAssignments.endDate, today)),
      ),
    )
    .orderBy(asc(roles.code))
    .limit(1);
  return row ? roleLabel(row.code, row.label) : "Teaching staff";
}

// ── teacher statement (R402) ─────────────────────────────────────────────────────────────────────────

export interface MyCpdLedgerRow {
  sessionDate: string;
  dateLabel: string;
  plcName: string;
  topic: string | null;
  /** attended + reflection (2dp) — the frozen arms summed. */
  pts: number;
  ptsLabel: string; // "+1.0" (full) / "+0.5" (partial)
  /** full = the reflection arm earned (navy +1.0); partial = attended-only (warn +0.5). */
  full: boolean;
}

export interface MyCpdStatement {
  displayName: string;
  initials: string;
  roleLabel: string;
  academicYear: string | null;
  termLabel: string | null;
  target: number;
  /** SUM(attended + reflection) over THIS academic year — NOT clamped at the target (R402). */
  yearTotal: number;
  /** SUM over the CURRENT term only. */
  termTotal: number;
  /** yearTotal / target as a %, capped at 100 for the bar (the number itself may exceed). */
  pctOfTarget: number;
  sessionCount: number;
  fullCount: number;
  partialCount: number;
  rows: MyCpdLedgerRow[];
}

/** The teacher's OWN PLC-CPD statement (R402 own-identity: WHERE user_id = viewer). Accrues first. */
export async function getMyCpdStatement(schoolId: string, userId: string): Promise<MyCpdStatement> {
  return withSchool(schoolId, async (tx) => {
    await accrueSettledSessions(tx, schoolId);

    const [progRow] = await tx
      .select(PROGRAMME_COLS)
      .from(plcProgramme)
      .where(eq(plcProgramme.schoolId, schoolId))
      .limit(1);
    const programme = coalescePlcProgramme(progRow ?? null);
    const period = await getCurrentPeriod(tx, schoolId);
    const year = period?.academicYear ?? null;
    const today = new Date().toISOString().slice(0, 10);

    const [me] = await tx
      .select({ name: users.fullName })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const displayName = me?.name ?? "—";
    const roleLabelText = await representativeRoleLabel(tx, schoolId, userId, today);

    const ledgerRows = await tx
      .select({
        sessionDate: plcSession.sessionDate,
        topic: plcSession.topic,
        plcName: plc.name,
        attendedPts: plcCpdLedger.attendedPts,
        reflectionPts: plcCpdLedger.reflectionPts,
        academicYear: academicPeriod.academicYear,
        periodId: plcSession.academicPeriodId,
      })
      .from(plcCpdLedger)
      .innerJoin(
        plcSession,
        and(eq(plcSession.schoolId, plcCpdLedger.schoolId), eq(plcSession.id, plcCpdLedger.sessionId)),
      )
      .innerJoin(plc, and(eq(plc.schoolId, plcSession.schoolId), eq(plc.id, plcSession.plcId)))
      .innerJoin(
        academicPeriod,
        and(
          eq(academicPeriod.schoolId, plcSession.schoolId),
          eq(academicPeriod.periodId, plcSession.academicPeriodId),
        ),
      )
      .where(and(eq(plcCpdLedger.schoolId, schoolId), eq(plcCpdLedger.userId, userId)))
      .orderBy(desc(plcSession.sessionDate));

    const thisYear = year ? ledgerRows.filter((r) => r.academicYear === year) : ledgerRows;

    let yearTotal = 0;
    let termTotal = 0;
    let fullCount = 0;
    let partialCount = 0;
    const rows: MyCpdLedgerRow[] = thisYear.map((r) => {
      const attended = num(r.attendedPts);
      const reflection = num(r.reflectionPts);
      const pts = round2(attended + reflection);
      const full = reflection > 0;
      yearTotal += pts;
      if (period && r.periodId === period.periodId) termTotal += pts;
      if (full) fullCount++;
      else partialCount++;
      return {
        sessionDate: r.sessionDate,
        dateLabel: fmtDate(r.sessionDate),
        plcName: r.plcName,
        topic: r.topic,
        pts,
        ptsLabel: `+${pts.toFixed(1)}`,
        full,
      };
    });
    yearTotal = round2(yearTotal);
    termTotal = round2(termTotal);
    const target = programme.annualPlcTarget;
    const pctOfTarget = target > 0 ? Math.min(100, Math.round((yearTotal / target) * 100)) : 0;

    return {
      displayName,
      initials: initialsOf(displayName),
      roleLabel: roleLabelText,
      academicYear: year,
      termLabel: period?.periodLabel ?? null,
      target,
      yearTotal,
      termTotal,
      pctOfTarget,
      sessionCount: rows.length,
      fullCount,
      partialCount,
      rows,
    };
  });
}

// ── school dashboard (R406) ──────────────────────────────────────────────────────────────────────────

export type CpdBand = "at-risk" | "below-pace" | "on-track";

export interface CpdStaffRow {
  userId: string;
  name: string;
  initials: string;
  roleLabel: string;
  /** SUM(attended + reflection) this year — NOT clamped at the target. */
  earned: number;
  target: number;
  band: CpdBand;
  /** DERIVED at-risk reason (missed / under-reflected held sessions), else null. Never fabricated. */
  reason: string | null;
}

export interface CpdDashboard {
  academicYear: string | null;
  target: number;
  staffCount: number;
  avgEarned: number;
  onTrackCount: number;
  belowPaceCount: number;
  atRiskCount: number;
  /** All staff-in-≥1-PLC, sorted at-risk → below-pace → on-track. */
  staff: CpdStaffRow[];
  /** The at-risk subset (drives the callout — rendered only when non-empty). */
  atRisk: CpdStaffRow[];
  /** false → an honest empty dashboard (no held sessions have settled yet). */
  hasSettledSessions: boolean;
}

/** The school-wide CPD rollup (R406). Accrues first; population = staff in ≥1 PLC. Management-gated by the page. */
export async function getSchoolCpdDashboard(schoolId: string): Promise<CpdDashboard> {
  // R405: the dashboard is gated on BOTH the route AND the reader. The route redirect is the UX boundary;
  // this reader-level assert is the real defense-in-depth boundary (throws for any non-management caller),
  // so a future unguarded caller cannot read the school-wide rollup that RLS alone leaves open to any staff.
  await assertAnyRole(PLC_DASHBOARD_READ_ROLES);
  return withSchool(schoolId, async (tx) => {
    await accrueSettledSessions(tx, schoolId);

    const [progRow] = await tx
      .select(PROGRAMME_COLS)
      .from(plcProgramme)
      .where(eq(plcProgramme.schoolId, schoolId))
      .limit(1);
    const programme = coalescePlcProgramme(progRow ?? null);
    const period = await getCurrentPeriod(tx, schoolId);
    const year = period?.academicYear ?? null;
    const target = programme.annualPlcTarget;
    const ptsAttended = programme.ptsPerAttendedSession;
    const ptsReflection = programme.ptsPerReflection;
    const today = new Date().toISOString().slice(0, 10);

    const empty: CpdDashboard = {
      academicYear: year,
      target,
      staffCount: 0,
      avgEarned: 0,
      onTrackCount: 0,
      belowPaceCount: 0,
      atRiskCount: 0,
      staff: [],
      atRisk: [],
      hasSettledSessions: false,
    };

    // Population = staff in ≥1 PLC (active membership, real user).
    const memberships = await tx
      .select({ plcId: plcMembership.plcId, userId: plcMembership.userId })
      .from(plcMembership)
      .where(
        and(
          eq(plcMembership.schoolId, schoolId),
          isNull(plcMembership.leftAt),
          isNotNull(plcMembership.userId),
        ),
      );
    const memberIds = [...new Set(memberships.map((m) => m.userId).filter((u): u is string => !!u))];
    if (memberIds.length === 0) return empty;

    // Facilitator per PLC (a facilitator has NO reflection arm → their per-session ceiling is smaller).
    const plcRows = await tx
      .select({ id: plc.id, facilitatorUserId: plc.facilitatorUserId })
      .from(plc)
      .where(eq(plc.schoolId, schoolId));
    const facByPlc = new Map(plcRows.map((p) => [p.id, p.facilitatorUserId]));

    // SETTLED sessions THIS YEAR per PLC — the held-only pro-rata denominator (R406).
    const sessions = await tx
      .select({
        plcId: plcSession.plcId,
        sessionDate: plcSession.sessionDate,
        academicYear: academicPeriod.academicYear,
      })
      .from(plcSession)
      .innerJoin(
        academicPeriod,
        and(
          eq(academicPeriod.schoolId, plcSession.schoolId),
          eq(academicPeriod.periodId, plcSession.academicPeriodId),
        ),
      )
      .where(eq(plcSession.schoolId, schoolId));
    const nowMs = Date.now();
    const settledByPlc = new Map<string, number>();
    let settledCount = 0;
    for (const s of sessions) {
      if (year && s.academicYear !== year) continue;
      if (nowMs < plcSettleAtMs(programme, s.sessionDate)) continue;
      settledByPlc.set(s.plcId, (settledByPlc.get(s.plcId) ?? 0) + 1);
      settledCount++;
    }
    const hasSettledSessions = settledCount > 0;

    // Per-staff AVAILABLE (pro-rata, held-only). ponytail: uses the CURRENT roster for the live
    // denominator (matches deriveTermProgress:402) — the NUMERATOR is the point-in-time frozen ledger.
    const availByUser = new Map<string, { att: number; refl: number }>();
    for (const m of memberships) {
      if (!m.userId) continue;
      const held = settledByPlc.get(m.plcId) ?? 0;
      if (held === 0) continue;
      const isFac = facByPlc.get(m.plcId) === m.userId;
      const cur = availByUser.get(m.userId) ?? { att: 0, refl: 0 };
      cur.att += held * ptsAttended;
      cur.refl += isFac ? 0 : held * ptsReflection;
      availByUser.set(m.userId, cur);
    }

    // Per-staff EARNED this year (numerator, point-in-time frozen).
    const ledgerRows = await tx
      .select({
        userId: plcCpdLedger.userId,
        attendedPts: plcCpdLedger.attendedPts,
        reflectionPts: plcCpdLedger.reflectionPts,
        academicYear: academicPeriod.academicYear,
      })
      .from(plcCpdLedger)
      .innerJoin(
        plcSession,
        and(eq(plcSession.schoolId, plcCpdLedger.schoolId), eq(plcSession.id, plcCpdLedger.sessionId)),
      )
      .innerJoin(
        academicPeriod,
        and(
          eq(academicPeriod.schoolId, plcSession.schoolId),
          eq(academicPeriod.periodId, plcSession.academicPeriodId),
        ),
      )
      .where(and(eq(plcCpdLedger.schoolId, schoolId), inArray(plcCpdLedger.userId, memberIds)));
    const earnedByUser = new Map<string, { att: number; refl: number }>();
    for (const r of ledgerRows) {
      if (!r.userId) continue;
      if (year && r.academicYear !== year) continue;
      const cur = earnedByUser.get(r.userId) ?? { att: 0, refl: 0 };
      cur.att += num(r.attendedPts);
      cur.refl += num(r.reflectionPts);
      earnedByUser.set(r.userId, cur);
    }

    // Names + representative role labels for the population.
    const staffRows = await tx
      .select({ userId: roleAssignments.userId, name: users.fullName, code: roles.code, label: roles.label })
      .from(roleAssignments)
      .innerJoin(users, eq(roleAssignments.userId, users.id))
      .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
      .where(
        and(
          eq(roleAssignments.schoolId, schoolId),
          inArray(roleAssignments.userId, memberIds),
          notInArray(roles.code, NON_STAFF_ROLE_CODES),
          lte(roleAssignments.startDate, today),
          or(isNull(roleAssignments.endDate), gte(roleAssignments.endDate, today)),
        ),
      )
      .orderBy(asc(users.fullName), asc(roles.code));
    const nameByUser = new Map<string, string>();
    const labelByUser = new Map<string, string>();
    for (const r of staffRows) {
      if (!nameByUser.has(r.userId)) {
        nameByUser.set(r.userId, r.name ?? "—");
        labelByUser.set(r.userId, roleLabel(r.code, r.label));
      }
    }

    const staff: CpdStaffRow[] = memberIds.map((userId) => {
      const earned = earnedByUser.get(userId) ?? { att: 0, refl: 0 };
      const avail = availByUser.get(userId) ?? { att: 0, refl: 0 };
      const earnedTotal = round2(earned.att + earned.refl);
      const availTotal = round2(avail.att + avail.refl);
      // No points were made available yet → no honest at-risk signal → on-track (can't be behind on nothing).
      const ratio = availTotal > 0 ? earnedTotal / availTotal : 1;
      const band: CpdBand =
        ratio < AT_RISK_RATIO ? "at-risk" : ratio < BELOW_PACE_RATIO ? "below-pace" : "on-track";
      const name = nameByUser.get(userId) ?? "—";
      return {
        userId,
        name,
        initials: initialsOf(name),
        roleLabel: labelByUser.get(userId) ?? "Teaching staff",
        earned: earnedTotal,
        target,
        band,
        reason: band === "at-risk" ? deriveReason(earned, avail, ptsAttended, ptsReflection) : null,
      };
    });

    const bandOrder: Record<CpdBand, number> = { "at-risk": 0, "below-pace": 1, "on-track": 2 };
    staff.sort((a, b) => bandOrder[a.band] - bandOrder[b.band] || a.name.localeCompare(b.name));

    const atRiskCount = staff.filter((s) => s.band === "at-risk").length;
    const belowPaceCount = staff.filter((s) => s.band === "below-pace").length;
    const onTrackCount = staff.filter((s) => s.band === "on-track").length;
    const avgEarned = staff.length
      ? round2(staff.reduce((s, r) => s + r.earned, 0) / staff.length)
      : 0;

    return {
      academicYear: year,
      target,
      staffCount: staff.length,
      avgEarned,
      onTrackCount,
      belowPaceCount,
      atRiskCount,
      staff,
      atRisk: staff.filter((s) => s.band === "at-risk"),
      hasSettledSessions,
    };
  });
}

/** The DERIVED at-risk reason from the held-only gap (never a fabricated narrative). */
function deriveReason(
  earned: { att: number; refl: number },
  avail: { att: number; refl: number },
  ptsAttended: number,
  ptsReflection: number,
): string {
  const parts: string[] = [];
  const missedSessions = ptsAttended > 0 ? Math.round((avail.att - earned.att) / ptsAttended) : 0;
  const missedRefl = ptsReflection > 0 ? Math.round((avail.refl - earned.refl) / ptsReflection) : 0;
  if (missedSessions > 0)
    parts.push(`${missedSessions} held session${missedSessions === 1 ? "" : "s"} missed`);
  if (missedRefl > 0)
    parts.push(`${missedRefl} reflection${missedRefl === 1 ? "" : "s"} not counted`);
  return parts.length ? parts.join(" · ") : "below the expected pace across held sessions";
}
