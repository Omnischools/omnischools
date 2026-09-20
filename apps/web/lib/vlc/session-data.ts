/**
 * SERVER-ONLY VLC Session register read (SHS module 4.5 / INCR-42a). Loads a single class's single-date
 * live session and DERIVES everything the register surface renders; also a landing list of recent held
 * sessions. Imports the DB driver via withSchool — NEVER import from a client component; the page passes
 * plain serializable props to the client grid. Tenant-scoped; RLS is the boundary.
 *
 * EVERYTHING DERIVES (R311/R312/R315) — nothing below is stored:
 *   • "held" = the vlc_session row exists (no status/started_at column);
 *   • the lifecycle windows + phase state + elapsed/remaining (session-clock, from the F0 programme);
 *   • the auto-lock (session_date + derived close < now);
 *   • present = enrolled − ABSENT rows (LATE counts present); rate/counts;
 *   • the value + slot + title (joined THROUGH session_template_id — no re-stored copy);
 *   • the PG-gold marker + the two facilitators + the two small groups (from the INCR-41 roster).
 * A missing programme coalesces to the frozen Wednesday defaults; a missing session → a coherent
 * not-held view (the page offers the FM an "open session" affordance), never a throw.
 */
import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import { getCurrentPeriod } from "@/lib/boarding/period";
import {
  academicPeriod,
  classes,
  students,
  users,
  vlcProgramme,
  vlcSession,
  vlcSessionAttendance,
  vlcSessionTemplate,
  vlcValue,
  vlcPeerGuide,
} from "@/db/schema";
import {
  coalesceVlcProgramme,
  VLC_VALUES,
  type VlcProgrammeRow,
} from "./defaults";
import { classFormNumber } from "@/lib/senior/form";
import { derivePhaseClock, isSessionWriteLocked, deriveAttendanceCounts, type PhaseClock } from "./session-clock";

const PROGRAMME_LABEL: Record<string, string> = {
  GENERAL_ARTS: "General Arts",
  GENERAL_SCIENCE: "General Science",
  BUSINESS: "Business",
  AGRICULTURE: "Agriculture",
  VISUAL_ARTS: "Visual Arts",
  HOME_ECONOMICS: "Home Economics",
  TECHNICAL: "Technical",
};

const initialsOf = (first: string, last: string) => `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
const shortNameOf = (first: string, last: string) => `${first.charAt(0)}. ${last}`;
const fullNameOf = (first: string, last: string) => `${first} ${last}`;

const fmtDate = (iso: string): string =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${iso}T00:00:00Z`),
  );

/** The intra-curriculum pairing (design commitment §7, V7B↔V9B): the slot-B value whose frozen prompt
 * references "Value {ordinal}B". Derived from the fixed curriculum, not per-school copy. */
function pairedValueLabel(ordinal: number): string | null {
  const needle = `Value ${ordinal}B`;
  const paired = VLC_VALUES.find((v) => v.sessions.some((s) => s.slot === "B" && s.prompt.includes(needle)));
  return paired ? `paired with Value ${paired.ordinal} ${paired.nameEn} · Session B` : null;
}

const slotLabel = (slot: string): string => (slot === "B" ? "Session B · applied" : "Session A · intro");

// ── view types (plain serializable — the page passes these to the client grid) ─────────────────────

export type CellStatus = "present" | "late" | "absent";

export interface SessionCell {
  studentId: string;
  name: string; // "B. Adusei" (surface abbreviation)
  fullName: string; // "Bright Adusei"
  status: CellStatus;
  isPeerGuide: boolean; // PG-gold (derived from the INCR-41 roster; NO stored column)
}

export interface FacilitatorChip {
  kind: "fm" | "pg-boy" | "pg-girl";
  name: string;
  initials: string;
  roleLabel: string;
}

export interface SessionGroup {
  label: string; // "Group A"
  leadName: string;
  leadInitials: string;
  rep: "boy" | "girl";
  members: SessionCell[];
}

