"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: "D" },
  { href: "/staff", label: "Staff", icon: "P" },
  { href: "/students", label: "Students", icon: "S" },
  { href: "/classes", label: "Classes", icon: "L" },
  { href: "/admissions", label: "Admissions", icon: "A" },
  { href: "/fees", label: "Fees", icon: "F" },
  { href: "/billing", label: "Billing", icon: "B" },
  { href: "/reports", label: "Reports", icon: "R" },
  { href: "/attendance", label: "Attendance", icon: "T" },
  { href: "/gradebook", label: "Gradebook", icon: "G" },
  { href: "/communication", label: "Communication", icon: "C" },
  { href: "/inbox", label: "Inbox", icon: "I" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];

// Roadmap items (later phases) — shown disabled to convey the shape.
const SOON: { label: string; icon: string }[] = [];

export function AppSidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface md:flex">
      <div className="flex items-center gap-2.5 px-5 py-[18px]">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-navy font-display text-[15px] font-semibold italic text-gold-soft">
          O
        </span>
        <span className="font-display text-lg font-semibold text-navy">Omnischools</span>
      </div>
      <nav className="flex-1 space-y-0.5 px-3 py-2">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active ? "bg-gold-bg text-navy" : "text-navy-2 hover:bg-bg",
              )}
            >
              <span
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded font-display text-xs italic",
                  active ? "bg-navy text-gold-soft" : "bg-bg text-navy-3",
                )}
              >
                {item.icon}
              </span>
              {item.label}
            </Link>
          );
        })}
        {SOON.length > 0 && (
          <>
            <div className="px-3 pb-1 pt-5 text-[10px] font-semibold uppercase tracking-[0.12em] text-navy-3">
              Coming soon
            </div>
            {SOON.map((item) => (
              <span
                key={item.label}
                className="text-navy-3/60 flex cursor-not-allowed items-center gap-3 rounded-md px-3 py-2 text-sm font-medium"
              >
                <span className="text-navy-3/60 flex h-6 w-6 items-center justify-center rounded bg-bg font-display text-xs italic">
                  {item.icon}
                </span>
                {item.label}
              </span>
            ))}
          </>
        )}
      </nav>
    </aside>
  );
}
