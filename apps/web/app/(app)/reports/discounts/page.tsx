import { requireSchool } from "@/lib/auth/server";
import { ghs } from "@/lib/reports/finance-data";
import { getDiscountsReport } from "@/lib/reports/discounts-data";
import { ExportCsv } from "@/components/reports/export-csv";
import { PrintButton } from "@/components/reports/print-button";
import { ReportHeader } from "@/components/reports/report-header";
import {
  DiscountApplicationsTable,
  type DiscountAppRow,
} from "@/components/reports/discount-applications-table";
import { PeriodBar } from "@/components/reports/period-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { resolvePeriod, weeksIn } from "@/lib/reports/period";
import { getReportTerm } from "@/lib/reports/report-term";
import { schoolFile } from "@/lib/filename";

export const dynamic = "force-dynamic";
export const metadata = { title: "Discounts given" };

/** colorKey → solid token bg class, used for tier-breakdown bars, swatches & timeline segments. */
const FILL_CLASS: Record<string, string> = {
  gold: "bg-gold",
  green: "bg-green",
  warn: "bg-warn",
  terra: "bg-terra",
  "navy-3": "bg-navy-3",
};
const ICON_CLASS: Record<string, string> = {
  gold: "bg-gold-bg text-gold",
  green: "bg-green-bg text-green",
  warn: "bg-warn-bg text-warn",
  terra: "bg-terra-bg text-terra",
  "navy-3": "bg-bg text-navy-2",
};

const kLabel = (n: number) =>
  n >= 1000
    ? `${(n / 1000).toLocaleString("en-GH", { maximumFractionDigits: n % 1000 === 0 ? 0 : 1 })}k`
    : String(Math.round(n));

