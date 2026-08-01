import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { withParentScope } from "@/lib/db/rls";
import type { Tx } from "@/lib/db";
import { students, ptas, ptaMeeting, ptaDuesCharge, ptaMeetingAttendance } from "@/db/schema";
import { num } from "@/lib/fees-helpers";
import {
  DEFAULT_REGISTER_LOCK_GRACE_HOURS,
  deriveParentStatus,
  isPtaMeetingWriteLocked,
} from "@/lib/pta/meeting-clock";
import { parentLongDate } from "@/lib/wassce/parent-copy";

/**
 * 🔴 INCR-55a · the PARENT-facing PTA reader — the PARTICIPATION half (SHS module 4.7 capstone · Kofi
 * R474–R482). The FIRST parent PTA read; the SECOND family (after INCR-46) to WIDEN the 19a boundary with
 * READS the parent gets. SERVER-ONLY — imports the db driver, so a client component must never import it
 * (only `pnpm build` catches that leak; the parent-portal-data / reports-data precedent).
 *
 * Wells's four `parent_scope` policies (policies.sql / prod-paste-0082) open the ROW on `ptas`,
 * `pta_meeting` (membership-scoped), `pta_dues_charge` (own family) + `pta_meeting_attendance` (own
 * guardian). RLS is ROW-level and CANNOT mask a column, so THE THREE FROZEN KEY-SETS below are the ONLY
 * column guard: a confidential field spread onto any of the three shapes changes its key-set and reds
 * parent-pta.test.ts (the INCR-46 AC-5 pattern), not production. The reader therefore:
 *   • DUES from `pta_dues_charge` ONLY — `rate_snapshot` is the BILLED amount (R476). It NEVER touches
 *     invoice / invoice_line_item / payment / receipt (all parent_deny), so the money engine is
 *     byte-unchanged for a parent session and tuition cannot leak (0-tuition-leak by construction). NO
 *     paid / outstanding (owner-deferred); every due is labelled "Billed".
 *   • OWN ATTENDANCE only — a parent's own PARENT-register row (RLS keys it on their guardian row;
 *     TEACHER rows carry student_guardian_id NULL → excluded structurally). The parent register is
 *     ABSENT-BY-DEFAULT (a mark-A DELETES the row — R435), so ABSENT is a read-time DERIVATION for a
 *     CLOSED meeting with no own row, NEVER a stored row. Live / not-yet-closed meetings are omitted
 *     ("awaiting" is not shown as a status).
 *   • runs under `withParentScope` ONLY (the D10 parent-loader rule — NEVER withSchool /
 *     withoutTenantScope; both bypass the parent boundary). Read-only by construction — no server action.
 *
 * 🔴 NAME/LABEL DERIVATION under withParentScope (Lucy Q2/Q4). `classes` / `houses` / `academic_period`
 * are parent_deny, so they CANNOT be joined to name a PTA or label a term. Resolved parent-reachably:
 *   • FORM  → the child's own class: match `ptas.class_id` to the parent-readable `students.class_id` and
 *             use `students.current_class_label` → "{class} PTA".
 *   • GENERAL → the static "General PTA".
 *   • HOUSE → the House NAME is NOT parent-reachable (no name column on `students`; `houses` is
 *             parent_deny), so the honest generic "House PTA" is used. A parent belongs to at most one
 *             House PTA per child's house, so this is unambiguous for the common single-boarder case.
 *             🔴 To name the specific House ("Aggrey PTA") a narrow name-only membership-scoped
 *             `parent_scope` on `houses` from Wells is required — flagged, NOT hacked with a withSchool
 *             sub-read (that would break the parent isolation boundary).
 *   • dues period → the bridge's `academic_year` (text, always set) → the year label directly. The
 *             PER_TERM term label ("Term 2") lives on `academic_period` (parent_deny) and is not shown.
 */

export type ParentPtaTier = "FORM" | "HOUSE" | "GENERAL";
export type ParentPtaAttendanceStatus = "Present" | "Late" | "Absent";

