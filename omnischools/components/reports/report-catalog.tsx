"use client";
import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export type ReportCard = {
  category: "finance" | "academic" | "operational";
  href?: string;
  icon: string;
  iconTone: string;
  name: string;
  desc: string;
  featured?: boolean;
  comingSoon?: boolean;
  snapshotLabel: string;
  snapshotValue: string;
  snapshotTone?: string;
  snapshotSub: string;
};

const TABS: { key: ReportCard["category"]; label: string }[] = [
  { key: "finance", label: "Finance" },
  { key: "academic", label: "Academic" },
  { key: "operational", label: "Operational" },
];

export function ReportCatalog({ cards }: { cards: ReportCard[] }) {
  const [tab, setTab] = useState<ReportCard["category"]>("finance");
  const count = (k: ReportCard["category"]) => cards.filter((c) => c.category === k).length;
  const shown = cards.filter((c) => c.category === tab);

  return (
    <div>
      {/* Category tabs */}
      <div className="mb-5 flex flex-wrap gap-5 border-b border-border">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "flex items-center gap-1.5 border-b-2 pb-2.5 text-sm font-semibold transition-colors",
                active
                  ? "border-gold text-navy"
                  : "border-transparent text-navy-3 hover:text-navy",
              )}
            >
              {t.label}
              <span
                className={cn(
                  "rounded-pill px-1.5 py-0.5 text-[10px] font-bold",
                  active ? "bg-gold-bg text-gold" : "bg-bg text-navy-3",
                )}
              >
                {count(t.key)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Card grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((c) => (
          <ReportCardView key={c.name} card={c} />
        ))}
      </div>
    </div>
  );
}

function ReportCardView({ card: c }: { card: ReportCard }) {
  const body = (
    <>
      {c.featured && (
        <span className="absolute right-4 top-4 rounded-pill bg-gold px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-navy">
          Most used
        </span>
      )}
      {c.comingSoon && (
        <span className="absolute right-4 top-4 rounded-pill border border-border-2 bg-bg px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-navy-3">
          MVP2
        </span>
      )}
      <div
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-lg font-display text-lg font-bold",
          c.iconTone,
        )}
      >
        {c.icon}
      </div>
      <h3 className="mt-3 font-display text-[17px] font-semibold text-navy">{c.name}</h3>
      <p className="mt-1 text-xs leading-relaxed text-navy-3">{c.desc}</p>
      <div className="mt-3 border-t border-dashed border-border-2 pt-3">
        <div className="text-[9px] font-bold uppercase tracking-[0.1em] text-navy-3">
          {c.snapshotLabel}
        </div>
        <div className={cn("mt-0.5 font-display text-xl font-semibold", c.snapshotTone ?? "text-navy")}>
          {c.snapshotValue}
        </div>
        <div className="mt-0.5 text-[10px] text-navy-3">{c.snapshotSub}</div>
      </div>
    </>
  );

  const base = "relative block rounded-xl border p-5";
  if (c.comingSoon || !c.href) {
    return <div className={cn(base, "border-border bg-surface opacity-60")}>{body}</div>;
  }
  return (
    <Link
      href={c.href}
      className={cn(
        base,
        "transition-shadow hover:shadow-md",
        c.featured ? "border-gold-soft bg-gold-bg/40" : "border-border bg-surface",
      )}
    >
      {body}
    </Link>
  );
}
