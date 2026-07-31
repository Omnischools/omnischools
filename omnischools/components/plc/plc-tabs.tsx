"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The in-page PLC sub-nav (Setup · Sessions), mirroring the VLC tabs idiom (components/vlc/vlc-tabs).
 * Rendered by the PLC nested layout above every /senior/plc page. Both tabs share the same read gate
 * (isStaff, R368), so — unlike the role-conditional VLC row — the tabs are static.
 *
 * NB (flag at PR): the shipped sidebar row "Teacher development" points at /senior/plc/setup; this adds a
 * second navigational surface (the tab row). The alternative was a second flat sidebar row for Sessions.
 * The tab row mirrors VLC exactly (Setup/Sessions are two faces of one module), so it is the consistent
 * placement — but the sub-nav-vs-sidebar call is Lucy's to confirm.
 */
const TABS = [
  { href: "/senior/plc/setup", label: "Setup" },
  { href: "/senior/plc/sessions", label: "Sessions" },
] as const;

export function PlcTabs() {
  const pathname = usePathname();
  return (
    <nav className="mb-6 flex gap-1 border-b border-border" aria-label="PLC sections">
      {TABS.map((t) => {
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
