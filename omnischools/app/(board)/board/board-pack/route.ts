import { requireBoard } from "@/lib/auth/server";
import { getSchoolRollup } from "@/lib/rollup/school-rollup";
import { renderBoardPackPdf } from "@/lib/pdf/render-board-pack";
import type { BoardPackData } from "@/lib/pdf/board-pack-document";

// @react-pdf/renderer is Node-only (fontkit); never run this on the edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /board/board-pack — the board/director downloadable governance-overview PDF (GOV-5).
 *
 * Gated by `requireBoard()` (BOARD_MEMBER only; a non-board session is redirected before it reaches
 * this handler). The school id is SESSION-derived (never a URL school id — R339); `?periodId` only
 * picks the term. It lives UNDER the `/board` prefix on purpose: `requireBoard()`'s x-pathname
 * confinement admits only `/board*` paths, so an `/api/...` location would 307-redirect a legitimate
 * board member. Reads the rollup arms VERBATIM and streams the pack inline (clone of the receipt route).
 */
export async function GET(req: Request) {
  const { school } = await requireBoard();
  const periodId = new URL(req.url).searchParams.get("periodId") ?? undefined;

  const rollup = await getSchoolRollup(school.id, { periodId });

  const termLabel = rollup.period
    ? `${rollup.period.label} · ${rollup.period.academicYear}`
    : "No academic period configured";

  const data: BoardPackData = {
    rollup,
    meta: {
      schoolName: school.name,
      schoolInitials: initialsOf(school.name),
      termLabel,
      generatedAtLabel: fmtDateTime(rollup.generatedAt),
    },
  };

  const pdf = await renderBoardPackPdf(data);
  const term = termLabel.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Board-pack-${term}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}

// 2-letter school-crest initials (matches the shipped PDF loaders' one-liner: "Aggrey Memorial" → "AM").
const initialsOf = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "S";

// Documents take pre-formatted dates (house style) — format in the route, in the school tz/locale.
const fmtDateTime = (d: Date) =>
  d
    .toLocaleString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
    .replace(",", " ·");
