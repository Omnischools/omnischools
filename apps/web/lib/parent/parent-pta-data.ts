import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { withParentScope } from "@/lib/db/rls";
import type { Tx } from "@/lib/db";
import {
  students,
  ptas,
  ptaMeeting,
  ptaDuesCharge,
  ptaMeetingAttendance,
  ptaOfficer,
  ptaMinutes,
  ptaAgendaItem,
  ptaActionItem,
  ptaResolution,
  users,
} from "@/db/schema";
import { num } from "@/lib/fees-helpers";
import {
  DEFAULT_REGISTER_LOCK_GRACE_HOURS,
  deriveParentStatus,
  isPtaMeetingWriteLocked,
} from "@/lib/pta/meeting-clock";
import { resolutionOutcome } from "@/lib/pta/minutes";
import {
  bestOfficeByHolder,
  officeRank,
  ownerWithOffice,
  ptaNameFor,
} from "@/lib/pta/parent-labels";
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
 *   • HOUSE → 🔴 INCR-58 (R483/R484): the specific House NAME now labels it — "Aggrey PTA". `house` STAYS
 *             parent_deny (it carries the resident housemaster + colour/capacity/gender IN-ROW), so the name
 *             comes from Wells's SECURITY DEFINER `parent_house_names(school, pu) → (house_id, house_name)`
 *             which returns ONLY the parent's OWN children's houses, id+name. The reader NEVER `SELECT`s
 *             `house`/`houses` in a parent session and builds a name-ONLY `houseNameById` map (the column
 *             guard). A null/unresolved house_id — or a since-CLOSED House PTA not in the active set — keeps
 *             the honest generic "House PTA" (unchanged from 55a).
 *   • dues period → the bridge's `academic_year` (text, always set) → the year label directly. The
 *             PER_TERM term label ("Term 2") lives on `academic_period` (parent_deny) and is not shown.
 */

/**
 * 🔴 INCR-55b · the RECORDS & DIRECTORY half — TWO more parent reads on the SAME `withParentScope` tx:
 *   • OFFICERS from `pta_officer` — Wells's parent_scope returns ONLY current holders (`ended_at IS NULL`)
 *     of the parent's PTAs (R479). leftJoins `ref_user` for the holder name (a PUBLIC governance fact).
 *     Vacancies are the ABSENCE of a row — NEVER synthesised. election_ref / end_reason / contact are the
 *     officer-only fields the projection (the column guard) strips — RLS gates ROWS, the frozen key-set
 *     gates COLUMNS. `isYou` is a reader DERIVATION (row.personUserId === userId); the id is read to derive
 *     the boolean, NEVER projected.
 *   • ADOPTED MINUTES from `pta_minutes` — parent_scope returns ONLY `status='ADOPTED'` of the parent's
 *     PTAs + its subtree (agenda / action / resolution, R478). The resolution PASSED/NOT-PASSED derivation
 *     is REUSED from lib/pta/minutes (`resolutionOutcome`), not re-derived. `quorum_met` is the ONE
 *     surviving attendance fact — public in the MINUTES context (R478), unlike 55a's attendance reader
 *     which omits it (R480). STRIPPED: any DRAFT/CHAIR_REVIEW (RLS already excludes), per-parent + numeric
 *     attendance aggregates, action deadlines/countdowns/SMS, distribution/validation cards, convened_by.
 * Both are read-only SELECTs on the parent-scoped tx; the entry threads the signed-in `userId` for own-hats.
 */

export type ParentPtaTier = "FORM" | "HOUSE" | "GENERAL";
export type ParentPtaAttendanceStatus = "Present" | "Late" | "Absent";
export type ParentPtaClassification = "Discussion" | "Action" | "Resolution";
export type ParentPtaActionStatus = "Pending" | "Completed";
export type ParentPtaResolutionResult = "PASSED" | "NOT_PASSED";

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

/**
 * FROZEN KEY-SET (R479). CURRENT holders only. NEVER project electionRef / endReason / contact /
 * personUserId / the holder's child-class caption — those change the key-set and RED parent-pta.test.ts,
 * not production. `isYou` is the BOOLEAN own-hat derivation, never the id.
 */
export interface ParentPtaOfficer {
  ptaName: string;
  tier: ParentPtaTier;
  office: string; // the STORED office label (school-configurable), NOT a hardcoded enum
  holderName: string; // server-resolved display STRING; public governance fact
  term: string; // "{start} → {end}"; ex-officio / holdover (term_end null) → "While in post"
  isYou: boolean;
}

