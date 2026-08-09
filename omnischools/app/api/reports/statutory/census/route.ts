import { and, desc, eq } from "drizzle-orm";
import { requireSchoolRole } from "@/lib/auth/server";
import { CENSUS_WRITE_ROLES } from "@/lib/access";
import { withSchool } from "@/lib/db/rls";
import { censusReturn } from "@/db/schema";
import { parseCensusSnapshot } from "@/lib/reports/census/schema";
import { parseCensusHandFill } from "@/lib/reports/census/hand-fill-schema";
import { renderCensusPdf } from "@/lib/pdf/render-census";
import type { CensusPdfData } from "@/lib/pdf/census-document";

// @react-pdf/renderer is Node-only (fontkit); never run this on the edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/reports/statutory/census?year=YYYY/YY — the ANNUAL GES census print-and-sign PDF (GOV-9).
 *
 * Management-gated (CENSUS_WRITE_ROLES = ADMIN / HEADMASTER; R430); the school id is SESSION-derived, never a
 * URL/body id. It renders from the FROZEN `census_return` row (`auto_snapshot` + `hand_fill`, both via their
 * versioned schemas) — NEVER a live re-composition (R427/GOV9-09) — so a filed census is byte-reproducible.
 * Downloadable in DRAFT (so the admin can print the hatched form to hand-complete) AND COMPLETED (R429). If no
 * ANNUAL row exists yet, it 404s → the admin must Generate first (GOV9-16). `/api` location dodges
 * `no-html-link-for-pages` (Dex MAJOR-1). Print-and-sign only — no electronic submission (R432).
 */
export async function GET(req: Request) {
  const { user, school } = await requireSchoolRole(CENSUS_WRITE_ROLES);
  const yearParam = new URL(req.url).searchParams.get("year") ?? undefined;

  const row = await withSchool(school.id, async (tx) => {
    const rows = await tx
      .select({
        academicYear: censusReturn.academicYear,
        status: censusReturn.status,
        autoSnapshot: censusReturn.autoSnapshot,
        handFill: censusReturn.handFill,
        generatedAt: censusReturn.generatedAt,
      })
      .from(censusReturn)
      .where(
        yearParam
          ? and(
              eq(censusReturn.schoolId, school.id),
              eq(censusReturn.cadence, "ANNUAL"),
              eq(censusReturn.academicYear, yearParam),
            )
          : and(eq(censusReturn.schoolId, school.id), eq(censusReturn.cadence, "ANNUAL")),
      )
      .orderBy(desc(censusReturn.generatedAt))
      .limit(1);
    return rows[0] ?? null;
  });

  if (!row) {
    return new Response("No annual census has been generated yet. Generate it first, then download.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  const snapshot = parseCensusSnapshot(row.autoSnapshot);
  const handFill = parseCensusHandFill(row.handFill);

  const data: CensusPdfData = {
    snapshot,
    handFill,
    meta: {
      schoolInitials: initialsOf(school.name),
      status: row.status,
      generatedAtLabel: fmtDateTime(row.generatedAt),
      // OC-CENSUS-HEADTEACHER-NAME: signer's name as the printed label (a fallback the OC permits); the
      // headteacher still signs by hand. Never fabricated — null prints a blank line.
      headteacherName: user.name ?? null,
    },
  };

  const pdf = await renderCensusPdf(data);
  const yr = snapshot.academicYear.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Annual-census-${yr}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}

const initialsOf = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "S";

const fmtDateTime = (d: Date) =>
  d
    .toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    .replace(",", " ·");
