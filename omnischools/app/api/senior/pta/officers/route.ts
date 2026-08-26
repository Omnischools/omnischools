import { requireSchoolRole } from "@/lib/auth/server";
import { PTA_CONFIG_WRITE_ROLES } from "@/lib/access";
import { getPtaOfficerMatrix } from "@/lib/pta/officers-data";
import { renderPtaOfficerRosterPdf } from "@/lib/pdf/render-pta-officer-roster";
import type { PtaOfficerRosterData } from "@/lib/pdf/pta-officer-roster-document";

// @react-pdf/renderer is Node-only (fontkit); never run this on the edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/senior/pta/officers — the authenticated PTA officer-roster PDF download (#297 · Capability A).
 * The reserved "PDF omitted (not a dead control)" slot on /senior/pta/officers now resolves here.
 *
 * GATE (R427, SAME as the officers PAGE — read == manage): `requireSchoolRole(PTA_CONFIG_WRITE_ROLES)`
 * (ADMIN / HEADMASTER). A non-admin — INCLUDING a non-admin Secretary — is redirected by the gate, never
 * served the PDF. NOT the meeting-register gate; officer-matrix access is admin-only. The school id is
 * SESSION-derived (never a query param), so a tenant can only ever export its OWN roster.
 *
 * 🔴 PII FENCE (owner-ratified: roster only, NO contact). The ONLY data source is `getPtaOfficerMatrix`,
 * whose `OfficersMatrix` shape carries no officer phone / email / address / studentGuardians field — so
 * neither this route nor the document can select or render contact PII (structural: the field is absent
 * from the type). pta-officer-roster.test.ts grep-guards the source of both.
 */
export async function GET() {
  const { school } = await requireSchoolRole(PTA_CONFIG_WRITE_ROLES);

  const matrix = await getPtaOfficerMatrix(school.id);

  const nameForInitials = school.shortName ?? school.name;
  const data: PtaOfficerRosterData = {
    matrix,
    meta: {
      schoolName: school.name,
      schoolInitials: initials(nameForInitials),
      generatedAtLabel: new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "UTC",
      }).format(new Date()),
    },
  };

  const pdf = await renderPtaOfficerRosterPdf(data);
  const filename = `PTA-Officer-Roster-${nameForInitials}.pdf`.replace(/[^A-Za-z0-9._-]+/g, "-");
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

/** First letters of the first two words (e.g. "Asankrangwa SHS" → "AS"). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "PTA";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}
