"use client";
import { useState } from "react";

export type OverCell = { name: string; category: string };

/**
 * "Generate STPSHS sheet →" (INCR-3 · Item 8). Client-side gating that mirrors the server:
 *  - disabled until the whole class ledger is COMPLETE (Q3);
 *  - if any category is over 100 (Q5), it lists the offending cells and stays disabled until
 *    the teacher EITHER corrects each down in the grid above (then this clears on refresh) OR
 *    ticks "cap to 100 for the STPSHS export" — which sets `ack=1` on the download link.
 * The route re-enforces both gates, so this is convenience, not the boundary.
 */
export function StpshsGenerateButton({
  classId,
  subjectId,
  periodId,
  complete,
  overCells,
}: {
  classId: string;
  subjectId: string;
  periodId: string;
  complete: boolean;
  overCells: OverCell[];
}) {
  const [ack, setAck] = useState(false);
  const hasOver = overCells.length > 0;
  const enabled = complete && (!hasOver || ack);
  const href =
    `/api/senior/stpshs-sheet?classId=${classId}&subjectId=${subjectId}&periodId=${periodId}` +
    (hasOver && ack ? "&ack=1" : "");

  return (
    <div className="mt-3">
      {hasOver && (
        <div className="mb-3 rounded-md border border-terra bg-terra-bg px-3 py-2 text-[12px] text-navy-2">
          <p className="font-semibold text-terra">
            {overCells.length} score{overCells.length === 1 ? "" : "s"} over 100 must be resolved
            before you can generate the STPSHS sheet.
          </p>
          <p className="mt-1">{overCells.map((c) => `${c.name} · ${c.category}`).join("; ")}</p>
          <label className="mt-2 flex items-start gap-2">
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Cap {overCells.length === 1 ? "it" : "them"} to 100 for the STPSHS export. The ledger
              value is unchanged; only the printed regulator sheet is bounded.
            </span>
          </label>
        </div>
      )}

      {enabled ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex rounded-md bg-navy px-5 py-2.5 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep"
        >
          Generate STPSHS sheet →
        </a>
      ) : (
        <button
          type="button"
          disabled
          className="inline-flex cursor-not-allowed rounded-md bg-navy px-5 py-2.5 text-sm font-semibold text-bg opacity-60"
        >
          Generate STPSHS sheet →
        </button>
      )}

      {!complete && (
        <p className="mt-2 text-[12px] text-navy-3">
          Fill all five categories for every student, then the printable STPSHS-ready sheet
          generates from this ledger.
        </p>
      )}
    </div>
  );
}
