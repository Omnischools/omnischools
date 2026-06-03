import Link from "next/link";
import { Brand } from "./brand";

const COLS = [
  {
    title: "Product",
    links: [
      { href: "/#features", label: "Features" },
      { href: "/pricing", label: "Pricing" },
      { href: "/contact", label: "Book a demo" },
      { href: "/start", label: "Sign up" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/about", label: "About" },
      { href: "/contact", label: "Contact" },
    ],
  },
  {
    title: "Legal & trust",
    links: [
      { href: "/legal/privacy", label: "Privacy policy" },
      { href: "/legal/data-protection", label: "Data protection" },
      { href: "/legal/terms", label: "Terms of service" },
    ],
  },
];

export function MarketingFooter() {
  return (
    <footer className="bg-navy-deep px-6 pb-8 pt-[72px] text-gold-soft md:px-8">
      <div className="mx-auto max-w-[1280px]">
        <div className="mb-14 grid grid-cols-1 gap-12 sm:grid-cols-2 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div>
            <div className="mb-3.5">
              <Brand variant="dark" />
            </div>
            <p className="max-w-[320px] text-sm leading-relaxed text-gold-soft">
              The school management system built in Ghana, for Ghanaian schools. KG
              through SHS, plus GES Oversight.
            </p>
          </div>
          {COLS.map((col) => (
            <div key={col.title}>
              <h4 className="mb-[18px] font-body text-[11px] font-bold uppercase tracking-[0.14em] text-gold">
                {col.title}
              </h4>
              <ul className="space-y-1.5">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link
                      href={l.href}
                      className="hover:text-bg text-sm text-gold-soft transition-colors"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="border-gold-soft/15 text-gold-soft/80 flex flex-col items-center justify-between gap-2.5 border-t pt-7 text-center text-[12.5px] sm:flex-row sm:text-left">
          <div>© 2026 Omnischools. Built in Ghana.</div>
          <div>hello@omnischools.gh · +233 (0) 30 000 0000</div>
        </div>
      </div>
    </footer>
  );
}
