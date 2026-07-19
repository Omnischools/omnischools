"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addUniversityTarget,
  setUniversityTargetRank,
  removeUniversityTarget,
} from "@/lib/actions/wassce-university";
import type { ActionResult } from "@/lib/actions/wassce-readiness";
import type { ProgrammeOptionView, UniversityMatchTileView } from "@/lib/wassce/readiness-view";

/**
 * The §6 university-target WRITE controls (SHS module 4.3 / INCR-17b). CLIENT component: it imports the
 * server ACTIONS and the PURE view types only — never `readiness-data` or the db driver (repo memory
 * `reports-data-is-server-only`; only `pnpm build` catches that leak). Every tile figure arrives
 * pre-formatted from the server; nothing is computed here.
 *
 * All authz (WASSCE_SETUP_ROLES), tenant scoping and audit live in the actions. Tagging or ranking a
 * target NEVER creates or supersedes a readiness statement (AC13) — the §6 board is derived on read.
 */

const RANK_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "No rank" },
  { value: "FIRST_CHOICE", label: "First choice · primary" },
  { value: "SECOND_CHOICE", label: "Second choice" },
  { value: "THIRD_CHOICE", label: "Third choice" },
];

function Msg({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  return (
    <p className={`mt-2 text-[11px] ${result.ok ? "text-green" : "text-terra"}`}>
      {result.ok ? "Saved." : result.error}
    </p>
  );
}

/** The dashed "+ Add programme" grid cell — the write entry-point AND the zero-target empty state. */
export function WassceAddTargetTile({
  candidateId,
  programmeOptions,
}: {
  candidateId: string;
  programmeOptions: ProgrammeOptionView[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [programmeId, setProgrammeId] = useState("");
  const [rank, setRank] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);

  return (
    <div className="flex min-h-[160px] flex-col items-center justify-center rounded-lg border border-dashed border-border-2 bg-bg px-5 py-[18px]">
      <div className="font-display text-[14px] font-medium text-navy-3">+ Add programme</div>
      <p className="mt-1.5 max-w-[240px] text-center text-[11px] text-navy-3">
        SHS guidance counsellor and candidate together. 3–5 programmes is the norm; 1 target, 1
        comfortable, 1–2 stretch, 1 safety.
      </p>
      <div className="mt-3 w-full max-w-[280px] space-y-2">
        <select
          value={programmeId}
          onChange={(e) => setProgrammeId(e.target.value)}
          className="w-full rounded-md border border-border-2 bg-surface px-2 py-1.5 text-[11px] text-navy"
          aria-label="Programme"
        >
          <option value="">Choose a programme…</option>
          {programmeOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          value={rank}
          onChange={(e) => setRank(e.target.value)}
          className="w-full rounded-md border border-border-2 bg-surface px-2 py-1.5 text-[11px] text-navy"
          aria-label="Choice rank"
        >
          {RANK_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={pending || !programmeId}
          onClick={() =>
            startTransition(async () => {
              const r = await addUniversityTarget({
                candidateId,
                universityProgrammeId: programmeId,
                targetRank: rank || null,
              });
              setResult(r);
              if (r.ok) {
                setProgrammeId("");
                setRank("");
                router.refresh();
              }
            })
          }
          className="w-full rounded-md bg-navy px-3 py-1.5 text-[11px] font-semibold text-bg disabled:cursor-not-allowed disabled:opacity-50"
        >
          Tag programme
        </button>
      </div>
      <Msg result={result} />
    </div>
  );
}

/** Per-tile rank + remove controls (rendered inside each §6 tile's footer). */
export function WassceTargetControls({ tile }: { tile: UniversityMatchTileView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  const run = (fn: () => Promise<ActionResult>) =>
    startTransition(async () => {
      const r = await fn();
      setResult(r);
      if (r.ok) router.refresh();
    });

  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-border pt-2.5">
      <select
        value={tile.targetRank ?? ""}
        disabled={pending}
        onChange={(e) =>
          run(() => setUniversityTargetRank({ targetId: tile.targetId, targetRank: e.target.value || null }))
        }
        className="rounded-md border border-border-2 bg-bg px-2 py-1 text-[11px] text-navy disabled:opacity-50"
        aria-label={`Choice rank for ${tile.name}`}
      >
        {RANK_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={pending}
        onClick={() => run(() => removeUniversityTarget({ targetId: tile.targetId }))}
        className="rounded-md border border-border-2 bg-surface px-2.5 py-1 text-[11px] font-semibold text-navy-3 hover:bg-terra-bg hover:text-terra disabled:opacity-50"
      >
        Remove
      </button>
      {result && !result.ok ? <span className="text-[11px] text-terra">{result.error}</span> : null}
    </div>
  );
}