/** FROZEN KEY-SET (R478). NEVER project a DRAFT field / attendance aggregate / owner deadline. */
export interface ParentPtaAgendaItem {
  order: number;
  title: string;
  classification: ParentPtaClassification;
  narrative: string;
}
/**
 * FROZEN KEY-SET (R478). description / owner / status ONLY — NO deadline / countdown / SMS reminder.
 * `owner` carries the R485 office caption ("{owner} · {office}") baked into the SAME string — no new field;
 * personUserId is read to derive it, never projected (the officer isYou-derivation idiom).
 */
export interface ParentPtaActionItem {
  description: string;
  owner: string;
  status: ParentPtaActionStatus;
}
/** FROZEN KEY-SET (R478). All fields PUBLIC on an adopted minutes; result via the reused staff derivation. */
export interface ParentPtaResolution {
  resolutionNo: string;
  title: string;
  body: string;
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
  result: ParentPtaResolutionResult;
  binding: boolean;
}
/**
 * FROZEN KEY-SET (R478). quorumMet is the ONLY attendance-derived fact that is public in the minutes
 * context (R478); NEVER project numeric/per-parent attendance, convened_by, or any DRAFT/CHAIR_REVIEW row.
 */
export interface ParentPtaMinutes {
  ptaName: string;
  tier: ParentPtaTier;
  meetingLabel: string;
  meetingDateLabel: string;
  quorumMet: boolean;
  agendaItems: ParentPtaAgendaItem[];
  actionItems: ParentPtaActionItem[];
  resolutions: ParentPtaResolution[];
}

export interface ParentPtaData {
  memberships: ParentPtaMembership[];
  dues: ParentPtaDue[];
  attendance: ParentPtaAttendance[];
  officers: ParentPtaOfficer[];
  minutes: ParentPtaMinutes[];
}

const TIER_RANK: Record<ParentPtaTier, number> = { FORM: 0, HOUSE: 1, GENERAL: 2 };
const isParentTier = (t: string): t is ParentPtaTier =>
  t === "FORM" || t === "HOUSE" || t === "GENERAL";

