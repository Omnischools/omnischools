"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveMockResult } from "@/lib/actions/wassce-mocks";
import { WASSCE_GRADES, type WassceGrade } from "@/lib/wassce/mock-grades";
import { GRADE_COLORS, GRADE_CHIP_TEXT } from "@/lib/wassce/grade-colors";
import type { MockColumn, MockCandidateRow } from "@/lib/wassce/mock-view";

/**
 * The §B.2 candidate trajectory table — THE mark-entry write surface (INCR-16). CLIENT component: it
 * imports the pure view-model types + the pure grade helpers + the `saveMockResult` server action, but
 * NO db driver and NO server loader (repo memory `reports-data-is-server-only`). Every value it renders
 * is a PRE-FORMATTED string handed from the server.
 *
 * States (Part C): a mock column that is `locked` (marking complete) renders read-only grade chips; an
 * open column with write access renders a grade <select> that saves on change (pending tint is the SOLID
 * `bg-gold-bg`, never `bg-gold/8` — the no-alpha trap). A moderated cell is read-only and shows the
 * HoA grade with the teacher's original struck through (AC10); the teacher cannot overwrite it.
 */

function GradeChip({ grade, dim, small }: { grade: WassceGrade; dim?: boolean; small?: boolean }) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-md font-display font-semibold ${
        small ? "h-5 px-1.5 text-[10px]" : "h-[30px] w-[30px] text-[12px]"
      }`}
      style={
        dim
          ? { background: "transparent", color: "#8A93A6", textDecoration: "line-through" }
          : { background: GRADE_COLORS[grade], color: GRADE_CHIP_TEXT }
      }
    >
      {grade}
    </span>
  );
}

const EM_DASH = "—";

export function WassceMockEntryGrid({
  rows,
  columns,
  subjectId,
  canWrite,
  predictorColumnId,
}: {
  rows: MockCandidateRow[];
  columns: MockColumn[];
  subjectId: string;
  canWrite: boolean;
  predictorColumnId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const anyOpen = columns.some((c) => !c.locked);

  function save(mockId: string, candidateId: string, grade: string) {
    setError(null);
    setBusyKey(`${mockId}:${candidateId}`);
    startTransition(async () => {
      const res = await saveMockResult({ mockId, candidateId, subjectId, grade });
      setBusyKey(null);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border-2 bg-surface p-10 text-center text-[12px] text-navy-3">
        No candidates have mock results for this subject yet.
        {canWrite && anyOpen ? " Enter a grade to begin." : ""}
      </div>
    );
  }

  return (
    <div>
      {error && (
        <div className="mb-2 rounded-md border border-terra bg-terra-bg px-3 py-2 text-[12px] text-terra">
          {error}
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[720px] border-collapse">
          <thead className="border-b border-border bg-bg text-[10px] font-bold uppercase tracking-[0.12em] text-navy-3">
            <tr>
              <th className="px-3 py-3 text-left">#</th>
              <th className="px-3 py-3 text-left">Name &amp; house</th>
              {columns.map((c) => (
                <th key={c.id} className="px-3 py-3 text-center">
                  {c.label}
                  {c.locked && <span className="ml-1 text-navy-3">🔒</span>}
                </th>
              ))}
              <th className="px-3 py-3 text-center">Trajectory</th>
              <th className="px-3 py-3 text-center">Predicted</th>
              <th className="px-3 py-3 text-left">Teacher note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className="border-b border-border align-middle"
                style={
                  r.isFocus
                    ? { background: "#FBEBE7" }
                    : r.rank <= 3
                      ? { background: "#F5FBF7" }
                      : undefined
                }
              >
                <td className="px-3 py-3 font-mono text-[11px] font-semibold text-navy-3">
                  {String(r.rank).padStart(2, "0")}
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-1.5">
                    <span className="font-display text-[12px] font-semibold text-navy">{r.name}</span>
                    {r.medFlag && (
                      <span className="rounded-full bg-terra-bg px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-terra">
                        MED
                      </span>
                    )}
                    {r.isFocus && (
                      <span className="rounded-full bg-warn-bg px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-warn">
                        FOCUS
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-navy-3">
                    {r.house ? `${r.house} · ` : ""}
                    {r.indexNumber}
                  </div>
                </td>
                {columns.map((c) => {
                  const cell = r.cells[c.id];
                  const editable = canWrite && !c.locked && (!cell || cell.moderatedGrade == null);
                  const key = `${c.id}:${r.id}`;
                  const isBusy = busyKey === key && pending;
                  return (
                    <td
                      key={c.id}
                      className="px-3 py-3 text-center"
                      style={isBusy ? { background: "var(--gold-bg)" } : undefined}
                    >
                      {cell && cell.moderatedGrade != null ? (
                        <span className="inline-flex flex-col items-center gap-0.5">
                          <span className="inline-flex items-center gap-1">
                            <GradeChip grade={cell.moderatedGrade} small />
                            <span className="rounded bg-navy px-1 py-0.5 text-[8px] font-bold uppercase text-gold">
                              MOD
                            </span>
                          </span>
                          <GradeChip grade={cell.grade} small dim />
                        </span>
                      ) : editable ? (
                        <select
                          aria-label={`${c.label} grade for ${r.name}`}
                          disabled={isBusy}
                          value={cell ? cell.grade : ""}
                          onChange={(e) => e.target.value && save(c.id, r.id, e.target.value)}
                          className="rounded-md border border-border-2 bg-surface px-1.5 py-1 font-display text-[12px] font-semibold text-navy focus:border-gold focus:outline-none"
                        >
                          <option value="">{EM_DASH}</option>
                          {WASSCE_GRADES.map((g) => (
                            <option key={g} value={g}>
                              {g}
                            </option>
                          ))}
                        </select>
                      ) : cell ? (
                        <GradeChip grade={cell.effective} />
                      ) : (
                        <span className="text-[13px] text-navy-3">{EM_DASH}</span>
                      )}
                    </td>
                  );
                })}
                <td className="px-3 py-3 text-center">
                  <span
                    className={`text-[13px] font-bold ${
                      r.trajectory.dir === "down"
                        ? "text-terra"
                        : r.trajectory.dir === "up"
                          ? "text-green"
                          : "text-navy-3"
                    }`}
                  >
                    {r.trajectory.label}
                  </span>
                </td>
                <td className="px-3 py-3 text-center">
                  {r.predicted ? (
                    <GradeChip grade={r.predicted} small />
                  ) : (
                    <span className="text-[13px] text-navy-3">{EM_DASH}</span>
                  )}
                </td>
                <td className="px-3 py-3 text-[11px] text-navy-2">
                  {r.teacherNote ?? <span className="text-navy-3">{EM_DASH}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] italic text-navy-3">
        {rows.length} candidates ·{" "}
        {predictorColumnId
          ? "predicted grade = the moderated-or-teacher grade of the predictor mock (derived on read)"
          : "no predictor mock yet — predicted grade pending"}
        {canWrite
          ? anyOpen
            ? " · marking open — pick a grade to save"
            : " · marking complete — read-only"
          : " · read-only (not your assigned subject)"}
        .
      </p>
    </div>
  );
}
