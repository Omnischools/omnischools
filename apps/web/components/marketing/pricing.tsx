import Link from "next/link";
import { cn } from "@/lib/utils";

const PLANS = [
  {
    name: "Basic",
    desc: "For KG, Primary & JHS schools — the operational core.",
    price: "GHS 10",
    note: "per student / per term",
    featured: false,
    cta: { label: "Start free trial", href: "/start?type=BASIC" },
    features: [
      "Admissions & student records",
      "Fees & mobile money reconciliation",
      "Attendance & timetable",
      "Gradebook & report cards",
      "Parent communication (SMS & WhatsApp)",
      "Books & financial reports",
      "Up to 1,500 students",
    ],
  },
  {
    name: "Senior",
    desc: "Everything in Basic, plus the modules that make an SHS run.",
    price: "GHS 20",
    note: "per student / per semester",
    featured: true,
    tag: "For SHS",
    cta: { label: "Start free trial", href: "/start?type=SENIOR" },
    features: [
      "Everything in Basic",
      "Boarding house management",
      "WASSCE cohort & readiness tracking",
      "Mock exams & predictor analytics",
      "PTA structure & dues collection",
      "Sickbay & health records",
      "Staff CPD points ledger",
      "No student cap",
    ],
  },
  {
    name: "Oversight",
    desc: "For GES districts, regions & the Ministry — multi-school visibility.",
    price: "Custom",
    note: "deployed in partnership with GES",
    featured: false,
    cta: { label: "Contact us →", href: "/contact" },
    features: [
      "District, regional & national dashboards",
      "Enrolment-vs-population analysis",
      "BECE/WASSCE performance tracking",
      "Cross-jurisdiction comparison",
      "Anomaly & investigation queue",
      "Audit-logged compliance access",
      "Data-sharing agreement management",
      "Dedicated GES onboarding",
    ],
  },
];

export function Pricing({ withHeading = true }: { withHeading?: boolean }) {
  return (
    <section id="pricing" className="bg-surface border-t border-border">
      <div className="mx-auto max-w-[1280px] px-6 py-24 md:px-8">
        {withHeading && (
          <div className="mx-auto mb-16 max-w-[640px] text-center">
            <div className="mb-[18px] inline-block text-[11px] font-bold uppercase tracking-[0.18em] text-gold">
              Pricing
            </div>
            <h2 className="mb-4 font-display text-[clamp(32px,4vw,46px)] font-semibold leading-tight text-navy">
              Priced for{" "}
              <em className="not-italic text-gold [font-style:italic]">real schools</em>,
              not enterprise budgets.
            </h2>
            <p className="text-[17px] text-navy-2">
              Per academic period — three terms a year for Basic, two semesters for Senior
              (the GES standard). Billed once at the start of each period. No setup fees,
              no per-user minimums, cancel any time.
            </p>
          </div>
        )}
        <div className="mx-auto grid max-w-[1100px] grid-cols-1 gap-6 md:grid-cols-3">
          {PLANS.map((p) => (
            <div
              key={p.name}
              className={cn(
                "relative flex flex-col rounded-2xl border p-9",
                p.featured
                  ? "border-navy bg-navy text-gold-soft md:scale-[1.02]"
                  : "bg-bg border-border",
              )}
            >
              {p.tag && (
                <span className="absolute -top-3 right-6 rounded-pill bg-gold px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-navy">
                  {p.tag}
                </span>
              )}
              <h3
                className={cn(
                  "mb-1.5 font-display text-[22px] font-semibold",
                  p.featured ? "text-bg" : "text-navy",
                )}
              >
                {p.name}
              </h3>
              <p
                className={cn(
                  "mb-7 min-h-[38px] text-[13px]",
                  p.featured ? "text-gold-soft" : "text-navy-3",
                )}
              >
                {p.desc}
              </p>
              <div
                className={cn(
                  "font-display text-[42px] font-semibold leading-none",
                  p.featured ? "text-bg" : "text-navy",
                )}
              >
                {p.price.startsWith("GHS") ? (
                  <em className="not-italic text-gold [font-style:italic]">{p.price}</em>
                ) : (
                  p.price
                )}
              </div>
              <div
                className={cn(
                  "mb-7 mt-1.5 text-[13px] font-medium",
                  p.featured ? "text-gold-soft" : "text-navy-3",
                )}
              >
                {p.note}
              </div>
              <ul className="mb-8 flex-1 space-y-0">
                {p.features.map((f) => (
                  <li
                    key={f}
                    className={cn(
                      "relative py-2 pl-6 text-sm leading-snug",
                      p.featured ? "text-gold-soft" : "text-navy-2",
                    )}
                  >
                    <span className="absolute left-0 font-bold text-gold">✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href={p.cta.href}
                className={cn(
                  "inline-flex w-full items-center justify-center rounded-md px-5 py-3 text-sm font-semibold transition-colors",
                  p.featured
                    ? "bg-gold text-navy hover:brightness-95"
                    : "border-border-2 hover:bg-surface border text-navy",
                )}
              >
                {p.cta.label}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
