"use client";
import { useState } from "react";
import Link from "next/link";

type Flag = { type: string; severity: string; label: string; detail: string };
export type FlaggedRow = {
  id: string;
  name: string;
  code: string;
  className: string | null;
  termPct: number | null;
  attended: number;
  total: number;
  flags: Flag[];
  worst: string | null;
  last14: { date: string; status: string }[];
};

const TABS: { key: string; label: string }[] = [
  { key: "all", label: "All flagged" },
  { key: "BELOW_THRESHOLD", label: "Below 70%" },
  { key: "LONG_ABSENCE", label: "Long absence" },
  { key: "PATTERN_SHIFT", label: "Pattern shift" },
];

const CELL: Record<string, string> = {
  PRESENT: "bg-green",
  LATE: "bg-warn",
  EXCUSED: "bg-navy-2",
  MEDICAL: "bg-gold",
  ABSENT: "bg-terra",
};

const pctTone = (p: number | null) =>
  p === null ? "text-navy-3" : p < 60 ? "text-terra" : p < 70 ? "text-warn" : "text-navy-2";

export function NeedsAttention({ students }: { students: FlaggedRow[] }) {
  const [tab, setTab] = useState("all");
  const count = (key: string) =>
    key === "all"
      ? students.length
      : students.filter((s) => s.flags.some((f) => f.type === key)).length;
  const rows =
    tab === "all"
      ? students
      : students.filter((s) => s.flags.some((f) => f.type === tab));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
        <div className="flex flex-wrap gap-1.5">
          {TABS.map((t) => {
            const n = count(t.key);
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`rounded-pill px-2.5 py-1 text-xs font-semibold transition-colors ${
                  active
                    ? "bg-navy text-bg"
                    : "border border-border-2 bg-surface text-navy-2 hover:border-gold"
                }`}
              >
                {t.label} <span className={active ? "text-bg/70" : "text-navy-3"}>{n}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-bg text-left text-xs uppercase tracking-wide text-navy-3">
            <tr>
              <th className="px-4 py-3 font-semibold">Student</th>
              <th className="px-4 py-3 font-semibold">Flag</th>
              <th className="px-4 py-3 font-semibold">Term attendance</th>
              <th className="px-4 py-3 font-semibold">Last 14 days</th>
              <th className="px-4 py-3 font-semibold"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((s) => (
              <tr key={s.id} className="hover:bg-bg">
                <td className="px-4 py-3">
                  <div className="font-medium text-navy">{s.name}</div>
                  <div className="font-mono text-xs text-navy-3">
                    {s.code}
                    {s.className ? ` · ${s.className}` : ""}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-1">
                    {s.flags.map((f) => (
                      <span key={f.type} className="flex items-center gap-1.5">
                        <span
                          className={`rounded-pill px-2 py-0.5 text-xs font-medium ${
                            f.severity === "CRITICAL"
                              ? "bg-terra-bg text-terra"
                              : "bg-warn-bg text-warn"
                          }`}
                        >
                          {f.label}
                        </span>
                        <span className="text-[11px] text-navy-3">{f.detail}</span>
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className={`text-sm font-semibold ${pctTone(s.termPct)}`}>
                    {s.termPct === null ? "—" : `${s.termPct}%`}
                  </span>
                  <span className="ml-1 text-[11px] text-navy-3">
                    {s.attended}/{s.total}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-0.5">
                    {s.last14.map((d, i) => (
                      <span
                        key={i}
                        title={`${d.date} · ${d.status.charAt(0) + d.status.slice(1).toLowerCase()}`}
                        className={`h-4 w-1.5 rounded-sm ${CELL[d.status] ?? "bg-border-2"}`}
                      />
                    ))}
                    {s.last14.length === 0 && (
                      <span className="text-[11px] text-navy-3">—</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/attendance/student/${s.id}`}
                    className="text-xs font-semibold text-gold hover:underline"
                  >
                    Follow up →
                  </Link>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-sm text-navy-3">
                  No students under this flag.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
