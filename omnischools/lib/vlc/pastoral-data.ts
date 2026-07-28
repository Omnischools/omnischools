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
import { classes, students, vlcPastoralFlag } from "@/db/schema";
import { VLC_PASTORAL_READ_ROLES, hasAnyRole } from "@/lib/access";

export interface PastoralFlagView {
  id: string;
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
      studentName: shortNameOf(r.firstName, r.lastName),
      severity: r.severity,
      context: r.context,
      surfacedBy: r.surfacedBy,
      raisedAtLabel: timeLabel(r.raisedAt),
    }));
  });
}