export default async function DiscountsPage(
  props: {
    searchParams: Promise<{ period?: string; from?: string; to?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const { school } = await requireSchool();
  const term = await getReportTerm(school.id);
  const period = resolvePeriod(searchParams, term, new Date());
  const r = await getDiscountsReport(school.id, { start: period.start, end: period.end });

  const tableRows: DiscountAppRow[] = r.rows;

  return (
    <div className="mx-auto max-w-page">
      <ReportHeader
        crumb="Discounts given"
        pre="Discounts"
        gold="given"
        lede="The fees you chose not to collect — by scheme and by recipient."
        actions={
          <>
            {r.rows.length > 0 && (
              <ExportCsv
                filename={schoolFile(school.name, "discounts.csv")}
                headers={["Student", "Class", "Scheme", "Amount", "Applied"]}
                rows={r.rows.map((d) => [
                  d.studentName,
                  d.className,
                  d.schemeName,
                  d.amount.toFixed(2),
                  d.appliedLabel,
                ])}
              />
            )}
            <PrintButton label="Export PDF" />
          </>
        }
      />

      {/* Period bar */}
      <PeriodBar
        activeKey={period.key}
        termLabel={term ? `${term.label} · ${term.academicYear}` : null}
        termWeeks={term ? weeksIn(term.start, term.end) : null}
        from={period.from}
        to={period.to}
      />

      {r.applicationCount === 0 ? (
        <EmptyState tone="muted">
          No discount applications recorded yet. Discounts are attributed to a scheme from issuance
          onward — issue an invoice and pick a discount scheme (or apply a sibling/bursary discount)
          to populate this report. Historical freeform discounts aren&rsquo;t attributed.
        </EmptyState>
      ) : (
        <>
          {/* KPI strip */}
          <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div className="rounded-xl border border-navy bg-navy p-5">
              <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-gold-soft">
                Total discounted this term
              </div>
              <div className="mt-1.5 font-display text-2xl font-semibold text-bg">
                {ghs(r.totalDiscounted)}
              </div>
              <div className="mt-0.5 text-xs text-gold-soft">
                <span className="mr-1 text-green">↑</span>
                {r.discountPctOfBilled}% of total billed
              </div>
            </div>

            <Kpi
              label="Active applications"
              value={String(r.applicationCount)}
              sub={`${r.studentCount} students · ${r.stackedStudentCount} stack 2+ schemes`}
            />
            <Kpi
              label="Most-used scheme"
              value={r.mostUsedScheme?.name ?? "—"}
              valueSmall
              sub={
                r.mostUsedScheme
                  ? `${r.mostUsedScheme.applicationCount} applications · ${r.mostUsedScheme.sharePct}% of total`
                  : "no applications yet"
              }
            />
            {period.key === "term" ? (
              <Kpi
                label="New this term"
                value={String(r.newThisTerm)}
                sub={r.newBreakdown || (r.hasTerm ? "none in the term window" : "no term set")}
              />
            ) : (
              <Kpi
                label="Schemes in use"
                value={String(r.schemesInUse)}
                sub={`across this ${period.key === "custom" ? "range" : period.key}`}
              />
            )}
          </div>

          {/* Tier breakdown */}
          {r.byScheme.length === 0 ? (
            <EmptyState tone="muted">No schemes have applications yet.</EmptyState>
          ) : (
            <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {r.byScheme.map((s) => (
                <div key={s.discountId} className="rounded-xl border border-border bg-surface p-5">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${ICON_CLASS[s.colorKey] ?? "bg-bg text-navy-2"}`}
                    >
                      {s.name.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="truncate text-sm font-semibold text-navy">{s.name}</div>
                  </div>
                  <div className="mt-3 font-display text-xl font-semibold text-navy">{ghs(s.amount)}</div>
                  <div className="mt-0.5 text-xs text-navy-3">
                    <b className="text-navy-2">{s.applicationCount} applications</b> · {s.studentCount} students
                  </div>
                  <div className="mt-4">
                    <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.08em] text-navy-3">
                      <span>Share of discounts</span>
                      <span className="text-navy-2">{s.sharePct}%</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-bg">
                      <div
                        className={`h-full rounded-full ${FILL_CLASS[s.colorKey] ?? "bg-navy-3"}`}
                        style={{ width: `${Math.min(100, s.sharePct)}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Two-column body: timeline + top recipients */}
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <section className="rounded-xl border border-border bg-surface p-5">
              <div className="mb-4">
                <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-navy-3">
                  Application timeline
                </div>
                <h3 className="mt-0.5 font-display text-lg font-semibold text-navy">
                  When discounts got applied
                </h3>
              </div>
              <Timeline timeline={r.timeline} />
            </section>

            <section className="rounded-xl border border-border bg-surface p-5">
              <div className="mb-4">
                <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-navy-3">
                  Top recipients
                </div>
                <h3 className="mt-0.5 font-display text-lg font-semibold text-navy">Largest amounts</h3>
              </div>
              {r.topRecipients.length === 0 ? (
                <EmptyState tone="muted">No recipients yet.</EmptyState>
              ) : (
                <div className="space-y-1">
                  {r.topRecipients.map((t, i) => (
                    <div key={`${t.studentName}-${i}`} className="flex items-center gap-3 py-2">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-bg font-mono text-xs font-semibold text-navy-3">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-navy">{t.studentName}</div>
                        <div className="truncate text-xs text-navy-3">
                          {t.className} · {t.schemes.join(" + ")}
                        </div>
                      </div>
                      <span className="shrink-0 font-mono text-sm font-semibold text-navy-2">
                        {ghs(t.total)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* Active applications */}
          <section className="mt-8">
            <div className="mb-3">
              <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-navy-3">
                Active applications
              </div>
              <h3 className="mt-0.5 font-display text-lg font-semibold text-navy">
                Every discount in effect this term
              </h3>
            </div>
            <DiscountApplicationsTable rows={tableRows} schemes={r.schemeColor} />
          </section>
        </>
      )}
    </div>
  );
}

function Timeline({ timeline }: { timeline: DiscountsTimeline }) {
  const { weeks, schemes, yMax } = timeline;
  const lines = [1, 0.75, 0.5, 0.25].map((f) => ({ pct: f * 100, label: kLabel(yMax * f) }));
  const hasData = weeks.some((w) => Object.keys(w.segments).length > 0);

  return (
    <div>
      <div className="relative ml-10 flex h-56 items-end gap-1.5">
        {lines.map((l) => (
          <div
            key={l.pct}
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-border"
            style={{ bottom: `${l.pct}%` }}
          >
            <span className="absolute -left-10 -top-2 w-9 text-right font-mono text-[10px] text-navy-3">
              {l.label}
            </span>
          </div>
        ))}
        {weeks.map((w, wi) => (
          <div key={`${w.label}-${wi}`} className="group flex h-full flex-1 flex-col justify-end">
            <div className="flex w-full max-w-[28px] flex-col-reverse self-center">
              {schemes.map((s) => {
                const amt = w.segments[s.discountId] ?? 0;
                if (amt <= 0) return null;
                const h = (amt / yMax) * 224; // plot height = h-56 = 14rem = 224px
                return (
                  <div
                    key={s.discountId}
                    className={`${FILL_CLASS[s.colorKey] ?? "bg-navy-3"} opacity-80`}
                    style={{ height: `${Math.max(2, h)}px` }}
                    title={`${s.name} · ${w.label}: ${ghs(amt)}`}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="ml-10 flex gap-1.5">
        {weeks.map((w, wi) => (
          <span key={`${w.label}-x-${wi}`} className="flex-1 text-center font-mono text-[10px] text-navy-3">
            {w.label}
          </span>
        ))}
      </div>

      {!hasData && (
        <p className="mt-3 text-center text-xs italic text-navy-3">
          No applications dated within this period yet.
        </p>
      )}

      {/* Legend */}
      {schemes.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-border pt-3">
          {schemes.map((s) => (
            <div key={s.discountId} className="flex items-center gap-1.5 text-xs text-navy-2">
              <span className={`h-3 w-3 rounded-sm ${FILL_CLASS[s.colorKey] ?? "bg-navy-3"}`} />
              <b className="font-medium text-navy">{s.name}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type DiscountsTimeline = {
  weeks: { label: string; segments: Record<string, number> }[];
  schemes: { discountId: string; name: string; colorKey: string }[];
  yMax: number;
};

function Kpi({
  label,
  value,
  sub,
  valueSmall,
}: {
  label: string;
  value: string;
  sub: string;
  valueSmall?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-navy-3">{label}</div>
      <div
        className={`mt-1.5 truncate font-display font-semibold text-navy ${valueSmall ? "text-lg" : "text-2xl"}`}
      >
        {value}
      </div>
      <div className="mt-0.5 text-xs text-navy-3">{sub}</div>
    </div>
  );
}
