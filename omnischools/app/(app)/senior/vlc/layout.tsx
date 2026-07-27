import { redirect } from "next/navigation";
import { requireSchoolRole } from "@/lib/auth/server";
import { VLC_CONFIG_READ_ROLES } from "@/lib/access";
import { VlcTabs } from "@/components/vlc/vlc-tabs";

/**
 * VLC nested layout (SHS module 4.5) — renders the shared Setup · Peer Guides sub-nav above every VLC
 * page (Lucy INCR-41 §1.2). Gated to VLC_CONFIG_READ_ROLES + BASIC-redirect as defence-in-depth; each
 * page keeps its OWN gate (a layout guard alone is never the boundary — the page and every server action
 * re-check). Renders only the tab row + children; no data fetch here.
 */
export default async function VlcLayout({ children }: { children: React.ReactNode }) {
  const { school } = await requireSchoolRole(VLC_CONFIG_READ_ROLES);
  if (school.schoolType === "BASIC") redirect("/dashboard");
  return (
    <div className="mx-auto max-w-page">
      <VlcTabs />
      {children}
    </div>
  );
}
