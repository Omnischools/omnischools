"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { savePortfolioScores } from "@/lib/actions/score-ledger";
import { provisionalTotal, type CategoryWeights } from "@/lib/score-ledger/compute";

export type LedgerRow = {
  id: string;
  name: string;
  code: string;
  asgn: number | null;
  midSem: number | null;
  endSem: number | null;
  project: number | null;
  portfolio: number | null;
  status: "DRAFT" | "COMPLETE" | "STPSHS_READY";
};

/** Category header colours (§3.4): assignments/project green, the two exams navy, portfolio terra. */
const HEAD = [
  { key: "asgn", label: "Assignments", cls: "text-green", wkey: "asgn" as const },
  { key: "midSem", label: "Mid-sem", cls: "text-navy-2", wkey: "midSem" as const },
  { key: "endSem", label: "End-of-sem", cls: "text-navy-2", wkey: "endSem" as const },
  { key: "project", label: "Project", cls: "text-green", wkey: "project" as const },
] as const;

const computedCell = "rounded-md bg-green-bg px-2 py-1 font-mono text-[13px] font-bold text-green";
const emptyCell = "font-mono text-[13px] text-border-2";

function fmt(n: number | null): string {
  return n == null ? "—" : n.toFixed(1);
}

export function SeniorLedgerGrid({
  rows,
  weights,
  classId,
  subjectId,
  periodId,
}: {
  rows: LedgerRow[];
  weights: CategoryWeights;
  classId: string;
  subjectId: string;
  periodId: string;
}) {
  const router = useRouter();
  const initial = useMemo(() => {
    const m: Record<string, string> = {};
    for (const r of rows) m[r.id] = r.portfolio == null ? "" : String(r.portfolio);
    return m;
  }, [rows]);

  const [portfolio, setPortfolio] = useState<Record<string, string>>(initial);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function setP(studentId: string, v: string) {
    setPortfolio((p) => ({ ...p, [studentId]: v }));
    setDirty((d) => new Set(d).add(studentId));
    setMsg(null);
  }

  /** Live weighted total mirroring the server compile (provisional until portfolio is in). */
  function total(r: LedgerRow) {
    const raw = portfolio[r.id];
    const pf = raw == null || raw.trim() === "" ? null : Number(raw);
    const cats = {
      asgn: r.asgn,
      midSem: r.midSem,
      endSem: r.endSem,
      project: r.project,
      portfolio: Number.isFinite(pf as number) ? (pf as number | null) : null,
    };
    const { total, weightEntered } = provisionalTotal(cats, weights);
    return { value: total, complete: weightEntered === 100 };
  }

  async function save() {
    if (dirty.size === 0) {
      setMsg("Nothing to save.");
      return;
    }
    setSaving(true);
    setError(null);
    setMsg(null);
    const scores = Array.from(dirty).map((id) => ({
      studentId: id,
      value: portfolio[id] ?? "",
    }));
    const res = await savePortfolioScores({ classId, subjectId, periodId, scores });
    setSaving(false);
    if (res.ok) {
      setDirty(new Set());
      setMsg(`Saved ${res.saved} portfolio score${res.saved === 1 ? "" : "s"}.`);
      router.refresh();
    } else setError(res.error);
  }

  const w = weights;
  const weightPct = [w.asgn, w.midSem, w.endSem, w.project];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-navy-3">
          Four categories auto-compile from the assessments below · portfolio is entered by
          hand at semester end.
        </p>
        <button
          onClick={save}
          disabled={saving || dirty.size === 0}
          className="rounded-md bg-navy px-5 py-2 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save portfolio"}
        </button>
      </div>

      {msg && (
        <p className="mb-3 rounded-md bg-green-bg px-3 py-2 text-sm text-green">{msg}</p>
      )}
      {error && <p className="mb-3 text-sm text-terra">{error}</p>}

      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b-2 border-border-2 bg-bg text-center text-[9px] font-bold uppercase tracking-[0.1em] text-navy-3">
            <tr>
              <th className="sticky left-0 z-10 bg-bg px-4 py-3 text-left">Student</th>
              {HEAD.map((h, i) => (
                <th key={h.key} className="px-2.5 py-3">
                  <div className={h.cls}>{h.label}</div>
                  <div className="mt-0.5 font-mono text-[9px] text-navy-3">
                    {weightPct[i]}%
                  </div>
                </th>
              ))}
              <th className="px-2.5 py-3">
                <div className="text-terra">Portfolio</div>
                <div className="mt-0.5 font-mono text-[9px] text-navy-3">{w.portfolio}%</div>
              </th>
              <th className="bg-navy px-2.5 py-3 text-bg">
                <div>Weighted</div>
                <div className="mt-0.5 font-mono text-[9px] text-bg/60">100%</div>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => {
              const t = total(r);
              return (
                <tr key={r.id} className="hover:bg-gold-bg">
                  <td className="sticky left-0 z-10 bg-surface px-4 py-2.5 text-left">
                    <div className="font-semibold text-navy">{r.name}</div>
                    <div className="font-mono text-[9.5px] text-navy-3">{r.code}</div>
                  </td>
                  {(["asgn", "midSem", "endSem", "project"] as const).map((k) => (
                    <td key={k} className="px-2.5 py-2.5 text-center">
                      {r[k] == null ? (
                        <span className={emptyCell}>—</span>
                      ) : (
                        <span className={computedCell}>{fmt(r[k])}</span>
                      )}
                    </td>
                  ))}
                  <td className="px-2.5 py-2.5 text-center">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      placeholder="—"
                      value={portfolio[r.id] ?? ""}
                      onChange={(e) => setP(r.id, e.target.value)}
                      className={
                        (portfolio[r.id] ?? "").trim() === ""
                          ? "w-16 rounded-md border border-border-2 bg-bg px-2 py-1.5 text-center font-mono text-[13px] text-border-2 outline-none focus:border-gold"
                          : "w-16 rounded-md border border-gold-soft bg-gold-bg px-2 py-1.5 text-center font-mono text-[13px] font-bold text-navy outline-none focus:border-gold"
                      }
                    />
                  </td>
                  <td className="bg-navy px-2.5 py-2.5 text-center font-mono text-[13px] font-bold text-bg">
                    {t.value == null || (r.asgn == null && r.midSem == null && r.endSem == null && r.project == null)
                      ? "—"
                      : t.value.toFixed(1)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Legend (§3.4) — render all three even in Path A. */}
      <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-navy-3">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded bg-green-bg" /> Auto-compiled from
          in-semester entries
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded bg-gold-bg" /> Manual entry (portfolio
          + corrections)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded bg-warn-bg" /> Low-confidence (scan
          path only)
        </span>
      </div>
    </div>
  );
}
