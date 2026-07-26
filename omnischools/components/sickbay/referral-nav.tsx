import Link from "next/link";

/**
 * The referrals module's in-page nav (SHS module 4.4 / INCR-27) — Active · History · Reconciliation.
 * A section is a TAB the reader is entitled to: the 30-day history is clinical-gated and the NHIS
 * reconciliation is finance-gated, so each page passes the visibility it computed from the actor's
 * roles — a HEADMASTER never sees a Reconciliation tab that would redirect them, and a BURSAR never
 * sees a History tab that names conditions.
 */
export function ReferralNav({
  active,
  showHistory,
  showReconciliation,
}: {
  active: "active" | "history" | "reconciliation";
  showHistory: boolean;
  showReconciliation: boolean;
}) {
  const tabs: { key: "active" | "history" | "reconciliation"; label: string; href: string }[] = [
    { key: "active", label: "Active", href: "/senior/sickbay/referrals" },
    ...(showHistory
      ? [{ key: "history" as const, label: "30-day history", href: "/senior/sickbay/referrals/history" }]
      : []),
    ...(showReconciliation
      ? [
          {
            key: "reconciliation" as const,
            label: "NHIS reconciliation",
            href: "/senior/sickbay/referrals/reconciliation",
          },
        ]
      : []),
  ];
  return (
    <div className="mb-5 flex flex-wrap gap-2 border-b border-border pb-3">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={`rounded-[5px] px-[12px] py-[6px] text-[12px] font-semibold no-underline ${
            t.key === active ? "bg-navy text-bg" : "border border-border-2 bg-surface text-navy-2"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
