"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  GraduationCap,
  BookOpen,
  UserPlus,
  Banknote,
  ReceiptText,
  BarChart3,
  Wallet,
  CalendarCheck,
  ClipboardList,
  Megaphone,
  MessageSquare,
  Settings,
  NotebookText,
  Gauge,
  BedDouble,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  isFinanceOnly,
  hasAnyRole,
  SENIOR_LEDGER_ROLES,
  SENIOR_MANAGEMENT_ROLES,
  BOARDING_ROLES,
} from "@/lib/access";

const NAV: { href: string; label: string; Icon: LucideIcon }[] = [
  { href: "/dashboard", label: "Dashboard", Icon: LayoutDashboard },
  { href: "/staff", label: "Staff", Icon: Users },
  { href: "/students", label: "Students", Icon: GraduationCap },
  { href: "/classes", label: "Classes", Icon: BookOpen },
  { href: "/admissions", label: "Admissions", Icon: UserPlus },
  { href: "/fees", label: "Fees", Icon: Banknote },
  { href: "/billing", label: "Billing", Icon: ReceiptText },
  { href: "/reports", label: "Reports", Icon: BarChart3 },
  { href: "/books", label: "Books", Icon: Wallet },
  { href: "/attendance", label: "Attendance", Icon: CalendarCheck },
  { href: "/gradebook", label: "Gradebook", Icon: ClipboardList },
  { href: "/communication", label: "Communication", Icon: Megaphone },
  { href: "/inbox", label: "Inbox", Icon: MessageSquare },
  { href: "/settings", label: "Settings", Icon: Settings },
];

const TIER: Record<string, string> = {
  BASIC: "Basic",
  SENIOR: "Senior",
  COMBINED: "Combined",
};

/** Senior (SHS) tier only — inserted after Gradebook. The teacher's score ledger and the
 * Vice Headmaster's completion view. */
const SENIOR_ITEMS = [
  {
    href: "/senior/score-ledger",
    label: "Score ledger",
    Icon: NotebookText,
    roles: SENIOR_LEDGER_ROLES,
  },
  {
    href: "/senior/academic-progress",
    label: "Ledger progress",
    Icon: Gauge,
    roles: SENIOR_MANAGEMENT_ROLES,
  },
  {
    href: "/senior/boarding",
    label: "Boarding",
    Icon: BedDouble,
    roles: BOARDING_ROLES,
  },
];

/** Finance-only (Accountant/Bursar) nav — billing first, then read-only students/classes. */
const FINANCE_NAV_ORDER = ["/billing", "/fees", "/reports", "/books", "/students", "/classes"];

/** First letters of the first two words, uppercased (e.g. "Christ King" → "CK"). */
function initials(s: string | null | undefined, fallback = "—"): string {
  const parts = (s ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

function titleCase(s: string): string {
  return s
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function AppSidebar({
  school,
  user,
}: {
  school: {
    name: string;
    shortName: string | null;
    schoolType: string;
    location: string | null;
  };
  user: { name: string | null; roles: string[] };
}) {
  const pathname = usePathname();
  const tierLoc = [TIER[school.schoolType] ?? school.schoolType, school.location]
    .filter(Boolean)
    .join(" · ");
  // Senior (SHS) and Combined schools get the Score ledger item after Gradebook.
  const isSenior =
    school.schoolType === "SENIOR" || school.schoolType === "COMBINED";
  // Senior items are further gated by role — a teacher sees the ledger but not the
  // management progress view; a student/parent sees neither.
  const seniorItems = SENIOR_ITEMS.filter((i) => hasAnyRole(user.roles, i.roles));
  const fullNav = isSenior
    ? NAV.flatMap((n) =>
        n.href === "/gradebook"
          ? [n, ...seniorItems.map(({ href, label, Icon }) => ({ href, label, Icon }))]
          : [n],
      )
    : NAV;
  // Finance-only staff see a billing-focused nav; everyone else sees the full set.
  const nav = isFinanceOnly(user.roles)
    ? FINANCE_NAV_ORDER.map((href) => NAV.find((n) => n.href === href)).filter(
        (n): n is (typeof NAV)[number] => !!n,
      )
    : fullNav;
  const roleLabel = user.roles[0] ? titleCase(user.roles[0]) : "";

  return (
    <aside className="hidden w-60 shrink-0 flex-col bg-navy text-bg md:flex print:hidden">
      {/* School block */}
      <div className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gold font-display text-sm font-semibold text-navy">
          {initials(school.shortName ?? school.name)}
        </span>
        <div className="min-w-0">
          <div className="truncate font-display text-sm font-medium text-bg">
            {school.name}
          </div>
          <div className="truncate text-[10px] uppercase tracking-wider text-gold-soft">
            {tierLoc}
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
        {nav.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-md border-l-2 py-2 pl-3 pr-3 text-sm font-medium transition-colors",
                active
                  ? "bg-gold/10 border-gold text-bg"
                  : "text-bg/70 border-transparent hover:bg-white/5 hover:text-bg",
              )}
            >
              <Icon
                className="h-[18px] w-[18px] shrink-0"
                strokeWidth={active ? 2.2 : 1.8}
              />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* User block */}
      <div className="flex items-center gap-2.5 border-t border-white/10 px-4 py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gold font-display text-xs font-semibold text-navy">
          {initials(user.name)}
        </span>
        <div className="min-w-0">
          <div className="truncate font-display text-xs font-semibold text-bg">
            {user.name ?? "—"}
          </div>
          <div className="truncate text-[10px] text-gold-soft">{roleLabel}</div>
        </div>
      </div>

      {/* On Omnischools */}
      <div className="border-t border-white/5 px-4 py-3">
        <span className="text-gold/60 text-[9px] font-bold uppercase tracking-[0.18em]">
          ON <span className="text-gold/90">OMNISCHOOLS</span>
        </span>
      </div>
    </aside>
  );
}
