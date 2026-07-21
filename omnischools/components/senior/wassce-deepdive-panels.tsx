"use client";

import { useState } from "react";
import type {
  ContextCellView,
  LedgerGridView,
  ScheduleView,
  StpshsStripView,
} from "@/lib/wassce/deepdive-view";

/**
 * CLIENT panels for the WASSCE candidate deep-dive (SHS module 4.3 / INCR-20 CAPSTONE). Every panel takes
 * PRE-FORMATTED view-model props (already-computed strings/numbers) whose types live in the db-free
 * `lib/wassce/deepdive-view` module — a client component here must NEVER import a data/loader module
 * (repo memory `reports-data-is-server-only`; only `pnpm build` catches that leak). No slash-opacity on a
 * raw-hex token (repo memory `no-alpha-token-opacity`): empty cells use `opacity-45`, row tints inline rgba.
 */

/* ─────────────────────────── NEW-1 · §4 full ledger-trajectory grid ───────────────────────────────── */

export function WassceLedgerGrid({
  grids,
  defaultSubjectId,
}: {
  grids: LedgerGridView[];
  defaultSubjectId: string | null;
}) {
  const [selectedId, setSelectedId] = useState(defaultSubjectId ?? grids[0]?.subjectId ?? "");
  const grid = grids.find((g) => g.subjectId === selectedId) ?? grids[0];
  if (!grid) return null;

  return (
    <section id="ledger-grid" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.12em] text-navy-3">
            Ledger trajectory · what the predictor sees that STPSHS does not
          </div>
          <h2 className="mt-1 font-display text-2xl font-medium text-navy">
            Score ledger · <em className="italic text-gold">{grid.subjectName}</em> · six semesters
          </h2>
        </div>
        {grids.length > 1 ? (
          <div className="flex flex-wrap gap-1.5">
            {grids.map((g) => (
              <button
                key={g.subjectId}
                type="button"
                onClick={() => setSelectedId(g.subjectId)}
                className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold ${
                  g.subjectId === grid.subjectId
                    ? "border-gold bg-gold-bg text-navy"
                    : "border-border-2 bg-surface text-navy-3 hover:bg-bg"
                }`}
              >
                {g.subjectName}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        {/* frame head */}
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-gold">
              Five-category score ledger
              {grid.teacherLabel ? ` · ${grid.teacherLabel}` : ""} · {grid.subjectName}
            </div>
            <div className="mt-1 font-display text-[19px] font-medium text-navy">
              The <em className="italic text-gold">evidence underneath</em> · five in-semester categories,
              each semester&apos;s stored weighted total shown as-is
            </div>
          </div>
          {grid.weightsLabel ? (
            <div className="text-right font-mono text-[10.5px] leading-relaxed text-navy-3">
              <div>weights {grid.weightsLabel}</div>
              <div>frozen at compile</div>
              <div>end-of-sem dominant</div>
            </div>
          ) : null}
        </div>

        {grid.hasLedger ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse font-mono text-[12px]">
              <thead>
                <tr className="bg-navy text-bg">
                  <th className="sticky left-0 z-10 w-[190px] bg-navy-2 px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wide">
                    Category · weight
                  </th>
                  {grid.columns.map((c) => (
                    <th key={c.periodId} className="px-3 py-2.5 text-center font-medium">
                      <div>{c.label}</div>
                      <div className="text-[10px] font-normal opacity-80">{c.periodSub}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.categories.map((cat) => (
                  <tr key={cat.label} className="border-b border-border">
                    <td className="sticky left-0 z-10 bg-bg px-3 py-2.5 text-left">
                      <div className="text-[11.5px] font-semibold text-navy">{cat.label}</div>
                      <div className="font-mono text-[10px] text-navy-3">{cat.weightLabel}</div>
                    </td>
                    {cat.cells.map((cell, i) => (
                      <td
                        key={grid.columns[i]?.periodId ?? i}
                        className={`px-3 py-2.5 text-center text-navy-2 ${cell === "—" ? "opacity-45" : ""}`}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="border-t-2 border-border-2 bg-gold-bg">
                  <td className="sticky left-0 z-10 bg-gold-bg px-3 py-2.5 text-left font-display text-[13px] font-semibold italic text-gold">
                    Weighted total
                  </td>
                  {grid.totals.map((t, i) => (
                    <td
                      key={grid.columns[i]?.periodId ?? i}
                      className="px-3 py-2.5 text-center font-display text-[15px] font-semibold text-gold"
                    >
                      {t}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-5 py-8 text-[13px] text-navy-3">
            {grid.resolved ? (
              <>
                No score ledger captured for <b className="text-navy-2">{grid.subjectName}</b> yet — the
                six-semester trajectory appears here once the ledger is compiled.
              </>
            ) : (
              <>
                <b className="text-navy-2">{grid.subjectName}</b> is not taught through the score ledger,
                so there is no in-semester trajectory to show. The projection reads the predictor mock, not
                this grid.
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/* ─────────────────────────── NEW-2 · §2 WASSCE paper schedule ──────────────────────────────────────── */

const STATUS_PILL: Record<string, string> = {
  SAT: "bg-green-bg text-green",
  MISSED: "bg-terra-bg text-terra",
  UPCOMING: "bg-gold-bg text-gold",
};
const MISSED_ROW_TINT = "rgba(184,74,57,0.05)"; // ≈ terra-bg, inline (no slash-opacity on a raw-hex token)

export function WassceScheduleTable({ schedule }: { schedule: ScheduleView }) {
  return (
    <section id="schedule" className="space-y-3">
      <div>
        <div className="text-[11px] uppercase tracking-[0.12em] text-navy-3">
          WASSCE schedule × completion
        </div>
        <h2 className="mt-1 font-display text-2xl font-medium text-navy">
          Paper-by-paper <em className="italic text-gold">completion</em>
        </h2>
      </div>

      {/* summary strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SumCell num={String(schedule.total)} tone="text-navy" label="Papers · total" />
        <SumCell num={String(schedule.sat)} tone="text-green" label="Sat" />
        <SumCell num={String(schedule.missed)} tone="text-terra" label="Missed · medical" />
        <SumCell num={String(schedule.upcoming)} tone="text-gold" label="Upcoming" />
      </div>

      {schedule.total > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full min-w-[640px] border-collapse text-[12px]">
            <thead>
              <tr className="bg-bg text-[10px] uppercase tracking-wide text-navy-3">
                <th className="px-4 py-2.5 text-left font-semibold">Date</th>
                <th className="px-4 py-2.5 text-left font-semibold">Paper</th>
                <th className="px-4 py-2.5 text-left font-semibold">Duration</th>
                <th className="px-4 py-2.5 text-left font-semibold">Type</th>
                <th className="px-4 py-2.5 text-left font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {schedule.rows.map((r) => (
                <tr
                  key={r.paperId}
                  className="border-t border-border"
                  style={r.status === "MISSED" ? { backgroundColor: MISSED_ROW_TINT } : undefined}
                >
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[11px] text-navy-2">
                    {r.dateLabel}
                    {r.timeLabel ? <span className="text-navy-3"> · {r.timeLabel}</span> : null}
                  </td>
                  <td className="px-4 py-2.5 font-medium text-navy">{r.paperName}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-navy-3">{r.durationLabel ?? "—"}</td>
                  <td className="px-4 py-2.5 text-navy-3">{r.typeLabel}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${STATUS_PILL[r.status]}`}
                    >
                      {r.statusLabel}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border-2 bg-surface p-5 text-[13px] text-navy-3">
          No WASSCE papers are scheduled for this candidate yet.
        </div>
      )}

      {/* make-up convention — generic WAEC policy (candidate-specific + sickbay detail omitted) */}
      <div className="rounded-md border border-border bg-bg px-5 py-4 text-[12px] leading-relaxed text-navy-2">
        <b className="text-navy">SC-12 make-up convention.</b> WAEC offers make-up sittings for candidates
        with documented medical disruption inside the live exam window. A make-up is rescheduled at the
        regional WAEC office — not at the school centre — typically within ten working days of fitness
        restoration. The school facilitates transport and teacher accompaniment; WAEC, not the school, sets
        the date.
      </div>
    </section>
  );
}

function SumCell({ num, tone, label }: { num: string; tone: string; label: string }) {
  return (
    <div className="rounded-md border border-border bg-surface px-4 py-3">
      <div className={`font-display text-[22px] font-medium ${tone}`}>{num}</div>
      <div className="text-[10px] uppercase tracking-wide text-navy-3">{label}</div>
    </div>
  );
}

/* ─────────────────────────── NEW-3 · §7 context strip (attendance + fees only) ─────────────────────── */

export function WassceContextStrip({
  termLabel,
  attendance,
  fees,
}: {
  termLabel: string | null;
  attendance: ContextCellView;
  fees: ContextCellView;
}) {
  const window = termLabel ? ` · ${termLabel}` : "";
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <ContextCell label={`Attendance${window}`} cell={attendance} />
      <ContextCell label={`Fees${window}`} cell={fees} />
    </div>
  );
}

