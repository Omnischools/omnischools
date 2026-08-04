import { requireSchoolRole } from "@/lib/auth/server";
import { CENSUS_WRITE_ROLES } from "@/lib/access";
import { generateCensusSnapshot } from "@/lib/reports/census/generate";
import { computeCensusView } from "@/lib/reports/census/view";
import { ReportHeader } from "@/components/reports/report-header";
import { CensusDrawer } from "@/components/reports/census/census-drawer";

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
    </div>
  );
}
