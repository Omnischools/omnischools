"use client";
import { useMemo, useState } from "react";
import type { SenRecord } from "@/lib/sen/register-data";
import type { SenCategory } from "@/lib/reports/census/sen-data";
import {
  SEN_CATEGORY_ORDER,
  SEN_CATEGORY_LABEL,
  SEN_CATEGORY_PILL,
  SEN_SEVERITY_LABEL,
  SEN_SEVERITY_PILL,
  sexNoun,
} from "@/lib/sen/vocab";

/**
 * GOV-10 · the SEN register table (GRANTED records only — a PENDING row has no detail and never appears
 * here, R410). Filter pills narrow by category, client-side. The confidential detail is already gated at the
 * page (SEN_REGISTER_ROLES); this only presents what the server chose to send.
 */

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

const pillBase =
  "inline-flex items-center rounded-pill px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide";

export function SenRegisterTable({ records }: { records: SenRecord[] }) {
  const [filter, setFilter] = useState<SenCategory | "ALL">("ALL");

  const counts = useMemo(() => {
    const c = new Map<SenCategory, number>();
    for (const r of records) c.set(r.category, (c.get(r.category) ?? 0) + 1);
    return c;
  }, [records]);

  const shown = filter === "ALL" ? records : records.filter((r) => r.category === filter);

  return (
    <div className="space-y-3.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <FilterPill active={filter === "ALL"} onClick={() => setFilter("ALL")} label="All" count={records.length} />
        {SEN_CATEGORY_ORDER.filter((c) => (counts.get(c) ?? 0) > 0).map((c) => (
          <FilterPill
            key={c}
            active={filter === c}
            onClick={() => setFilter(c)}
            label={SEN_CATEGORY_LABEL[c]}
            count={counts.get(c) ?? 0}
          />
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-bg text-left text-[11px] uppercase tracking-wide text-navy-3">
              <th className="px-4 py-2.5 font-bold">Student</th>
              <th className="px-4 py-2.5 font-bold">Category</th>
              <th className="px-4 py-2.5 font-bold">Severity</th>
              <th className="px-4 py-2.5 font-bold">Support &amp; accommodations</th>
              <th className="px-4 py-2.5 font-bold">Diagnosis &amp; consent</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {shown.map((r) => (
              <tr key={r.id} className="align-top">
                <td className="px-4 py-3.5">
                  <div className="grid grid-cols-[36px_1fr] items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gold-bg font-display text-[11px] font-semibold text-navy">
                      {initials(r.studentName)}
                    </div>
                    <div>
                      <div className="text-[13px] font-semibold text-navy">{r.studentName}</div>
                      <div className="text-[10px] italic text-navy-3">
                        {r.className ?? "Unassigned"} · {sexNoun(r.sex)}
                        {r.age != null ? ` · age ${r.age}` : ""}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3.5">
                  <span className={`${pillBase} ${SEN_CATEGORY_PILL[r.category]}`}>
                    {SEN_CATEGORY_LABEL[r.category]}
                  </span>
                </td>
                <td className="px-4 py-3.5">
                  {r.severity ? (
                    <span className={`${pillBase} ${SEN_SEVERITY_PILL[r.severity]}`}>
                      {SEN_SEVERITY_LABEL[r.severity]}
                    </span>
                  ) : (
                    <span className="text-navy-3">—</span>
                  )}
                </td>
                <td className="max-w-[280px] px-4 py-3.5 text-[11px] leading-relaxed text-navy-2">
                  {r.supportNotes || <span className="text-navy-3">—</span>}
                  {r.accommodations.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {r.accommodations.map((a, i) => (
                        <span
                          key={i}
                          className="rounded border border-border bg-bg px-1.5 py-0.5 text-[9px] font-semibold text-navy-3"
                        >
                          {a}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3.5 text-[11px] text-navy-2">
                  {r.diagnosisSource === "CLINICAL_DIAGNOSIS" ? (
                    <span>
                      <b className="text-navy">Diagnosed</b>
                      {r.diagnosingClinician ? ` by ${r.diagnosingClinician}` : ""}
                    </span>
                  ) : (
                    <span className="font-semibold text-warn">
                      {r.diagnosisSource === "SCHOOL_OBSERVED" ? "School-observed" : "Diagnosis pending"}
                    </span>
                  )}
                  <div className="mt-0.5 text-[10px] italic text-navy-3">
                    {[r.diagnosingInstitution, r.diagnosisYear].filter(Boolean).join(" · ")}
                    {r.diagnosingInstitution || r.diagnosisYear ? " · " : ""}
                    <b className="not-italic text-navy-2">
                      consent on file{r.consentOnFileAt ? ` (${r.consentOnFileAt})` : ""}
                    </b>
                  </div>
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-navy-3">
                  No records in this category.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-pill border px-3 py-1.5 text-[11px] font-semibold transition-colors ${
        active
          ? "border-navy bg-navy text-bg"
          : "border-border bg-surface text-navy-2 hover:bg-gold-bg"
      }`}
    >
      {label}
      <span className="font-mono text-[10px] opacity-70">{count}</span>
    </button>
  );
}
