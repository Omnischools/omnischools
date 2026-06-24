import { BackLink } from "@/components/ui/back-link";

/**
 * Shared detail-route header: a back link to the Reports hub (matching the
 * app-wide "← Label" convention), a crumb, a display title with a gold-italic
 * word, and optional actions.
 */
export function ReportHeader({
  crumb,
  pre,
  gold,
  lede,
  actions,
}: {
  crumb: string;
  pre: string;
  gold: string;
  lede?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <BackLink href="/reports" label="Reports" className="mb-2" />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-navy-3 print:hidden">{crumb}</div>
          <h1 className="mt-1 font-display text-3xl font-semibold text-navy">
            {pre} <em className="text-gold">{gold}</em>
          </h1>
          {lede && <p className="mt-0.5 max-w-2xl text-sm text-navy-3">{lede}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 print:hidden">{actions}</div>}
      </div>
    </div>
  );
}