/**
 * FROZEN KEY-SET (R480). NEVER project ptaId / classId / houseId / status / officer_roles / quorum_rule /
 * tier_settings — those are read INTERNALLY to derive the name, never returned.
 */
export interface ParentPtaMembership {
  ptaName: string;
  tier: ParentPtaTier;
}

/**
 * FROZEN KEY-SET (R476). Billed-only. NEVER touch invoice / payment; NEVER project invoiceId /
 * householdId / subjectStudentId / lineItemId / academicPeriodId / status.
 */
export interface ParentPtaDue {
  ptaName: string;
  tier: ParentPtaTier;
  periodLabel: string; // the academic year (e.g. "2024/2025") — the parent-reachable period label
  amountBilled: string; // pre-formatted "GHS 50.00" — the reader is the column guard, clients take strings
}

/**
 * FROZEN KEY-SET (R477). The parent's OWN attendance at CLOSED meetings only. NEVER project
 * studentGuardianId / recordedBy / note / minutesLate / any other family's row / the teacher register.
 */
export interface ParentPtaAttendance {
  meetingDateLabel: string;
  ptaName: string;
  meetingLabel: string;
  status: ParentPtaAttendanceStatus;
}

export interface ParentPtaData {
  memberships: ParentPtaMembership[];
  dues: ParentPtaDue[];
  attendance: ParentPtaAttendance[];
}

const TIER_RANK: Record<ParentPtaTier, number> = { FORM: 0, HOUSE: 1, GENERAL: 2 };
const isParentTier = (t: string): t is ParentPtaTier =>
  t === "FORM" || t === "HOUSE" || t === "GENERAL";

