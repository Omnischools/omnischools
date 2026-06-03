"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveScores } from "@/lib/actions/gradebook";
import { weightedTotal, gradeFor } from "@/lib/gradebook-helpers";

type Row = {
  id: string;
  name: string;
  code: string;
  classScore: string;
  examScore: string;
};

const inputCls =
  "w-20 rounded-md border border-border-2 bg-bg px-2 py-1.5 text-sm text-navy outline-none focus:border-gold";

export function ScoreGrid({
  classId,
  subjectId,
  periodId,
  weights,
  roster,
}: {
  classId: string;
  subjectId: string;
  periodId: string;
  weights: { cw: number; ew: number };
  roster: Row[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Record<string, { c: string; e: string }>>(
    Object.fromEntries(roster.map((r) => [r.id, { c: r.classScore, e: r.examScore }])),
  );
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function set(id: string, key: "c" | "e", v: string) {
    setRows((s) => ({ ...s, [id]: { ...s[id], [key]: v } }));
  }
  function preview(id: string) {
    const c = rows[id].c === "" ? null : Number(rows[id].c);
    const e = rows[id].e === "" ? null : Number(rows[id].e);
    const t = weightedTotal(c, e, weights.cw, weights.ew);
    return t == null ? null : { total: t, grade: gradeFor(t) };
  }

  async function save() {
    setSaving(true);
    setError(null);
    setMsg(null);
    const res = await saveScores({
      classId,
      subjectId,
      periodId,
      entries: roster.map((r) => ({
        studentId: r.id,
        classScore: rows[r.id].c === "" ? null : rows[r.id].c,
        examScore: rows[r.id].e === "" ? null : rows[r.id].e,
      })),
    });
    setSaving(false);
    if (res.ok) {
      setMsg(`Saved ${res.saved} score${res.saved === 1 ? "" : "s"}.`);
      router.refresh();
    } else setError(res.error);
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-navy-3">
          Class {weights.cw}% · Exam {weights.ew}% — total updates live.
        </p>
        <button
          onClick={save}
          disabled={saving}
          className="text-bg rounded-md bg-navy px-5 py-2 text-sm font-semibold transition-colors hover:bg-navy-deep disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save scores"}
        </button>
      </div>
      {msg && (
        <p className="mb-3 rounded-md bg-green-bg px-3 py-2 text-sm text-green">{msg}</p>
      )}
      {error && <p className="mb-3 text-sm text-terra">{error}</p>}

      <div className="bg-surface overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-bg border-b border-border text-left text-xs uppercase tracking-wide text-navy-3">
            <tr>
              <th className="px-4 py-3 font-semibold">Student</th>
              <th className="px-4 py-3 font-semibold">Class ({weights.cw}%)</th>
              <th className="px-4 py-3 font-semibold">Exam ({weights.ew}%)</th>
              <th className="px-4 py-3 text-right font-semibold">Total</th>
              <th className="px-4 py-3 font-semibold">Grade</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {roster.map((r) => {
              const p = preview(r.id);
              return (
                <tr key={r.id}>
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-navy">{r.name}</div>
                    <div className="font-mono text-xs text-navy-3">{r.code}</div>
                  </td>
                  <td className="px-4 py-2.5">
                    <input
                      className={inputCls}
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={rows[r.id].c}
                      onChange={(e) => set(r.id, "c", e.target.value)}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <input
                      className={inputCls}
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={rows[r.id].e}
                      onChange={(e) => set(r.id, "e", e.target.value)}
                    />
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium text-navy">
                    {p ? p.total.toFixed(2) : "—"}
                  </td>
                  <td className="px-4 py-2.5 font-semibold text-navy-2">
                    {p ? p.grade : "—"}
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
