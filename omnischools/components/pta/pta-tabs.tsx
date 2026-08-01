"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The in-page PTA sub-nav (Setup · Officers), mirroring the PLC tabs idiom (components/plc/plc-tabs).
 * Rendered by the PTA nested layout above every /senior/pta page. BOTH tabs are admin-only (the whole
 * PTA surface is PTA_CONFIG_WRITE_ROLES — read == manage); the layout redirects anyone who fails, so
 * the tabs never render for a non-admin. The single flat sidebar "PTA" entry still points at Setup.
 */
const TABS = [
  { href: "/senior/pta/setup", label: "Setup" },
  { href: "/senior/pta/officers", label: "Officers" },
] as const;

export function PtaTabs() {
  const pathname = usePathname();
  return (
    <nav className="mb-6 flex gap-1 border-b border-border" aria-label="PTA sections">
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
