"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { parseCsv, csvTemplate } from "@/lib/import/csv";
import {
  validateStaffRows,
  STAFF_IMPORT_HEADERS,
  STAFF_IMPORT_SAMPLE,
  type StaffImportRow,
  type ImportSummary,
} from "@/lib/import/staff-import";
import { importStaff } from "@/lib/actions/staff";

type Filter = "all" | "ready" | "warning" | "error";

export function StaffImport() {
  const router = useRouter();
  const [rows, setRows] = useState<StaffImportRow[]>([]);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [invite, setInvite] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function downloadTemplate() {
    const csv = csvTemplate(STAFF_IMPORT_HEADERS, STAFF_IMPORT_SAMPLE);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "omnischools-staff-template.csv";
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
    const data = parseCsv(text).slice(1); // drop header row
    const { rows, summary } = validateStaffRows(data);
    setRows(rows);
    setSummary(summary);
    setFilter("all");
  }

  async function runImport() {
    const importable = rows.filter((r) => r.errors.length === 0);
    if (importable.length === 0) return;
    setBusy(true);
    setError(null);
    const res = await importStaff({
      rows: importable.map((r) => ({
        fullName: r.fullName,
        phone: r.phone,
        email: r.email,
        role: r.role,
      })),
      sendInvites: invite,
    });
    setBusy(false);
    if (res.ok) {
      const inv = invite && res.invited ? ` · ${res.invited} invited` : "";
      setDone(`Added ${res.created} staff member${res.created === 1 ? "" : "s"}${inv}.`);
      setRows([]);
      setSummary(null);
      setFileName(null);
      router.refresh();
    } else setError(res.error ?? "Could not import staff.");
  }

  const shown = rows.filter((r) =>
    filter === "all"
      ? true
      : filter === "error"
        ? r.errors.length > 0
        : filter === "warning"
          ? r.errors.length === 0 && r.warnings.length > 0
          : r.errors.length === 0 && r.warnings.length === 0,
  );
  const importable = rows.filter((r) => r.errors.length === 0).length;

  const pill = (f: Filter, label: string, tone: string) => (
    <button
      onClick={() => setFilter(f)}
      className={`rounded-pill px-3 py-1 text-xs font-semibold ${
        filter === f ? tone : "bg-bg text-navy-3"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-5">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg font-semibold text-navy">
            Bulk import from CSV
          </h2>
          <p className="text-sm text-navy-3">
            Download the template, fill it in, and upload. We validate every row before
            anything is saved. Staff sign in with their phone number.
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
        <p className="rounded-md bg-green-bg px-4 py-3 text-sm font-medium text-green">
          {done}
        </p>
      )}
      {error && <p className="text-sm text-terra">{error}</p>}

      {summary && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Total rows", summary.total, "text-navy"],
              ["Ready", summary.ready, "text-green"],
              ["Warnings", summary.warning, "text-warn"],
              ["Errors", summary.error, "text-terra"],
            ].map(([label, n, tone]) => (
              <div
                key={label as string}
                className="rounded-xl border border-border bg-surface p-4"
              >
                <div className="text-xs font-semibold uppercase tracking-wide text-navy-3">
                  {label}
                </div>
                <div className={`mt-1 font-display text-2xl font-semibold ${tone}`}>{n}</div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1.5">
              {pill("all", `All ${summary.total}`, "bg-navy text-bg")}
              {pill("ready", `Ready ${summary.ready}`, "bg-green text-bg")}
              {pill("warning", `Warnings ${summary.warning}`, "bg-warn text-bg")}
              {pill("error", `Errors ${summary.error}`, "bg-terra text-bg")}
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-navy-2">
                <input
                  type="checkbox"
                  checked={invite}
                  onChange={(e) => setInvite(e.target.checked)}
                  className="h-4 w-4 accent-gold"
                />
                Send password-setup invites
              </label>
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
          </div>

          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-bg text-left text-xs uppercase tracking-wide text-navy-3">
                <tr>
                  <th className="px-3 py-2.5 font-semibold">#</th>
                  <th className="px-3 py-2.5 font-semibold">Name</th>
                  <th className="px-3 py-2.5 font-semibold">Phone</th>
                  <th className="px-3 py-2.5 font-semibold">Email</th>
                  <th className="px-3 py-2.5 font-semibold">Role</th>
                  <th className="px-3 py-2.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shown.map((r) => (
                  <tr key={r.index} className="align-top">
                    <td className="px-3 py-2.5 font-mono text-xs text-navy-3">{r.index}</td>
                    <td className="px-3 py-2.5 font-medium text-navy">{r.fullName || "—"}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-navy-2">
                      {r.phone || "—"}
                    </td>
                    <td className="px-3 py-2.5 text-navy-2">{r.email || "—"}</td>
                    <td className="px-3 py-2.5 text-navy-2">{r.roleLabel}</td>
                    <td className="px-3 py-2.5">
                      {r.errors.length > 0 ? (
                        <span className="text-xs text-terra">{r.errors.join("; ")}</span>
                      ) : r.warnings.length > 0 ? (
                        <span className="text-xs text-warn">{r.warnings.join("; ")}</span>
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
