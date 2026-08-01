import { redirect } from "next/navigation";
import { requireSchool } from "@/lib/auth/server";
import { hasAnyRole, PTA_CONFIG_WRITE_ROLES } from "@/lib/access";
import { PtaTabs } from "@/components/pta/pta-tabs";

/**
 * PTA nested layout (SHS module 4.7) — renders the shared Setup · Officers sub-nav above every PTA page
 * (Lucy's nav rec) and applies the admin-only gate + a BASIC-tier redirect as defence-in-depth. The whole
 * PTA surface is PTA_CONFIG_WRITE_ROLES (read == manage, R415/R427), so both tabs share one gate.
 *
 * A layout redirect never stops the page rendering on its own (layouts + pages render in parallel), so
 * each page keeps its OWN gate + every server action re-checks — this is belt-and-braces.
 */
export default async function PtaLayout({ children }: { children: React.ReactNode }) {
  const { school, user } = await requireSchool();
  if (school.schoolType === "BASIC") redirect("/dashboard");
  if (!hasAnyRole(user.roles, PTA_CONFIG_WRITE_ROLES)) redirect("/dashboard");
  return (
    <div className="mx-auto max-w-page">
      <PtaTabs />
      {children}
    </div>
  );
}