function ContextCell({ label, cell }: { label: string; cell: ContextCellView }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-5 py-4">
      <div className="text-[10px] uppercase tracking-wide text-navy-3">{label}</div>
      <div className="mt-1 font-display text-[16px] font-medium text-navy">{cell.value}</div>
      <div className="mt-0.5 text-[12px] text-navy-3">{cell.meta}</div>
    </div>
  );
}

/* ─────────────────────────── NEW-4 · §1 STPSHS reference strip (REDUCED, not the matrix) ───────────── */

export function WassceStpshsStrip({ stpshs }: { stpshs: StpshsStripView }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-gold">
            WAEC STPSHS · regulator submission reference
          </div>
          <div className="mt-1 flex items-center gap-2 font-display text-[16px] font-medium text-navy">
            Reference
            <span
              className={`rounded px-2 py-0.5 font-mono text-[13px] ${
                stpshs.pending ? "bg-gold-bg text-gold" : "text-navy-2"
              }`}
            >
              {stpshs.ref}
            </span>
          </div>
        </div>
        <a
          href={stpshs.sheetHref}
          className="rounded-md border border-border-2 bg-surface px-4 py-2 text-[12px] font-semibold text-navy hover:bg-gold-bg"
        >
          Generate STPSHS score sheet →
        </a>
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-navy-3">
        STPSHS is WAEC&apos;s regulator ledger — the terminal weighted score per subject per year that WAEC
        reconciles against the WASSCE result. This candidate&apos;s per-student STPSHS reference is
        {stpshs.pending ? (
          <>
            {" "}
            <b className="text-navy-2">pending</b>: it is assigned during the WAEC bio-data ingest, a later
            increment. The score-ledger evidence underneath — the six-semester five-category trajectory in
            the ledger grid below — is what Omnischools holds today.
          </>
        ) : (
          <> on file. The printable STPSHS score sheet is generated from the score ledger.</>
        )}
      </p>
    </div>
  );
}
