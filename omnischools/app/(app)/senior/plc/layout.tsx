import { redirect } from "next/navigation";
import { requireSchool } from "@/lib/auth/server";
import { hasAnyRole, PLC_DASHBOARD_READ_ROLES } from "@/lib/access";
import { PlcTabs } from "@/components/plc/plc-tabs";

/**
 * PLC nested layout (SHS module 4.6) — renders the shared Setup · Sessions · My CPD sub-nav (+ the
 * management-only CPD dashboard tab) above every PLC page. Read gate = the shared `isStaff` (R368,
 * delivered by `requireSchool`) + a BASIC-tier redirect as defence-in-depth; each page keeps its OWN gate
 * (a layout guard never stops the page rendering on its own — the page and every server action re-check).
 *
 * `canSeeDashboard` (hasAnyRole(roles, PLC_DASHBOARD_READ_ROLES), R405) only toggles TAB visibility; the
 * real boundary is the /dashboard route's own redirect gate, not the hidden tab.
 */
export default async function PlcLayout({ children }: { children: React.ReactNode }) {
  const { school, user } = await requireSchool();
  if (school.schoolType === "BASIC") redirect("/dashboard");
  const canSeeDashboard = hasAnyRole(user.roles, PLC_DASHBOARD_READ_ROLES);
  return (
    <div className="mx-auto max-w-page">
      <PlcTabs canSeeDashboard={canSeeDashboard} />
      {children}
    </div>
  );
}
