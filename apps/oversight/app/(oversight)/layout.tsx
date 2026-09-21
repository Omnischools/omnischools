import type { ReactNode } from "react";
import { getOfficerSession } from "@/lib/auth";
import { Shell } from "@/components/oversight/shell";

export const dynamic = "force-dynamic";

export default async function OversightLayout({ children }: { children: ReactNode }) {
  const officer = await getOfficerSession();
  return (
    <Shell
      officerName={officer?.displayName ?? "Not signed in"}
      officerRole={officer?.officerRole ?? "—"}
      jurisdictionName={officer?.jurisdictionName ?? "Ghana Education Service"}
    >
      {children}
    </Shell>
  );
}
