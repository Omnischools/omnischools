import "server-only";
/**
 * 🔴 INCR-42b — the SOLE confidential-content read path for VLC pastoral flags (SHS module 4.5). The one
 * reader that projects a flag's `severity` / `context` / `surfaced_by`; NO other query anywhere returns
 * flag content (the create/resolve actions read only ids + class_teacher_user_id, for gating). Imports the
 * DB driver via `withSchool` — NEVER import from a client component; the page passes plain serializable
 * views to the client callout.
 *
 * TWO-LAYER access model (Kofi R318). RLS (FORCE + tenant_isolation + parent_deny) is the tenant + parent
 * boundary. This reader is the INTRA-tenant app-layer scoping:
 *   • ROLE gate — the caller must hold FORM_MASTER or DEAN_OF_STUDENTS (VLC_PASTORAL_READ_ROLES); anyone
 *     else (ADMIN, HEADMASTER, a Peer Guide, a student) gets an empty list, never a row.
 *   • OWN-CLASS narrowing — a DEAN reads ALL of the school's flags (school-wide pastoral authority); a
 *     FORM_MASTER reads ONLY flags whose flagged student's class has `class_teacher_user_id === caller.id`.
 *     The filter anchors on the STUDENT's class (join flag → students → classes), so a session-less flag
 *     still gates, and `caller.userId` is server-loaded/un-spoofable. This is the IDOR fence: an FM
 *     querying a class that is not theirs gets ZERO rows because the WHERE never matches.
 *
 * Only ACTIVE flags (`resolved_at IS NULL`) are returned — resolving a flag drops it from the callout (the
 * open-row idiom). Projects EXACTLY what the callout renders; the flagged student's name is abbreviated
 * server-side (the register's "J. Manu" idiom) and `raised_at` is pre-formatted to a school-tz clock, so no
 * raw timestamp or full record leaves the DB.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import {
  classes,
  houses,
  students,
  users,
  vlcPastoralCase,
  vlcPastoralFlag,
  vlcPastoralJournal,
  vlcPastoralNote,
  vlcPastoralObservation,
  vlcSession,
  vlcSessionAttendance,
  vlcSessionTemplate,
  vlcValue,
} from "@/db/schema";
import { VLC_PASTORAL_READ_ROLES, hasAnyRole } from "@/lib/access";
import { canAccessPastoralFlag } from "@/lib/vlc/authz";
import { classFormNumber } from "@/lib/senior/form";

export interface PastoralFlagView {
  id: string;
  studentId: string; // for the INCR-43a "Open journal" deep-link (/senior/vlc/journal/[studentId])
  studentName: string; // "J. Manu" — the register's abbreviation
  severity: string; // NOTE | CONCERN | CRISIS (the frozen allow-list)
  context: string | null; // the ONE short locator (never a narrative)
  surfacedBy: string | null; // "Akua Gyamfi (PG)" — display attribution, no access weight
  raisedAtLabel: string; // "3:08 PM" — school tz (Ghana = UTC), pre-formatted
}

export interface PastoralCaller {
  roles: readonly string[];
  userId: string | null | undefined;
}

// Ghana is UTC+0 (Africa/Accra), so the civil clock is UTC — pin it so a raw timestamp never ships.
const timeLabel = (at: Date): string =>
  new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC",
  }).format(at);

const shortNameOf = (first: string, last: string) => `${first.charAt(0)}. ${last}`;

/**
 * The active pastoral flags a gated caller may see for `classId`. Returns [] for a non-gated caller (the
 * page never renders the callout for them — the flag row is never fetched into their props). The own-class
 * WHERE is the security boundary; `classId` scopes the callout to the register being viewed.
 */
