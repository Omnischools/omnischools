import { requireBoard } from "@/lib/auth/server";
import { buildBoardPackResponse } from "@/lib/pdf/board-pack-response";

// @react-pdf/renderer is Node-only (fontkit); never run this on the edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /board/board-pack — the board's downloadable governance-overview PDF (GOV-5).
 *
 * Gated by `requireBoard()` (BOARD_MEMBER only; a non-board session is redirected before it reaches this
 * handler). It lives UNDER the `/board` prefix on purpose: `requireBoard()`'s x-pathname confinement admits
 * only `/board*` paths, so an `/api/...` location would 307-redirect a legitimate board member. School id is
 * SESSION-derived (never a URL id — R339); `?periodId` only picks the term. The document + data assembly is
 * the SHARED `buildBoardPackResponse` (#309) — this route and `/api/insights/board-pack` differ ONLY in the
 * gate, and both now carry the full aggregate drill-downs the two synced surfaces show.
 */
export async function GET(req: Request) {
  const { school } = await requireBoard();
  const periodId = new URL(req.url).searchParams.get("periodId") ?? undefined;
  return buildBoardPackResponse(school, periodId);
}