export interface ValueFocus {
  ordinal: number;
  nameEn: string;
  nameTwi: string | null;
  slot: string;
  slotLabel: string;
  title: string;
  prompt: string | null;
  pairing: string | null;
}

export interface AttendanceSummary {
  enrolled: number;
  present: number;
  late: number;
  absent: number;
  presentPct: number;
  peerGuideCount: number;
}

interface SessionViewBase {
  classId: string;
  className: string;
  formLabel: string;
  programmeLabel: string | null;
  sessionDate: string;
  dateLabel: string;
  classTeacherUserId: string | null;
  clock: PhaseClock;
}

export interface HeldSessionView extends SessionViewBase {
  held: true;
  sessionId: string;
  weekLabel: string | null;
  focus: ValueFocus;
  facilitators: FacilitatorChip[];
  cells: SessionCell[];
  groups: SessionGroup[];
  summary: AttendanceSummary;
  locked: boolean;
}

export interface NotHeldSessionView extends SessionViewBase {
  held: false;
  templates: { id: string; label: string }[];
}

export type SessionView = HeldSessionView | NotHeldSessionView | null;

// ── the single-session read (the register page) ─────────────────────────────────────────────────

export async function getVlcSession(
  schoolId: string,
  classId: string,
  sessionDate: string,
  now: Date = new Date(),
): Promise<SessionView> {
  return withSchool(schoolId, async (tx) => {
    const [cls] = await tx
      .select({
        id: classes.id,
        name: classes.name,
        level: classes.level,
        programme: classes.programme,
        classTeacherUserId: classes.classTeacherUserId,
      })
      .from(classes)
      .where(and(eq(classes.schoolId, schoolId), eq(classes.id, classId)))
      .limit(1);
    if (!cls) return null;

    const [programmeRow] = await tx
      .select({
        sessionDay: vlcProgramme.sessionDay,
        sessionStart: vlcProgramme.sessionStart,
        openerMin: vlcProgramme.openerMin,
        smallGroupMin: vlcProgramme.smallGroupMin,
        plenaryMin: vlcProgramme.plenaryMin,
        reflectionMin: vlcProgramme.reflectionMin,
        closeMin: vlcProgramme.closeMin,
        configuredAt: vlcProgramme.configuredAt,
      })
      .from(vlcProgramme)
      .where(eq(vlcProgramme.schoolId, schoolId))
      .limit(1);
    const programme = coalesceVlcProgramme((programmeRow as VlcProgrammeRow | undefined) ?? null);
    const clock = derivePhaseClock(programme, sessionDate, now);

    const form = classFormNumber(cls.level, cls.name);
    const base: SessionViewBase = {
      classId,
      className: cls.name,
      formLabel: form ? `F${form}` : "—",
      programmeLabel: cls.programme ? (PROGRAMME_LABEL[cls.programme] ?? cls.programme) : null,
      sessionDate,
      dateLabel: fmtDate(sessionDate),
      classTeacherUserId: cls.classTeacherUserId ?? null,
      clock,
    };

    // The held-session instance for (class × date). Absent → the not-held view + the template picker.
    const [session] = await tx
      .select({
        id: vlcSession.id,
        templateId: vlcSession.sessionTemplateId,
        ordinal: vlcValue.ordinal,
        nameEn: vlcValue.nameEn,
        nameTwi: vlcValue.nameTwi,
        slot: vlcSessionTemplate.slot,
        title: vlcSessionTemplate.title,
        prompt: vlcSessionTemplate.prompt,
      })
      .from(vlcSession)
      .innerJoin(
        vlcSessionTemplate,
        and(
          eq(vlcSessionTemplate.schoolId, vlcSession.schoolId),
          eq(vlcSessionTemplate.id, vlcSession.sessionTemplateId),
        ),
      )
      .innerJoin(
        vlcValue,
        and(eq(vlcValue.schoolId, vlcSessionTemplate.schoolId), eq(vlcValue.id, vlcSessionTemplate.valueId)),
      )
      .where(
        and(
          eq(vlcSession.schoolId, schoolId),
          eq(vlcSession.classId, classId),
          eq(vlcSession.sessionDate, sessionDate),
        ),
      )
      .limit(1);

    if (!session) {
      // The value/session the FM will run today — the school's active templates, ordered value then slot.
      const templateRows = await tx
        .select({
          id: vlcSessionTemplate.id,
          slot: vlcSessionTemplate.slot,
          title: vlcSessionTemplate.title,
          ordinal: vlcValue.ordinal,
          nameEn: vlcValue.nameEn,
        })
        .from(vlcSessionTemplate)
        .innerJoin(
          vlcValue,
          and(eq(vlcValue.schoolId, vlcSessionTemplate.schoolId), eq(vlcValue.id, vlcSessionTemplate.valueId)),
        )
        .where(and(eq(vlcSessionTemplate.schoolId, schoolId), eq(vlcSessionTemplate.active, true)));
      const templates = templateRows
        .sort((a, b) => a.ordinal - b.ordinal || a.slot.localeCompare(b.slot))
        .map((t) => ({ id: t.id, label: `Value ${t.ordinal} ${t.nameEn} · ${t.slot} · ${t.title}` }));
      return { held: false, ...base, templates } satisfies NotHeldSessionView;
    }

    // ── enrolled roster + the not-present rows (present-by-default) ──
    const roster = await tx
      .select({
        id: students.id,
        firstName: students.firstName,
        lastName: students.lastName,
        sex: students.sex,
      })
      .from(students)
      .where(
        and(eq(students.schoolId, schoolId), eq(students.classId, classId), eq(students.status, "ACTIVE")),
      );

    const attendanceRows = await tx
      .select({ studentId: vlcSessionAttendance.studentId, status: vlcSessionAttendance.status })
      .from(vlcSessionAttendance)
      .where(and(eq(vlcSessionAttendance.schoolId, schoolId), eq(vlcSessionAttendance.sessionId, session.id)));
    const statusByStudent = new Map(attendanceRows.map((r) => [r.studentId, r.status]));

    // ── active PGs for this class × current period (INCR-41) → the PG-gold marker + facilitators ──
    const period = await getCurrentPeriod(tx, schoolId);
    const pgRows = period
      ? await tx
          .select({
            studentId: vlcPeerGuide.studentId,
            firstName: students.firstName,
            lastName: students.lastName,
            sex: students.sex,
          })
          .from(vlcPeerGuide)
          .innerJoin(
            students,
            and(eq(students.schoolId, vlcPeerGuide.schoolId), eq(students.id, vlcPeerGuide.studentId)),
          )
          .where(
            and(
              eq(vlcPeerGuide.schoolId, schoolId),
              eq(vlcPeerGuide.classId, classId),
              eq(vlcPeerGuide.academicPeriodId, period.periodId),
            ),
          )
      : [];
    const pgStudentIds = new Set(pgRows.map((p) => p.studentId));

    const cellOf = (s: { id: string; firstName: string; lastName: string }): SessionCell => {
      const raw = statusByStudent.get(s.id);
      const status: CellStatus = raw === "ABSENT" ? "absent" : raw === "LATE" ? "late" : "present";
      return {
        studentId: s.id,
        name: shortNameOf(s.firstName, s.lastName),
        fullName: fullNameOf(s.firstName, s.lastName),
        status,
        isPeerGuide: pgStudentIds.has(s.id),
      };
    };

    // PG-first capture order (gold surfaced first), then the rest by name.
    const cells = roster
      .map(cellOf)
      .sort((a, b) => Number(b.isPeerGuide) - Number(a.isPeerGuide) || a.name.localeCompare(b.name));

    const lateCount = cells.filter((c) => c.status === "late").length;
    const absentCount = cells.filter((c) => c.status === "absent").length;
    const counts = deriveAttendanceCounts(cells.length, lateCount, absentCount);

    // ── facilitator strip: FM (class teacher) + the two active PGs ──
    const [fm] = cls.classTeacherUserId
      ? await tx
          .select({ name: users.fullName })
          .from(users)
          .where(eq(users.id, cls.classTeacherUserId))
          .limit(1)
      : [];
    const facilitators: FacilitatorChip[] = [];
    if (fm?.name) {
      const [first, ...rest] = fm.name.split(" ");
      facilitators.push({
        kind: "fm",
        name: fm.name,
        initials: initialsOf(first ?? "", rest.length ? rest[rest.length - 1] : (first ?? "")),
        roleLabel: `Form Master · ${cls.name}`,
      });
    }
    for (const p of pgRows) {
      const rep = p.sex === "MALE" ? "boy" : "girl";
      facilitators.push({
        kind: rep === "boy" ? "pg-boy" : "pg-girl",
        name: fullNameOf(p.firstName, p.lastName),
        initials: initialsOf(p.firstName, p.lastName),
        roleLabel: `Peer Guide · ${rep === "boy" ? "boys'" : "girls'"} rep`,
      });
    }

    // ── the two PG-led small groups — DERIVED, EPHEMERAL, no table (R314); OMIT the project brief ──
    const present = cells.filter((c) => c.status !== "absent" && !c.isPeerGuide);
    const groups: SessionGroup[] = pgRows.slice(0, 2).map((p, gi) => ({
      label: `Group ${String.fromCharCode(65 + gi)}`,
      leadName: fullNameOf(p.firstName, p.lastName),
      leadInitials: initialsOf(p.firstName, p.lastName),
      rep: p.sex === "MALE" ? "boy" : "girl",
      members: present.filter((_, i) => i % Math.max(1, pgRows.slice(0, 2).length) === gi),
    }));

    const focus: ValueFocus = {
      ordinal: session.ordinal,
      nameEn: session.nameEn,
      nameTwi: session.nameTwi,
      slot: session.slot,
      slotLabel: slotLabel(session.slot),
      title: session.title,
      prompt: session.prompt,
      pairing: pairedValueLabel(session.ordinal),
    };

    // Week N — from the SENIOR period start vs the session date (calendar-derived, never stored).
    let weekLabel: string | null = null;
    if (period) {
      const [startRow] = await tx
        .select({ startsOn: academicPeriod.startsOn })
        .from(academicPeriod)
        .where(and(eq(academicPeriod.schoolId, schoolId), eq(academicPeriod.periodId, period.periodId)))
        .limit(1);
      if (startRow?.startsOn) {
        const days = Math.floor(
          (new Date(`${sessionDate}T00:00:00Z`).getTime() -
            new Date(`${startRow.startsOn}T00:00:00Z`).getTime()) /
            86400000,
        );
        if (days >= 0) weekLabel = `Week ${Math.floor(days / 7) + 1}`;
      }
    }

    return {
      held: true,
      ...base,
      sessionId: session.id,
      weekLabel,
      focus,
      facilitators,
      cells,
      groups,
      summary: { ...counts, peerGuideCount: pgStudentIds.size },
      locked: isSessionWriteLocked(programme, sessionDate, now),
    } satisfies HeldSessionView;
  });
}

