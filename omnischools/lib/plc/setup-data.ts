/**
 * SERVER-ONLY PLC setup read (SHS module 4.6 / INCR-47). Loads the per-school programme (coalesced to
 * lib/plc/defaults when no plc_programme row — the VLC/sickbay config idiom, never a fabricated row),
 * the ACTIVE PLC groups (+ facilitator name/role & member avatars), the two real-zero config stat
 * tiles, and each PLC's term focus for the CURRENT academic period. Imports the DB driver via
 * withSchool — NEVER import from a client component; the page passes plain pre-formatted primitives to
 * the client editors ([[reports-data-is-server-only]]). All reads are tenant-scoped; RLS is the boundary.
 *
 * HONESTY (R379): an unconfigured school reads the coalesced default cadence, configured:false, an
 * empty PLC list and REAL-ZERO stats. Everything backed by INCR-48/49/NTC data (sessions held,
 * attendance %, NTC sync) is OMITTED here — never a fabricated value.
 */
import "server-only";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, notInArray, or } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import {
  auditLog,
  plc,
  plcMembership,
  plcProgramme,
  plcTermFocus,
  roleAssignments,
  roles,
  users,
} from "@/db/schema";
import { getCurrentPeriod } from "@/lib/boarding/period";
import { NON_STAFF_ROLE_CODES, roleLabel } from "@/lib/staff-roles";
import {
  coalescePlcProgramme,
  plcTypeOf,
  PLC_TYPE_SEMANTICS,
  type PlcProgramme,
  type PlcType,
} from "./defaults";

const PLC_AUDIT_ENTITIES = ["plc_programme", "plc", "plc_membership", "plc_term_focus"];
const TEACHING_STAFF = ["TEACHER", "FORM_MASTER"];

export interface PlcStaffOption {
  userId: string;
  name: string;
  initials: string;
  roleLabel: string;
}

export interface PlcMemberAvatar {
  userId: string;
  initials: string;
  name: string;
}

export interface PlcCardView {
  id: string;
  type: PlcType;
  typeLabel: string;
  mandatory: boolean;
  accent: "navy" | "gold" | "green";
  name: string;
  iconInitials: string;
  facilitator: { userId: string; name: string; initials: string; roleLabel: string } | null;
  memberCount: number;
  /** All active members (name + initials) — the head shows the first few; the edit panel lists all. */
  members: PlcMemberAvatar[];
  /** Current-period term focus, or null (renders the empty state, never a fake). */
  focus: string | null;
  /** null = inherits the programme cadence; else the per-PLC override. */
  overrideFrequency: string | null;
  overrideSessionDay: number | null;
  /** "Biweekly" / "Weekly · <Day>" pill text when overridden, else null. */
  overrideLabel: string | null;
}

export interface PlcSetup {
  programme: PlcProgramme;
  configured: boolean;
  plcs: PlcCardView[];
  staffOptions: PlcStaffOption[];
  stats: {
    activePlcCount: number;
    typeBreakdown: { subject: number; crossCutting: number; newTeacher: number };
    staffInPlc: number;
    teachingStaffCount: number;
  };
  periodLabel: string | null;
  academicYear: string | null;
  provenance: { at: string; byName: string } | null;
}

