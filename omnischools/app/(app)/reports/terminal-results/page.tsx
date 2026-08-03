import { requireSchoolRole } from "@/lib/auth/server";
import { TERMINAL_RESULTS_WRITE_ROLES } from "@/lib/access";
import { listTerminalResults } from "@/lib/reports/terminal-results-data";
import { examTypesFor } from "@/lib/import/terminal-results-import";
import { ReportHeader } from "@/components/reports/report-header";
import { EmptyState } from "@/components/ui/empty-state";
import { TerminalResultsForm } from "@/components/reports/terminal-results-form";
import { TerminalResultsImport } from "@/components/reports/terminal-results-import";

/**
 * GOV-6 · terminal-exam results (BECE / WASSCE) capture — management only (`TERMINAL_RESULTS_WRITE_ROLES`:
 * ADMIN / HEADMASTER / VICE_HEADMASTER_ACADEMIC). Cross-tier: exam_type is limited to what the school's
 * tier sits (R367). Manual entry + CSV import feed the board overview + census; the list shows what's
 * captured. AGGREGATE-ONLY — no candidate names/scores anywhere on this surface.
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Terminal results" };

export default async function TerminalResultsPage() {
  const { school } = await requireSchoolRole(TERMINAL_RESULTS_WRITE_ROLES);
  const offeredExamTypes = examTypesFor(school.schoolType);
  const sittings = await listTerminalResults(school.id);

  return (
    <div className="mx-auto max-w-page space-y-6">
      <ReportHeader
        crumb="Academic / Terminal results"
        pre="Terminal"
        gold="results"
        lede="School-level BECE and WASSCE outcomes, split by sex. Aggregate counts only — no candidate detail. These figures feed the board overview and the GES census."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <TerminalResultsForm offeredExamTypes={offeredExamTypes} />
        <TerminalResultsImport schoolType={school.schoolType} schoolName={school.name} />
      </div>

      <section className="rounded-xl border border-border bg-surface">
        <div className="border-b border-border px-5 py-3.5">
          <h2 className="font-display text-lg font-semibold text-navy">Captured sittings</h2>
        </div>
        {sittings.length === 0 ? (
          <EmptyState tone="muted" className="m-6">
            No sittings captured yet. Add one above, or import a CSV.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-bg text-left text-xs uppercase tracking-wide text-navy-3">
                <tr>
                  <th className="px-5 py-2.5 font-semibold">Exam</th>
                  <th className="px-5 py-2.5 font-semibold">Year</th>
                  <th className="px-5 py-2.5 font-semibold">Candidates</th>
                  <th className="px-5 py-2.5 font-semibold">Passed</th>
                  <th className="px-5 py-2.5 font-semibold">Pass rate</th>
                  <th className="px-5 py-2.5 font-semibold">F / M split</th>
                  <th className="px-5 py-2.5 font-semibold">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sittings.map((s) => (
                  <tr key={`${s.examType}-${s.year}`}>
                    <td className="px-5 py-3 font-semibold text-navy">{s.examType}</td>
                    <td className="px-5 py-3 font-mono text-navy-2">{s.year}</td>
                    <td className="px-5 py-3 font-mono text-navy-2">
                      {s.totalCandidates.toLocaleString("en-GH")}
                    </td>
                    <td className="px-5 py-3 font-mono text-navy-2">
                      {s.passedCount.toLocaleString("en-GH")}
                    </td>
                    <td className="px-5 py-3 font-semibold text-navy">{s.passRate}%</td>
                    <td className="px-5 py-3 font-mono text-xs text-navy-3">
                      {s.female.passed}/{s.female.candidates} F · {s.male.passed}/{s.male.candidates} M
                    </td>
                    <td className="px-5 py-3 text-xs text-navy-3">{s.note ?? "—"}</td>
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
