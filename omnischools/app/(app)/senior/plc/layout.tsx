import { redirect } from "next/navigation";
import { requireSchool } from "@/lib/auth/server";
import { PlcTabs } from "@/components/plc/plc-tabs";

/**
 * PLC nested layout (SHS module 4.6) — renders the shared Setup · Sessions sub-nav above every PLC page.
 * Read gate = the shared `isStaff` (R368, delivered by `requireSchool`) + a BASIC-tier redirect as
 * defence-in-depth; each page keeps its OWN gate (a layout guard never stops the page rendering on its
 * own — the page and every server action re-check). Renders only the tab row + children; no data fetch.
 */
export default async function PlcLayout({ children }: { children: React.ReactNode }) {
  const { school } = await requireSchool();
  if (school.schoolType === "BASIC") redirect("/dashboard");
  return (
    <div className="mx-auto max-w-page">
      <PlcTabs />
      {children}
    </div>
  );
}
