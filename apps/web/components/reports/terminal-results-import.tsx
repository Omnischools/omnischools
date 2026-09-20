"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { parseCsv, csvTemplate } from "@/lib/import/csv";
import {
  validateTerminalRows,
  TERMINAL_IMPORT_HEADERS,
  TERMINAL_IMPORT_SAMPLE,
  type TerminalImportRow,
  type ImportSummary,
} from "@/lib/import/terminal-results-import";
import { importTerminalResults } from "@/lib/actions/terminal-results";
import type { SchoolType } from "@/lib/reports/school-type-data";
import { schoolFile } from "@/lib/filename";

/**
 * GOV-6 · CSV bulk import of terminal-exam sittings. Every row is validated in the browser BEFORE upload
 * (REJECT-NOT-FABRICATE — an invalid row is flagged, never coerced; the valid rows in the same file still
 * import). Header carries NO candidate-identifying column. The server re-validates + re-tier-gates.
 */
export function TerminalResultsImport({
  schoolType,
  schoolName,
}: {
  schoolType: SchoolType;
  schoolName?: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<TerminalImportRow[]>([]);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function downloadTemplate() {
    const csv = csvTemplate(TERMINAL_IMPORT_HEADERS, TERMINAL_IMPORT_SAMPLE);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = schoolFile(schoolName, "terminal-results-template.csv");
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setDone(null);
    setError(null);
    const text = await file.text();
    const parsed = parseCsv(text);
    const data = parsed.slice(1); // drop header row
    const { rows, summary } = validateTerminalRows(data, schoolType);
    setRows(rows);
    setSummary(summary);
  }

  async function runImport() {
    const importable = rows.filter((r) => r.errors.length === 0);
    if (importable.length === 0) return;
    setBusy(true);
    setError(null);
    const res = await importTerminalResults({
      rows: importable.map((r) => ({
        examType: r.examType!,
        year: r.year!,
        femaleCandidates: r.femaleCandidates!,
        maleCandidates: r.maleCandidates!,
        femalePassed: r.femalePassed!,
        malePassed: r.malePassed!,
        note: r.note,
      })),
    });
    setBusy(false);
    if (res.ok) {
      setDone(
        `Imported ${res.imported} sitting${res.imported === 1 ? "" : "s"}` +
          (res.skipped > 0 ? ` · ${res.skipped} skipped (wrong tier)` : "") +
          ".",
      );
      setRows([]);
      setSummary(null);
      setFileName(null);
      router.refresh();
    } else setError(res.error);
  }

  const importable = rows.filter((r) => r.errors.length === 0).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-5">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg font-semibold text-navy">Bulk import from CSV</h2>
          <p className="text-sm text-navy-3">
            Download the template, fill in one row per exam and year, and upload. Every row is checked
            before anything is saved — bad rows are skipped, good rows still import.
          </p>
        </div>
        <button
          onClick={downloadTemplate}
          className="rounded-md border border-border-2 px-4 py-2 text-sm font-semibold text-navy-2 transition-colors hover:bg-bg"
        >
          ↓ Template
        </button>
        <label className="cursor-pointer rounded-md bg-navy px-4 py-2 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep">
          Upload CSV
          <input type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" />
        </label>
      </div>

      {done && (
        <p className="rounded-md bg-green-bg px-4 py-3 text-sm font-medium text-green">{done}</p>
      )}
      {error && <p className="text-sm text-terra">{error}</p>}

      {summary && (
        <>
          <div className="grid grid-cols-3 gap-3">
            {[
              ["Total rows", summary.total, "text-navy"],
              ["Ready", summary.ready, "text-green"],
              ["Errors", summary.error, "text-terra"],
            ].map(([label, n, tone]) => (
              <div key={label as string} className="rounded-xl border border-border bg-surface p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-navy-3">
                  {label}
                </div>
                <div className={`mt-1 font-display text-2xl font-semibold ${tone}`}>{n}</div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3">
            <button
              onClick={runImport}
              disabled={busy || importable === 0}
              className="rounded-md bg-navy px-5 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-50"
            >
              {busy
                ? "Importing…"
                : summary.error > 0
                  ? `Skip errors & import ${importable}`
                  : `Import ${importable}`}
            </button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-bg text-left text-xs uppercase tracking-wide text-navy-3">
                <tr>
                  <th className="px-3 py-2.5 font-semibold">#</th>
                  <th className="px-3 py-2.5 font-semibold">Exam</th>
                  <th className="px-3 py-2.5 font-semibold">Year</th>
                  <th className="px-3 py-2.5 font-semibold">Candidates (F/M)</th>
                  <th className="px-3 py-2.5 font-semibold">Passed (F/M)</th>
                  <th className="px-3 py-2.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.index} className="align-top">
                    <td className="px-3 py-2.5 font-mono text-xs text-navy-3">{r.index}</td>
                    <td className="px-3 py-2.5 font-medium text-navy">{r.examType ?? "—"}</td>
                    <td className="px-3 py-2.5 text-navy-2">{r.year ?? "—"}</td>
                    <td className="px-3 py-2.5 font-mono text-navy-2">
                      {r.femaleCandidates ?? "—"} / {r.maleCandidates ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-navy-2">
                      {r.femalePassed ?? "—"} / {r.malePassed ?? "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      {r.errors.length > 0 ? (
                        <span className="text-xs text-terra">{r.errors.join("; ")}</span>
                      ) : (
                        <span className="text-xs font-medium text-green">Ready</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {fileName && <p className="text-xs text-navy-3">{fileName}</p>}
        </>
      )}
    </div>
  );
}
