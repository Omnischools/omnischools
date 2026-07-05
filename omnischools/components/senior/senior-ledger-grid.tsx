"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  savePortfolioScores,
  saveDirectLedgerScores,
} from "@/lib/actions/score-ledger";
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

type CatKey = "asgn" | "midSem" | "endSem" | "project" | "portfolio";

/** The five categories in order, with header colour (§3.4) and weight key. */
const CATS: { key: CatKey; label: string; cls: string; wkey: keyof CategoryWeights }[] = [
  { key: "asgn", label: "Assignments", cls: "text-green", wkey: "asgn" },
  { key: "midSem", label: "Mid-sem", cls: "text-navy-2", wkey: "midSem" },
  { key: "endSem", label: "End-of-sem", cls: "text-navy-2", wkey: "endSem" },
  { key: "project", label: "Project", cls: "text-green", wkey: "project" },
  { key: "portfolio", label: "Portfolio", cls: "text-terra", wkey: "portfolio" },
];

const computedCell = "rounded-md bg-green-bg px-2 py-1 font-mono text-[13px] font-bold text-green";
const emptyCell = "font-mono text-[13px] text-border-2";
const plainInput =
  "w-16 rounded-md border border-border-2 bg-bg px-2 py-1.5 text-center font-mono text-[13px] text-navy outline-none focus:border-gold";
const filledPortfolio =
  "w-16 rounded-md border border-gold-soft bg-gold-bg px-2 py-1.5 text-center font-mono text-[13px] font-bold text-navy outline-none focus:border-gold";
const emptyInput =
  "w-16 rounded-md border border-border-2 bg-bg px-2 py-1.5 text-center font-mono text-[13px] text-border-2 outline-none focus:border-gold";

const cellKey = (id: string, k: CatKey) => `${id}:${k}`;

export function SeniorLedgerGrid({
  rows,
  weights,
  classId,
  subjectId,
  periodId,
  /** compiled = Path A (4 auto cells read-only, portfolio manual); direct = Path C (all five editable). */
  mode = "compiled",
}: {
  rows: LedgerRow[];
  weights: CategoryWeights;
  classId: string;
  subjectId: string;
  periodId: string;
  mode?: "compiled" | "direct";
}) {
  const router = useRouter();
  const editable: Set<CatKey> =
    mode === "direct"
      ? new Set<CatKey>(["asgn", "midSem", "endSem", "project", "portfolio"])
      : new Set<CatKey>(["portfolio"]);

  const initial = useMemo(() => {
    const m: Record<string, string> = {};
    for (const r of rows) {
      for (const c of CATS) {
        if (!editable.has(c.key)) continue;
        const v = r[c.key];
        m[cellKey(r.id, c.key)] = v == null ? "" : String(v);
      }
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, mode]);

  const [cells, setCells] = useState<Record<string, string>>(initial);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function setCell(studentId: string, k: CatKey, v: string) {
    setCells((c) => ({ ...c, [cellKey(studentId, k)]: v }));
    setDirty((d) => new Set(d).add(studentId));
    setMsg(null);
  }

  /** The current value of a category for a row — from the input if editable, else the compiled row value. */
  function catValue(r: LedgerRow, k: CatKey): number | null {
    if (editable.has(k)) {
      const raw = cells[cellKey(r.id, k)];
      if (raw == null || raw.trim() === "") return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    }
    return r[k];
  }

  /** Live weighted total mirroring the server compile (provisional until all five present). */
  function total(r: LedgerRow) {
    const cats = {
      asgn: catValue(r, "asgn"),
      midSem: catValue(r, "midSem"),
      endSem: catValue(r, "endSem"),
      project: catValue(r, "project"),
      portfolio: catValue(r, "portfolio"),
    };
    const anyPresent = Object.values(cats).some((v) => v != null);
    return { value: provisionalTotal(cats, weights).total, anyPresent };
  }

  async function save() {
    if (dirty.size === 0) {
      setMsg("Nothing to save.");
      return;
    }
    setSaving(true);
    setError(null);
    setMsg(null);
    const res =
      mode === "direct"
        ? await saveDirectLedgerScores({
            classId,
            subjectId,
            periodId,
            scores: Array.from(dirty).map((id) => ({
              studentId: id,
              asgn: cells[cellKey(id, "asgn")] ?? "",
              midSem: cells[cellKey(id, "midSem")] ?? "",
              endSem: cells[cellKey(id, "endSem")] ?? "",
              project: cells[cellKey(id, "project")] ?? "",
              portfolio: cells[cellKey(id, "portfolio")] ?? "",
            })),
          })
        : await savePortfolioScores({
            classId,
            subjectId,
            periodId,
            scores: Array.from(dirty).map((id) => ({
              studentId: id,
              value: cells[cellKey(id, "portfolio")] ?? "",
            })),
          });
    setSaving(false);
    if (res.ok) {
      setDirty(new Set());
      setMsg(`Saved ${res.saved} row${res.saved === 1 ? "" : "s"}.`);
      router.refresh();
    } else setError(res.error);
  }

  const weightBy = (k: CatKey) => weights[CATS.find((c) => c.key === k)!.wkey];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-navy-3">
          {mode === "direct"
            ? "Direct entry (Path C) — type each category score (0–100) straight onto the grid."
            : "Four categories auto-compile from the assessments below · portfolio is entered by hand at semester end."}
        </p>
        <button
          onClick={save}
          disabled={saving || dirty.size === 0}
          className="rounded-md bg-navy px-5 py-2 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep disabled:opacity-60"
        >
          {saving ? "Saving…" : mode === "direct" ? "Save ledger" : "Save portfolio"}
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
              {CATS.map((c) => (
                <th key={c.key} className="px-2.5 py-3">
                  <div className={c.cls}>{c.label}</div>
                  <div className="mt-0.5 font-mono text-[9px] text-navy-3">
                    {weightBy(c.key)}%
                  </div>
                </th>
              ))}
              <th className="bg-navy px-2.5 py-3 text-bg">
                <div>Weighted</div>
                <div className="mt-0.5 font-mono text-[9px] text-bg opacity-60">100%</div>
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
                  {CATS.map((c) => (
                    <td key={c.key} className="px-2.5 py-2.5 text-center">
                      {editable.has(c.key) ? (
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          placeholder="—"
                          value={cells[cellKey(r.id, c.key)] ?? ""}
                          onChange={(e) => setCell(r.id, c.key, e.target.value)}
                          className={
                            (cells[cellKey(r.id, c.key)] ?? "").trim() === ""
                              ? emptyInput
                              : c.key === "portfolio"
                                ? filledPortfolio
                                : plainInput
                          }
                        />
                      ) : r[c.key] == null ? (
                        <span className={emptyCell}>—</span>
                      ) : (
                        <span className={computedCell}>{r[c.key]!.toFixed(1)}</span>
                      )}
                    </td>
                  ))}
                  <td className="bg-navy px-2.5 py-2.5 text-center font-mono text-[13px] font-bold text-bg">
                    {t.value == null || !t.anyPresent ? "—" : t.value.toFixed(1)}
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
