import { redirect } from "next/navigation";
import { requireSchool } from "@/lib/auth/server";
import { getMyCpdStatement } from "@/lib/plc/cpd-data";
import { CpdStatement } from "@/components/plc/cpd-statement";

export const dynamic = "force-dynamic";

/**
 * `/senior/plc/my-cpd` — the teacher's own PLC-CPD statement (SHS module 4.6 / INCR-49 · R402). READ gate
 * = the shared `isStaff` (delivered by `requireSchool`) + BASIC redirect; the read is OWN-IDENTITY
 * (WHERE user_id = viewer), so any staffer sees only their own points, no role gate.
 *
 * `force-dynamic` is load-bearing: the reader runs `accrueSettledSessions` (an UPSERT), which must NOT
 * run in a cached RSC. PLC 8-pt arm only — no 20-pt breakdown, NTC sync, licence cycle or gap-analysis.
 */
export default async function MyCpdPage() {
  const { school, user } = await requireSchool();
  if (school.schoolType === "BASIC") redirect("/dashboard");

  const statement = await getMyCpdStatement(school.id, user.id);
  return <CpdStatement statement={statement} />;
}
