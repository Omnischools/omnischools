"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS: { href: string; label: string; soon?: boolean }[] = [
  { href: "/books", label: "Dashboard" },
  { href: "/books/income", label: "Income" },
  { href: "/books/expenses", label: "Expenses" },
  { href: "/books/reports", label: "Financial reports" },
  { href: "/books/assets", label: "Fixed assets" },
  { href: "/books/settings", label: "Settings" },
];

export function BooksTabs() {
  const pathname = usePathname();
  return (
    <div className="mb-6 flex flex-wrap gap-1.5 border-b border-border pb-3">
      {TABS.map((t) => {
        const active = pathname === t.href;
        if (t.soon) {
          return (
            <span
              key={t.href}
              className="cursor-default rounded-md px-3 py-1.5 text-sm font-semibold text-navy-3/50"
              title="Coming soon"
            >
              {t.label}
              <span className="ml-1 rounded-full bg-bg px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-navy-3">
                soon
              </span>
            </span>
          );
        }
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-semibold transition-colors",
              active ? "bg-navy text-bg" : "text-navy-2 hover:bg-bg",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
