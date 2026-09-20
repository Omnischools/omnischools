import { redirect } from "next/navigation";
import { requireSchool } from "@/lib/auth/server";
import { hasAnyRole, isStaff, PTA_CONFIG_WRITE_ROLES } from "@/lib/access";
import { resolveDuesAccess } from "@/lib/pta/dues-data";
import { PtaTabs } from "@/components/pta/pta-tabs";

/**
 * PTA nested layout (SHS module 4.7) — renders the shared sub-nav above every PTA page and applies a
 * BASIC-tier redirect as defence-in-depth.
 *
 * 🔴 INCR-52 gating fix (R433/Lucy §1): the meeting-register writer is the PTA's SECRETARY — often a
 * NON-ADMIN Form Master — so the meetings surface must NOT be admin-only. The layout read-gate is therefore
 * the shared `isStaff` (a plain teacher/Form-Master reaches the Meetings tab), NOT PTA_CONFIG_WRITE_ROLES.
 * The Setup + Officers PAGES keep their OWN `hasAnyRole(PTA_CONFIG_WRITE_ROLES)` redirect (config is still
 * admin-only, R415/R427), and the Meetings writes are gated per-meeting by `authorizePtaMeetingWrite` (the
 * server-loaded officer IDOR fence). `canManage` only toggles the Setup/Officers TAB visibility — the real
 * boundary is each page's own gate. A layout redirect never stops the page rendering on its own (layouts +
 * pages render in parallel), so each page + every server action re-checks; this is belt-and-braces.
 */
export default async function PtaLayout({ children }: { children: React.ReactNode }) {
  const { school, user } = await requireSchool();
  if (school.schoolType === "BASIC") redirect("/dashboard");
  if (!isStaff(user.roles)) redirect("/dashboard");
  const canManage = hasAnyRole(user.roles, PTA_CONFIG_WRITE_ROLES);
  // Dues tab (INCR-54a): visible to management (school-wide) OR a Treasurer of any PTA (server-loaded,
  // R469). A parent-Treasurer can't reach this layout (isStaff redirect above) — their read is INCR-55.
  const canViewDues = (await resolveDuesAccess(school.id, { userId: user.id, roles: user.roles })).canView;
  return (
    <div className="mx-auto max-w-page">
      <PtaTabs canManage={canManage} canViewDues={canViewDues} />
      {children}
    </div>
  );
}
