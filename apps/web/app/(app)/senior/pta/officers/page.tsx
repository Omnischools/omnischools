import { redirect } from "next/navigation";
import { requireSchool } from "@/lib/auth/server";
import { hasAnyRole, PTA_CONFIG_WRITE_ROLES } from "@/lib/access";
import { getPtaOfficerMatrix, assignablePtasFromMatrix } from "@/lib/pta/officers-data";
import { OfficerMatrix } from "@/components/pta/officer-matrix";

export const dynamic = "force-dynamic";

/**
 * `/senior/pta/officers` — the PTA officer matrix (SHS module 4.7 / INCR-51, surface 02): every office
 * at every tier, who holds it, since when, until when. Ex-officio holders (Headmaster / Form Master /
 * Housemaster) are DERIVED read-only; vacancies are derived red; nothing fabricates a holder.
 *
 * ADMIN-ONLY (R427): read == manage (PTA_CONFIG_WRITE_ROLES = Admin / Headmaster). The layout gates too
 * (belt-and-braces); this page keeps its OWN gate, and every officer server action re-checks. Parents
 * return only at INCR-55 (the school-wide-parent-readable matrix), never here.
 *
 * Scope fence (R430): officer matrix ONLY — no meetings/minutes/dues/parent-read. SMS-on-assign is
 * deferred; the Emergency tier has no standing officers; PDF export is omitted (not a dead control).
 */
export default async function PtaOfficersPage() {
  const { school, user } = await requireSchool();
  if (school.schoolType === "BASIC") redirect("/dashboard");
  if (!hasAnyRole(user.roles, PTA_CONFIG_WRITE_ROLES)) redirect("/dashboard");

  const matrix = await getPtaOfficerMatrix(school.id);
  const assignablePtas = assignablePtasFromMatrix(matrix);

  return <OfficerMatrix matrix={matrix} assignablePtas={assignablePtas} />;
}
