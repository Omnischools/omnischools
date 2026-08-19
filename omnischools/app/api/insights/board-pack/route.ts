import { requireSchoolRole } from "@/lib/auth/server";
import { INSIGHTS_READ_ROLES } from "@/lib/access";
import { getSchoolRollup } from "@/lib/rollup/school-rollup";
import { renderBoardPackPdf } from "@/lib/pdf/render-board-pack";
import type { BoardPackData } from "@/lib/pdf/board-pack-document";

// @react-pdf/renderer is Node-only (fontkit); never run this on the edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/insights/board-pack — the DIRECTORS' downloadable governance-overview PDF (INS §17-F follow-up).
 *
 * The SAME aggregate board pack the board sees (GOV-5), re-gated for the director tier: `INSIGHTS_READ_ROLES`
 * (ADMIN/HEADMASTER/PROPRIETOR), the same gate as the `/insights` page. It lives under `app/api/*` — the
 * repo's authenticated-download convention (receipts / report-cards / sen census-export) — NOT under the
 * page tree (which `no-html-link-for-pages` would flag); and unlike `requireBoard()`, `requireSchoolRole`
 * carries no `/board*` x-pathname confinement, so `/api` is the correct home (a director hitting `/board/*`
 * would be bounced). School id is SESSION-derived (never a URL id — R339); `?periodId` only picks the term.
 * Content is the PII-stripped rollup arms directors already see on `/insights` — no new exposure. Clone of
 * the `/board/board-pack` route (same data, same document), differing only in the gate + location.
 */
export async function GET(req: Request) {
  const { school } = await requireSchoolRole(INSIGHTS_READ_ROLES);
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
