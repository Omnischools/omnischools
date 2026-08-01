"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The in-page PTA sub-nav, mirroring the PLC tabs idiom (components/plc/plc-tabs).
 *
 * 🔴 INCR-52: the Meetings tab is ALL-STAFF (the meeting-register writer is the Secretary — often a
 * non-admin Form Master), while Setup + Officers stay ADMIN-ONLY (config = PTA_CONFIG_WRITE_ROLES,
 * read == manage). The layout computes `canManage` (hasAnyRole(roles, PTA_CONFIG_WRITE_ROLES)) and this
 * component renders the admin tabs ONLY when true — like the PLC dashboard tab. Tab visibility is a
 * convenience; the real boundary is each page's own gate (Setup/Officers redirect, meetings via the
 * per-meeting server-loaded write gate).
 */
const MEETINGS_TAB = { href: "/senior/pta/meetings", label: "Meetings" } as const;
const DUES_TAB = { href: "/senior/pta/dues", label: "Dues" } as const;
const ADMIN_TABS = [
  { href: "/senior/pta/setup", label: "Setup" },
  { href: "/senior/pta/officers", label: "Officers" },
] as const;

export function PtaTabs({
  canManage = false,
  canViewDues = false,
}: {
  canManage?: boolean;
  canViewDues?: boolean;
}) {
  const pathname = usePathname();
  // Dues (INCR-54a): visible to management OR a Treasurer of any PTA (the layout computes canViewDues).
  const tabs = [
    MEETINGS_TAB,
    ...(canViewDues ? [DUES_TAB] : []),
    ...(canManage ? ADMIN_TABS : []),
  ];
  return (
    <nav className="mb-6 flex gap-1 border-b border-border" aria-label="PTA sections">
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
