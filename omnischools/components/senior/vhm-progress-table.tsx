import type { VhmProgressRow, CapturePath, VhmStatus } from "@/lib/score-ledger/vhm-progress";

/**
 * The Vice Headmaster completion table (surface §1). COMPLETION STATES ONLY — every cell is
 * a path letter, a category dot (entered / partial / pending), an n/5 tier, or a relative
 * date. No score value is ever rendered (spec §6.2). Server component — purely presentational.
 */

const PATH_PILL: Record<CapturePath, { letter: string; cls: string }> = {
  AUTO_COMPILE: { letter: "A", cls: "bg-green-bg text-green" },
  SCAN_EXTRACT: { letter: "B", cls: "bg-gold-bg text-gold" },
  DIRECT_ENTRY: { letter: "C", cls: "bg-terra-bg text-terra" },
};

const STPSHS: Record<VhmStatus, { label: string; cls: string }> = {
  ready: { label: "Ready", cls: "bg-green-bg text-green" },
  behind: { label: "Behind", cls: "bg-gold-bg text-gold" },
  at_risk: { label: "At risk", cls: "bg-terra-bg text-terra" },
};

const CATS: { key: keyof VhmProgressRow["filled"]; label: string; cls: string }[] = [
  { key: "asgn", label: "Asg", cls: "text-green" },
  { key: "midSem", label: "MS", cls: "text-navy-2" },
  { key: "endSem", label: "ES", cls: "text-navy-2" },
  { key: "project", label: "Proj", cls: "text-green" },
  { key: "portfolio", label: "Port", cls: "text-terra" },
];

/** A category dot: ✓ (all entered) / ◐ (some) / — (none). Never a score — the state only. */
function CatDot({ filled, roster }: { filled: number; roster: number }) {
  const done = roster > 0 && filled === roster;
  const partial = filled > 0 && !done;
  const cls = done
    ? "bg-green text-bg"
    : partial
      ? "bg-gold text-navy"
      : "bg-border-2 text-navy-3";
  const glyph = done ? "✓" : partial ? "◐" : "—";
  return (
    <span
      title={roster > 0 ? `${filled} of ${roster} entered` : "no students"}
      className={`inline-flex h-[22px] w-[22px] items-center justify-center rounded-md font-mono text-[11px] font-bold ${cls}`}
    >
      {glyph}
    </span>
  );
}

function lastActivityLabel(daysInactive: number | null): string {
  if (daysInactive == null) return "never";
  if (daysInactive <= 0) return "today";
  if (daysInactive === 1) return "yesterday";
  return `${daysInactive} days ago`;
}

export function VhmProgressTable({ rows }: { rows: VhmProgressRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border-2 bg-surface p-12 text-center text-sm text-navy-3">
        No class-subject combinations for this semester yet. Set up teaching assignments in
        Classes &amp; subjects to track ledger progress.
      </div>
    );
  }
  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-bg text-[9px] font-bold uppercase tracking-[0.1em] text-navy-3">
            <tr>
              <th className="px-4 py-3 text-left">Teacher</th>
              <th className="px-3 py-3 text-left">Class · subject</th>
              <th className="px-2 py-3 text-center">Path</th>
              {CATS.map((c) => (
                <th key={c.key} className={`px-2 py-3 text-center ${c.cls}`}>
                  {c.label}
                </th>
              ))}
              <th className="px-3 py-3 text-center">STPSHS</th>
              <th className="px-4 py-3 text-right">Last activity</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => {
              const pill = PATH_PILL[r.path];
              const s = STPSHS[r.status];
              const stale = r.daysInactive != null && r.daysInactive >= 14;
              return (
                <tr key={`${r.classId}:${r.subjectId}`} className="hover:bg-gold-bg">
                  <td className="px-4 py-3 text-left">
                    <div className="font-semibold text-navy">{r.teacherName ?? "—"}</div>
                    <div className="text-[9.5px] text-navy-3">{r.subjectName}</div>
                  </td>
                  <td className="px-3 py-3 text-left font-semibold text-navy-2">
                    {r.className}
                  </td>
                  <td className="px-2 py-3 text-center">
                    <span
                      className={`rounded-full px-[7px] py-[3px] font-mono text-[9px] font-bold tracking-[0.04em] ${pill.cls}`}
                    >
                      {pill.letter}
                    </span>
                  </td>
                  {CATS.map((c) => (
                    <td key={c.key} className="px-2 py-3 text-center">
                      <CatDot filled={r.filled[c.key]} roster={r.rosterSize} />
                    </td>
                  ))}
                  <td className="px-3 py-3 text-center">
                    <span
                      className={`inline-block rounded-full px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.04em] ${s.cls}`}
                    >
                      {s.label} · {r.categoriesDone}/5
                    </span>
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-mono text-[10px] ${
                      stale ? "font-bold text-terra" : "text-navy-3"
                    }`}
                  >
                    {lastActivityLabel(r.daysInactive)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Legends (§1.5 path · §1.6 cat-dot). */}
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-[10.5px] text-navy-3">
        <span className="flex items-center gap-2">
          <span className="rounded-full bg-green-bg px-[6px] py-[2px] font-mono text-[9px] font-bold text-green">
            A
          </span>
          Auto-compile
          <span className="rounded-full bg-gold-bg px-[6px] py-[2px] font-mono text-[9px] font-bold text-gold">
            B
          </span>
          Scan paper
          <span className="rounded-full bg-terra-bg px-[6px] py-[2px] font-mono text-[9px] font-bold text-terra">
            C
          </span>
          Direct digital
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-green text-[9px] text-bg">
            ✓
          </span>
          Entered
          <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-gold text-[9px] text-navy">
            ◐
          </span>
          Partial
          <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-border-2 text-[9px] text-navy-3">
            —
          </span>
          Pending
        </span>
      </div>
    </div>
  );
}