export async function getPastoralFlags(
  schoolId: string,
  caller: PastoralCaller,
  classId: string,
): Promise<PastoralFlagView[]> {
  // ROLE gate — an ADMIN / HEADMASTER / PG / student / parent never reaches the content.
  if (!hasAnyRole(caller.roles, VLC_PASTORAL_READ_ROLES)) return [];
  const isDean = caller.roles.includes("DEAN_OF_STUDENTS");
  // A non-Dean caller (i.e. a Form Master) with no resolvable id can own no class → nothing to show.
  if (!isDean && !caller.userId) return [];

  return withSchool(schoolId, async (tx) => {
    const rows = await tx
      .select({
        id: vlcPastoralFlag.id,
        studentId: vlcPastoralFlag.studentId,
        firstName: students.firstName,
        lastName: students.lastName,
        severity: vlcPastoralFlag.severity,
        context: vlcPastoralFlag.context,
        surfacedBy: vlcPastoralFlag.surfacedBy,
        raisedAt: vlcPastoralFlag.raisedAt,
      })
      .from(vlcPastoralFlag)
      // Anchor on the STUDENT's class so a session-less flag still gates on class ownership.
      .innerJoin(
        students,
        and(eq(students.schoolId, vlcPastoralFlag.schoolId), eq(students.id, vlcPastoralFlag.studentId)),
      )
      .innerJoin(
        classes,
        and(eq(classes.schoolId, students.schoolId), eq(classes.id, students.classId)),
      )
      .where(
        and(
          eq(vlcPastoralFlag.schoolId, schoolId),
          isNull(vlcPastoralFlag.resolvedAt), // active only (resolve drops it from the callout)
          eq(students.classId, classId), // the register being viewed
          // 🔴 THE OWN-CLASS FENCE — a Form Master sees ONLY their own class's flags; the Dean is
          // school-wide (no clause). Un-spoofable: classTeacherUserId is DB-loaded, caller.userId is
          // the server session. An other-class FM matches nothing here → zero rows.
          isDean ? undefined : eq(classes.classTeacherUserId, caller.userId!),
        ),
      )
      .orderBy(desc(vlcPastoralFlag.raisedAt));

    return rows.map((r) => ({
      id: r.id,
      studentId: r.studentId,
      studentName: shortNameOf(r.firstName, r.lastName),
      severity: r.severity,
      context: r.context,
      surfacedBy: r.surfacedBy,
      raisedAtLabel: timeLabel(r.raisedAt),
    }));
  });
}

/* ============================================================================
 * 🔴 INCR-43a — the CONFIDENTIAL casework reader (SHS module 4.5). The SOLE server-only path that
 * projects the FOUR casework bodies (vlc_pastoral_journal.body / vlc_pastoral_note.body /
 * vlc_pastoral_observation.body / vlc_pastoral_case.summary) for the per-student journal page. NO other
 * query anywhere returns any of the four bodies (the write actions touch ids only, for gating + audit).
 *
 * The gate is REUSED VERBATIM from 42b — `canAccessPastoralFlag` (DEAN school-wide OR own-class-FM
 * identity). Resolve the student → class → class_teacher_user_id ONCE (server-loaded, un-spoofable),
 * role-gate VLC_PASTORAL_READ_ROLES, then narrow: a DEAN reads any student; a FORM_MASTER reads ONLY a
 * student whose class teacher IS them. A non-gated caller (ADMIN / HEADMASTER / other-class FM / PG /
 * student / parent) gets `null` — the page turns that into `notFound()` (the whole page is confidential;
 * a non-gated viewer must not even learn a case exists). Everything but the raw bodies DERIVES: word
 * count, entry date (session.session_date else created_at), the "N open" note count (the student's flags
 * WHERE resolved_at IS NULL — never a stored column), the year-strip metrics, the timeline.
 * ==========================================================================*/

export interface CaseworkStreamItem {
  kind: "entry" | "note" | "observation";
  id: string;
  dateLabel: string; // "07 May 2026" — entry date derives (session_date else created_at)
  timeLabel: string; // "3:24 PM" — school tz (Ghana = UTC)
  body: string;
  wordCount: number | null; // entries only (derived); null for notes/observations
  valueLabel: string | null; // entries linked to a session: "Value 7 Patriotism · B"
  author: string | null; // notes: the FM/Dean who wrote it
  observedBy: string | null; // observations: the PG named as DATA (never a principal)
}

export interface CaseworkTimelineCell {
  valueLabel: string; // "V7 · B"
  dateLabel: string;
  state: "attended" | "late" | "absent" | "flag";
  flagged: boolean;
}