// ── the landing read (recent held sessions + the classes a writer may open) ──────────────────────

export interface RecentSession {
  sessionId: string;
  classId: string;
  className: string;
  sessionDate: string;
  dateLabel: string;
  valueLabel: string; // "Value 7 Patriotism · B"
  present: number;
  enrolled: number;
  presentPct: number;
}

export interface LandingClass {
  classId: string;
  name: string;
  formLabel: string;
  classTeacherUserId: string | null;
  fmName: string | null;
  eligible: boolean; // a senior form class (F1–F3) — the surface's constituency
}

export interface SessionsLandingView {
  today: string;
  recent: RecentSession[];
  classes: LandingClass[];
}

export async function getVlcSessionsLanding(
  schoolId: string,
  now: Date = new Date(),
): Promise<SessionsLandingView> {
  const today = now.toISOString().slice(0, 10);
  return withSchool(schoolId, async (tx) => {
    const classRows = await tx
      .select({
        id: classes.id,
        name: classes.name,
        level: classes.level,
        classTeacherUserId: classes.classTeacherUserId,
        fmName: users.fullName,
      })
      .from(classes)
      .leftJoin(users, eq(classes.classTeacherUserId, users.id))
      .where(eq(classes.schoolId, schoolId));
    const landingClasses: LandingClass[] = classRows
      .map((c) => {
        const form = classFormNumber(c.level, c.name);
        return {
          classId: c.id,
          name: c.name,
          formLabel: form ? `F${form}` : "—",
          classTeacherUserId: c.classTeacherUserId ?? null,
          fmName: c.fmName ?? null,
          eligible: form !== null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const sessionRows = await tx
      .select({
        id: vlcSession.id,
        classId: vlcSession.classId,
        className: classes.name,
        sessionDate: vlcSession.sessionDate,
        ordinal: vlcValue.ordinal,
        nameEn: vlcValue.nameEn,
        slot: vlcSessionTemplate.slot,
      })
      .from(vlcSession)
      .innerJoin(classes, and(eq(classes.schoolId, vlcSession.schoolId), eq(classes.id, vlcSession.classId)))
      .innerJoin(
        vlcSessionTemplate,
        and(
          eq(vlcSessionTemplate.schoolId, vlcSession.schoolId),
          eq(vlcSessionTemplate.id, vlcSession.sessionTemplateId),
        ),
      )
      .innerJoin(
        vlcValue,
        and(eq(vlcValue.schoolId, vlcSessionTemplate.schoolId), eq(vlcValue.id, vlcSessionTemplate.valueId)),
      )
      .where(eq(vlcSession.schoolId, schoolId))
      .orderBy(desc(vlcSession.sessionDate))
      .limit(24);

    // present/total per recent session — DERIVED: enrolled(class) − ABSENT rows(session).
    const classIds = [...new Set(sessionRows.map((s) => s.classId))];
    const sessionIds = sessionRows.map((s) => s.id);
    const enrolledByClass = new Map<string, number>();
    if (classIds.length) {
      const enr = await tx
        .select({ classId: students.classId, id: students.id })
        .from(students)
        .where(
          and(
            eq(students.schoolId, schoolId),
            eq(students.status, "ACTIVE"),
            inArray(students.classId, classIds),
          ),
        );
      for (const r of enr) {
        if (r.classId) enrolledByClass.set(r.classId, (enrolledByClass.get(r.classId) ?? 0) + 1);
      }
    }
    const absentBySession = new Map<string, number>();
    if (sessionIds.length) {
      const abs = await tx
        .select({ sessionId: vlcSessionAttendance.sessionId, status: vlcSessionAttendance.status })
        .from(vlcSessionAttendance)
        .where(
          and(
            eq(vlcSessionAttendance.schoolId, schoolId),
            inArray(vlcSessionAttendance.sessionId, sessionIds),
            eq(vlcSessionAttendance.status, "ABSENT"),
          ),
        );
      for (const r of abs) absentBySession.set(r.sessionId, (absentBySession.get(r.sessionId) ?? 0) + 1);
    }

    const recent: RecentSession[] = sessionRows.map((s) => {
      const enrolled = enrolledByClass.get(s.classId) ?? 0;
      const c = deriveAttendanceCounts(enrolled, 0, absentBySession.get(s.id) ?? 0);
      return {
        sessionId: s.id,
        classId: s.classId,
        className: s.className,
        sessionDate: s.sessionDate,
        dateLabel: fmtDate(s.sessionDate),
        valueLabel: `Value ${s.ordinal} ${s.nameEn} · ${s.slot}`,
        present: c.present,
        enrolled,
        presentPct: c.presentPct,
      };
    });

    return { today, recent, classes: landingClasses };
  });
}
