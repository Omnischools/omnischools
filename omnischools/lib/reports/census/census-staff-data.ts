import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import { roleAssignments, roles, staffProfiles, staffCompensation } from "@/db/schema";
import { isStaff } from "@/lib/access";

/**
 * GOV-8 · the census staff read (Kofi §3 staff arm) — teaching / non-teaching head-counts split by sex, and
 * the salary-status tally the census reports. Server-only, `withSchool`-scoped, AGGREGATE-ONLY (counts, never
 * names/pay). This is the one staff read the task sanctions beyond the shipped rollup arms (the rollup exposes
 * a teaching COUNT + PTR but neither a sex split, non-teaching, nor `staff_compensation.salaryStatus`).
 *
 * Teaching is the SAME definition the enrolment arm's PTR uses (a role whose code/label matches "teacher"),
 * so the two never disagree. Non-teaching = a staff member (isStaff) who is not teaching. Sex comes from the
 * free-text, NULLABLE `staff_profile.gender`; an uncaptured gender is an honest `unknown` bucket, never
 * guessed — which drives the section to PARTIAL (some captured) rather than a fabricated split.
 *
 * salaryStatus is a per-status COUNT (school-paid / GES-paid / allowance); ZERO comp rows → the generator
 * renders the arm NOT_APPLICABLE ("this school does not run payroll in Omnischools"), never a fabricated 0
 * (GOV8-09) — the same honesty as the GOV-3 payroll line.
 */

export type CensusStaffGroup = { female: number; male: number; unknown: number; total: number };
export type CensusSalaryStatus = {
  schoolPaid: number;
  gesPaid: number;
  allowance: number;
  total: number; // 0 → the arm is NOT_APPLICABLE (no payroll run in Omnischools)
};
export type CensusStaff = {
  teaching: CensusStaffGroup;
  nonTeaching: CensusStaffGroup;
  salaryStatus: CensusSalaryStatus;
};

const isTeacherRole = (code: string, label: string | null): boolean =>
  /teacher/i.test(code) || /teacher/i.test(label ?? "");

const normSex = (gender: string | null): "female" | "male" | "unknown" => {
  const g = (gender ?? "").trim().toLowerCase();
  if (g.startsWith("f")) return "female";
  if (g.startsWith("m")) return "male";
  return "unknown";
};

export async function getCensusStaff(schoolId: string): Promise<CensusStaff> {
  return withSchool(schoolId, async (tx) => {
    const roleRows = await tx
      .select({ userId: roleAssignments.userId, code: roles.code, label: roles.label })
      .from(roleAssignments)
      .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
      .where(and(eq(roleAssignments.schoolId, schoolId), isNull(roleAssignments.endDate)));

    const profileRows = await tx
      .select({ userId: staffProfiles.userId, gender: staffProfiles.gender })
      .from(staffProfiles)
      .where(eq(staffProfiles.schoolId, schoolId));

    const compRows = await tx
      .select({ salaryStatus: staffCompensation.salaryStatus })
      .from(staffCompensation)
      .where(eq(staffCompensation.schoolId, schoolId));

    // Fold role assignments to one record per user: their role codes + whether any is a teaching role.
    const perUser = new Map<string, { codes: string[]; teaching: boolean }>();
    for (const r of roleRows) {
      const u = perUser.get(r.userId) ?? { codes: [], teaching: false };
      u.codes.push(r.code);
      if (isTeacherRole(r.code, r.label)) u.teaching = true;
      perUser.set(r.userId, u);
    }

    const genderByUser = new Map(profileRows.map((p) => [p.userId, normSex(p.gender)]));

    const teaching: CensusStaffGroup = { female: 0, male: 0, unknown: 0, total: 0 };
    const nonTeaching: CensusStaffGroup = { female: 0, male: 0, unknown: 0, total: 0 };
    for (const [userId, u] of perUser) {
      if (!isStaff(u.codes)) continue; // parents/students/board holding an assignment here are not staff
      const group = u.teaching ? teaching : nonTeaching;
      group[genderByUser.get(userId) ?? "unknown"]++;
      group.total++;
    }

    const salaryStatus: CensusSalaryStatus = { schoolPaid: 0, gesPaid: 0, allowance: 0, total: 0 };
    for (const c of compRows) {
      if (c.salaryStatus === "GES_PAID") salaryStatus.gesPaid++;
      else if (c.salaryStatus === "ALLOWANCE") salaryStatus.allowance++;
      else salaryStatus.schoolPaid++; // SCHOOL_PAID default
      salaryStatus.total++;
    }

    return { teaching, nonTeaching, salaryStatus };
  });
}
