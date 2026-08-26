/**
 * SERVER-ONLY PTA meeting-register read (SHS module 4.7 / INCR-52). Loads a single convened meeting and
 * DERIVES everything the dual register renders (the lifecycle clock, the two rosters, the per-register
 * default polarity, the officer tags, the quorum panel) plus the landing list + the convene form's option
 * lists. Imports the DB driver via withSchool — NEVER import from a client component ([[reports-data-is-
 * server-only]]); the page passes plain pre-formatted primitives to the client interactives. Tenant-scoped;
 * RLS is the boundary.
 *
 * EVERYTHING DERIVES (R432/R435) — nothing here is stored: the lifecycle windows + write-lock (meeting-
 * clock); the TEACHER register is present-by-default (no row = present, PLC-verbatim); the PARENT register
 * is absent-by-default (no row = awaiting-while-live / absent-once-closed, a pure read-time flip — ZERO
 * bulk absent rows, R435). COUNT-ONCE (R437): a person is exactly one register row; officer identity is a
 * display TAG, never a second row; twin-parents dedupe by the person (user_id ∥ phone); a staff member who
 * is also a scope guardian is TEACHER-wins-when-invited (the R437 policy edge).
 *
 * The write gate (`computePtaWriteAccess` / `resolvePtaWriteAccess`) is SHARED with lib/actions/pta-
 * meeting.ts so the page's read-only render and the server-side IDOR fence can never drift: NO bare role
 * satisfies the officer arm, and the offices are SERVER-loaded here, never request-supplied (R439).
 */
import "server-only";
import { and, eq, inArray, isNull, gte, lte, or, desc } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import type { Tx } from "@/lib/db";
import {
  canActAsPtaOfficer,
  hasAnyRole,
  PTA_MEETING_BREAKGLASS_ROLES,
} from "@/lib/access";
import { NON_STAFF_ROLE_CODES, roleLabel } from "@/lib/staff-roles";
import {
  academicPeriod,
  classes,
  houses,
  ptas,
  ptaMeeting,
  ptaMeetingAttendance,
  ptaOfficer,
  ptaTiersConfig,
  roleAssignments,
  roles,
  students,
  studentGuardians,
  users,
} from "@/db/schema";
import { ptaTierDefault, type PtaTierType } from "./defaults";
import { coalesceExOfficio } from "./officers";
import { computePtaWriteAccess } from "./meeting-access";
import {
  coalesceGraceHours,
  derivePtaMeetingClock,
  deriveParentStatus,
  deriveTeacherStatus,
  type PtaMeetingClock,
  type PtaMeetingState,
  type RegisterStatus,
} from "./meeting-clock";

export type { RegisterStatus };

// ── small local helpers (kept off ./defaults to avoid coupling the pure module) ─────────────────────

function toStringRecord(v: unknown): Record<string, string> {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (val !== null && val !== undefined) out[k] = String(val);
    }
    return out;
  }
  return {};
}

function toIdArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
}

function initialsOf(s: string | null | undefined, fallback = "—"): string {
  const parts = (s ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

const fmtDate = (iso: string): string =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));

const relLabel = (r: string | null): string =>
  r === "FATHER" ? "Father" : r === "MOTHER" ? "Mother" : "Guardian";

// ── the agenda shape (agenda_json {items:[{text,durationMin?,done}]}, the INCR-48 plc_session shape) ──

export interface PtaAgendaItem {
  text: string;
  durationMin: number | null;
  done: boolean;
}

