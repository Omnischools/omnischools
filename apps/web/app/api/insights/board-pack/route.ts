import { requireSchoolRole } from "@/lib/auth/server";
import { INSIGHTS_READ_ROLES } from "@/lib/access";
import { buildBoardPackResponse } from "@/lib/pdf/board-pack-response";

// @react-pdf/renderer is Node-only (fontkit); never run this on the edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/insights/board-pack — the DIRECTORS' downloadable governance-overview PDF (INS §17-F).
 *
 * The SAME aggregate board pack the board gets (GOV-5), re-gated for the director tier: `INSIGHTS_READ_ROLES`
 * (ADMIN/HEADMASTER/PROPRIETOR), the same gate as the `/insights` page. It lives under `app/api/*` — the
 * repo's authenticated-download convention (receipts / report-cards / sen census-export) — NOT under the
 * page tree (which `no-html-link-for-pages` would flag); and unlike `requireBoard()`, `requireSchoolRole`
 * carries no `/board*` x-pathname confinement, so `/api` is the correct home. School id is SESSION-derived
 * (never a URL id — R339); `?periodId` only picks the term. The document + data assembly is now the SHARED
 * `buildBoardPackResponse` (#309) — this route and `/board/board-pack` differ ONLY in the gate.
 */
export async function GET(req: Request) {
  const { school } = await requireSchoolRole(INSIGHTS_READ_ROLES);
  const periodId = new URL(req.url).searchParams.get("periodId") ?? undefined;
  return buildBoardPackResponse(school, periodId);
}
