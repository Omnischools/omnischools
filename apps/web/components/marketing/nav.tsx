import Link from "next/link";
import { Brand } from "./brand";

const LINKS = [
  { href: "/#features", label: "Features" },
  { href: "/about", label: "About" },
  { href: "/pricing", label: "Pricing" },
  { href: "/contact", label: "Book a demo" },
  { href: "/faq", label: "FAQ" },
];

export function MarketingNav() {
  return (
    <nav className="bg-bg/90 sticky top-0 z-[100] border-b border-border backdrop-blur-md">
      <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-8 px-6 py-[18px] md:px-8">
        <Brand />
        <div className="hidden gap-[30px] text-sm font-medium text-navy-2 md:flex">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="transition-colors hover:text-gold"
            >
              {l.label}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-2.5">
          <Link
            href="/login"
            className="hidden rounded-md px-5 py-2.5 text-sm font-semibold text-navy-2 transition-colors hover:bg-gold-bg hover:text-navy sm:inline-flex"
          >
            Log in
          </Link>
          <Link
            href="/start"
            className="text-bg rounded-md bg-navy px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-navy-deep"
          >
            Sign up
          </Link>
        </div>
      </div>
    </nav>
  );
}
