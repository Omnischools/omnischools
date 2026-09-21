import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The Oversight app shell (Lucy §0): a fixed 230px deep-navy rail beside the main column, a white
 * page-head over the `bg-bg` body.
 *
 * The deep navy is meaningful, not decorative — it is the visual signal of "you are inside the
 * audited, named tier", shared by the sidebar, the record head and the append-only banner. Keep it
 * wherever those appear together.
 *
 * NOTE on the nav: there is deliberately NO "Data-sharing agreements" item. That label survives in
 * the two audited mocks but the DSA concept was removed (§5.5); E3 consent is narrow — the
 * individual drill-down of non-GES staff — and is not a surface of its own here.
 */
const NAV = [
  { group: "Overview", items: [{ href: "/", label: "Dashboard" }] },
  {
    group: "Records & audit",
    items: [
      { href: "/compliance-records", label: "Compliance records" },
      { href: "/compliance-records/new", label: "Request a named record" },
    ],
  },
] as const;

export function Shell({
  officerName,
  officerRole,
  jurisdictionName,
  children,
}: {
  officerName: string;
  officerRole: string;
  jurisdictionName: string;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-[230px_1fr]">
      <aside className="hidden flex-col justify-between bg-navy-deep p-5 text-bg md:flex">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded bg-gold px-1.5 py-0.5 font-mono text-[10px] font-bold text-navy-deep">
              GES
            </span>
            <div className="leading-tight">
              <div className="font-display text-sm">Omnischools Oversight</div>
              <div className="text-bg/60 text-[10px]">{jurisdictionName}</div>
            </div>
          </div>

          <div className="border-gold-soft/40 bg-gold/10 text-bg/80 mt-5 rounded-md border px-3 py-2 text-[11px]">
            <div className="text-[9px] uppercase tracking-wide text-gold">
              Your jurisdiction
            </div>
            <div className="mt-0.5">{jurisdictionName}</div>
          </div>

          <nav className="mt-6 space-y-5">
            {NAV.map((section) => (
              <div key={section.group}>
                <div className="text-bg/40 text-[9px] uppercase tracking-[0.14em]">
                  {section.group}
                </div>
                <ul className="mt-2 space-y-1">
                  {section.items.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className="text-bg/80 hover:bg-bg/10 block rounded px-2 py-1 text-xs"
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className="text-bg/60 text-[10px]">
          <div className="text-xs text-bg">{officerName}</div>
          <div>{officerRole}</div>
          <div className="mt-3">
            Powered by <span className="accent-italic">Omnischools</span>
          </div>
        </div>
      </aside>

      <div className="min-h-screen bg-bg">{children}</div>
    </div>
  );
}

export function PageHead({
  crumb,
  title,
  lede,
  actions,
}: {
  crumb: string;
  title: ReactNode;
  lede: string;
  actions?: ReactNode;
}) {
  return (
    <header className="border-b border-border-1 bg-surface px-9 py-7">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gold">
        {crumb}
      </p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl text-navy md:text-3xl">{title}</h1>
          <p className="mt-2 max-w-prose text-sm text-navy-2">{lede}</p>
        </div>
        {actions ? <div className="flex gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

export function PageBody({ children }: { children: ReactNode }) {
  return <main className="space-y-6 px-9 py-7">{children}</main>;
}
