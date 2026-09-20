import "server-only";
import { and, eq, isNotNull } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import { roleAssignments, roles, staffProfiles } from "@/db/schema";

/**
 * assertSchoolClinician (SHS module 4.4 / INCR-24a · Kofi R158 / Sarah advisory 2) — THE shared seam
 * for every clinical actor pointer in the medication layer (24a's controlled-movement witness; 24b's
 * MAR administered_by / witness). Generalises the INCR-21 `holdsMatronRole` (which now delegates here).
 *
 * 🔴 WHY IT IS APP-LAYER, NOT A DB CONSTRAINT. Every clinical actor pointer FKs the GLOBAL `ref_user`
 * (users.id), so the composite (school_id, id) tenant FK the intra-tenant tables use is unavailable —
 * the DB cannot check that the user pointed at holds a role IN THIS school, nor that they carry an
 * N&MC licence here. That check has to live in lib/ (the boarding "Kofi trap J3" rule: business logic
 * in lib/, never a trigger), so it stays portable and is the ONLY tenancy guard on a global pointer.
 *
 * Returns `true` iff `userId` holds the MATRON role in `schoolId`. With `{ requireNmc: true }` it
 * ADDITIONALLY requires a non-null `staff_profile.nmc_licence_number` for the SAME (school_id, user_id)
 * — a real tenant join on the tenant-scoped staff_profile (R155): the N&MC witness of record is a
 * licensed clinician, never a student prefect and never free text.
 *
 * ONE tenant-scoped statement (through `withSchool`, so RLS is the boundary; on dev the app is a
 * superuser and the `eq(schoolId)` filter is what scopes it). The role check joins role_assignments →
 * roles WHERE code = 'MATRON'; the NMC check inner-joins staff_profile on (school_id, user_id) and
 * requires nmc_licence_number IS NOT NULL. No row ⇒ `false`.
 */
export async function assertSchoolClinician(
  schoolId: string,
  userId: string,
  opts?: { requireNmc?: boolean },
): Promise<boolean> {
  const requireNmc = opts?.requireNmc === true;
  return withSchool(schoolId, async (tx) => {
    const base = tx
      .select({ userId: roleAssignments.userId })
      .from(roleAssignments)
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId));
    const rows = requireNmc
      ? await base
          .innerJoin(
            staffProfiles,
            and(
              eq(staffProfiles.schoolId, roleAssignments.schoolId),
              eq(staffProfiles.userId, roleAssignments.userId),
            ),
          )
          .where(
            and(
              eq(roleAssignments.schoolId, schoolId),
              eq(roleAssignments.userId, userId),
              eq(roles.code, "MATRON"),
              isNotNull(staffProfiles.nmcLicenceNumber),
            ),
          )
          .limit(1)
      : await base
          .where(
            and(
              eq(roleAssignments.schoolId, schoolId),
              eq(roleAssignments.userId, userId),
              eq(roles.code, "MATRON"),
            ),
          )
          .limit(1);
    return rows.length > 0;
  });
}

/**
 * Generic "does `userId` hold `roleCode` in `schoolId`?" — the same app-layer tenancy guard as
 * `assertSchoolClinician` (the DB cannot check role membership on a GLOBAL ref_user pointer), for a
 * NON-matron actor pointer. INCR-25b uses it for the referral's HM co-sign (R191:
 * `hm_authorised_by_user_id` must hold HEADMASTER in THIS school). One tenant-scoped statement.
 */
export async function holdsSchoolRole(
  schoolId: string,
  userId: string,
  roleCode: string,
): Promise<boolean> {
  return withSchool(schoolId, async (tx) => {
    const rows = await tx
      .select({ userId: roleAssignments.userId })
      .from(roleAssignments)
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .where(
        and(
          eq(roleAssignments.schoolId, schoolId),
          eq(roleAssignments.userId, userId),
          eq(roles.code, roleCode),
        ),
      )
      .limit(1);
    return rows.length > 0;
  });
}
