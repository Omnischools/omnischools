"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The in-page PLC sub-nav (Setup · Sessions · My CPD · CPD dashboard), mirroring the VLC tabs idiom
 * (components/vlc/vlc-tabs). Rendered by the PLC nested layout above every /senior/plc page.
 *
 * Setup / Sessions / My CPD share the shared read gate (isStaff, R368 / own-identity), so they always
 * render. The CPD dashboard tab is management-only — the layout computes `canSeeDashboard`
 * (hasAnyRole(roles, PLC_DASHBOARD_READ_ROLES), R405) and this component renders that tab ONLY when true.
 * The tab visibility is a convenience; the real boundary is the /dashboard route's own redirect gate.
 */
const BASE_TABS = [
  { href: "/senior/plc/setup", label: "Setup" },
  { href: "/senior/plc/sessions", label: "Sessions" },
  { href: "/senior/plc/my-cpd", label: "My CPD" },
] as const;

const DASHBOARD_TAB = { href: "/senior/plc/dashboard", label: "CPD dashboard" } as const;

export function PlcTabs({ canSeeDashboard = false }: { canSeeDashboard?: boolean }) {
  const pathname = usePathname();
  const tabs = canSeeDashboard ? [...BASE_TABS, DASHBOARD_TAB] : BASE_TABS;
  return (
    <nav className="mb-6 flex gap-1 border-b border-border" aria-label="PLC sections">
      {tabs.map((t) => {
        const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px border-b-2 px-3.5 py-2.5 text-[13px] font-semibold transition-colors ${
              active ? "border-gold text-navy" : "border-transparent text-navy-3 hover:text-navy"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
