import Link from "next/link";
import { avatarInitials, initialSurname } from "@/lib/wassce/parent-copy";

/**
 * The shared parent-portal chrome (SHS module 4.3) — header + flat nav, extracted from the wassce page so
 * the tab set lives in ONE place. One child, resolved from the session (never a URL param); labels
 * verbatim; NO faked unread dot (R234). INCR-278: the nav is now EVERY tab a live route — WASSCE, Sickbay,
 * PTA, School calendar — with NO inert "coming soon" spans (R234 honest-absence: a disabled tab is a faked
 * affordance). Communications / Billing / Boarding return here each behind its own increment when it ships
 * (Billing needs a safe scoped projection — invoice deliberately stays parent_deny, R476 tuition-leak).
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
      {/* INCR-34 (L2a) — the guardian block links to the account page (change password). */}
      <Link
        href="/account"
        title="Account & password"
        className="-mr-1.5 flex items-center gap-2.5 rounded-md px-1.5 py-1 transition-colors hover:bg-bg"
      >
        <div className="text-right">
          <div className="text-xs font-semibold text-navy">{initialSurname(guardianDisplay)}</div>
          <div className="text-[10px] text-navy-3">{relation}</div>
        </div>
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-navy font-display text-[13px] font-semibold text-gold">
          {avatarInitials(guardianDisplay)}
        </div>
      </Link>
    </header>
  );
}

/** Every tab is a live route today. */
export type ParentTab = "WASSCE" | "Attendance" | "Sickbay" | "PTA" | "School calendar";

// INCR-278 → +Attendance — flat tabs, ALL live routes (the inert Communications / Billing / Boarding spans
// are gone; each returns behind its own increment). Attendance sits second — the most-checked daily fact
// ("is my child in school?"). Every entry below has an HREF.
const TABS = ["WASSCE", "Attendance", "Sickbay", "PTA", "School calendar"] as const;
const HREF: Record<(typeof TABS)[number], string> = {
  WASSCE: "/wassce",
  // URL is /attendance-summary (the /attendance path is the STAFF marking route — parent routes share the
  // (app) route namespace, so the parent tab needs a unique segment); the tab LABEL stays "Attendance".
  Attendance: "/attendance-summary",
  Sickbay: "/sickbay",
  PTA: "/pta",
  "School calendar": "/calendar",
};

/**
 * The flat parent nav; `active` is the current one. Every non-active tab is a real <Link> (all four are live
 * routes — no inert spans, R234). NO unread dot — it would be faked with no open-episode source (R234).
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
        // HREF is total → every tab has a route; the ONLY <span> is the active tab (no inert spans, R234).
        return !isActive ? (
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
