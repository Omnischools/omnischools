"use client";

/** Client-side CSV download from a header row + rows. No server round-trip. */
export function ExportCsv({
  filename,
  headers,
  rows,
  label = "Export CSV",
}: {
  filename: string;
  headers: string[];
  rows: (string | number)[][];
  label?: string;
}) {
  function download() {
    const esc = (v: string | number) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [headers, ...rows].map((r) => r.map(esc).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      onClick={download}
      disabled={rows.length === 0}
      className="rounded-md border border-border-2 px-3 py-1.5 text-xs font-semibold text-navy-2 transition-colors hover:bg-bg disabled:opacity-50"
    >
      {label}
    </button>
  );
}
