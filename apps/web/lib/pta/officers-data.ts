/**
 * SERVER-ONLY PTA officer-matrix read (SHS module 4.7 / INCR-51). Loads the tenant-scoped rows —
 * active `ptas` + their class/House join, the coalesced tier configs, the CURRENT stored officer rows
 * (ended_at IS NULL), the ended history (for previous-holder text), and the DERIVED ex-officio holders
 * (Headmaster / class teacher / housemaster) — then hands them to the PURE `composeMatrix` in
 * `lib/pta/officers.ts`. Nothing here fabricates a holder; a PTA with 0 stored officers composes to an
 * honest all-vacant matrix (the ex-officio slot still derives).
 *
 * Imports the DB driver via withSchool — NEVER import from a client component ([[reports-data-is-
 * server-only]]); the page passes plain pre-formatted primitives to the client matrix. The read gate is
 * admin-only (PTA_CONFIG_WRITE_ROLES, read == manage) — applied by the layout + page, which redirect.
 *
 * `person_type` is DERIVED at read (guardian-link ⇒ parent / staff-role ⇒ staff / external_name ⇒
 * external) — a DISPLAY tag only; authz never keys on it (R419).
 */
import "server-only";
import { and, eq, inArray, isNull, isNotNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { withSchool } from "@/lib/db/rls";
import {
  classes,
  houses,
  ptas,
  ptaOfficer,
  ptaTiersConfig,
  roleAssignments,
  roles,
  students,
  studentGuardians,
  users,
} from "@/db/schema";
import { coalescePtaTiers, type PtaTierType } from "./defaults";
import {
  coalesceExOfficio,
  composeMatrix,
  type EndedOfficer,
  type OfficersMatrix,
  type PersonType,
  type PtaComposeInput,
  type StoredOfficer,
} from "./officers";

const todayISO = () => new Date().toISOString().slice(0, 10);

/** The whole officer matrix, pre-formatted. Read-gate (PTA_CONFIG_WRITE_ROLES) applied by the caller. */
export async function getPtaOfficerMatrix(schoolId: string): Promise<OfficersMatrix> {
  return withSchool(schoolId, async (tx) => {
    const classTeacher = alias(users, "class_teacher");
    const houseMaster = alias(users, "house_master");

    // ── Active PTAs + class/House join (name + the ex-officio staff pointer) ──
    const ptaRows = await tx
      .select({
        id: ptas.id,
        tierType: ptas.tierType,
        classId: ptas.classId,
        houseId: ptas.houseId,
        className: classes.name,
        classTeacherName: classTeacher.fullName,
        houseName: houses.name,
        houseGender: houses.gender,
        hmName: houseMaster.fullName,
      })
      .from(ptas)
      .leftJoin(classes, and(eq(ptas.schoolId, classes.schoolId), eq(ptas.classId, classes.id)))
      .leftJoin(classTeacher, eq(classes.classTeacherUserId, classTeacher.id))
      .leftJoin(houses, and(eq(ptas.schoolId, houses.schoolId), eq(ptas.houseId, houses.id)))
      .leftJoin(houseMaster, eq(houses.hmUserId, houseMaster.id))
      .where(and(eq(ptas.schoolId, schoolId), eq(ptas.status, "ACTIVE")));

    if (ptaRows.length === 0) {
      return { general: null, houses: [], forms: [], multiHat: [], totals: { houses: { filled: 0, total: 0 }, forms: { filled: 0, total: 0 } } };
    }
    const ptaIds = ptaRows.map((r) => r.id);

    // ── Coalesced tier config (officer_roles + tier_settings per tier; spine seeds {} ) ──
    const tierRows = await tx
      .select({
        tierType: ptaTiersConfig.tierType,
        active: ptaTiersConfig.active,
        frequencyNorm: ptaTiersConfig.frequencyNorm,
        officerRoles: ptaTiersConfig.officerRoles,
        quorumRule: ptaTiersConfig.quorumRule,
        duesEnabled: ptaTiersConfig.duesEnabled,
        duesAmount: ptaTiersConfig.duesAmount,
        duesBasis: ptaTiersConfig.duesBasis,
        duesCadence: ptaTiersConfig.duesCadence,
        tierSettings: ptaTiersConfig.tierSettings,
        configuredAt: ptaTiersConfig.configuredAt,
      })
      .from(ptaTiersConfig)
      .where(eq(ptaTiersConfig.schoolId, schoolId));
    const tiers = coalescePtaTiers(tierRows);
    const tierOf = (t: PtaTierType) => tiers.find((x) => x.tierType === t)!;

    // ── Officer rows (current + ended), with the holder's resolved name ──
    const officerCols = {
      id: ptaOfficer.id,
      ptaId: ptaOfficer.ptaId,
      office: ptaOfficer.office,
      personUserId: ptaOfficer.personUserId,
      externalName: ptaOfficer.externalName,
      holderFullName: users.fullName,
      assignmentBasis: ptaOfficer.assignmentBasis,
      electionRef: ptaOfficer.electionRef,
      termStart: ptaOfficer.termStart,
      termEnd: ptaOfficer.termEnd,
      endedAt: ptaOfficer.endedAt,
      endReason: ptaOfficer.endReason,
    };
    const currentRows = await tx
      .select(officerCols)
      .from(ptaOfficer)
      .leftJoin(users, eq(ptaOfficer.personUserId, users.id))
      .where(and(eq(ptaOfficer.schoolId, schoolId), inArray(ptaOfficer.ptaId, ptaIds), isNull(ptaOfficer.endedAt)));
    const endedRows = await tx
      .select(officerCols)
      .from(ptaOfficer)
      .leftJoin(users, eq(ptaOfficer.personUserId, users.id))
      .where(and(eq(ptaOfficer.schoolId, schoolId), inArray(ptaOfficer.ptaId, ptaIds), isNotNull(ptaOfficer.endedAt)));

    // ── person_type derivation: a holder id is `parent` if it links a guardian, else `staff` ──
    const holderIds = [
      ...new Set(currentRows.map((r) => r.personUserId).filter((x): x is string => !!x)),
    ];
    const guardianUserIds = new Set<string>();
    if (holderIds.length > 0) {
      const g = await tx
        .select({ userId: studentGuardians.userId })
        .from(studentGuardians)
        .where(and(eq(studentGuardians.schoolId, schoolId), inArray(studentGuardians.userId, holderIds)));
      for (const r of g) if (r.userId) guardianUserIds.add(r.userId);
    }
    const personType = (personUserId: string | null, externalName: string | null): PersonType => {
      if (externalName != null) return "external";
      if (personUserId && guardianUserIds.has(personUserId)) return "parent";
      return "staff";
    };
    const holderName = (r: { holderFullName: string | null; externalName: string | null }) =>
      r.externalName ?? r.holderFullName ?? "Unknown holder";

    const stored: StoredOfficer[] = currentRows.map((r) => ({
      id: r.id,
      ptaId: r.ptaId,
      office: r.office,
      personUserId: r.personUserId,
      holderName: holderName(r),
      personType: personType(r.personUserId, r.externalName),
      assignmentBasis: r.assignmentBasis as "ELECTED" | "APPOINTED",
      electionRef: r.electionRef,
      termStart: String(r.termStart),
      termEnd: r.termEnd != null ? String(r.termEnd) : null,
    }));
    const ended: EndedOfficer[] = endedRows.map((r) => ({
      ptaId: r.ptaId,
      office: r.office,
      holderName: holderName(r),
      endedAt: (r.endedAt instanceof Date ? r.endedAt.toISOString() : String(r.endedAt)).slice(0, 10),
      endReason: r.endReason,
    }));

    // ── Headmaster ex-officio (General): the holder(s) of the coalesced headmaster_role ──
    const headmasterRole = coalesceExOfficio(tierOf("GENERAL").tierSettings).headmasterRole;
    const hmHolders = await tx
      .select({ name: users.fullName })
      .from(roleAssignments)
      .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
      .innerJoin(users, eq(roleAssignments.userId, users.id))
      .where(and(eq(roleAssignments.schoolId, schoolId), eq(roles.code, headmasterRole), isNull(roleAssignments.endDate)));
    const headmasterNames = hmHolders.map((r) => r.name ?? "Headmaster");

    // ── Scope badges: student counts per class / House ──
    const classIds = ptaRows.map((r) => r.classId).filter((x): x is string => !!x);
    const houseIds = ptaRows.map((r) => r.houseId).filter((x): x is string => !!x);
    const classCounts = new Map<string, number>();
    const houseCounts = new Map<string, number>();
    if (classIds.length > 0) {
      const rows = await tx
        .select({ classId: students.classId, n: sql<number>`count(*)::int` })
        .from(students)
        .where(and(eq(students.schoolId, schoolId), inArray(students.classId, classIds)))
        .groupBy(students.classId);
      for (const r of rows) if (r.classId) classCounts.set(r.classId, r.n);
    }
    if (houseIds.length > 0) {
      const rows = await tx
        .select({ houseId: students.houseId, n: sql<number>`count(*)::int` })
        .from(students)
        .where(and(eq(students.schoolId, schoolId), inArray(students.houseId, houseIds)))
        .groupBy(students.houseId);
      for (const r of rows) if (r.houseId) houseCounts.set(r.houseId, r.n);
    }

    const inputs: PtaComposeInput[] = ptaRows
      .filter((r) => r.tierType !== "EMERGENCY") // Emergency has no standing officers (R414)
      .map((r) => {
        const tt = r.tierType as PtaTierType;
        const cfg = tierOf(tt);
        const label =
          tt === "FORM"
            ? `${r.className ?? "Class"} PTA`
            : tt === "HOUSE"
              ? `${r.houseName ?? "House"} PTA`
              : "General PTA";
        const scopeBadge =
          tt === "FORM"
            ? `${classCounts.get(r.classId ?? "") ?? 0} students`
            : tt === "HOUSE"
              ? `${r.houseGender ? `${r.houseGender} · ` : ""}${houseCounts.get(r.houseId ?? "") ?? 0}`
              : null;
        return {
          id: r.id,
          tierType: tt,
          label,
          scopeBadge,
          officerRoles: cfg.officerRoles,
          tierSettings: cfg.tierSettings,
          exOfficioSecretaryName: tt === "FORM" ? r.classTeacherName : tt === "HOUSE" ? r.hmName : null,
          headmasterNames: tt === "GENERAL" ? headmasterNames : [],
        };
      });

    return composeMatrix(inputs, stored, ended, todayISO());
  });
}

/** The assign drawer's per-PTA option list (label + electable offices), for the top "+ Assign" flow. */
export interface AssignablePta {
  id: string;
  tierType: PtaTierType;
  label: string;
  offices: string[]; // officer_roles minus the ex-officio slot
}

export function assignablePtasFromMatrix(m: OfficersMatrix): AssignablePta[] {
  const out: AssignablePta[] = [];
  if (m.general) out.push({ id: m.general.id, tierType: "GENERAL", label: m.general.label, offices: m.general.assignableOffices });
  for (const h of m.houses) out.push({ id: h.id, tierType: "HOUSE", label: h.label, offices: h.assignableOffices });
  for (const f of m.forms) out.push({ id: f.id, tierType: "FORM", label: f.label, offices: f.assignableOffices });
  return out;
}