/** Pre-format the billed rate as the codebase's standard cedi string (finance-data / receipt idiom). */
const ghs = (n: number): string =>
  `GHS ${n.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Parent long date from a 'YYYY-MM-DD' column (the 55a attendance idiom — UTC, no time). */
const longDay = (isoDate: string): string => parentLongDate(new Date(`${isoDate}T00:00:00Z`));

/** DB classification (uppercase, pinned on adopted minutes) → the surface's title-case chip label. */
const CLASSIFICATION_LABEL: Record<string, ParentPtaClassification> = {
  DISCUSSION: "Discussion",
  ACTION: "Action",
  RESOLUTION: "Resolution",
};
/** DB action status (PENDING | DONE) → the surface's pill label. */
const actionStatusLabel = (s: string): ParentPtaActionStatus => (s === "DONE" ? "Completed" : "Pending");

/** The parent's PTA reads (participation + records). MUST run on a tx already scoped by withParentScope. */
export async function loadParentPtaTx(
  tx: Tx,
  schoolId: string,
  userId: string,
  now: Date = new Date(),
): Promise<ParentPtaData> {
  // The parent's own children's class labels (students is parent-readable; RLS scopes to own children).
  const kids = await tx
    .select({ classId: students.classId, classLabel: students.currentClassLabel })
    .from(students)
    .where(eq(students.schoolId, schoolId));
  const classLabelById = new Map<string, string>();
  for (const k of kids) if (k.classId && k.classLabel) classLabelById.set(k.classId, k.classLabel);

  // The NAMES of the parent's OWN children's houses (R483/R484) — via Wells's SECURITY DEFINER
  // parent_house_names, which returns ONLY (house_id, house_name) of the parent's kids' houses. `house`
  // itself STAYS parent_deny — NEVER SELECT it in a parent session. Build a name-ONLY map (the column guard).
  const houseNameById = new Map<string, string>();
  const houseRows = (await tx.execute(
    sql`SELECT house_id, house_name FROM parent_house_names(${schoolId}::uuid, ${userId}::uuid)`,
  )) as unknown as { house_id: string; house_name: string }[];
  for (const h of houseRows) if (h.house_id && h.house_name) houseNameById.set(h.house_id, h.house_name);

  // ── Your PTAs — the parent's ACTIVE PTAs (RLS returns ONLY those; EMERGENCY excluded by parent_in_pta).
  const ptaRows = await tx
    .select({ id: ptas.id, tier: ptas.tierType, classId: ptas.classId, houseId: ptas.houseId })
    .from(ptas)
    .where(eq(ptas.schoolId, schoolId));
  const nameById = new Map<string, string>();
  const tierByPtaId = new Map<string, ParentPtaTier>();
  const memberships: ParentPtaMembership[] = [];
  for (const p of ptaRows) {
    if (!isParentTier(p.tier)) continue; // belt: RLS already excludes EMERGENCY
    const ptaName = ptaNameFor(p.tier, p.classId, p.houseId, classLabelById, houseNameById);
    nameById.set(p.id, ptaName);
    tierByPtaId.set(p.id, p.tier);
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
    // A charge on a since-CLOSED PTA is not in nameById (ptas RLS returns ACTIVE only) → tier-generic name
    // (no class/house context on the dues bridge → generic "House PTA"/"Class PTA", unchanged from 55a).
    const ptaName =
      nameById.get(d.ptaId) ?? ptaNameFor(d.tier, null, null, classLabelById, houseNameById);
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

  // ── PTA officers (R479) — CURRENT holders (RLS returns ended_at IS NULL of the parent's PTAs; the
  //    isNull belt makes that intent explicit). leftJoin ref_user for the holder name. election_ref /
  //    end_reason are NEVER selected — the projection is the column guard. Vacancies = no row (no synth).
  const officerRows = await tx
    .select({
      ptaId: ptaOfficer.ptaId,
      office: ptaOfficer.office,
      personUserId: ptaOfficer.personUserId,
      externalName: ptaOfficer.externalName,
      holderFullName: users.fullName,
      termStart: ptaOfficer.termStart,
      termEnd: ptaOfficer.termEnd,
    })
    .from(ptaOfficer)
    .leftJoin(users, eq(ptaOfficer.personUserId, users.id))
    .where(and(eq(ptaOfficer.schoolId, schoolId), isNull(ptaOfficer.endedAt)));
  const officers: ParentPtaOfficer[] = [];
  for (const r of officerRows) {
    const ptaName = nameById.get(r.ptaId);
    const tier = tierByPtaId.get(r.ptaId);
    if (!ptaName || !tier) continue; // belt: officer of a PTA not in the parent's ACTIVE set (RLS excludes)
    officers.push({
      ptaName,
      tier,
      office: r.office,
      holderName: r.holderFullName ?? r.externalName ?? "—",
      term: r.termEnd == null ? "While in post" : `${longDay(r.termStart)} → ${longDay(r.termEnd)}`,
      isYou: r.personUserId != null && r.personUserId === userId,
    });
  }
  officers.sort(
    (a, b) =>
      TIER_RANK[a.tier] - TIER_RANK[b.tier] ||
      a.ptaName.localeCompare(b.ptaName) ||
      officeRank(a.office) - officeRank(b.office) ||
      a.office.localeCompare(b.office),
  );

  // (R485) The action-owner office caption: (ptaId, personUserId) → the holder's best CURRENT office in
  // THAT PTA (multi-hat → highest office wins). Built from the same current-holder officerRows already
  // loaded above (no extra read) — an ended office is not in officerRows, so it can never caption.
  const officeByHolder = bestOfficeByHolder(officerRows);

  // ── Adopted minutes (R478) — RLS returns ONLY status='ADOPTED' of the parent's PTAs + subtree. Join
  //    pta_meeting (membership-scoped, readable) for the label/date/quorum_met; quorum_met is the ONE public
  //    attendance fact in the MINUTES context (R478) — read here even though 55a's attendance omits it (R480).
  const minutesRows = await tx
    .select({
      minutesId: ptaMinutes.id,
      ptaId: ptaMeeting.ptaId,
      meetingType: ptaMeeting.meetingType,
      meetingDate: ptaMeeting.meetingDate,
      quorumMet: ptaMeeting.quorumMet,
    })
    .from(ptaMinutes)
    .innerJoin(
      ptaMeeting,
      and(eq(ptaMeeting.schoolId, ptaMinutes.schoolId), eq(ptaMeeting.id, ptaMinutes.meetingId)),
    )
    .where(eq(ptaMinutes.schoolId, schoolId));
  minutesRows.sort((a, b) => b.meetingDate.localeCompare(a.meetingDate)); // most recent first (B.8)

  const minutesIds = minutesRows.map((m) => m.minutesId);
  const agendaRows = minutesIds.length
    ? await tx
        .select({
          id: ptaAgendaItem.id,
          minutesId: ptaAgendaItem.minutesId,
          seqNo: ptaAgendaItem.seqNo,
          title: ptaAgendaItem.title,
          classification: ptaAgendaItem.classification,
          narrative: ptaAgendaItem.narrative,
        })
        .from(ptaAgendaItem)
        .where(and(eq(ptaAgendaItem.schoolId, schoolId), inArray(ptaAgendaItem.minutesId, minutesIds)))
    : [];
  const agendaIds = agendaRows.map((a) => a.id);

  // Action items (R478 public = description / owner / status only — deadline/countdown/SMS are STRIPPED).
  const actionRows = agendaIds.length
    ? await tx
        .select({
          agendaItemId: ptaActionItem.agendaItemId,
          description: ptaActionItem.description,
          externalName: ptaActionItem.externalName,
          personUserId: ptaActionItem.personUserId, // read to append the owner's office caption (R485); NOT projected
          ownerFullName: users.fullName,
          status: ptaActionItem.status,
        })
        .from(ptaActionItem)
        .leftJoin(users, eq(users.id, ptaActionItem.personUserId))
        .where(and(eq(ptaActionItem.schoolId, schoolId), inArray(ptaActionItem.agendaItemId, agendaIds)))
    : [];
  const resolutionRows = agendaIds.length
    ? await tx
        .select({
          agendaItemId: ptaResolution.agendaItemId,
          resolutionNo: ptaResolution.resolutionNo,
          resolutionText: ptaResolution.resolutionText,
          votesFor: ptaResolution.votesFor,
          votesAgainst: ptaResolution.votesAgainst,
          votesAbstain: ptaResolution.votesAbstain,
          binding: ptaResolution.binding,
        })
        .from(ptaResolution)
        .where(and(eq(ptaResolution.schoolId, schoolId), inArray(ptaResolution.agendaItemId, agendaIds)))
    : [];

  type AgendaRow = (typeof agendaRows)[number];
  const agendaByMinutes = new Map<string, AgendaRow[]>();
  for (const a of agendaRows) {
    const arr = agendaByMinutes.get(a.minutesId);
    if (arr) arr.push(a);
    else agendaByMinutes.set(a.minutesId, [a]);
  }
  const actionByAgenda = new Map(actionRows.map((a) => [a.agendaItemId, a] as const));
  const resolutionByAgenda = new Map(resolutionRows.map((r) => [r.agendaItemId, r] as const));

  const minutes: ParentPtaMinutes[] = minutesRows.map((m) => {
    const items = (agendaByMinutes.get(m.minutesId) ?? []).slice().sort((a, b) => a.seqNo - b.seqNo);
    const agendaItems: ParentPtaAgendaItem[] = items.map((a) => ({
      order: a.seqNo,
      title: a.title,
      classification: CLASSIFICATION_LABEL[a.classification ?? "DISCUSSION"] ?? "Discussion",
      narrative: a.narrative ?? "",
    }));
    const actionItems: ParentPtaActionItem[] = [];
    const resolutions: ParentPtaResolution[] = [];
    for (const a of items) {
      const act = actionByAgenda.get(a.id);
      if (act) {
        // (R485) Append the owner's CURRENT office in THIS minutes' PTA ("· {office}"); name-only when the
        // owner is external / holds no current office in that PTA (see ownerWithOffice).
        const ownerName = act.ownerFullName ?? act.externalName ?? "—";
        actionItems.push({
          description: act.description,
          owner: ownerWithOffice(ownerName, m.ptaId, act.personUserId, officeByHolder),
          status: actionStatusLabel(act.status),
        });
      }
      const res = resolutionByAgenda.get(a.id);
      if (res) {
        resolutions.push({
          resolutionNo: res.resolutionNo ?? "—",
          title: a.title, // the resolution's heading is its parent agenda item's title (B.5)
          body: res.resolutionText,
          votesFor: res.votesFor,
          votesAgainst: res.votesAgainst,
          votesAbstain: res.votesAbstain,
          result: resolutionOutcome(res.votesFor, res.votesAgainst),
          binding: res.binding,
        });
      }
    }
    return {
      ptaName: nameById.get(m.ptaId) ?? "PTA",
      tier: tierByPtaId.get(m.ptaId) ?? "GENERAL",
      meetingLabel: m.meetingType,
      meetingDateLabel: longDay(m.meetingDate),
      quorumMet: m.quorumMet === true, // Secretary judgment; null (unjudged) → not met (B.2 boolean)
      agendaItems,
      actionItems,
      resolutions,
    };
  });

  return { memberships, dues, attendance, officers, minutes };
}

/** Entry point — the parent's PTA slice under `withParentScope` (never `withSchool`). */
export async function loadParentPta(schoolId: string, userId: string): Promise<ParentPtaData> {
  return withParentScope(schoolId, userId, (tx) => loadParentPtaTx(tx, schoolId, userId));
}