/** First letters of the first two words, uppercased (mirrors the sidebar/roster avatar idiom). */
function initials(s: string | null | undefined, fallback = "—"): string {
  const parts = (s ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const fmtDate = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(d);

/** The whole PLC surface's config, pre-formatted. Read-gate (isStaff) applied by the page. */
export async function getPlcSetup(schoolId: string): Promise<PlcSetup> {
  return withSchool(schoolId, async (tx) => {
    const today = new Date().toISOString().slice(0, 10);

    const [progRow] = await tx
      .select({
        sessionDay: plcProgramme.sessionDay,
        sessionStart: plcProgramme.sessionStart,
        sessionLengthMin: plcProgramme.sessionLengthMin,
        weeksPerSemester: plcProgramme.weeksPerSemester,
        ptsPerAttendedSession: plcProgramme.ptsPerAttendedSession,
        ptsPerReflection: plcProgramme.ptsPerReflection,
        reflectionWindowHours: plcProgramme.reflectionWindowHours,
        annualPlcTarget: plcProgramme.annualPlcTarget,
        configuredAt: plcProgramme.configuredAt,
      })
      .from(plcProgramme)
      .where(eq(plcProgramme.schoolId, schoolId))
      .limit(1);
    const programme = coalescePlcProgramme(progRow ?? null);

    // Active PLCs (archived_at IS NULL — a PLC is NEVER hard-deleted, R373).
    const plcRows = await tx
      .select({
        id: plc.id,
        type: plc.type,
        name: plc.name,
        facilitatorUserId: plc.facilitatorUserId,
        overrideFrequency: plc.overrideFrequency,
        overrideSessionDay: plc.overrideSessionDay,
      })
      .from(plc)
      .where(and(eq(plc.schoolId, schoolId), isNull(plc.archivedAt)))
      .orderBy(asc(plc.createdAt));
    const plcIds = plcRows.map((p) => p.id);

    // Active membership rows for those PLCs (open row = left_at IS NULL, a real member = user_id NOT NULL).
    const memberRows =
      plcIds.length > 0
        ? await tx
            .select({
              plcId: plcMembership.plcId,
              userId: plcMembership.userId,
              name: users.fullName,
            })
            .from(plcMembership)
            .innerJoin(users, eq(plcMembership.userId, users.id))
            .where(
              and(
                eq(plcMembership.schoolId, schoolId),
                inArray(plcMembership.plcId, plcIds),
                isNull(plcMembership.leftAt),
                isNotNull(plcMembership.userId),
              ),
            )
        : [];

    // Term focus for the CURRENT academic period (blank school → null everywhere).
    const period = await getCurrentPeriod(tx, schoolId);
    const focusRows =
      period && plcIds.length > 0
        ? await tx
            .select({ plcId: plcTermFocus.plcId, focus: plcTermFocus.focus })
            .from(plcTermFocus)
            .where(
              and(
                eq(plcTermFocus.schoolId, schoolId),
                eq(plcTermFocus.academicPeriodId, period.periodId),
                inArray(plcTermFocus.plcId, plcIds),
              ),
            )
        : [];
    const focusByPlc = new Map(focusRows.map((f) => [f.plcId, f.focus]));

    // All staff (non student/parent), active window — the facilitator/member pickers + role labels +
    // the teaching-staff denominator. One pass: reduce to distinct users, keep a representative role.
    const staffRows = await tx
      .select({
        userId: roleAssignments.userId,
        name: users.fullName,
        code: roles.code,
        label: roles.label,
      })
      .from(roleAssignments)
      .innerJoin(users, eq(roleAssignments.userId, users.id))
      .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
      .where(
        and(
          eq(roleAssignments.schoolId, schoolId),
          notInArray(roles.code, NON_STAFF_ROLE_CODES),
          lte(roleAssignments.startDate, today),
          or(isNull(roleAssignments.endDate), gte(roleAssignments.endDate, today)),
        ),
      )
      .orderBy(asc(users.fullName), asc(roles.code));

    const staffByUser = new Map<string, PlcStaffOption>();
    const teachingStaffIds = new Set<string>();
    for (const r of staffRows) {
      if (TEACHING_STAFF.includes(r.code)) teachingStaffIds.add(r.userId);
      if (!staffByUser.has(r.userId)) {
        staffByUser.set(r.userId, {
          userId: r.userId,
          name: r.name ?? "—",
          initials: initials(r.name),
          roleLabel: roleLabel(r.code, r.label),
        });
      }
    }
    const staffOptions = [...staffByUser.values()];

    // Group members by PLC.
    const membersByPlc = new Map<string, PlcMemberAvatar[]>();
    const activeMemberIds = new Set<string>();
    for (const m of memberRows) {
      if (!m.userId) continue;
      activeMemberIds.add(m.userId);
      const arr = membersByPlc.get(m.plcId) ?? [];
      arr.push({ userId: m.userId, initials: initials(m.name), name: m.name ?? "—" });
      membersByPlc.set(m.plcId, arr);
    }

    const plcs: PlcCardView[] = plcRows.map((p) => {
      const t = plcTypeOf(p.type);
      const sem = PLC_TYPE_SEMANTICS[t];
      const members = membersByPlc.get(p.id) ?? [];
      const fac = p.facilitatorUserId ? staffByUser.get(p.facilitatorUserId) : undefined;
      const overrideLabel = p.overrideFrequency
        ? p.overrideFrequency === "BIWEEKLY"
          ? "Biweekly"
          : p.overrideSessionDay
            ? `Weekly · ${DAY_NAMES[Math.min(Math.max(p.overrideSessionDay, 1), 7) - 1]}`
            : "Weekly"
        : null;
      return {
        id: p.id,
        type: t,
        typeLabel: sem.label,
        mandatory: sem.mandatory,
        accent: sem.accent,
        name: p.name,
        iconInitials: initials(p.name, "P"),
        facilitator: fac
          ? { userId: fac.userId, name: fac.name, initials: fac.initials, roleLabel: fac.roleLabel }
          : null,
        memberCount: members.length,
        members,
        focus: focusByPlc.get(p.id) ?? null,
        overrideFrequency: p.overrideFrequency,
        overrideSessionDay: p.overrideSessionDay,
        overrideLabel,
      };
    });

    // Provenance — the latest PLC audit row + its actor (reads audit only; omit-not-fake if none).
    const [prov] = await tx
      .select({
        at: auditLog.occurredAt,
        actorName: users.fullName,
        actorRole: auditLog.actorRole,
      })
      .from(auditLog)
      .leftJoin(users, eq(auditLog.actorUserId, users.id))
      .where(
        and(eq(auditLog.schoolId, schoolId), inArray(auditLog.entityType, PLC_AUDIT_ENTITIES)),
      )
      .orderBy(desc(auditLog.occurredAt))
      .limit(1);

    const typeBreakdown = {
      subject: plcs.filter((p) => p.type === "subject").length,
      crossCutting: plcs.filter((p) => p.type === "cross-cutting").length,
      newTeacher: plcs.filter((p) => p.type === "new-teacher").length,
    };
    let staffInPlc = 0;
    for (const id of activeMemberIds) if (teachingStaffIds.has(id)) staffInPlc++;

    return {
      programme,
      configured: programme.configured,
      plcs,
      staffOptions,
      stats: {
        activePlcCount: plcs.length,
        typeBreakdown,
        staffInPlc,
        teachingStaffCount: teachingStaffIds.size,
      },
      periodLabel: period?.periodLabel ?? null,
      academicYear: period?.academicYear ?? null,
      provenance: prov
        ? {
            at: fmtDate(prov.at),
            byName:
              prov.actorName || (prov.actorRole ? roleLabel(prov.actorRole) : "a coordinator"),
          }
        : null,
    };
  });
}
