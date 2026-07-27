"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The in-page VLC sub-nav (Lucy INCR-41 §1.2): a module-level secondary tab row shared by the two VLC
 * surfaces, so the single flat "Student support" sidebar item stays one slot while Setup and Peer Guides
 * live under it. Rendered by the VLC nested layout above every VLC page. NOT a sidebar section and NOT a
 * second top-level item.
 */
const TABS = [
  { href: "/senior/vlc/setup", label: "Setup" },
  { href: "/senior/vlc/peer-guides", label: "Peer Guides" },
] as const;

export function VlcTabs() {
  const pathname = usePathname();
  return (
    <nav className="mb-6 flex gap-1 border-b border-border" aria-label="VLC sections">
      {TABS.map((t) => {
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
