"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteGradebookColumn, saveColumnScores } from "@/lib/actions/gradebook";
import { AddColumnForm } from "./add-column-form";

type Column = {
  id: string;
  name: string;
  category: "CA" | "EXAM";
  maxScore: number;
};
type Student = { id: string; name: string; code: string };

const inputCls =
  "w-16 rounded-md border border-border-2 bg-bg px-2 py-1.5 text-sm font-mono text-navy outline-none focus:border-gold";

function cellKey(columnId: string, studentId: string) {
  return `${columnId}:${studentId}`;
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function ColumnScoreGrid({
  columns,
  roster,
  scores,
  weights,
  classId,
  subjectId,
  periodId,
}: {
  columns: Column[];
  roster: Student[];
  /** flat list of existing raw scores, keyed by column + student */
  scores: { columnId: string; studentId: string; raw: string }[];
  weights: { cw: number; ew: number };
  classId: string;
  subjectId: string;
  periodId: string;
}) {
  const router = useRouter();

  const initial = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of scores) m[cellKey(s.columnId, s.studentId)] = s.raw;
    return m;
  }, [scores]);

  const [cells, setCells] = useState<Record<string, string>>(initial);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  function set(columnId: string, studentId: string, v: string) {
    const k = cellKey(columnId, studentId);
    setCells((c) => ({ ...c, [k]: v }));
    setDirty((d) => new Set(d).add(k));
    setMsg(null);
  }

  // Client-side preview of the rolled-up CA% / Exam% / Total per student. The
  // server rollup on save is the source of truth; this just mirrors it live.
  function rollup(studentId: string) {
    let caRaw = 0,
      caMax = 0,
      exRaw = 0,
      exMax = 0;
    for (const col of columns) {
      const raw = cells[cellKey(col.id, studentId)];
      if (raw == null || raw.trim() === "") continue;
      const n = Number(raw);
      if (!Number.isFinite(n)) continue;
      const v = Math.min(Math.max(n, 0), col.maxScore);
      if (col.category === "EXAM") {
        exRaw += v;
        exMax += col.maxScore;
      } else {
        caRaw += v;
        caMax += col.maxScore;
      }
    }
    const caPct = caMax > 0 ? round2((caRaw / caMax) * 100) : null;
    const examPct = exMax > 0 ? round2((exRaw / exMax) * 100) : null;
    const total =
      caPct == null && examPct == null
        ? null
        : round2(((caPct ?? 0) * weights.cw) / 100 + ((examPct ?? 0) * weights.ew) / 100);
    return { caPct, examPct, total };
  }

  async function save() {
    if (dirty.size === 0) {
      setMsg("Nothing to save.");
      return;
    }
    setSaving(true);
    setError(null);
    setMsg(null);
    const payload = Array.from(dirty).map((k) => {
      const [columnId, studentId] = k.split(":");
      return { columnId, studentId, raw: cells[k] ?? "" };
    });
    const res = await saveColumnScores({
      classId,
      subjectId,
      periodId,
      scores: payload,
    });
    setSaving(false);
    if (res.ok) {
      setDirty(new Set());
      setMsg(`Saved ${res.saved} cell${res.saved === 1 ? "" : "s"}.`);
      router.refresh();
    } else setError(res.error);
  }

  async function removeColumn(columnId: string) {
    setError(null);
    const res = await deleteGradebookColumn({ columnId });
    if (res.ok) router.refresh();
    else setError(res.error);
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-navy-3">
          Class {weights.cw}% · Exam {weights.ew}% — totals roll up on save.
        </p>
        <div className="flex items-center gap-2">
          {!showAdd && (
            <button
              onClick={() => setShowAdd(true)}
              className="border-border-2 bg-surface rounded-md border px-4 py-2 text-sm font-semibold text-navy hover:bg-gold-bg"
            >
              + Add column
            </button>
          )}
          <button
            onClick={save}
            disabled={saving || dirty.size === 0}
            className="text-bg rounded-md bg-navy px-5 py-2 text-sm font-semibold transition-colors hover:bg-navy-deep disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {showAdd && (
        <div className="bg-surface mb-3 rounded-xl border border-border p-3">
          <AddColumnForm
            classId={classId}
            subjectId={subjectId}
            periodId={periodId}
            onCancel={() => setShowAdd(false)}
            onDone={() => setShowAdd(false)}
          />
        </div>
      )}

      {msg && (
        <p className="mb-3 rounded-md bg-green-bg px-3 py-2 text-sm text-green">{msg}</p>
      )}
      {error && <p className="mb-3 text-sm text-terra">{error}</p>}

      <div className="bg-surface overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-bg border-b border-border text-left text-xs uppercase tracking-wide text-navy-3">
            <tr>
              <th className="bg-bg sticky left-0 z-10 px-4 py-3 font-semibold">Student</th>
              {columns.map((col) => (
                <th key={col.id} className="px-3 py-3 text-center font-semibold">
                  <div className="flex items-center justify-center gap-1.5">
                    <span className="text-navy">{col.name}</span>
                    <button
                      onClick={() => removeColumn(col.id)}
                      title={`Delete ${col.name}`}
                      aria-label={`Delete ${col.name}`}
                      className="text-navy-3 hover:text-terra"
                    >
                      ×
                    </button>
                  </div>
                  <div className="mt-0.5 flex items-center justify-center gap-1.5 text-[10px] normal-case">
                    <span className="font-mono text-navy-3">/{col.maxScore}</span>
                    <span
                      className={
                        col.category === "EXAM"
                          ? "rounded-full bg-navy px-1.5 py-0.5 text-[9px] font-semibold text-bg"
                          : "rounded-full bg-gold-bg px-1.5 py-0.5 text-[9px] font-semibold text-gold"
                      }
                    >
                      {col.category === "EXAM" ? "EXAM" : "CA"}
                    </span>
                  </div>
                </th>
              ))}
              <th className="px-3 py-3 text-right font-semibold">CA %</th>
              <th className="px-3 py-3 text-right font-semibold">Exam %</th>
              <th className="px-3 py-3 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {roster.map((s) => {
              const r = rollup(s.id);
              return (
                <tr key={s.id}>
                  <td className="bg-surface sticky left-0 z-10 px-4 py-2.5">
                    <div className="font-medium text-navy">{s.name}</div>
                    <div className="font-mono text-xs text-navy-3">{s.code}</div>
                  </td>
                  {columns.map((col) => (
                    <td key={col.id} className="px-3 py-2.5 text-center">
                      <input
                        className={inputCls}
                        type="number"
                        min="0"
                        max={col.maxScore}
                        step="0.01"
                        value={cells[cellKey(col.id, s.id)] ?? ""}
                        onChange={(e) => set(col.id, s.id, e.target.value)}
                      />
                    </td>
                  ))}
                  <td className="px-3 py-2.5 text-right text-navy-2">
                    {r.caPct == null ? "—" : `${r.caPct.toFixed(2)}%`}
                  </td>
                  <td className="px-3 py-2.5 text-right text-navy-2">
                    {r.examPct == null ? "—" : `${r.examPct.toFixed(2)}%`}
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold text-navy">
                    {r.total == null ? "—" : r.total.toFixed(2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
