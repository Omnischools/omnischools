import "server-only";
import { getDirectorsInsights, buildAttention } from "@/lib/insights/insights-data";
import { renderBoardPackPdf } from "@/lib/pdf/render-board-pack";
import type { BoardPackData } from "@/lib/pdf/board-pack-document";

/**
 * The SHARED board-pack builder (#309). ONE document + data assembly behind BOTH routes — the board's
 * `/board/board-pack` (requireBoard) and the directors' `/api/insights/board-pack`
 * (INSIGHTS_READ_ROLES) — which now differ ONLY in their gate, killing the maintenance clone. The pack
 * carries the full aggregate set the two synced surfaces show: the rollup arms + year-group performance
 * + attendance-by-level + census age/gender/approved-age + the "needs attention" rows — all
 * aggregate-only, no per-student row. The caller resolves `school` from the SESSION (never a URL id);
 * `periodId` only picks the term.
 */
export async function buildBoardPackResponse(
  school: { id: string; name: string },
  periodId: string | undefined,
): Promise<Response> {
  const insights = await getDirectorsInsights(school.id, { periodId });
  const { rollup, levelPerf, attendanceByLevel, census } = insights;

  const termLabel = rollup.period
    ? `${rollup.period.label} · ${rollup.period.academicYear}`
    : "No academic period configured";

  const data: BoardPackData = {
    rollup,
    attention: buildAttention(insights, termLabel),
    levelPerf,
    attendanceByLevel,
    census,
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

// Documents take pre-formatted dates (house style) — format here, in the school tz/locale.
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
