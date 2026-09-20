import { and, eq } from "drizzle-orm";
import { requireSchoolRole } from "@/lib/auth/server";
import { CENSUS_WRITE_ROLES } from "@/lib/access";
import { withSchool } from "@/lib/db/rls";
import { censusReturn } from "@/db/schema";
import { generateCensusSnapshot } from "@/lib/reports/census/generate";
import { computeCensusView } from "@/lib/reports/census/view";
import { parseCensusHandFill } from "@/lib/reports/census/hand-fill-schema";
import { ReportHeader } from "@/components/reports/report-header";
import { CensusDrawer } from "@/components/reports/census/census-drawer";
import { CensusCompletionPanel } from "@/components/reports/census/census-completion-panel";

/**
 * GOV-8 · GES census generation drawer — management only (`CENSUS_WRITE_ROLES`: ADMIN / HEADMASTER; the
 * headteacher signs and files). Dual-gated: this page runs `requireSchoolRole`, and `saveCensusReturn`
 * re-checks `assertAnyRole` before any DB work. The drawer PREVIEWS the live composition (server-rendered, so
 * first paint is populated); clicking Generate freezes it as a DRAFT `census_return`. `?cadence=MID_YEAR` is
 * the GOV-8 path; `?cadence=ANNUAL` previews the fuller return with the annual-only sections greyed. No PDF /
 * no electronic submission (GOV-9). School id is the session's — never a URL/body value (GOV8-14).
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Generate GES census" };

function normCadence(raw?: string): "MID_YEAR" | "ANNUAL" {
  return (raw ?? "").toUpperCase().replaceAll("-", "_") === "ANNUAL" ? "ANNUAL" : "MID_YEAR";
}

function buildFilename(code: string, cadence: "MID_YEAR" | "ANNUAL", year: string): string {
  const c = (code || "SCHOOL").replace(/\s+/g, "").toUpperCase().slice(0, 12);
  const kind = cadence === "MID_YEAR" ? "MidYearCensus" : "AnnualCensus";
  return `${c}_GES_${kind}_${year.replace("/", "-")}.pdf`;
}

export default async function GenerateCensusPage({
  searchParams,
}: {
  searchParams: Promise<{ cadence?: string }>;
}) {
  const { school } = await requireSchoolRole(CENSUS_WRITE_ROLES);
  const cadence = normCadence((await searchParams).cadence);

  const snapshot = await generateCensusSnapshot(school.id, { cadence, censusDate: new Date() });
  const view = computeCensusView(snapshot, cadence);
  const filename = buildFilename(school.shortName ?? school.gesCode, cadence, snapshot.academicYear);

  // GOV-9 / GOV-9b · the completion panel needs the persisted DRAFT/COMPLETED row (status + hand-fill) for
  // THIS cadence + year, and whether §5 auto-fills (adopted) or is hand-filled. Both cadences get a PDF; only
  // ANNUAL has a hand-fill.
  const rows = await withSchool(school.id, (tx) =>
    tx
      .select({ status: censusReturn.status, handFill: censusReturn.handFill })
      .from(censusReturn)
      .where(
        and(
          eq(censusReturn.schoolId, school.id),
          eq(censusReturn.cadence, cadence),
          eq(censusReturn.academicYear, snapshot.academicYear),
        ),
      )
      .limit(1),
  );
  const existingReturn = rows[0]
    ? { status: rows[0].status, handFill: parseCensusHandFill(rows[0].handFill) }
    : null;
  const senAdopted = snapshot.sections.specialNeeds.coverage === "FULL";

  return (
    <div className="mx-auto max-w-page space-y-6">
      <ReportHeader
        crumb="Statutory / GES census"
        pre="Generate"
        gold="census"
        lede="Compose the GES statutory return from your live Omnischools data. Every figure is auto-filled from what's captured — an un-captured section is left honestly blank for hand-fill, never a fabricated zero."
      />
      <CensusDrawer
        cadence={cadence}
        academicYear={snapshot.academicYear}
        periodLabel={snapshot.period?.label ?? null}
        identification={snapshot.identification}
        filename={filename}
        view={view}
        periodId={snapshot.period?.periodId ?? null}
      />
      <CensusCompletionPanel
        cadence={cadence}
        academicYear={snapshot.academicYear}
        existing={existingReturn}
        senAdopted={senAdopted}
      />
    </div>
  );
}