/** Pre-format the billed rate as the codebase's standard cedi string (finance-data / receipt idiom). */
const ghs = (n: number): string =>
  `GHS ${n.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Derive the PTA display name parent-reachably (see the docblock). classLabelById is keyed on class_id. */
function ptaNameFor(
  tier: ParentPtaTier,
  classId: string | null,
  classLabelById: Map<string, string>,
): string {
  if (tier === "GENERAL") return "General PTA";
  if (tier === "FORM") {
    const label = classId ? classLabelById.get(classId) : null;
    return label ? `${label} PTA` : "Class PTA";
  }
  // ponytail: generic "House PTA" — the House NAME is parent_deny; upgrade to "{house} PTA" when Wells
  // opens a name-only membership-scoped parent_scope on `houses`.
  return "House PTA";
}

/** The 3 participation reads for the signed-in parent. MUST run on a tx already scoped by withParentScope. */
export async function loadParentPtaTx(
  tx: Tx,
  schoolId: string,
  now: Date = new Date(),
): Promise<ParentPtaData> {
  // The parent's own children's class labels (students is parent-readable; RLS scopes to own children).
  const kids = await tx
    .select({ classId: students.classId, classLabel: students.currentClassLabel })
    .from(students)
    .where(eq(students.schoolId, schoolId));
  const classLabelById = new Map<string, string>();
  for (const k of kids) if (k.classId && k.classLabel) classLabelById.set(k.classId, k.classLabel);

  // ── Your PTAs — the parent's ACTIVE PTAs (RLS returns ONLY those; EMERGENCY excluded by parent_in_pta).
  const ptaRows = await tx
    .select({ id: ptas.id, tier: ptas.tierType, classId: ptas.classId })
    .from(ptas)
    .where(eq(ptas.schoolId, schoolId));
  const nameById = new Map<string, string>();
  const memberships: ParentPtaMembership[] = [];
  for (const p of ptaRows) {
    if (!isParentTier(p.tier)) continue; // belt: RLS already excludes EMERGENCY
    const ptaName = ptaNameFor(p.tier, p.classId, classLabelById);
    nameById.set(p.id, ptaName);
    memberships.push({ ptaName, tier: p.tier });
  }
  memberships.sort(
    (a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || a.ptaName.localeCompare(b.ptaName),
  );

  // ── Your dues — own-family charges (RLS scopes to the parent's children/household). Billed-only:
  //    rate_snapshot off the bridge, NEVER the invoice/payment tables.
  const dueRows = await tx
    .select({
      ptaId: ptaDuesCharge.ptaId,
      tier: ptaDuesCharge.tierType,
      academicYear: ptaDuesCharge.academicYear,
      amount: ptaDuesCharge.rateSnapshot,
    })
    .from(ptaDuesCharge)
    .where(eq(ptaDuesCharge.schoolId, schoolId));
  const dues: ParentPtaDue[] = [];
  for (const d of dueRows) {
    if (!isParentTier(d.tier)) continue;
    // A charge on a since-CLOSED PTA is not in nameById (ptas RLS returns ACTIVE only) → tier-generic name.
    const ptaName = nameById.get(d.ptaId) ?? ptaNameFor(d.tier, null, classLabelById);
    dues.push({ ptaName, tier: d.tier, periodLabel: d.academicYear, amountBilled: ghs(num(d.amount)) });
  }
  dues.sort(
    (a, b) =>
      TIER_RANK[a.tier] - TIER_RANK[b.tier] ||
      a.ptaName.localeCompare(b.ptaName) ||
      a.periodLabel.localeCompare(b.periodLabel),
  );

  // ── Your attendance — CLOSED meetings of the parent's PTAs, most recent first. Meeting reader omits
  //    agenda_json / invited_teacher_user_ids / convened_by / quorum_met (staff PII, R480).
  const meetingRows = (
    await tx
      .select({
        id: ptaMeeting.id,
        ptaId: ptaMeeting.ptaId,
        meetingType: ptaMeeting.meetingType,
        meetingDate: ptaMeeting.meetingDate,
        endTime: ptaMeeting.endTime,
      })
      .from(ptaMeeting)
      .where(eq(ptaMeeting.schoolId, schoolId))
  ).sort((a, b) => b.meetingDate.localeCompare(a.meetingDate));

  // The parent's OWN attendance rows (RLS keys on their guardian row; TEACHER rows excluded structurally).
  // Aggregate per meeting: PRESENT beats LATE beats no-row (→ derived ABSENT once closed).
  const ownByMeeting = new Map<string, "PRESENT" | "LATE">();
  if (meetingRows.length > 0) {
    const attRows = await tx
      .select({ meetingId: ptaMeetingAttendance.meetingId, status: ptaMeetingAttendance.status })
      .from(ptaMeetingAttendance)
      .where(
        and(
          eq(ptaMeetingAttendance.schoolId, schoolId),
          inArray(
            ptaMeetingAttendance.meetingId,
            meetingRows.map((m) => m.id),
          ),
        ),
      );
    for (const r of attRows) {
      if (r.status === "PRESENT") ownByMeeting.set(r.meetingId, "PRESENT");
      else if (r.status === "LATE" && ownByMeeting.get(r.meetingId) !== "PRESENT")
        ownByMeeting.set(r.meetingId, "LATE");
    }
  }

  const attendance: ParentPtaAttendance[] = [];
  for (const m of meetingRows) {
    // Closed = register write-locked (end + grace). tier_settings.register_lock_grace_hours is parent_deny,
    // so the frozen 24h default is used (ponytail: the exact per-school grace is not parent-reachable — it
    // only shifts the live→closed boundary by hours; once truly closed it is always closed).
    if (!isPtaMeetingWriteLocked(m.meetingDate, m.endTime, DEFAULT_REGISTER_LOCK_GRACE_HOURS, now)) {
      continue;
    }
    const st = deriveParentStatus(ownByMeeting.get(m.id) ?? null, true); // finalised → own row or ABSENT
    attendance.push({
      meetingDateLabel: parentLongDate(new Date(`${m.meetingDate}T00:00:00Z`)),
      ptaName: nameById.get(m.ptaId) ?? "PTA",
      meetingLabel: m.meetingType,
      status: st === "present" ? "Present" : st === "late" ? "Late" : "Absent",
    });
  }

  return { memberships, dues, attendance };
}

/** Entry point — the parent's PTA participation slice under `withParentScope` (never `withSchool`). */
export async function loadParentPta(schoolId: string, userId: string): Promise<ParentPtaData> {
  return withParentScope(schoolId, userId, (tx) => loadParentPtaTx(tx, schoolId));
}
