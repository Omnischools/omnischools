/**
 * SERVER-ONLY VLC Peer Guides read (SHS module 4.5 / INCR-41). Loads, for the school's CURRENT SENIOR
 * academic_period, the eligible (Form 2 / Form 3) classes with their ACTIVE Peer Guides, the training
 * events for the period's academic year, and the training absences — then DERIVES everything the roster
 * surface renders. Imports the DB driver via withSchool — NEVER import from a client component; the page
 * passes plain serializable props to the client editors. All reads are tenant-scoped; RLS is the boundary.
 *
 * EVERYTHING IS DERIVED (R302/R307) — nothing below is a stored scalar:
 *   • active-PG count + vacancy (< 2 active in an eligible class);
 *   • the 1-boy + 1-girl advisory flag (from students.sex — NOT a stored slot-gender);
 *   • the form distribution (F2 / F3 — from the class form, not a stored column);
 *   • training DONE/NEXT/FUTURE (from scheduled_date vs today) + attendance % (active PGs − absentees);
 *   • the "rotating after T2" count (F3 PGs, who roll off for WASSCE).
 * A missing current period → an empty, coherent view (the page renders the empty state, never a throw).
 */
import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import { getCurrentPeriod } from "@/lib/boarding/period";
import {
  classes,
  students,
  users,
  vlcPeerGuide,
  vlcTraining,
  vlcTrainingAbsence,
} from "@/db/schema";
import { classFormNumber, isPeerGuideEligibleForm } from "./eligibility";