export interface StudentCaseworkView {
  studentId: string;
  classTeacherUserId: string | null; // returned so the page computes the (identical) write gate
  hero: {
    fullName: string;
    shortName: string; // "J. Manu"
    initials: string; // "JM"
    age: number | null;
    className: string | null;
    formLabel: string | null; // "F2"
    houseName: string | null;
    fmName: string | null;
    hasActiveCase: boolean;
  };
  metrics: {
    sessionsHeld: number;
    sessionsAttended: number;
    absences: number;
    reflections: number;
    avgWords: number;
    minWords: number;
    maxWords: number;
    notesTotal: number;
    notesOpen: number; // DERIVES from flags resolved_at IS NULL
    observations: number;
  };
  timeline: CaseworkTimelineCell[];
  activeCase: {
    flagId: string;
    summary: string;
    openedLabel: string;
    revisedLabel: string;
    revisedByName: string | null;
  } | null;
  // Flags on this student that have no case yet — the anchors for "open a case" (1:1 per flag, R328).
  openableFlags: { id: string; label: string }[];
  stream: CaseworkStreamItem[]; // entries + notes + observations, newest-first (append-only chrome)
}

const dateLabelOf = (d: Date): string =>
  new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
const dateLabelFromIso = (iso: string): string => dateLabelOf(new Date(`${iso}T00:00:00Z`));
const initialsOf = (first: string, last: string) =>
  `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
const wordsIn = (s: string): number => {
  const t = s.trim();
  return t ? t.split(/\s+/).length : 0;
};
const ageFromDob = (iso: string | null): number | null => {
  if (!iso) return null;
  const dob = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const m = now.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) age -= 1;
  return age >= 0 && age < 120 ? age : null;
};

/**
 * The whole casework document for ONE student — or `null` for a non-gated caller (never a stub). This is
 * the gate AND the sole content path; the page renders nothing when it returns null.
 */
export async function getStudentCasework(
  schoolId: string,
  caller: PastoralCaller,
  studentId: string,
): Promise<StudentCaseworkView | null> {
  // ROLE gate — an ADMIN / HEADMASTER / PG / student / parent never reaches the content.
  if (!hasAnyRole(caller.roles, VLC_PASTORAL_READ_ROLES)) return null;
  const isDean = caller.roles.includes("DEAN_OF_STUDENTS");
  // A non-Dean caller (a Form Master) with no resolvable id can own no class → nothing.
  if (!isDean && !caller.userId) return null;

  return withSchool(schoolId, async (tx) => {
    // 1) student → class → class teacher (the fence anchor, server-loaded / un-spoofable).
    const [stu] = await tx
      .select({
        id: students.id,
        firstName: students.firstName,
        lastName: students.lastName,
        dateOfBirth: students.dateOfBirth,
        classId: students.classId,
        className: classes.name,
        classLevel: classes.level,
        classTeacherUserId: classes.classTeacherUserId,
        houseName: houses.name,
      })
      .from(students)
      .leftJoin(classes, and(eq(classes.schoolId, students.schoolId), eq(classes.id, students.classId)))
      .leftJoin(houses, and(eq(houses.schoolId, students.schoolId), eq(houses.id, students.houseId)))
      .where(and(eq(students.schoolId, schoolId), eq(students.id, studentId)))
      .limit(1);
    if (!stu) return null;

    // 🔴 THE OWN-CLASS FENCE — REUSED VERBATIM (DEAN → any student; FM → own-class identity only). An
    // other-class FM (or any non-gated role) fails here and gets null: no "a case exists" leak.
    if (
      !canAccessPastoralFlag({
        roles: caller.roles,
        userId: caller.userId,
        classTeacherUserId: stu.classTeacherUserId,
      })
    ) {
      return null;
    }

    const [fm] = stu.classTeacherUserId
      ? await tx.select({ name: users.fullName }).from(users).where(eq(users.id, stu.classTeacherUserId)).limit(1)
      : [];

    // 2) the FOUR casework tables — the SOLE projection of the bodies.
    const journalRows = await tx
      .select({
        id: vlcPastoralJournal.id,
        body: vlcPastoralJournal.body,
        createdAt: vlcPastoralJournal.createdAt,
        sessionDate: vlcSession.sessionDate,
        ordinal: vlcValue.ordinal,
        nameEn: vlcValue.nameEn,
        slot: vlcSessionTemplate.slot,
      })
      .from(vlcPastoralJournal)
      .leftJoin(
        vlcSession,
        and(eq(vlcSession.schoolId, vlcPastoralJournal.schoolId), eq(vlcSession.id, vlcPastoralJournal.sessionId)),
      )
      .leftJoin(
        vlcSessionTemplate,
        and(
          eq(vlcSessionTemplate.schoolId, vlcSession.schoolId),
          eq(vlcSessionTemplate.id, vlcSession.sessionTemplateId),
        ),
      )
      .leftJoin(
        vlcValue,
        and(eq(vlcValue.schoolId, vlcSessionTemplate.schoolId), eq(vlcValue.id, vlcSessionTemplate.valueId)),
      )
      .where(and(eq(vlcPastoralJournal.schoolId, schoolId), eq(vlcPastoralJournal.studentId, studentId)));

    const noteRows = await tx
      .select({
        id: vlcPastoralNote.id,
        body: vlcPastoralNote.body,
        createdAt: vlcPastoralNote.createdAt,
        author: users.fullName,
      })
      .from(vlcPastoralNote)
      .leftJoin(users, eq(users.id, vlcPastoralNote.authorUserId))
      .where(and(eq(vlcPastoralNote.schoolId, schoolId), eq(vlcPastoralNote.studentId, studentId)));

    const obsRows = await tx
      .select({
        id: vlcPastoralObservation.id,
        body: vlcPastoralObservation.body,
        observedBy: vlcPastoralObservation.observedBy,
        createdAt: vlcPastoralObservation.createdAt,
      })
      .from(vlcPastoralObservation)
      .where(and(eq(vlcPastoralObservation.schoolId, schoolId), eq(vlcPastoralObservation.studentId, studentId)));

    // the case(s) — 1:1 per flag; a student may hold ≥1 flag, so join case → flag → student.
    const caseRows = await tx
      .select({
        flagId: vlcPastoralCase.flagId,
        summary: vlcPastoralCase.summary,
        openedAt: vlcPastoralCase.openedAt,
        lastRevisedAt: vlcPastoralCase.lastRevisedAt,
        revisedBy: users.fullName,
      })
      .from(vlcPastoralCase)
      .innerJoin(
        vlcPastoralFlag,
        and(eq(vlcPastoralFlag.schoolId, vlcPastoralCase.schoolId), eq(vlcPastoralFlag.id, vlcPastoralCase.flagId)),
      )
      .leftJoin(users, eq(users.id, vlcPastoralCase.lastRevisedByUserId))
      .where(and(eq(vlcPastoralCase.schoolId, schoolId), eq(vlcPastoralFlag.studentId, studentId)))
      .orderBy(desc(vlcPastoralCase.openedAt));

    // 3) flags — the "N open" count (resolved_at IS NULL), timeline dots, and case anchors.
    const flagRows = await tx
      .select({
        id: vlcPastoralFlag.id,
        sessionId: vlcPastoralFlag.sessionId,
        resolvedAt: vlcPastoralFlag.resolvedAt,
        raisedAt: vlcPastoralFlag.raisedAt,
      })
      .from(vlcPastoralFlag)
      .where(and(eq(vlcPastoralFlag.schoolId, schoolId), eq(vlcPastoralFlag.studentId, studentId)));
    const notesOpen = flagRows.filter((f) => !f.resolvedAt).length;
    const flaggedSessionIds = new Set(flagRows.map((f) => f.sessionId).filter(Boolean) as string[]);

    // 4) the class's held sessions + this student's attendance → the timeline + attendance metrics.
    const sessionRows = stu.classId
      ? await tx
          .select({
            id: vlcSession.id,
            sessionDate: vlcSession.sessionDate,
            ordinal: vlcValue.ordinal,
            slot: vlcSessionTemplate.slot,
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
          .where(and(eq(vlcSession.schoolId, schoolId), eq(vlcSession.classId, stu.classId)))
          .orderBy(vlcSession.sessionDate)
      : [];
    const attRows = await tx
      .select({ sessionId: vlcSessionAttendance.sessionId, status: vlcSessionAttendance.status })
      .from(vlcSessionAttendance)
      .where(and(eq(vlcSessionAttendance.schoolId, schoolId), eq(vlcSessionAttendance.studentId, studentId)));
    const statusBySession = new Map(attRows.map((r) => [r.sessionId, r.status]));

    const timeline: CaseworkTimelineCell[] = sessionRows.map((s) => {
      const raw = statusBySession.get(s.id);
      const flagged = flaggedSessionIds.has(s.id);
      const state: CaseworkTimelineCell["state"] = flagged
        ? "flag"
        : raw === "ABSENT"
          ? "absent"
          : raw === "LATE"
            ? "late"
            : "attended";
      return { valueLabel: `V${s.ordinal} · ${s.slot}`, dateLabel: dateLabelFromIso(s.sessionDate), state, flagged };
    });

    const sessionsHeld = sessionRows.length;
    const sessionIdSet = new Set(sessionRows.map((s) => s.id));
    const absences = attRows.filter((r) => r.status === "ABSENT" && sessionIdSet.has(r.sessionId)).length;

    // reflection word-count metrics (all DERIVED — length is not depth; NO quality/engagement score).
    const words = journalRows.map((j) => wordsIn(j.body));
    const avgWords = words.length ? Math.round(words.reduce((a, b) => a + b, 0) / words.length) : 0;

    // 5) interleave the three append-only streams, newest-first (sort by the recorded created_at).
    const stream: { at: number; item: CaseworkStreamItem }[] = [
      ...journalRows.map((j) => ({
        at: j.createdAt.getTime(),
        item: {
          kind: "entry" as const,
          id: j.id,
          dateLabel: j.sessionDate ? dateLabelFromIso(j.sessionDate) : dateLabelOf(j.createdAt),
          timeLabel: timeLabel(j.createdAt),
          body: j.body,
          wordCount: wordsIn(j.body),
          valueLabel: j.ordinal != null ? `Value ${j.ordinal} ${j.nameEn} · ${j.slot}` : null,
          author: null,
          observedBy: null,
        },
      })),
      ...noteRows.map((n) => ({
        at: n.createdAt.getTime(),
        item: {
          kind: "note" as const,
          id: n.id,
          dateLabel: dateLabelOf(n.createdAt),
          timeLabel: timeLabel(n.createdAt),
          body: n.body,
          wordCount: null,
          valueLabel: null,
          author: n.author ?? null,
          observedBy: null,
        },
      })),
      ...obsRows.map((o) => ({
        at: o.createdAt.getTime(),
        item: {
          kind: "observation" as const,
          id: o.id,
          dateLabel: dateLabelOf(o.createdAt),
          timeLabel: timeLabel(o.createdAt),
          body: o.body,
          wordCount: null,
          valueLabel: null,
          author: null,
          observedBy: o.observedBy,
        },
      })),
    ];
    stream.sort((a, b) => b.at - a.at);

    const caseFlagIds = new Set(caseRows.map((c) => c.flagId));
    const activeCase = caseRows[0]
      ? {
          flagId: caseRows[0].flagId,
          summary: caseRows[0].summary,
          openedLabel: dateLabelOf(caseRows[0].openedAt),
          revisedLabel: dateLabelOf(caseRows[0].lastRevisedAt),
          revisedByName: caseRows[0].revisedBy ?? null,
        }
      : null;
    const openableFlags = flagRows
      .filter((f) => !caseFlagIds.has(f.id))
      .map((f) => ({ id: f.id, label: `Flag · ${dateLabelOf(f.raisedAt)}` }));

    return {
      studentId,
      classTeacherUserId: stu.classTeacherUserId ?? null,
      hero: {
        fullName: `${stu.firstName} ${stu.lastName}`,
        shortName: shortNameOf(stu.firstName, stu.lastName),
        initials: initialsOf(stu.firstName, stu.lastName),
        age: ageFromDob(stu.dateOfBirth),
        className: stu.className ?? null,
        formLabel: (() => {
          const f = classFormNumber(stu.classLevel, stu.className ?? "");
          return f ? `F${f}` : null;
        })(),
        houseName: stu.houseName ?? null,
        fmName: fm?.name ?? null,
        hasActiveCase: !!activeCase,
      },
      metrics: {
        sessionsHeld,
        sessionsAttended: Math.max(0, sessionsHeld - absences),
        absences,
        reflections: journalRows.length,
        avgWords,
        minWords: words.length ? Math.min(...words) : 0,
        maxWords: words.length ? Math.max(...words) : 0,
        notesTotal: noteRows.length,
        notesOpen,
        observations: obsRows.length,
      },
      timeline,
      activeCase,
      openableFlags,
      stream: stream.map((s) => s.item),
    } satisfies StudentCaseworkView;
  });
}
