import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Surface primitives ported from the audited mocks
 * (Surfaces/schoolup-oversight-compliance-record.html, …-access-audit.html) via Lucy's design map.
 *
 * Everything binds to the token classes in tailwind.config.ts — never a literal hex — so a brand
 * change is one file. shadcn/ui is not installed in this app yet, so Lucy's PART B mapping is
 * satisfied here with the same semantics in plain markup (Panel≈Card, Pill≈Badge, Alert boxes).
 * When shadcn lands, these are the four things to replace.
 */

export function Panel({
  title,
  meta,
  children,
  className,
}: {
  title: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-lg border border-border-1 bg-surface",
        className,
      )}
    >
      <header className="flex items-baseline justify-between gap-4 border-b border-border-1 px-5 py-3">
        <h2 className="font-display text-base text-navy">{title}</h2>
        {meta ? <span className="text-xs text-navy-3">{meta}</span> : null}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

type PillTone = "gold" | "green" | "terra" | "warn" | "navy" | "muted";

const PILL_TONE: Record<PillTone, string> = {
  gold: "bg-gold-bg text-gold border-gold-soft",
  green: "bg-green-bg text-green border-green",
  terra: "bg-terra-bg text-terra border-terra",
  warn: "bg-warn-bg text-warn border-warn",
  navy: "bg-navy text-bg border-navy",
  muted: "bg-bg text-navy-3 border-border-2",
};

export function Pill({
  tone = "muted",
  children,
}: {
  tone?: PillTone;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-pill border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wide",
        PILL_TONE[tone],
      )}
    >
      {children}
    </span>
  );
}

/**
 * The legal-basis chip (Lucy C3). STATUTORY takes the green `audit` family, CONSENT the gold `fshs`
 * family — the same two colours the access & audit log already uses for those reason families, so
 * a reviewer who has learned one surface has learned the other.
 */
export function BasisPill({ basis }: { basis: "STATUTORY" | "CONSENT" }) {
  return <Pill tone={basis === "STATUTORY" ? "green" : "gold"}>{basis}</Pill>;
}

export function OutcomePill({ outcome }: { outcome: string }) {
  return (
    <Pill tone={outcome === "GRANTED" ? "green" : "warn"}>
      {outcome === "GRANTED" ? "GRANTED" : "DENIED"}
    </Pill>
  );
}

/**
 * The banner family. `tone` maps to the mock's four boxes: warn = the gate banner, gold = the
 * roster banner and the consent-denied state (C2), green = the audit-confirm, navy = the
 * append-only banner. Denial is GOLD, never terra — see C2: a school that has not granted consent
 * has done nothing wrong, and a red error box would say otherwise.
 */
export function Banner({
  tone,
  glyph,
  title,
  children,
  action,
}: {
  tone: "warn" | "gold" | "green" | "navy";
  glyph: string;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const tones = {
    warn: "border-warn bg-warn-bg/60",
    gold: "border-gold-soft bg-gold-bg",
    green: "border-green bg-green-bg",
    navy: "border-navy-deep bg-navy-deep text-bg",
  } as const;
  const glyphTones = {
    warn: "bg-warn text-bg",
    gold: "bg-gold text-bg",
    green: "bg-green text-bg",
    navy: "bg-gold text-navy-deep",
  } as const;
  return (
    <div className={cn("flex gap-4 rounded-[14px] border-[1.5px] p-5", tones[tone])}>
      <span
        aria-hidden
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sm font-semibold",
          glyphTones[tone],
        )}
      >
        {glyph}
      </span>
      <div className="min-w-0 flex-1">
        <h3
          className={cn(
            "font-display text-base",
            tone === "navy" ? "text-bg" : "text-navy",
          )}
        >
          {title}
        </h3>
        {children ? (
          <div
            className={cn("mt-1 text-sm", tone === "navy" ? "text-bg/80" : "text-navy-2")}
          >
            {children}
          </div>
        ) : null}
        {action ? <div className="mt-3">{action}</div> : null}
      </div>
    </div>
  );
}

/**
 * A record field. `withheld` renders Lucy C7's `.rec-field.redacted` — greyed, italic, LABEL STILL
 * VISIBLE, value exactly "Withheld — not released for this reason". The label stays because the
 * officer should see what more exists; the value is absent because it was never fetched.
 */
export function RecField({
  label,
  value,
  withheld,
  unavailable,
}: {
  label: string;
  value?: ReactNode;
  withheld?: boolean;
  unavailable?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-border-1 p-3",
        withheld ? "bg-bg" : "bg-surface",
      )}
    >
      <div className="text-[10px] uppercase tracking-wide text-navy-3">{label}</div>
      {withheld ? (
        <div className="mt-1 text-sm italic text-navy-3">
          Withheld — not released for this reason
        </div>
      ) : unavailable ? (
        <div className="mt-1 text-sm italic text-navy-3">
          No operational source — Omnischools does not record this
        </div>
      ) : (
        <div className="mt-1 break-words text-sm text-navy">{value ?? "—"}</div>
      )}
    </div>
  );
}

/** The gold `⊘` scope line under the fields grid (Lucy §A1.2 / C7). */
export function ScopeLine({ children }: { children: ReactNode }) {
  return (
    <p className="mt-4 flex items-start gap-2 text-xs text-navy-2">
      <span aria-hidden className="text-gold">
        ⊘
      </span>
      <span>{children}</span>
    </p>
  );
}

/** The neutral provenance row every Oversight surface ends with. */
export function Provenance({ items }: { items: [string, string][] }) {
  return (
    <dl className="mt-6 grid gap-3 border-t border-border-1 pt-4 text-xs text-navy-3 sm:grid-cols-3">
      {items.map(([term, detail]) => (
        <div key={term}>
          <dt className="font-semibold text-navy-2">{term}</dt>
          <dd className="mt-0.5">{detail}</dd>
        </div>
      ))}
    </dl>
  );
}
