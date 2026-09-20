/**
 * Shared VLC surface chrome (SHS module 4.5) — the `SectionHead` block header and the `SumCard` summary
 * card, extracted from the F0 setup page (INCR-40) so the Peer Guides surface (INCR-41) reuses them 1:1
 * rather than a second copy. Server-safe (no "use client"): both are pure presentational components the
 * setup + peer-guides server pages render directly.
 *
 * No-alpha token trap (repo memory `no-alpha-token-opacity`): the `featured` (navy) card's label/sub use
 * SOLID `text-gold-soft`, never a slash-opacity on the raw-hex token; the `warn` card uses the solid
 * `text-warn` / `bg-warn-bg` tokens. Verify tints in the live preview, not the build.
 */

export function SectionHead({
  eyebrow,
  meta,
  children,
}: {
  eyebrow: string;
  meta?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-2 border-b border-border pb-3">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gold">{eyebrow}</div>
        <h3 className="mt-0.5 font-display text-2xl font-semibold text-navy">{children}</h3>
      </div>
      {meta && <div className="max-w-md text-right text-[11px] text-navy-3">{meta}</div>}
    </div>
  );
}

/**
 * A summary-strip card. Four grounds: default (surface), `featured` (navy, gold number — the shipped F0
 * variant), `warn` (warn-bg, warn number — INCR-41's "Rotating after T2" card) and `terra` (terra-bg, terra
 * number — new for INCR-44's pastoral-flags card). All are mutually exclusive; precedence warn > terra >
 * featured. Every ground uses SOLID tokens (`bg-terra-bg` / `text-terra`, never a slash-opacity on a raw-hex
 * token — the no-alpha trap; verify tints in the live preview, not the build).
 */
export function SumCard({
  label,
  big,
  children,
  featured,
  warn,
  terra,
}: {
  label: string;
  big: string;
  children: React.ReactNode;
  featured?: boolean;
  warn?: boolean;
  terra?: boolean;
}) {
  const ground = warn
    ? "border-warn bg-warn-bg"
    : terra
      ? "border-terra bg-terra-bg"
      : featured
        ? "border-navy bg-navy text-bg"
        : "border-border bg-surface";
  const labelColor = warn ? "text-warn" : terra ? "text-terra" : featured ? "text-gold-soft" : "text-navy-3";
  const bigColor = warn ? "text-warn" : terra ? "text-terra" : featured ? "text-gold" : "text-navy";
  const subColor = warn ? "text-warn" : terra ? "text-terra" : featured ? "text-gold-soft" : "text-navy-3";
  return (
    <div className={`rounded-xl border p-4 ${ground}`}>
      <div className={`text-[10px] font-bold uppercase tracking-[0.12em] ${labelColor}`}>{label}</div>
      <div className={`mt-1 font-display text-2xl font-semibold leading-none ${bigColor}`}>{big}</div>
      <div className={`mt-1.5 text-[11px] leading-snug ${subColor}`}>{children}</div>
    </div>
  );
}