const PROGRAMME_LABEL: Record<string, string> = {
  GENERAL_ARTS: "General Arts",
  GENERAL_SCIENCE: "General Science",
  BUSINESS: "Business",
  AGRICULTURE: "Agriculture",
  VISUAL_ARTS: "Visual Arts",
  HOME_ECONOMICS: "Home Economics",
  TECHNICAL: "Technical",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function initialsOf(first: string, last: string): string {
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}

export interface PeerGuideSlot {
  peerGuideId: string;
  studentId: string;
  name: string;
  initials: string;
  sex: "MALE" | "FEMALE";
  rep: "boy" | "girl";
  roleLabel: string; // "Boys' rep · F2"
}

export interface RosterCandidate {
  studentId: string;
  name: string;
  sex: "MALE" | "FEMALE";
}

export interface RosterClass {
  classId: string;
  name: string; // "Form 2 General Arts A"
  form: number | null; // 1 | 2 | 3 | null
  formLabel: string; // "F1" | "F2" | "F3" | "—"
  eligible: boolean;
  programmeLabel: string | null;
  studentCount: number;
  fmName: string | null;
  slots: PeerGuideSlot[]; // active PGs (0..2)
  openSlots: number; // eligible ? 2 - active : 0
  vacancy: boolean; // eligible && active < 2
  genderBalanced: boolean; // exactly 1 boy + 1 girl (advisory only)
  tenureLabel: string;
  candidates: RosterCandidate[]; // class students not currently serving (appoint picker)
}

export interface TrainingRow {
  id: string;
  scheduledDate: string; // ISO "YYYY-MM-DD"
  day: string; // "26"
  month: string; // "Jan"
  weekday: string; // "SAT"
  title: string;
  description: string | null;
  durationLabel: string; // "90 min"
  status: "DONE" | "NEXT" | "FUTURE";
  present: number | null; // null until the date has passed
  total: number; // active PG count (the denominator)
  pct: number | null;
  attendanceLabel: string; // "34 / 36 · 94%" | "— · upcoming" | "— · scheduled"
  absentPeerGuideIds: string[]; // for the attendance-capture modal
}

export interface PeerGuidesSummary {
  activeCount: number;
  slots: number; // 2 × eligible classes
  fillPct: number;
  openSlots: number;
  vacancyCount: number;
  boys: number;
  girls: number;
  f2: number;
  f3: number;
  trainingsDone: number;
  trainingPct: number | null;
  trainingAvgPresent: number | null;
  trainingTotal: number; // active PG count (the n in "avg n of N")
  rotatingCount: number; // F3 active PGs (roll off for WASSCE)
}

export interface ActivePeerGuide {
  peerGuideId: string;
  name: string;
  className: string;
}

export interface PeerGuidesView {
  hasPeriod: boolean;
  academicYear: string;
  periodLabel: string | null;
  classes: RosterClass[];
  vacancies: RosterClass[];
  activePeerGuides: ActivePeerGuide[];
  trainings: TrainingRow[];
  summary: PeerGuidesSummary;
}

const EMPTY_SUMMARY: PeerGuidesSummary = {
  activeCount: 0,
  slots: 0,
  fillPct: 0,
  openSlots: 0,
  vacancyCount: 0,
  boys: 0,
  girls: 0,
  f2: 0,
  f3: 0,
  trainingsDone: 0,
  trainingPct: null,
  trainingAvgPresent: null,
  trainingTotal: 0,
  rotatingCount: 0,
};

export async function getPeerGuides(schoolId: string): Promise<PeerGuidesView> {
  return withSchool(schoolId, async (tx) => {
    const period = await getCurrentPeriod(tx, schoolId);
    if (!period) {
      return {
        hasPeriod: false,
        academicYear: "—",
        periodLabel: null,
        classes: [],
        vacancies: [],
        activePeerGuides: [],
        trainings: [],
        summary: EMPTY_SUMMARY,
      };
    }

    // ── classes (+ Form Master name) ──
    const classRows = await tx
      .select({
        id: classes.id,
        name: classes.name,
        level: classes.level,
        programme: classes.programme,
        fmName: users.fullName,
      })
      .from(classes)
      .leftJoin(users, eq(classes.classTeacherUserId, users.id))
      .where(eq(classes.schoolId, schoolId));

    // ── students of each class (count + candidate list + sex lookup) ──
    const studentRows = await tx
      .select({
        id: students.id,
        classId: students.classId,
        firstName: students.firstName,
        lastName: students.lastName,
        sex: students.sex,
      })
      .from(students)
      .where(and(eq(students.schoolId, schoolId), eq(students.status, "ACTIVE")));

    // ── active PGs for the current period (ended_at IS NULL) ──
    const activeRows = await tx
      .select({
        peerGuideId: vlcPeerGuide.id,
        classId: vlcPeerGuide.classId,
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
          eq(vlcPeerGuide.academicPeriodId, period.periodId),
          isNull(vlcPeerGuide.endedAt),
        ),
      );

    // ── trainings for the period's academic year (+ absences) ──
    const trainingRows = await tx
      .select({
        id: vlcTraining.id,
        scheduledDate: vlcTraining.scheduledDate,
        title: vlcTraining.title,
        description: vlcTraining.description,
        durationMin: vlcTraining.durationMin,
      })
      .from(vlcTraining)
      .where(and(eq(vlcTraining.schoolId, schoolId), eq(vlcTraining.academicYear, period.academicYear)))
      .orderBy(asc(vlcTraining.scheduledDate));

    const absenceRows = await tx
      .select({
        trainingId: vlcTrainingAbsence.trainingId,
        peerGuideId: vlcTrainingAbsence.peerGuideId,
      })
      .from(vlcTrainingAbsence)
      .where(eq(vlcTrainingAbsence.schoolId, schoolId));

    // ── group students by class ──
    const studentsByClass = new Map<string, typeof studentRows>();
    for (const s of studentRows) {
      if (!s.classId) continue;
      const list = studentsByClass.get(s.classId) ?? [];
      list.push(s);
      studentsByClass.set(s.classId, list);
    }
    const activeByClass = new Map<string, typeof activeRows>();
    const activeStudentIds = new Set<string>();
    for (const a of activeRows) {
      activeStudentIds.add(a.studentId);
      const list = activeByClass.get(a.classId) ?? [];
      list.push(a);
      activeByClass.set(a.classId, list);
    }

    // ── build the per-class roster ──
    const roster: RosterClass[] = classRows
      .map((c) => {
        const form = classFormNumber(c.level, c.name);
        const eligible = isPeerGuideEligibleForm(form);
        const classStudents = studentsByClass.get(c.id) ?? [];
        const active = activeByClass.get(c.id) ?? [];
        const slots: PeerGuideSlot[] = active.map((a) => {
          const rep = a.sex === "MALE" ? "boy" : "girl";
          return {
            peerGuideId: a.peerGuideId,
            studentId: a.studentId,
            name: `${a.firstName} ${a.lastName}`,
            initials: initialsOf(a.firstName, a.lastName),
            sex: a.sex,
            rep,
            roleLabel: `${rep === "boy" ? "Boys'" : "Girls'"} rep${form ? ` · F${form}` : ""}`,
          };
        });
        const boys = slots.filter((s) => s.rep === "boy").length;
        const girls = slots.filter((s) => s.rep === "girl").length;
        return {
          classId: c.id,
          name: c.name,
          form,
          formLabel: form ? `F${form}` : "—",
          eligible,
          programmeLabel: c.programme ? (PROGRAMME_LABEL[c.programme] ?? c.programme) : null,
          studentCount: classStudents.length,
          fmName: c.fmName ?? null,
          slots,
          openSlots: eligible ? Math.max(0, 2 - slots.length) : 0,
          vacancy: eligible && slots.length < 2,
          genderBalanced: boys === 1 && girls === 1,
          tenureLabel:
            form === 3
              ? "Final semester · WASSCE soon"
              : form === 2
                ? period.periodLabel
                : "",
          candidates: eligible
            ? classStudents
                .filter((s) => !activeStudentIds.has(s.id))
                .map((s) => ({
                  studentId: s.id,
                  name: `${s.firstName} ${s.lastName}`,
                  sex: s.sex,
                }))
            : [],
        };
      })
      // Form order F1 → F2 → F3 → unresolved, then by name (stable, readable grid).
      .sort((a, b) => (a.form ?? 99) - (b.form ?? 99) || a.name.localeCompare(b.name));

    const eligibleClasses = roster.filter((c) => c.eligible);
    const activeCount = activeRows.length;
    const slotsTotal = eligibleClasses.length * 2;
    const boys = activeRows.filter((a) => a.sex === "MALE").length;
    const girls = activeRows.filter((a) => a.sex === "FEMALE").length;
    // Form distribution + rotation from the PG's class form.
    const formOfClass = new Map(roster.map((c) => [c.classId, c.form]));
    const f2 = activeRows.filter((a) => formOfClass.get(a.classId) === 2).length;
    const f3 = activeRows.filter((a) => formOfClass.get(a.classId) === 3).length;

    // ── training rows + attendance derivation ──
    const today = new Date().toISOString().slice(0, 10);
    const absencesByTraining = new Map<string, string[]>();
    for (const a of absenceRows) {
      const list = absencesByTraining.get(a.trainingId) ?? [];
      list.push(a.peerGuideId);
      absencesByTraining.set(a.trainingId, list);
    }
    const firstUpcomingIdx = trainingRows.findIndex((t) => t.scheduledDate >= today);
    const trainings: TrainingRow[] = trainingRows.map((t, i) => {
      const d = new Date(`${t.scheduledDate}T00:00:00Z`);
      const isPast = t.scheduledDate < today;
      const status: TrainingRow["status"] = isPast
        ? "DONE"
        : i === firstUpcomingIdx
          ? "NEXT"
          : "FUTURE";
      const absentIds = absencesByTraining.get(t.id) ?? [];
      // ponytail: the denominator is the CURRENT active-PG count, not the roster as-of the training
      // date — a PG appointed/ended after a past training skews that training's present/total (and can
      // disagree with the attendance modal, which iterates current active PGs). Fine for a display %
      // (roster is stable within a semester; F3 roll-off lands at the period boundary = new period).
      // Upgrade: snapshot the active-PG set per training, or count active-as-of scheduled_date.
      const present = isPast ? Math.max(0, activeCount - absentIds.length) : null;
      const pct = isPast && activeCount > 0 ? Math.round((present! / activeCount) * 100) : null;
      const attendanceLabel = isPast
        ? `${present} / ${activeCount}${pct !== null ? ` · ${pct}%` : ""}`
        : status === "NEXT"
          ? "— · upcoming"
          : "— · scheduled";
      return {
        id: t.id,
        scheduledDate: t.scheduledDate,
        day: String(d.getUTCDate()),
        month: MONTHS[d.getUTCMonth()],
        weekday: WEEKDAYS[d.getUTCDay()],
        title: t.title,
        description: t.description,
        durationLabel: `${t.durationMin} min`,
        status,
        present,
        total: activeCount,
        pct,
        attendanceLabel,
        absentPeerGuideIds: absentIds,
      };
    });

    const doneTrainings = trainings.filter((t) => t.status === "DONE" && t.present !== null);
    const trainingsDone = doneTrainings.length;
    const trainingAvgPresent = trainingsDone
      ? Math.round(doneTrainings.reduce((n, t) => n + (t.present ?? 0), 0) / trainingsDone)
      : null;
    const trainingPct =
      trainingsDone && activeCount > 0
        ? Math.round(
            doneTrainings.reduce((n, t) => n + (t.pct ?? 0), 0) / trainingsDone,
          )
        : null;

    const summary: PeerGuidesSummary = {
      activeCount,
      slots: slotsTotal,
      fillPct: slotsTotal > 0 ? Math.round((activeCount / slotsTotal) * 100) : 0,
      openSlots: Math.max(0, slotsTotal - activeCount),
      vacancyCount: eligibleClasses.filter((c) => c.vacancy).length,
      boys,
      girls,
      f2,
      f3,
      trainingsDone,
      trainingPct,
      trainingAvgPresent,
      trainingTotal: activeCount,
      rotatingCount: f3, // F3 PGs roll off for WASSCE (derived, no scheduled-cycle-date storage — OC2/OC3)
    };

    const classNameById = new Map(roster.map((c) => [c.classId, c.name]));
    const activePeerGuides: ActivePeerGuide[] = activeRows.map((a) => ({
      peerGuideId: a.peerGuideId,
      name: `${a.firstName} ${a.lastName}`,
      className: classNameById.get(a.classId) ?? "",
    }));

    return {
      hasPeriod: true,
      academicYear: period.academicYear,
      periodLabel: period.periodLabel,
      classes: roster,
      vacancies: eligibleClasses.filter((c) => c.vacancy),
      activePeerGuides,
      trainings,
      summary,
    };
  });
}
