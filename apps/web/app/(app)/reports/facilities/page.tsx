import { requireSchoolRole } from "@/lib/auth/server";
import { FACILITIES_WRITE_ROLES } from "@/lib/access";
import { listAcademicTerms, resolveSelectedTerm } from "@/lib/reports/academic-term";
import { listFacilitiesSnapshots } from "@/lib/reports/facilities-data";
import { ReportHeader } from "@/components/reports/report-header";
import { EmptyState } from "@/components/ui/empty-state";
import { FacilitiesForm } from "@/components/reports/facilities-form";

/**
 * GOV-7 · termly facilities-snapshot capture — management only (`FACILITIES_WRITE_ROLES`: ADMIN /
 * HEADMASTER; facilities is estates, not academics, so no VICE_HEADMASTER_ACADEMIC). Tier-agnostic — every
 * school captures facilities. Native-form manual entry (no CSV import) feeds the board overview + census;
 * the list shows what's captured, newest term first. Aggregate estates data only — no student/staff detail.
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Facilities snapshot" };

export default async function FacilitiesPage() {
  const { school } = await requireSchoolRole(FACILITIES_WRITE_ROLES);
  const terms = await listAcademicTerms(school.id);
  const defaultTerm = resolveSelectedTerm(terms);
  const snapshots = await listFacilitiesSnapshots(school.id);

  return (
    <div className="mx-auto max-w-page space-y-6">
      <ReportHeader
        crumb="Operational / Facilities"
        pre="Facilities"
        gold="snapshot"
        lede="A once-a-term census of the school's physical infrastructure — classrooms, water, sanitation, power, ICT, library and feeding. Aggregate estates data only. These figures feed the board overview and the GES census."
      />

      <FacilitiesForm terms={terms} defaultPeriodId={defaultTerm?.periodId ?? null} />

      <section className="rounded-xl border border-border bg-surface">
        <div className="border-b border-border px-5 py-3.5">
          <h2 className="font-display text-lg font-semibold text-navy">Captured snapshots</h2>
        </div>
        {snapshots.length === 0 ? (
          <EmptyState tone="muted" className="m-6">
            No snapshots captured yet. Fill in the form above for the current term.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-bg text-left text-xs uppercase tracking-wide text-navy-3">
                <tr>
                  <th className="px-5 py-2.5 font-semibold">Term</th>
                  <th className="px-5 py-2.5 font-semibold">Classrooms</th>
                  <th className="px-5 py-2.5 font-semibold">% sound</th>
                  <th className="px-5 py-2.5 font-semibold">Water · Power</th>
                  <th className="px-5 py-2.5 font-semibold">Latrines</th>
                  <th className="px-5 py-2.5 font-semibold">Captured</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {snapshots.map((snap) => (
                  <tr key={snap.periodId}>
                    <td className="px-5 py-3 font-semibold text-navy">
                      {snap.capturedFor.periodLabel} · {snap.capturedFor.academicYear}
                    </td>
                    <td className="px-5 py-3 font-mono text-navy-2">
                      {snap.classrooms.good}/{snap.classrooms.total} good
                    </td>
                    <td className="px-5 py-3 font-semibold text-navy">
                      {snap.classrooms.pctGood == null ? "—" : `${snap.classrooms.pctGood}%`}
                    </td>
                    <td className="px-5 py-3 text-xs text-navy-3">
                      {snap.utilities.waterSource} · {snap.utilities.electricitySource}
                    </td>
                    <td className="px-5 py-3 font-mono text-navy-2">
                      {snap.utilities.latrinesTotal.toLocaleString("en-GH")}
                    </td>
                    <td className="px-5 py-3 text-xs text-navy-3">
                      {snap.capturedAt.toLocaleDateString("en-GH")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
