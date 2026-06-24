"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { applyColumnTemplate } from "@/lib/actions/gradebook";
import { AddColumnForm } from "./add-column-form";

type Student = { id: string; name: string; code: string };

const PREVIEW_COLS = 5;

function initials(name: string): string {
  const parts = name.replace(",", "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function classLabel(name: string): string {
  const compact = name.replace(/[^A-Za-z0-9]/g, "");
  return (compact.slice(0, 2) || name.slice(0, 2)).toUpperCase();
}

export function GradebookEmptyColumns({
  className,
  subjectName,
  termLabel,
  students,
  classId,
  subjectId,
  periodId,
}: {
  className: string;
  subjectName: string;
  termLabel: string;
  students: Student[];
  classId: string;
  subjectId: string;
  periodId: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const preview = students.slice(0, 6);

  async function useTemplate() {
    setPending(true);
    setError(null);
    const res = await applyColumnTemplate({ classId, subjectId, periodId });
    setPending(false);
    if (res.ok) router.refresh();
    else setError(res.error);
  }

  return (
    <div>
      {/* Class-context strip */}
      <div className="bg-surface mb-5 flex items-center gap-3 rounded-xl border border-border p-4">
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[10px] bg-navy font-display text-sm font-semibold text-gold">
          {classLabel(className)}
        </div>
        <div className="flex-1">
          <div className="font-display text-base font-semibold text-navy">
            {className} · {subjectName}
          </div>
          <div className="mt-0.5 text-xs text-navy-3">
            {students.length} student{students.length === 1 ? "" : "s"} · taught by{" "}
            <span className="font-semibold text-navy">you</span> · {termLabel}
          </div>
        </div>
        <div className="flex gap-2">
          <span className="rounded-full border border-navy bg-navy px-2.5 py-1 text-[10px] font-semibold text-bg">
            Continuous Assessment
          </span>
          <span className="rounded-full border border-border bg-bg px-2.5 py-1 text-[10px] font-semibold text-navy-3">
            Term Exam
          </span>
        </div>
      </div>

      {/* Faded preview grid with a floating CTA over it */}
      <div className="relative bg-surface overflow-hidden rounded-xl border border-border">
        <div className="opacity-45 pointer-events-none">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="px-3.5 py-3 text-left text-[10px] font-bold uppercase tracking-wide text-navy-3">
                  Student
                </th>
                <th
                  colSpan={PREVIEW_COLS}
                  className="border-l border-dashed border-border-2 bg-gold-bg px-3.5 py-3 text-center text-[10px] font-bold uppercase tracking-wide text-gold"
                >
                  + Add your first column
                </th>
                <th className="px-3.5 py-3 text-center text-[10px] font-bold uppercase tracking-wide text-navy-3">
                  Total
                </th>
                <th className="px-3.5 py-3 text-center text-[10px] font-bold uppercase tracking-wide text-navy-3">
                  Grade
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {preview.map((s) => (
                <tr key={s.id}>
                  <td className="px-3.5 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gold-bg font-display text-[11px] font-semibold text-navy">
                        {initials(s.name)}
                      </div>
                      <div>
                        <div className="font-semibold text-navy">{s.name}</div>
                        <div className="font-mono text-[10px] text-navy-3">{s.code}</div>
                      </div>
                    </div>
                  </td>
                  {Array.from({ length: PREVIEW_COLS + 2 }).map((_, i) => (
                    <td
                      key={i}
                      className="px-3.5 py-2.5 text-center font-display text-sm text-border-2"
                    >
                      —
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Floating CTA card, centered over the faded grid */}
        <div className="absolute left-1/2 top-1/2 z-10 w-[360px] max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-gold bg-surface px-7 pb-5 pt-6 text-center shadow-[0_30px_70px_-20px_rgba(26,43,71,0.22)]">
          <div className="mx-auto mb-3.5 flex h-11 w-11 items-center justify-center rounded-full bg-gold-bg font-display text-lg font-bold text-gold">
            +
          </div>
          <h4 className="font-display text-base font-semibold text-navy">
            Add your <em className="not-italic text-gold">first column</em>
          </h4>
          <p className="mx-auto mt-1.5 mb-4 text-xs leading-relaxed text-navy-3">
            A column is one assessment — Quiz 1, Class Test, Assignment 2. Once you add it
            and set the marks ceiling, you can grade students inline.
          </p>

          {!showForm ? (
            <div className="flex justify-center gap-2">
              <button
                onClick={useTemplate}
                disabled={pending}
                className="border-border-2 bg-surface rounded-md border px-3.5 py-2 text-xs font-semibold text-navy hover:bg-gold-bg disabled:opacity-50"
              >
                {pending ? "Adding…" : "Use a quick template"}
              </button>
              <button
                onClick={() => setShowForm(true)}
                disabled={pending}
                className="rounded-md border border-gold bg-gold px-3.5 py-2 text-xs font-semibold text-navy hover:bg-gold-soft disabled:opacity-50"
              >
                + Add column
              </button>
            </div>
          ) : (
            <div className="text-left">
              <AddColumnForm
                classId={classId}
                subjectId={subjectId}
                periodId={periodId}
                onCancel={() => setShowForm(false)}
              />
            </div>
          )}

          {error && <p className="mt-2 text-xs text-terra">{error}</p>}
        </div>
      </div>
    </div>
  );
}
