"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  VLC_DASHBOARD_READ_ROLES,
  VLC_PARAGRAPH_READ_ROLES,
  hasAnyRole,
} from "@/lib/access";

/**
 * The in-page VLC sub-nav (Lucy INCR-41 §1.2): a module-level secondary tab row shared by the VLC surfaces,
 * rendered by the VLC nested layout above every VLC page. NOT a sidebar section and NOT a second top-level item.
 *
 * 🔴 INCR-44 — the tab row is ROLE-CONDITIONAL because the VLC audiences differ: a static row would give an FM
 * a dead "Dashboard" link (FM is not in VLC_DASHBOARD_READ_ROLES → the page redirects him) and an ADMIN a dead
 * "Reference" link (ADMIN is not in VLC_PARAGRAPH_READ_ROLES → the roster notFounds him). So the Dashboard tab
 * renders only for VLC_DASHBOARD_READ_ROLES (Dean/HM/ADMIN) and the Reference (leaver-roster) tab only for
 * VLC_PARAGRAPH_READ_ROLES (FM/Dean/HM); the Setup/Peer-Guides/Sessions config tabs render for everyone the
 * layout already admitted (VLC_CONFIG_READ_ROLES). No role gets a tab whose target 404s/redirects them.
 */
const CONFIG_TABS = [
  { href: "/senior/vlc/setup", label: "Setup" },
  { href: "/senior/vlc/peer-guides", label: "Peer Guides" },
  { href: "/senior/vlc/sessions", label: "Sessions" },
] as const;

export function VlcTabs({ roles }: { roles: readonly string[] }) {
  const pathname = usePathname();
  // The confidential per-student drill-ins — the 43a journal (/senior/vlc/journal/<id>) and the 43b
  // per-student character reference (/senior/vlc/reference/<id>) — are reached from a callout / roster row, not
  // a VLC section; no tab represents either, so hide the section row there (Dex INCR-43a LOW, extended for 43b).
  // NB: the INCR-44 leaver ROSTER index (/senior/vlc/reference, no trailing id) keeps the row — the guard below
  // matches only the trailing-slash per-student route.
  if (
    pathname.startsWith("/senior/vlc/journal/") ||
    pathname.startsWith("/senior/vlc/reference/")
  ) {
    return null;
  }

  const tabs = [
    ...(hasAnyRole(roles, VLC_DASHBOARD_READ_ROLES)
      ? [{ href: "/senior/vlc/dashboard", label: "Dashboard" }]
      : []),
    ...CONFIG_TABS,
    ...(hasAnyRole(roles, VLC_PARAGRAPH_READ_ROLES)
      ? [{ href: "/senior/vlc/reference", label: "Leavers" }]
      : []),
  ];

  return (
    <nav className="mb-6 flex gap-1 border-b border-border" aria-label="VLC sections">
      {tabs.map((t) => {
        const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px border-b-2 px-3.5 py-2.5 text-[13px] font-semibold transition-colors ${
              active
                ? "border-gold text-navy"
                : "border-transparent text-navy-3 hover:text-navy"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
