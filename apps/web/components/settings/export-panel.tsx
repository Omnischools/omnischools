"use client";
import { useState } from "react";
import {
  exportStudentsCsv,
  exportStaffCsv,
  exportFeesCsv,
} from "@/lib/actions/export";

type Kind = "students" | "staff" | "fees";
const RUNNERS: Record<Kind, () => Promise<unknown>> = {
  students: exportStudentsCsv,
  staff: exportStaffCsv,
  fees: exportFeesCsv,
};

const CARDS: { kind: Kind; name: string; desc: string }[] = [
  { kind: "students", name: "Students", desc: "Codes, names, sex, DOB, class and status." },
  { kind: "staff", name: "Staff", desc: "Names, phone, email and roles." },
  { kind: "fees", name: "Fee structures", desc: "Fee plans and their line items by year." },
];

function download(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExportPanel() {
  const [busy, setBusy] = useState<Kind | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(kind: Kind) {
    setBusy(kind);
    setMsg(null);
    const res = (await RUNNERS[kind]()) as
      | { ok: true; filename: string; csv: string; rows: number }
      | { ok: false; error: string };
    setBusy(null);
    if (res.ok) {
      download(res.filename, res.csv);
      setMsg({ ok: true, text: `Exported ${res.rows} row${res.rows === 1 ? "" : "s"}.` });
    } else setMsg({ ok: false, text: res.error });
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        {CARDS.map((c) => (
          <div key={c.kind} className="rounded-xl border border-border bg-surface p-5">
            <div className="font-display text-base font-medium text-navy">{c.name}</div>
            <p className="mb-4 mt-1 text-[12px] leading-relaxed text-navy-3">{c.desc}</p>
            <button
              onClick={() => run(c.kind)}
              disabled={busy !== null}
              className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-50"
            >
              {busy === c.kind ? "Preparing…" : "↓ Download CSV"}
            </button>
          </div>
        ))}
      </div>
      {msg && (
        <p className={`text-sm ${msg.ok ? "text-green" : "text-terra"}`}>{msg.text}</p>
      )}
      <p className="text-xs text-navy-3">
        Files download to your device. Your records are yours to take anytime.
      </p>
    </div>
  );
}
