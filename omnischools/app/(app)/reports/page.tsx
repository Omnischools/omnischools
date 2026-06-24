import { requireSchool } from "@/lib/auth/server";
import { getFinanceReport, ghs } from "@/lib/reports/finance-data";
import { ReportCatalog, type ReportCard } from "@/components/reports/report-catalog";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const { school } = await requireSchool();
  const r = await getFinanceReport(school.id, null);

  const cards: ReportCard[] = [
    {
      category: "finance",
      href: "/reports/term-collection",
      icon: "$",
      iconTone: "bg-gold-bg text-gold",
      name: "Term collection summary",
      desc: "How much you've collected this term, by method and by class.",
      featured: true,
      snapshotLabel: "Collected to date",
      snapshotValue: ghs(r.collected),
      snapshotTone: "text-green",
      snapshotSub: `${r.rate}% of ${ghs(r.billed)} billed`,
    },
    {
      category: "finance",
      href: "/reports/outstanding",
      icon: "!",
      iconTone: "bg-terra-bg text-terra",
      name: "Outstanding balances",
      desc: "Who hasn't paid, grouped by aging bucket. Send reminders directly.",
      snapshotLabel: "Currently outstanding",
      snapshotValue: ghs(r.outstanding),
      snapshotTone: "text-terra",
      snapshotSub: `${r.overdue30PlusCount} student${r.overdue30PlusCount === 1 ? "" : "s"} overdue 30+ days`,
    },
    {
      category: "finance",
      href: "/reports/discounts",
      icon: "%",
      iconTone: "bg-green-bg text-green",
      name: "Discounts given",
      desc: "Total discount value applied this term, broken down by tier.",
      snapshotLabel: "Discounts applied",
      snapshotValue: ghs(r.discountTotal),
      snapshotSub: `${r.discountedCount} invoice${r.discountedCount === 1 ? "" : "s"} discounted`,
    },
    {
      category: "finance",
      href: "/reports/finance/collection-trend",
      icon: "↗",
      iconTone: "bg-navy text-gold",
      name: "Collection trend",
      desc: "Term-on-term collection rates and timing patterns.",
      snapshotLabel: "Collection rate",
      snapshotValue: `${r.rate}%`,
      snapshotSub: "across the period to date",
    },
    {
      category: "finance",
      href: "/reports/voids-refunds",
      icon: "×",
      iconTone: "bg-terra-bg text-terra",
      name: "Voids & refunds",
      desc: "Reversed transactions this term with reasons summarised.",
      snapshotLabel: "Reversed",
      snapshotValue: r.voidTotal > 0 ? `−${ghs(r.voidTotal)}` : ghs(0),
      snapshotTone: r.voidTotal > 0 ? "text-terra" : "text-navy",
      snapshotSub: `${r.voids.length} event${r.voids.length === 1 ? "" : "s"}`,
    },
    {
      category: "academic",
      icon: "A",
      iconTone: "bg-bg text-navy-3",
      name: "Class performance",
      desc: "Average grades by class, with term-on-term comparison.",
      comingSoon: true,
      snapshotLabel: "Academic data needed",
      snapshotValue: "Available in MVP2",
      snapshotSub: "Once gradebook has 2+ terms of data",
    },
    {
      category: "academic",
      icon: "B",
      iconTone: "bg-bg text-navy-3",
      name: "Subject performance",
      desc: "Per-subject averages across the school on the 1–9 scale.",
      comingSoon: true,
      snapshotLabel: "Academic data needed",
      snapshotValue: "Available in MVP2",
      snapshotSub: "Needs a full term of graded entries",
    },
    {
      category: "operational",
      icon: "S",
      iconTone: "bg-bg text-navy-3",
      name: "School statistics",
      desc: "Headcount, class composition, gender split and enrolment flow.",
      comingSoon: true,
      snapshotLabel: "Coming soon",
      snapshotValue: "In build",
      snapshotSub: "Headcount & composition rollups",
    },
    {
      category: "operational",
      icon: "@",
      iconTone: "bg-bg text-navy-3",
      name: "Attendance summary",
      desc: "Term attendance rates by class and the students needing attention.",
      comingSoon: true,
      snapshotLabel: "Coming soon",
      snapshotValue: "Available in MVP2",
      snapshotSub: "Rolls up the attendance module",
    },
    {
      category: "operational",
      icon: "E",
      iconTone: "bg-bg text-navy-3",
      name: "Enrolment & roll",
      desc: "Admissions, withdrawals and transfers over the term.",
      comingSoon: true,
      snapshotLabel: "Coming soon",
      snapshotValue: "Available in MVP2",
      snapshotSub: "Term-window enrolment deltas",
    },
  ];

  return (
    <div className="mx-auto max-w-page">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">
        Omnischools · Reports
      </div>
      <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold text-navy">
            Answers, not <em className="text-gold">spreadsheets</em>
          </h1>
          <div className="mb-3 mt-2 h-0.5 w-16 bg-gold" />
          <p className="max-w-2xl text-sm text-navy-3">
            Each report answers a specific question. Open any card for the detail; export to CSV
            or PDF for filing.
          </p>
        </div>
        <span
          title="Coming soon — scheduled report delivery"
          className="cursor-default rounded-md border border-border-2 bg-bg px-3 py-2 text-sm font-semibold text-navy-3 opacity-60"
        >
          Export all (zip)
        </span>
      </div>

      <div className="mt-6">
        <ReportCatalog cards={cards} />
      </div>
    </div>
  );
}
