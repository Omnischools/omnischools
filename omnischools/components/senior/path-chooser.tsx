/**
 * The three capture paths (spec §4). Peers, not a progression — the branded paper ledger
 * is a feature, not a transitional artifact (§4.4). For Item 1 only Path A is functional;
 * B (scan, Item 4) and C (direct entry, Item 2) render as inactive-but-visible cards.
 */
const PATHS = [
  {
    letter: "A",
    name: "Auto-compile",
    desc: "From the assignments, exams and projects I've recorded through the semester. Portfolio entered at semester end.",
    active: true,
  },
  {
    letter: "B",
    name: "Scan my paper ledger",
    desc: "I keep a paper book; photograph it and Omnischools extracts the scores. I verify cell-by-cell.",
    active: false,
  },
  {
    letter: "C",
    name: "Type directly",
    desc: "Skip individual assignment tracking; enter category scores onto the ledger grid as I go.",
    active: false,
  },
] as const;

export function PathChooser() {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {PATHS.map((p) => (
        <div
          key={p.letter}
          className={
            p.active
              ? "relative rounded-xl border border-gold bg-gold-bg p-4"
              : "relative rounded-xl border-[1.5px] border-border-2 bg-surface p-4 opacity-80 hover:border-gold-soft"
          }
        >
          {p.active && (
            <span className="absolute right-3 top-3 text-[9px] font-semibold uppercase tracking-wide text-gold">
              Active
            </span>
          )}
          <div className="font-display text-[22px] italic text-gold">{p.letter}</div>
          <div className="mt-1 text-sm font-semibold text-navy">{p.name}</div>
          <p className="mt-1 text-xs leading-relaxed text-navy-3">{p.desc}</p>
          {!p.active && (
            <div className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-navy-3">
              Coming soon
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
