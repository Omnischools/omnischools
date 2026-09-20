import { EmptyState } from "@/components/ui/empty-state";
import type { MyCpdStatement } from "@/lib/plc/cpd-data";

/**
 * The teacher's PLC-CPD statement (surface schoolup-cpd-points-ledger, PLC 8-pt arm ONLY). Server-safe,
 * purely presentational — the page passes a pre-formatted `MyCpdStatement`.
 *
 * DROPPED (omit-not-fake, R404): the 20-pt source breakdown, NTC-sync chips/status, the 3-year licence
 * cycle panel, evidence uploads / "Log external CPD", forecast/pace, gap-analysis. Identity is roleLabel
 * ONLY (no subject / GES-rank / NTC-id — no such field). X/8 is NOT clamped (the bar caps at 100%, the
 * number may exceed the target).
 *
 * No-alpha token trap (repo memory `no-alpha-token-opacity`): the navy hero's off-white tints are
 * `bg-white/5` / `border-white/10` (white is a real colour) and `text-gold-soft` / a literal
 * `text-[rgba(250,247,242,0.6)]` — NEVER a slash-opacity on the raw-hex `--bg` token. Verify in the live
 * preview, not the build.
 */
export function CpdStatement({ statement }: { statement: MyCpdStatement }) {
  const s = statement;
  const barPct = Math.min(100, s.pctOfTarget);
  return (
    <div className="pb-20">
      {/* ── Profile hero (identity = roleLabel only) ── */}
      <header className="mb-6 flex flex-wrap items-center gap-5 rounded-2xl border border-border bg-surface p-6">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gold font-display text-2xl font-bold text-navy">
          {s.initials}
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-navy-3">
            My profile · PLC CPD
          </div>
          <h1 className="mt-1 font-display text-3xl font-medium leading-tight text-navy">
            {s.displayName}
          </h1>
          <div className="mt-1 text-sm text-navy-2">{s.roleLabel}</div>
        </div>
      </header>

      {/* ── Navy target hero · X / 8 ── */}
      <section className="mb-8 grid grid-cols-1 gap-8 rounded-2xl bg-navy p-8 text-bg lg:grid-cols-[1.4fr_1fr]">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">
            {s.academicYear ? `Academic year ${s.academicYear} · ` : ""}Annual PLC contribution
          </div>
          <h2 className="mt-1.5 font-display text-2xl font-medium leading-snug">
            You&rsquo;re at{" "}
            <em className="italic text-gold">
              {s.yearTotal} of {s.target} PLC points
            </em>{" "}
            this year
          </h2>
          <div className="mb-4 mt-4 flex items-end gap-4">
            <div className="font-display text-5xl font-medium leading-none text-gold">
              {s.yearTotal}
            </div>
            <div className="font-display text-lg text-[rgba(250,247,242,0.5)]">of</div>
            <div className="font-display text-2xl font-medium text-[rgba(250,247,242,0.7)]">
              {s.target} pts
            </div>
          </div>
          <div className="mb-2.5 h-2.5 w-full overflow-hidden rounded-pill bg-white/5">
            <div
              className="h-full rounded-pill bg-gold"
              style={{ width: `${barPct}%` }}
            />
          </div>
          <div className="text-[11px] text-gold-soft">
            <b className="font-bold text-gold">{s.pctOfTarget}%</b> of the{" "}
            {s.target}-point PLC target
            {s.yearTotal > s.target && (
              <span className="text-[rgba(250,247,242,0.6)]"> · past the target (target ≠ cap)</span>
            )}
          </div>
        </div>

        <div className="lg:border-l lg:border-white/10 lg:pl-8">
          <MiniStat label="PLC sessions counted this year" value={`${s.sessionCount}`} />
          <MiniStat label="Full sessions · attended + reflected" value={`${s.fullCount}`} gold />
          <MiniStat label="Attended-only · no reflection point" value={`${s.partialCount}`} />
          {s.termLabel && (
            <MiniStat label={`${s.termLabel} · this term`} value={`${s.termTotal} pts`} gold last />
          )}
        </div>
      </section>

      {/* ── The PLC ledger ── */}
      <section>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2 border-b border-border pb-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">
              Every PLC session · newest first
            </div>
            <h3 className="mt-0.5 font-display text-2xl font-semibold text-navy">
              PLC ledger <em className="italic text-gold">this academic year</em>
            </h3>
          </div>
          <div className="max-w-md text-right text-[11px] text-navy-3">
            {s.sessionCount} {s.sessionCount === 1 ? "entry" : "entries"} ·{" "}
            <b className="font-semibold text-navy-2">+1.0</b> attended &amp; reflected ·{" "}
            <b className="font-semibold text-navy-2">+0.5</b> attended only
          </div>
        </div>

        {s.rows.length === 0 ? (
          <EmptyState
            eyebrow="No PLC points yet"
            title="Your PLC ledger is empty"
            body="Points post here automatically once a PLC session you attended settles (after its reflection window closes). Attend a session and submit your reflection to earn the full point."
          />
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border bg-surface">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="w-[16%] border-b border-border bg-bg px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.14em] text-navy-3">
                    Date
                  </th>
                  <th className="border-b border-border bg-bg px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.14em] text-navy-3">
                    PLC session
                  </th>
                  <th className="w-[14%] border-b border-border bg-bg px-4 py-3 text-right text-[10px] font-bold uppercase tracking-[0.14em] text-navy-3">
                    Points
                  </th>
                </tr>
              </thead>
              <tbody>
                {s.rows.map((r, i) => (
                  <tr key={`${r.sessionDate}-${r.plcName}-${i}`} className="hover:bg-gold-bg">
                    <td className="border-b border-border px-4 py-3.5 align-middle">
                      <span className="whitespace-nowrap font-mono text-[11px] font-semibold text-navy-2">
                        {r.dateLabel}
                      </span>
                    </td>
                    <td className="border-b border-border px-4 py-3.5 align-middle">
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`h-2 w-2 flex-shrink-0 rounded-full ${r.full ? "bg-navy" : "bg-warn"}`}
                          aria-hidden
                        />
                        <div>
                          <div className="text-[13px] font-semibold text-navy">{r.plcName}</div>
                          <div className="mt-0.5 text-[11px] text-navy-3">
                            {r.topic ?? (r.full ? "Attended · reflection counted" : "Attended · no reflection point")}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="border-b border-border px-4 py-3.5 text-right align-middle">
                      <span
                        className={`font-display text-base font-semibold ${r.full ? "text-navy" : "text-warn"}`}
                      >
                        {r.ptsLabel}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function MiniStat({
  label,
  value,
  gold,
  last,
}: {
  label: string;
  value: string;
  gold?: boolean;
  last?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 py-2.5 text-[12px] text-[rgba(250,247,242,0.85)] ${
        last ? "" : "border-b border-white/10"
      }`}
    >
      <span>{label}</span>
      <b className={`font-bold ${gold ? "text-gold" : "text-bg"}`}>{value}</b>
    </div>
  );
}