export function parsePtaAgenda(json: unknown): PtaAgendaItem[] {
  const items = (json as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return [];
  return items
    .map((it): PtaAgendaItem => {
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

interface RegisterRowBase {
  name: string;
  initials: string;
  context: string; // "Form Master · Maths" / "Father of Kwame Adjei"
  status: RegisterStatus;
  officerTag: string | null; // "Secretary (ex-officio)" / "Chair" / "Treasurer"
  officerExOfficio: boolean; // ex-officio (green tag) vs stored office (gold tag)
}

export interface PtaTeacherRow extends RegisterRowBase {
  userId: string;
}
export interface PtaParentRow extends RegisterRowBase {
  studentGuardianId: string;
}

export interface PtaMeetingView {
  meetingId: string;
  ptaId: string;
  tierType: PtaTierType;
  label: string; // "Form 2 GA A PTA"
  tierLabel: string; // "Form PTA"
  iconInitials: string; // "FP"
  meetingType: string; // free-text display label
  meetingDate: string;
  dateLabel: string;
  timeLabel: string; // "10:00 AM — 12:00 PM"
  location: string | null;
  periodLabel: string | null;
  clock: PtaMeetingClock;
  agenda: PtaAgendaItem[];
  teacherRows: PtaTeacherRow[];
  parentRows: PtaParentRow[];
  quorum: {
    ruleText: string;
    presentCount: number; // parents PRESENT + LATE (R438 — Late counts toward quorum)
    totalParents: number;
    pct: number | null;
    teacherPresent: number;
    teacherTotal: number;
    quorumMet: boolean | null; // the Secretary's judgment (R438 — nullable, NOT auto-derived)
  };
  /** The viewer may write this register (Secretary by identity ∥ break-glass) — SHARED with the gate. */
  canWrite: boolean;
}

// ── the write gate — SHARED with lib/actions/pta-meeting.ts (one authz path, no drift) ───────────────

interface PtaScope {
  ptaId: string;
  tierType: PtaTierType;
  classTeacherUserId: string | null;
  hmUserId: string | null;
  tierSettings: Record<string, string>;
}

/** Server-load the caller's stored offices for THIS pta, then decide. Used by the reader + the action gate. */
export async function resolvePtaWriteAccess(
  tx: Tx,
  schoolId: string,
  scope: PtaScope,
  viewer: { userId: string | null; roles: readonly string[] },
): Promise<{ canWrite: boolean; secretaryOffice: string }> {
  let heldOffices: string[] = [];
  if (viewer.userId) {
    const rows = await tx
      .select({ office: ptaOfficer.office })
      .from(ptaOfficer)
      .where(
        and(
          eq(ptaOfficer.schoolId, schoolId),
          eq(ptaOfficer.ptaId, scope.ptaId),
          eq(ptaOfficer.personUserId, viewer.userId),
          isNull(ptaOfficer.endedAt),
        ),
      );
    heldOffices = rows.map((r) => r.office);
  }
  return computePtaWriteAccess({
    tierType: scope.tierType,
    classTeacherUserId: scope.classTeacherUserId,
    hmUserId: scope.hmUserId,
    tierSettings: scope.tierSettings,
    heldOffices,
    viewer,
  });
}

// ── loading the meeting through the meeting→ptas join (school-derived pta_id/tier — never request) ──

export interface PtaMeetingScope extends PtaScope {
  meetingId: string;
  classId: string | null;
  houseId: string | null;
  meetingType: string;
  meetingDate: string;
  startTime: string;
  endTime: string;
  location: string | null;
  agendaJson: unknown;
  invitedTeacherUserIds: string[];
  quorumMet: boolean | null;
  academicPeriodId: string;
  className: string | null;
  houseName: string | null;
  houseGender: string | null;
  quorumRule: string;
}

const MEETING_JOIN_COLS = {
  meetingId: ptaMeeting.id,
  ptaId: ptaMeeting.ptaId,
  meetingType: ptaMeeting.meetingType,
  meetingDate: ptaMeeting.meetingDate,
  startTime: ptaMeeting.startTime,
  endTime: ptaMeeting.endTime,
  location: ptaMeeting.location,
  agendaJson: ptaMeeting.agendaJson,
  invitedTeacherUserIds: ptaMeeting.invitedTeacherUserIds,
  quorumMet: ptaMeeting.quorumMet,
  academicPeriodId: ptaMeeting.academicPeriodId,
  tierType: ptas.tierType,
  classId: ptas.classId,
  houseId: ptas.houseId,
  className: classes.name,
  classTeacherUserId: classes.classTeacherUserId,
  houseName: houses.name,
  houseGender: houses.gender,
  hmUserId: houses.hmUserId,
  tierSettings: ptaTiersConfig.tierSettings,
  quorumRule: ptaTiersConfig.quorumRule,
} as const;

/** Load a meeting + its PTA scope + tier config through the join. NULL when the meeting does not exist. */
export async function loadMeetingScope(
  tx: Tx,
  schoolId: string,
  meetingId: string,
): Promise<PtaMeetingScope | null> {
  const [row] = await tx
    .select(MEETING_JOIN_COLS)
    .from(ptaMeeting)
    .innerJoin(ptas, and(eq(ptas.schoolId, ptaMeeting.schoolId), eq(ptas.id, ptaMeeting.ptaId)))
    .leftJoin(classes, and(eq(classes.schoolId, ptas.schoolId), eq(classes.id, ptas.classId)))
    .leftJoin(houses, and(eq(houses.schoolId, ptas.schoolId), eq(houses.id, ptas.houseId)))
    .leftJoin(ptaTiersConfig, and(eq(ptaTiersConfig.schoolId, ptas.schoolId), eq(ptaTiersConfig.tierType, ptas.tierType)))
    .where(and(eq(ptaMeeting.schoolId, schoolId), eq(ptaMeeting.id, meetingId)))
    .limit(1);
  if (!row) return null;
  const tierType = row.tierType as PtaTierType;
  return {
    meetingId: row.meetingId,
    ptaId: row.ptaId,
    tierType,
    classId: row.classId,
    houseId: row.houseId,
    meetingType: row.meetingType,
    meetingDate: row.meetingDate,
    startTime: row.startTime,
    endTime: row.endTime,
    location: row.location,
    agendaJson: row.agendaJson,
    invitedTeacherUserIds: toIdArray(row.invitedTeacherUserIds),
    quorumMet: row.quorumMet,
    academicPeriodId: row.academicPeriodId,
    className: row.className,
    classTeacherUserId: row.classTeacherUserId,
    houseName: row.houseName,
    houseGender: row.houseGender,
    hmUserId: row.hmUserId,
    tierSettings: toStringRecord(row.tierSettings),
    quorumRule: row.quorumRule ?? ptaTierDefault(tierType).quorumRule,
  };
}

/**
 * The PARENT-notify audience for a meeting scope (#297 · State-1 console-notify): the SAME primary-
 * guardian roster the register's PARENT column derives (R436), reduced to DEDUPED, non-null phone
 * numbers. FORM→class, HOUSE→house, GENERAL/EMERGENCY→all active students' primary guardians (no scope
 * filter). Runs inside the caller's convene tx; the convener collects each phone as a post-commit
 * SmsIntent (a rollback discards them). One SMS per distinct number (dedupe by phone); a guardian with no
 * phone is silently skipped.
 */
export async function loadMeetingNotifyPhones(
  tx: Tx,
  schoolId: string,
  scope: { tierType: PtaTierType; classId: string | null; houseId: string | null },
): Promise<string[]> {
  const conds = [
    eq(students.schoolId, schoolId),
    eq(students.status, "ACTIVE"),
    eq(studentGuardians.isPrimary, true),
  ];
  if (scope.tierType === "FORM" && scope.classId) conds.push(eq(students.classId, scope.classId));
  else if (scope.tierType === "HOUSE" && scope.houseId) conds.push(eq(students.houseId, scope.houseId));
  const rows = await tx
    .select({ phone: studentGuardians.phone })
    .from(studentGuardians)
    .innerJoin(students, and(eq(students.schoolId, studentGuardians.schoolId), eq(students.id, studentGuardians.studentId)))
    .where(and(...conds));
  const phones = new Set<string>();
  for (const r of rows) {
    const p = r.phone?.trim();
    if (p) phones.add(p);
  }
  return [...phones];
}

const tierLabelOf = (t: PtaTierType): string =>
  t === "FORM" ? "Form PTA" : t === "HOUSE" ? "House PTA" : t === "EMERGENCY" ? "Emergency PTA" : "General PTA";
const iconInitialsOf = (t: PtaTierType): string =>
  t === "FORM" ? "FP" : t === "HOUSE" ? "HP" : t === "EMERGENCY" ? "EP" : "GP";
function ptaLabelOf(scope: { tierType: PtaTierType; className: string | null; houseName: string | null }): string {
  return scope.tierType === "FORM"
    ? `${scope.className ?? "Class"} PTA`
    : scope.tierType === "HOUSE"
      ? `${scope.houseName ?? "House"} PTA`
      : scope.tierType === "EMERGENCY"
        ? "Emergency PTA"
        : "General PTA";
}

// ── the single-meeting read (the register page) ─────────────────────────────────────────────────────

export async function getPtaMeeting(
  schoolId: string,
  meetingId: string,
  viewer: { userId: string | null; roles: readonly string[] },
  now: Date = new Date(),
): Promise<PtaMeetingView | null> {
  return withSchool(schoolId, async (tx) => {
    const scope = await loadMeetingScope(tx, schoolId, meetingId);
    if (!scope) return null;
    const { tierType } = scope;

    const graceHours = coalesceGraceHours(scope.tierSettings);
    const clock = derivePtaMeetingClock(scope.meetingDate, scope.startTime, scope.endTime, graceHours, now);
    const secretaryOffice = coalesceExOfficio(scope.tierSettings).exOfficioOffice;

    // Period label (the term the meeting belongs to).
    const [period] = await tx
      .select({ label: academicPeriod.periodLabel })
      .from(academicPeriod)
      .where(and(eq(academicPeriod.schoolId, schoolId), eq(academicPeriod.periodId, scope.academicPeriodId)))
      .limit(1);

    // Attendance rows for THIS meeting, split by register.
    const attRows = await tx
      .select({
        register: ptaMeetingAttendance.register,
        userId: ptaMeetingAttendance.userId,
        studentGuardianId: ptaMeetingAttendance.studentGuardianId,
        status: ptaMeetingAttendance.status,
      })
      .from(ptaMeetingAttendance)
      .where(and(eq(ptaMeetingAttendance.schoolId, schoolId), eq(ptaMeetingAttendance.meetingId, meetingId)));
    const teacherStatusByUser = new Map<string, string>();
    const parentStatusByGuardian = new Map<string, string>();
    for (const r of attRows) {
      if (r.register === "TEACHER" && r.userId) teacherStatusByUser.set(r.userId, r.status);
      else if (r.register === "PARENT" && r.studentGuardianId) parentStatusByGuardian.set(r.studentGuardianId, r.status);
    }

    // Stored current officers of this PTA → the display-tag map (office by holder user id).
    const officerRows = await tx
      .select({ personUserId: ptaOfficer.personUserId, office: ptaOfficer.office })
      .from(ptaOfficer)
      .where(and(eq(ptaOfficer.schoolId, schoolId), eq(ptaOfficer.ptaId, scope.ptaId), isNull(ptaOfficer.endedAt)));
    const officeByUser = new Map<string, string>();
    for (const r of officerRows) if (r.personUserId && !officeByUser.has(r.personUserId)) officeByUser.set(r.personUserId, r.office);

    // ── TEACHER roster (R436): ex-officio Secretary ∪ invited ∪ walk-ins (any TEACHER attendance row) ──
    const exOfficioTeacherIds = new Set<string>();
    if (tierType === "FORM" && scope.classTeacherUserId) exOfficioTeacherIds.add(scope.classTeacherUserId);
    if (tierType === "HOUSE" && scope.hmUserId) exOfficioTeacherIds.add(scope.hmUserId);
    if (tierType === "GENERAL" || tierType === "EMERGENCY") {
      const headmasterRole = coalesceExOfficio(scope.tierSettings).headmasterRole;
      const hm = await tx
        .select({ userId: roleAssignments.userId })
        .from(roleAssignments)
        .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
        .where(and(eq(roleAssignments.schoolId, schoolId), eq(roles.code, headmasterRole), isNull(roleAssignments.endDate)));
      for (const r of hm) if (r.userId) exOfficioTeacherIds.add(r.userId);
    }
    const teacherUserIds = new Set<string>([
      ...exOfficioTeacherIds,
      ...scope.invitedTeacherUserIds,
      ...teacherStatusByUser.keys(),
    ]);

    // Resolve teacher names + a representative active role label.
    const nameById = new Map<string, string>();
    const roleLabelById = new Map<string, string>();
    if (teacherUserIds.size > 0) {
      const ids = [...teacherUserIds];
      const nameRows = await tx.select({ id: users.id, name: users.fullName }).from(users).where(inArray(users.id, ids));
      for (const r of nameRows) nameById.set(r.id, r.name ?? "—");
      const today = now.toISOString().slice(0, 10);
      const rlRows = await tx
        .select({ userId: roleAssignments.userId, code: roles.code, label: roles.label })
        .from(roleAssignments)
        .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
        .where(
          and(
            eq(roleAssignments.schoolId, schoolId),
            inArray(roleAssignments.userId, ids),
            lte(roleAssignments.startDate, today),
            or(isNull(roleAssignments.endDate), gte(roleAssignments.endDate, today)),
          ),
        )
        .orderBy(roles.code);
      for (const r of rlRows) {
        if (r.code === "STUDENT" || r.code === "PARENT") continue;
        if (!roleLabelById.has(r.userId)) roleLabelById.set(r.userId, roleLabel(r.code, r.label));
      }
    }

    const teacherRows: PtaTeacherRow[] = [...teacherUserIds]
      .map((uid): PtaTeacherRow => {
        const status = deriveTeacherStatus(teacherStatusByUser.get(uid));
        const exOfficio = exOfficioTeacherIds.has(uid);
        const officerTag = exOfficio
          ? tierType === "GENERAL" || tierType === "EMERGENCY"
            ? "Headmaster (ex-officio)"
            : `${secretaryOffice} (ex-officio)`
          : officeByUser.get(uid) ?? null;
        const name = nameById.get(uid) ?? "—";
        return {
          userId: uid,
          name,
          initials: initialsOf(name),
          context: roleLabelById.get(uid) ?? "Teaching staff",
          status,
          officerTag,
          officerExOfficio: exOfficio,
        };
      })
      .sort((a, b) => Number(!!b.officerTag) - Number(!!a.officerTag) || a.name.localeCompare(b.name));

    // ── PARENT roster (R436/R437): PRIMARY guardians of the scope's students, deduped by person ──
    const scopeConds = [
      eq(students.schoolId, schoolId),
      eq(students.status, "ACTIVE"),
      eq(studentGuardians.isPrimary, true),
    ];
    if (tierType === "FORM" && scope.classId) scopeConds.push(eq(students.classId, scope.classId));
    else if (tierType === "HOUSE" && scope.houseId) scopeConds.push(eq(students.houseId, scope.houseId));
    // GENERAL / EMERGENCY → all active students' primary guardians (no scope filter).

    const guardianRows = await tx
      .select({
        guardianId: studentGuardians.id,
        userId: studentGuardians.userId,
        name: studentGuardians.name,
        phone: studentGuardians.phone,
        relationship: studentGuardians.relationship,
        childFirst: students.firstName,
        childLast: students.lastName,
      })
      .from(studentGuardians)
      .innerJoin(students, and(eq(students.schoolId, studentGuardians.schoolId), eq(students.id, studentGuardians.studentId)))
      .where(and(...scopeConds))
      .orderBy(studentGuardians.id);

    // Dedupe to ONE row per PERSON (user_id ∥ phone). A staff member who is also a scope guardian is
    // TEACHER-wins-when-invited (R437 policy edge): skip them here — they appear in the teacher register.
    interface ParentAgg {
      rep: string; // representative student_guardian_id (deterministic — min id, drives the mark + status)
      userId: string | null;
      name: string;
      relationship: string | null;
      children: string[];
    }
    const byPerson = new Map<string, ParentAgg>();
    for (const g of guardianRows) {
      if (g.userId && teacherUserIds.has(g.userId)) continue; // teacher-wins
      const key = g.userId ?? `p:${g.phone}`;
      const child = `${g.childFirst} ${g.childLast}`.trim();
      const existing = byPerson.get(key);
      if (!existing) {
        byPerson.set(key, {
          rep: g.guardianId,
          userId: g.userId,
          name: g.name,
          relationship: g.relationship,
          children: [child],
        });
      } else if (!existing.children.includes(child)) {
        existing.children.push(child);
      }
    }

    const parentRows: PtaParentRow[] = [...byPerson.values()]
      .map((p): PtaParentRow => {
        const status = deriveParentStatus(parentStatusByGuardian.get(p.rep), clock.parentsFinalised);
        const officerTag = p.userId ? officeByUser.get(p.userId) ?? null : null;
        return {
          studentGuardianId: p.rep,
          name: p.name,
          initials: initialsOf(p.name),
          context: `${relLabel(p.relationship)} of ${p.children.join(" & ")}`,
          status,
          officerTag,
          officerExOfficio: false,
        };
      })
      .sort((a, b) => Number(!!b.officerTag) - Number(!!a.officerTag) || a.name.localeCompare(b.name));

    // Access + quorum.
    const { canWrite } = await resolvePtaWriteAccess(tx, schoolId, scope, viewer);
    const presentCount = parentRows.filter((r) => r.status === "present" || r.status === "late").length;
    const totalParents = parentRows.length;
    const teacherPresent = teacherRows.filter((r) => r.status === "present" || r.status === "late").length;

    return {
      meetingId: scope.meetingId,
      ptaId: scope.ptaId,
      tierType,
      label: ptaLabelOf(scope),
      tierLabel: tierLabelOf(tierType),
      iconInitials: iconInitialsOf(tierType),
      meetingType: scope.meetingType,
      meetingDate: scope.meetingDate,
      dateLabel: fmtDate(scope.meetingDate),
      timeLabel: clock.windowLabel,
      location: scope.location,
      periodLabel: period?.label ?? null,
      clock,
      agenda: parsePtaAgenda(scope.agendaJson),
      teacherRows,
      parentRows,
      quorum: {
        ruleText: scope.quorumRule,
        presentCount,
        totalParents,
        pct: totalParents > 0 ? Math.round((presentCount / totalParents) * 100) : null,
        teacherPresent,
        teacherTotal: teacherRows.length,
        quorumMet: scope.quorumMet,
      },
      canWrite,
    } satisfies PtaMeetingView;
  });
}

// ── the meetings landing (upcoming / live / past) ────────────────────────────────────────────────────

export interface PtaMeetingListItem {
  meetingId: string;
  label: string;
  tierLabel: string;
  meetingType: string;
  dateLabel: string;
  timeLabel: string;
  state: PtaMeetingState;
}
export interface PtaMeetingsLanding {
  live: PtaMeetingListItem[];
  upcoming: PtaMeetingListItem[];
  past: PtaMeetingListItem[];
  canConveneAny: boolean;
  canConveneEmergency: boolean;
}

export async function getPtaMeetingsLanding(
  schoolId: string,
  viewer: { userId: string | null; roles: readonly string[] },
  now: Date = new Date(),
): Promise<PtaMeetingsLanding> {
  return withSchool(schoolId, async (tx) => {
    const rows = await tx
      .select({
        meetingId: ptaMeeting.id,
        meetingType: ptaMeeting.meetingType,
        meetingDate: ptaMeeting.meetingDate,
        startTime: ptaMeeting.startTime,
        endTime: ptaMeeting.endTime,
        tierType: ptas.tierType,
        className: classes.name,
        houseName: houses.name,
        tierSettings: ptaTiersConfig.tierSettings,
      })
      .from(ptaMeeting)
      .innerJoin(ptas, and(eq(ptas.schoolId, ptaMeeting.schoolId), eq(ptas.id, ptaMeeting.ptaId)))
      .leftJoin(classes, and(eq(classes.schoolId, ptas.schoolId), eq(classes.id, ptas.classId)))
      .leftJoin(houses, and(eq(houses.schoolId, ptas.schoolId), eq(houses.id, ptas.houseId)))
      .leftJoin(ptaTiersConfig, and(eq(ptaTiersConfig.schoolId, ptas.schoolId), eq(ptaTiersConfig.tierType, ptas.tierType)))
      .where(eq(ptaMeeting.schoolId, schoolId))
      .orderBy(desc(ptaMeeting.meetingDate));

    const live: PtaMeetingListItem[] = [];
    const upcoming: PtaMeetingListItem[] = [];
    const past: PtaMeetingListItem[] = [];
    for (const r of rows) {
      const tierType = r.tierType as PtaTierType;
      const clock = derivePtaMeetingClock(
        r.meetingDate,
        r.startTime,
        r.endTime,
        coalesceGraceHours(toStringRecord(r.tierSettings)),
        now,
      );
      const item: PtaMeetingListItem = {
        meetingId: r.meetingId,
        label: ptaLabelOf({ tierType, className: r.className, houseName: r.houseName }),
        tierLabel: tierLabelOf(tierType),
        meetingType: r.meetingType,
        dateLabel: fmtDate(r.meetingDate),
        timeLabel: clock.windowLabel,
        state: clock.state,
      };
      (clock.state === "held" ? live : clock.state === "scheduled" ? upcoming : past).push(item);
    }
    const convenable = await getConvenablePtas(schoolId, viewer, tx);
    const emergency = await canConveneEmergency(schoolId, viewer, tx);
    return { live, upcoming, past, canConveneAny: convenable.length > 0, canConveneEmergency: emergency };
  });
}

// ── convene-form option lists ────────────────────────────────────────────────────────────────────────

export interface ConvenablePta {
  ptaId: string;
  tierType: PtaTierType;
  label: string;
}

/**
 * The active standing PTAs the viewer may convene a regular meeting for (Secretary by identity ∥
 * break-glass). Emergency PTAs are convened on-demand (a NEW instance) — not listed here. Runs inside an
 * existing tx when passed (the landing reuses it), else opens its own.
 */
export async function getConvenablePtas(
  schoolId: string,
  viewer: { userId: string | null; roles: readonly string[] },
  outerTx?: Tx,
): Promise<ConvenablePta[]> {
  const run = async (tx: Tx): Promise<ConvenablePta[]> => {
    const ptaRows = await tx
      .select({
        id: ptas.id,
        tierType: ptas.tierType,
        classTeacherUserId: classes.classTeacherUserId,
        hmUserId: houses.hmUserId,
        className: classes.name,
        houseName: houses.name,
        tierSettings: ptaTiersConfig.tierSettings,
      })
      .from(ptas)
      .leftJoin(classes, and(eq(classes.schoolId, ptas.schoolId), eq(classes.id, ptas.classId)))
      .leftJoin(houses, and(eq(houses.schoolId, ptas.schoolId), eq(houses.id, ptas.houseId)))
      .leftJoin(ptaTiersConfig, and(eq(ptaTiersConfig.schoolId, ptas.schoolId), eq(ptaTiersConfig.tierType, ptas.tierType)))
      .where(
        and(
          eq(ptas.schoolId, schoolId),
          eq(ptas.status, "ACTIVE"),
          inArray(ptas.tierType, ["FORM", "HOUSE", "GENERAL"]),
        ),
      );

    // The viewer's stored offices across ALL PTAs, in one query (office-by-pta).
    const heldByPta = new Map<string, string[]>();
    if (viewer.userId) {
      const held = await tx
        .select({ ptaId: ptaOfficer.ptaId, office: ptaOfficer.office })
        .from(ptaOfficer)
        .where(and(eq(ptaOfficer.schoolId, schoolId), eq(ptaOfficer.personUserId, viewer.userId), isNull(ptaOfficer.endedAt)));
      for (const h of held) heldByPta.set(h.ptaId, [...(heldByPta.get(h.ptaId) ?? []), h.office]);
    }

    const out: ConvenablePta[] = [];
    for (const p of ptaRows) {
      const tierType = p.tierType as PtaTierType;
      const { canWrite } = computePtaWriteAccess({
        tierType,
        classTeacherUserId: p.classTeacherUserId,
        hmUserId: p.hmUserId,
        tierSettings: toStringRecord(p.tierSettings),
        heldOffices: heldByPta.get(p.id) ?? [],
        viewer,
      });
      if (canWrite) out.push({ ptaId: p.id, tierType, label: ptaLabelOf({ tierType, className: p.className, houseName: p.houseName }) });
    }
    out.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  };
  return outerTx ? run(outerTx) : withSchool(schoolId, run);
}

/**
 * May the viewer convene an EMERGENCY meeting (R440)? break-glass role ∥ the GENERAL PTA "Chair" held BY
 * IDENTITY (a stored office). Runs inside an existing tx when passed (the landing reuses it).
 */
export async function canConveneEmergency(
  schoolId: string,
  viewer: { userId: string | null; roles: readonly string[] },
  outerTx?: Tx,
): Promise<boolean> {
  if (hasAnyRole(viewer.roles, PTA_MEETING_BREAKGLASS_ROLES)) return true;
  const uid = viewer.userId;
  if (!uid) return false;
  const run = async (tx: Tx): Promise<boolean> => {
    const [general] = await tx
      .select({ id: ptas.id })
      .from(ptas)
      .where(and(eq(ptas.schoolId, schoolId), eq(ptas.tierType, "GENERAL"), eq(ptas.status, "ACTIVE")))
      .limit(1);
    if (!general) return false;
    const held = await tx
      .select({ office: ptaOfficer.office })
      .from(ptaOfficer)
      .where(
        and(
          eq(ptaOfficer.schoolId, schoolId),
          eq(ptaOfficer.ptaId, general.id),
          eq(ptaOfficer.personUserId, uid),
          isNull(ptaOfficer.endedAt),
        ),
      );
    return canActAsPtaOfficer({ userId: uid, heldOffices: held.map((h) => h.office), exOfficioOffices: [], office: "Chair" });
  };
  return outerTx ? run(outerTx) : withSchool(schoolId, run);
}

export interface StaffOption {
  userId: string;
  name: string;
  roleLabel: string;
}

/** Staff users (active, non-student/parent) for the convene form's invited-teacher multi-select. */
export async function getConveneStaffOptions(schoolId: string, now: Date = new Date()): Promise<StaffOption[]> {
  return withSchool(schoolId, async (tx) => {
    const today = now.toISOString().slice(0, 10);
    const rows = await tx
      .select({ userId: roleAssignments.userId, name: users.fullName, code: roles.code, label: roles.label })
      .from(roleAssignments)
      .innerJoin(users, eq(roleAssignments.userId, users.id))
      .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
      .where(
        and(
          eq(roleAssignments.schoolId, schoolId),
          lte(roleAssignments.startDate, today),
          or(isNull(roleAssignments.endDate), gte(roleAssignments.endDate, today)),
        ),
      )
      .orderBy(roles.code);
    const byUser = new Map<string, StaffOption>();
    for (const r of rows) {
      if (r.code === "STUDENT" || r.code === "PARENT") continue;
      if (!byUser.has(r.userId)) byUser.set(r.userId, { userId: r.userId, name: r.name ?? "—", roleLabel: roleLabel(r.code, r.label) });
    }
    return [...byUser.values()].sort((a, b) => a.name.localeCompare(b.name));
  });
}

// re-export for the actions file (shared authz path)
export { NON_STAFF_ROLE_CODES };
export type { PtaScope };
