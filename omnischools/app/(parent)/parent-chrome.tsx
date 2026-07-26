import Link from "next/link";
import { avatarInitials, initialSurname } from "@/lib/wassce/parent-copy";

/**
 * The shared parent-portal chrome (SHS module 4.3) — header + flat six-tab nav, extracted from the
 * wassce page so the tab-flip lives in ONE place (INCR-29 R234: activate the inert "Sickbay" tab as a
 * live link). One child, resolved from the session (never a URL param); labels verbatim; NO faked
 * unread dot (R234). Only WASSCE and Sickbay are live routes today; the other four stay inert spans.
 */

export function ParentHeader({
  schoolName,
  childName,
  guardianDisplay,
  relation,
}: {
  schoolName: string;
  childName: string | null;
  guardianDisplay: string;
  relation: string;
}) {
  return (
    <header className="flex items-center gap-3.5 border-b border-border bg-surface px-7 py-[18px]">
      <div className="flex flex-1 items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-gold font-display text-sm font-semibold text-navy">
          {schoolName.trim()[0]?.toUpperCase() ?? "S"}
        </div>
        <div>
          <div className="font-display text-[15px] font-medium text-navy">{schoolName}</div>
          <div className="text-[11px] text-navy-3">
            Parent portal{childName ? ` · ${childName}` : ""}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2.5">
        <div className="text-right">
          <div className="text-xs font-semibold text-navy">{initialSurname(guardianDisplay)}</div>
          <div className="text-[10px] text-navy-3">{relation}</div>
        </div>
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-navy font-display text-[13px] font-semibold text-gold">
          {avatarInitials(guardianDisplay)}
        </div>
      </div>
    </header>
  );
}

/** The tab whose route is built today. WASSCE + Sickbay are live links; the rest stay inert. */
export type ParentTab = "WASSCE" | "Sickbay";

const TABS = ["WASSCE", "Sickbay", "Communications", "Billing", "Boarding", "School calendar"] as const;
const HREF: Partial<Record<(typeof TABS)[number], string>> = { WASSCE: "/wassce", Sickbay: "/sickbay" };

/**
 * Six flat tabs; `active` is the current one. A non-active tab with a route becomes a real <Link>; the
 * four unbuilt tabs remain inert spans. NO unread dot — it would be faked with no open-episode source
 * on this render path (R234).
 */
export function ParentNav({ active }: { active: ParentTab }) {
  return (
    <nav className="flex gap-0 overflow-x-auto border-b border-border bg-surface px-7">
      {TABS.map((t) => {
        const isActive = t === active;
        const cls = isActive
          ? "whitespace-nowrap border-b-2 border-gold px-4 py-3.5 text-[13px] font-semibold text-navy"
          : "whitespace-nowrap border-b-2 border-transparent px-4 py-3.5 text-[13px] font-medium text-navy-3";
        const href = HREF[t];
        return href && !isActive ? (
          <Link key={t} href={href} className={cls}>
            {t}
          </Link>
        ) : (
          <span key={t} className={cls} aria-current={isActive ? "page" : undefined}>
            {t}
          </span>
        );
      })}
    </nav>
  );
}
