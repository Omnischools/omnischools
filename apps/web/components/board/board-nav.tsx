"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * The read-only board shell's nav. The board group has exactly two surfaces — the Overview dashboard
 * and Account — and no sidebar, so without this there is no link back to the overview from Account.
 * Both hrefs stay inside `/board*` (requireBoard's path confinement); never a link out to staff surfaces.
 */
const ITEMS = [
  { href: "/board", label: "Overview" },
  { href: "/board/account", label: "Account" },
];

export function BoardNav() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1 print:hidden">
      {ITEMS.map(({ href, label }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors",
              active
                ? "bg-gold/15 text-navy"
                : "text-navy-3 hover:bg-bg hover:text-navy",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
