import { redirect } from "next/navigation";
import { requireSchool } from "@/lib/auth/server";
import { hasAnyRole, PLC_DASHBOARD_READ_ROLES } from "@/lib/access";
import { getSchoolCpdDashboard } from "@/lib/plc/cpd-data";
import { CpdDashboardView } from "@/components/plc/cpd-dashboard";

export const dynamic = "force-dynamic";

/**
 * `/senior/plc/dashboard` — the school-wide CPD rollup (SHS module 4.6 / INCR-49 · R405/R406). The
 * management READ-gate is THE BOUNDARY (not the hidden tab): `redirect("/dashboard")` unless the viewer
 * holds a PLC_DASHBOARD_READ_ROLES role (PD Coordinator / Headmaster / VHA / Admin). RLS alone would let
 * any same-school staffer SELECT the SHOWN ledger, so this app-gate scopes the rollup to management.
 *
 * `force-dynamic` is load-bearing: the reader runs `accrueSettledSessions` (an UPSERT), which must NOT
 * run in a cached RSC. PLC 8-pt arm only — per-staff X/8 + status bands + at-risk callout, no NTC/licence.
 */
export default async function PlcDashboardPage() {
  const { school, user } = await requireSchool();
  if (school.schoolType === "BASIC") redirect("/dashboard");
  if (!hasAnyRole(user.roles, PLC_DASHBOARD_READ_ROLES)) redirect("/dashboard");

  const dashboard = await getSchoolCpdDashboard(school.id);
  return <CpdDashboardView dashboard={dashboard} />;
}
