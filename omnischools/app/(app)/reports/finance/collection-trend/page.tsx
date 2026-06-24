import Link from "next/link";
import { requireSchool } from "@/lib/auth/server";
import { ghs } from "@/lib/reports/finance-data";
import { getCollectionTrend } from "@/lib/reports/collection-trend-data";
import { CumulativeOverlay } from "@/components/reports/cumulative-overlay";
import { ExportCsv } from "@/components/reports/export-csv";
import { PrintButton } from "@/components/reports/print-button";
import { ReportHeader } from "@/components/reports/report-header";
import { schoolFile } from "@/lib/filename";

export const dynamic = "force-dynamic";
export const metadata = { title: "Collection trend" };

const fmtDate = (d: Date | null) =>
  d
    ? d.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      })
    : "—";

/** "1 invoice" / "3 invoices" — naive English pluralisation for count labels. */
const plur = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export default async function CollectionTrendPage() {
  const { school } = await requireSchool();
  const r = await getCollectionTrend(school.id);
  const cur = r.currentTerm;
  const prior = r.priorTerm;
  const wk = r.currentWeekIndex;

  return (
    <div className="mx-auto max-w-page">
      <ReportHeader
        crumb="Finance / Collection trend"
        pre="Collection"
        gold="trend"
        lede="Collection velocity and pace — this term against last."
        actions={
          <>
            <ExportCsv
              filename={schoolFile(school.name, "collection-trend.csv")}
              headers={[
                "Week",
                "Dates",
                "Collected",
                "Payments",
                "Students",
                "Last term",
                "Delta %",
              ]}
              rows={r.weeklyRows.map((w) => [
                String(w.week),
                `${w.startLabel}–${w.endLabel}`,
                w.amount.toFixed(2),
                String(w.paymentsCount),
                String(w.studentsCount),
                w.priorAmount == null ? "" : w.priorAmount.toFixed(2),
                w.deltaPct == null ? "" : String(w.deltaPct),
              ])}
            />
            <PrintButton label="Export PDF" />
          </>
        }
      />

      {/* Term pills */}
      <div className="mb-6 flex flex-wrap gap-1.5">
        {prior && (
          <TermPill label={prior.label} year={prior.academicYear} state="prior" />
        )}
        {cur && (
          <TermPill label={cur.label} year={cur.academicYear} state="current" active />
        )}
        {!cur && (
          <span className="text-sm text-navy-3">No academic terms configured yet.</span>
        )}
      </div>

      {/* ============ REGION 01 — WHERE WE ARE ============ */}
      <Region
        num="01"
        pre="Where we"
        gold="are"
        meta={cur ? `${r.householdsOutstanding} households outstanding` : undefined}
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {/* Hero */}
          <div className="col-span-2 flex flex-col gap-1.5 rounded-xl border border-navy bg-navy p-5 lg:col-span-1">
            <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-gold-soft">
              Collected · {cur?.label ?? "this term"} to date
            </div>
            <div className="mt-0.5 font-display text-[36px] font-semibold leading-none text-gold">
              <span className="mr-1 text-sm font-medium text-gold-soft">GHS</span>
              {r.currentCollected.toLocaleString("en-GH", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </div>
            <div className="text-[11px] text-gold-soft">
              <b className="font-semibold text-bg">{r.currentRate}%</b> of {ghs(r.currentBilled)} invoiced
            </div>
            {/* pace bar */}
            <div className="mt-1.5">
              <div className="mb-1 flex items-baseline justify-between font-mono text-[10px] font-semibold text-gold-soft">
                <span>0%</span>
                <span className="text-bg">now: {r.currentRate}%</span>
                <span>100%</span>
              </div>
              <div className="relative h-1.5 rounded-pill bg-white/10">
                <div
                  className="h-full rounded-pill bg-gold"
                  style={{ width: `${Math.min(100, r.currentRate)}%` }}
                />
                {r.hasPrior && (
                  <div
                    className="absolute -top-0.5 h-2.5 w-0.5 bg-white/70"
                    style={{ left: `${Math.min(100, r.priorRateAtSameWeek)}%` }}
                    title="expected pace"
                  />
                )}
              </div>
            </div>
          </div>

          {/* Velocity */}
          {r.hasPrior ? (
            <div className="flex flex-col gap-1.5 rounded-xl border border-gold-soft bg-gold-bg p-5">
              <span
                className={`self-start rounded-pill px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-white ${
                  r.gapCedis >= 0 ? "bg-green" : "bg-terra"
                }`}
              >
                {Math.abs(Math.round(r.gapPoints))}% {r.gapCedis >= 0 ? "ahead" : "behind"}
              </span>
              <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-navy-3">
                vs {prior?.label} at week {wk}
              </div>
              <div
                className={`font-display text-[32px] font-semibold italic leading-none ${
                  r.gapCedis >= 0 ? "text-green" : "text-terra"
                }`}
              >
                {r.gapCedis >= 0 ? "+" : "−"}
                <em className="not-italic">{ghs(Math.abs(r.gapCedis))}</em>
              </div>
              <div className="text-[11px] text-navy-3">
                Last term we&apos;d collected{" "}
                <b className="font-semibold text-navy-2">{r.priorRateAtSameWeek}%</b> by this point
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface p-5">
              <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-navy-3">
                Term-on-term
              </div>
              <div className="font-display text-2xl font-semibold leading-tight text-navy-3">
                No prior term to compare
              </div>
              <div className="text-[11px] text-navy-3">
                Velocity vs last term appears once a previous term has data.
              </div>
            </div>
          )}

          {/* Avg weekly */}
          <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface p-5">
            <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-navy-3">
              Avg weekly · last 3 wks
            </div>
            <div className="mt-0.5 font-display text-[32px] font-semibold leading-none text-navy">
              <span className="mr-1 text-sm font-medium text-navy-3">GHS</span>
              {Math.round(r.avgWeeklyLast3).toLocaleString("en-GH")}
            </div>
            <div className="text-[11px] text-navy-3">
              {r.avgWeeklyLast3 >= r.avgWeeklyFirst3 ? "up" : "down"} from{" "}
              <b className="font-semibold text-navy-2">
                GHS {Math.round(r.avgWeeklyFirst3).toLocaleString("en-GH")}
              </b>{" "}
              in wks 1-3
            </div>
          </div>

          {/* Outstanding */}
          <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface p-5">
            <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-navy-3">
              Still outstanding
            </div>
            <div className="mt-0.5 font-display text-[32px] font-semibold leading-none text-terra">
              <span className="mr-1 text-sm font-medium text-navy-3">GHS</span>
              {r.outstandingTotal.toLocaleString("en-GH", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </div>
            <div className="text-[11px] text-navy-3">
              <b className="font-semibold text-navy-2">{plur(r.aging.totalInvoices, "invoice")}</b>{" "}
              from {plur(r.householdsOutstanding, "household")}
            </div>
          </div>
        </div>
      </Region>

      {/* ============ REGION 02 — CUMULATIVE OVERLAY ============ */}
      <Region
        num="02"
        pre="Cumulative"
        gold="collection"
        post=" · this term vs last"
        meta="Weekly cumulative · GHS thousands"
      >
        {!r.hasPeriods || !cur ? (
          <Empty>
            Configure academic terms (Settings → Term &amp; calendar) to see term-on-term trends.
          </Empty>
        ) : (
          <div className="rounded-xl border border-border bg-surface p-6">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="mb-1 text-[9px] font-bold uppercase tracking-[0.16em] text-navy-3">
                  {cur.label} {cur.academicYear}
                  {prior ? ` vs ${prior.label} ${prior.academicYear}` : ""}
                </div>
                <div className="font-display text-lg font-semibold text-navy">
                  Cumulative <em className="not-italic text-gold">collection</em> curve
                </div>
              </div>
              <div className="flex items-center gap-4 text-[11px] text-navy-2">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-[3px] w-5 rounded-sm bg-gold" />
                  <b className="font-semibold text-navy">This term</b>
                </span>
                {r.hasPrior && (
                  <>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-[3px] w-5 rounded-sm bg-navy-3" />
                      Last term
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-0 w-5 border-t-2 border-dashed border-navy-3" />
                      Expected pace
                    </span>
                  </>
                )}
              </div>
            </div>

            <CumulativeOverlay
              current={r.cumulative.current}
              prior={r.cumulative.prior}
              totalWeeks={r.cumulative.totalWeeks}
              currentWeekIndex={r.cumulative.currentWeekIndex}
              yMax={r.cumulative.yMax}
              currentLabel={`today · ${r.currentRate}%`}
              priorLabel={prior ? `last term wk ${wk}` : undefined}
            />

            {/* chart foot */}
            <div
              className={`mt-4 grid gap-3 border-t border-border pt-4 ${
                r.hasPrior ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-1"
              }`}
            >
              {r.hasPrior && (
                <FootCell
                  label={`${prior?.label} final · last yr`}
                  value={ghs(r.priorFinal)}
                  meta={`${r.priorFinalRate}% of invoiced`}
                />
              )}
              <FootCell
                label={`At wk ${wk} · this term`}
                value={ghs(r.currentCollected)}
                meta={`${r.currentRate}% of invoiced`}
              />
              {r.hasPrior && (
                <FootCell
                  label={`At wk ${wk} · last term`}
                  value={ghs(r.priorCollectedAtSameWeek)}
                  meta={`${r.priorRateAtSameWeek}% of invoiced`}
                  tone="green"
                />
              )}
              {r.hasPrior && (
                <FootCell
                  label="Gap to last term"
                  value={`${r.gapCedis < 0 ? "−" : "+"}${ghs(Math.abs(r.gapCedis))}`}
                  meta={`${r.gapPoints} percentage points`}
                  tone="terra"
                />
              )}
            </div>
          </div>
        )}
      </Region>

      {/* ============ REGION 03 — WEEK BY WEEK ============ */}
      <Region
        num="03"
        pre="Week by"
        gold="week"
        meta="Each week's collection vs same week last term"
      >
        {r.weeklyRows.length === 0 ? (
          <Empty>No weekly collection yet for this term.</Empty>
        ) : (
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 lg:grid-cols-5">
            {r.weeklyRows.map((w) => {
              const isCurrent = w.week === wk;
              return (
                <div
                  key={w.week}
                  className={`relative rounded-[10px] border p-3.5 ${
                    isCurrent
                      ? "border-gold bg-gradient-to-b from-gold-bg to-surface"
                      : "border-border bg-surface"
                  }`}
                >
                  <div className="mb-px font-display text-[11px] font-semibold text-navy">
                    Week <em className="not-italic font-medium text-gold">{w.week}</em>
                    {isCurrent ? " · this wk" : ""}
                  </div>
                  <div className="mb-2.5 font-mono text-[9px] font-semibold text-navy-3">
                    {w.startLabel}–{w.endLabel}
                  </div>
                  <div className="font-display text-[17px] font-semibold leading-none text-navy">
                    <span className="mr-0.5 text-[10px] font-medium text-navy-3">GHS</span>
                    {Math.round(w.amount).toLocaleString("en-GH")}
                  </div>
                  <div className="mt-1 text-[10px] text-navy-3">
                    <b className="font-semibold text-navy-2">{plur(w.paymentsCount, "payment")}</b> ·{" "}
                    {plur(w.studentsCount, "student")}
                  </div>
                  <div className="mt-2 flex h-[3px] overflow-hidden rounded-pill bg-bg">
                    <div
                      className="rounded-pill bg-gold"
                      style={{ width: `${Math.min(100, (w.amount / r.maxWeekly) * 100)}%` }}
                    />
                  </div>
                  {r.hasPrior && w.priorAmount != null && (
                    <div className="mt-2 flex items-baseline justify-between border-t border-border pt-2 text-[10px]">
                      <span className="text-navy-3">
                        Last yr · GHS {Math.round(w.priorAmount).toLocaleString("en-GH")}
                      </span>
                      <DeltaTag deltaPct={w.deltaPct} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Region>

      {/* ============ REGION 04 — BY CLASS ============ */}
      <Region num="04" pre="By" gold="class" meta="Which year groups are leading or lagging">
        {r.byClass.length === 0 ? (
          <Empty>No invoiced classes yet for this term.</Empty>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <div className="flex items-center justify-between border-b border-border bg-bg px-5 py-3.5 text-[11px] italic text-navy-3">
              <span>
                {r.byClass.length} classes · sorted by outstanding (highest first)
              </span>
            </div>
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-bg text-left text-[10px] uppercase tracking-wide text-navy-3">
                <tr>
                  <th className="px-5 py-3 font-semibold">Class</th>
                  <th className="px-5 py-3 font-semibold">Collection rate</th>
                  <th className="px-5 py-3 text-right font-semibold">Billed</th>
                  <th className="px-5 py-3 text-right font-semibold">Collected</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {r.byClass.map((c) => {
                  const tone =
                    c.rate >= 70 ? "bg-green" : c.rate >= 50 ? "bg-warn" : "bg-terra";
                  const pctTone =
                    c.rate >= 70 ? "text-green" : c.rate >= 50 ? "text-gold" : "text-terra";
                  return (
                    <tr key={c.classId ?? c.className} className="hover:bg-bg">
                      <td className="px-5 py-3.5 font-display font-semibold text-navy">
                        {c.className}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="relative h-2.5 w-40 overflow-hidden rounded-pill bg-bg">
                            <div
                              className={`h-full rounded-pill ${tone}`}
                              style={{ width: `${Math.max(4, Math.min(100, c.rate))}%` }}
                            />
                          </div>
                          <span className={`font-display text-sm font-semibold ${pctTone}`}>
                            {c.rate}%
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-right font-mono text-xs font-semibold text-navy">
                        {ghs(c.billed)}
                      </td>
                      <td className="px-5 py-3.5 text-right font-mono text-xs font-semibold text-green">
                        {ghs(c.collected)}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        {c.classId && (
                          <Link
                            href={`/reports/class/${c.classId}`}
                            className="text-xs font-semibold text-gold hover:underline"
                          >
                            View →
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Region>

      {/* ============ REGION 05 — AGING ============ */}
      <Region num="05" pre="Age of" gold="outstanding" post=" balances" meta="How old is the unpaid amount">
        {r.aging.totalOutstanding <= 0 ? (
          <Empty>Nothing outstanding — every invoice is settled.</Empty>
        ) : (
          <AgingCard aging={r.aging} />
        )}
      </Region>
    </div>
  );
}

/* ---------------------------------------------------------------- helpers */

function Region({
  num,
  pre,
  gold,
  post,
  meta,
  children,
}: {
  num: string;
  pre: string;
  gold: string;
  post?: string;
  meta?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-9">
      <div className="mb-3.5 flex items-baseline gap-3">
        <div className="font-display text-lg font-medium italic text-gold">{num}</div>
        <h2 className="font-display text-lg font-semibold text-navy">
          {pre} <em className="font-normal not-italic text-gold">{gold}</em>
          {post ?? ""}
        </h2>
        {meta && (
          <div className="ml-auto text-[11px] font-semibold text-navy-3">{meta}</div>
        )}
      </div>
      {children}
    </div>
  );
}

function TermPill({
  label,
  year,
  state,
  active,
}: {
  label: string;
  year: string;
  state: string;
  active?: boolean;
}) {
  return (
    <div
      className={`inline-flex items-center rounded-pill border px-3 py-1.5 font-display text-xs font-semibold ${
        active ? "border-navy bg-navy text-bg" : "border-border bg-bg text-navy-3"
      }`}
    >
      {label} <em className="ml-1 italic text-gold">{year}</em>
      <span
        className={`ml-1.5 text-[9px] font-bold uppercase tracking-[0.1em] ${
          active ? "text-gold-soft" : "text-navy-3"
        }`}
      >
        {state}
      </span>
    </div>
  );
}

function FootCell({
  label,
  value,
  meta,
  tone,
}: {
  label: string;
  value: string;
  meta: string;
  tone?: "green" | "terra";
}) {
  const toneClass = tone === "green" ? "text-green" : tone === "terra" ? "text-terra" : "text-navy";
  return (
    <div>
      <div className="mb-1 text-[9px] font-bold uppercase tracking-[0.12em] text-navy-3">
        {label}
      </div>
      <div className={`font-display text-base font-semibold ${toneClass}`}>{value}</div>
      <div className="mt-0.5 text-[10px] text-navy-3">{meta}</div>
    </div>
  );
}

function DeltaTag({ deltaPct }: { deltaPct: number | null }) {
  if (deltaPct == null) {
    return <span className="text-[10px] font-bold tracking-[0.04em] text-navy-3">— flat</span>;
  }
  if (Math.abs(deltaPct) < 1) {
    return <span className="text-[10px] font-bold tracking-[0.04em] text-navy-3">— flat</span>;
  }
  const up = deltaPct > 0;
  return (
    <span
      className={`text-[10px] font-bold tracking-[0.04em] ${up ? "text-green" : "text-terra"}`}
    >
      {up ? "↑" : "↓"} {Math.abs(Math.round(deltaPct))}%
    </span>
  );
}

function AgingCard({
  aging,
}: {
  aging: {
    buckets: {
      key: string;
      label: string;
      amount: number;
      invoiceCount: number;
      householdCount: number;
      pct: number;
    }[];
    totalOutstanding: number;
    totalInvoices: number;
    totalHouseholds: number;
    oldestIssuedAt: Date | null;
    oldestAgeDays: number;
    avgAgeDays: number;
  };
}) {
  const maxBucket = Math.max(1, ...aging.buckets.map((b) => b.amount));
  const bucketColor: Record<string, string> = {
    b1: "bg-green",
    b2: "bg-gold",
    b3: "bg-warn",
    b4: "bg-terra",
  };
  // range head split: "1—30 days" → number in gold em
  const rangeParts: Record<string, [string, string, string]> = {
    b1: ["1—", "30", " days"],
    b2: ["31—", "60", " days"],
    b3: ["61—", "90", " days"],
    b4: ["90+ ", "days", ""],
  };

  const dominant = aging.buckets.reduce((a, b) => (b.amount > a.amount ? b : a), aging.buckets[0]);

  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      {/* headline */}
      <div className="mb-5 grid grid-cols-1 items-end gap-5 border-b border-border pb-4 sm:grid-cols-[1fr_auto]">
        <div>
          <div className="mb-1 text-[9px] font-bold uppercase tracking-[0.16em] text-navy-3">
            Total outstanding · {aging.totalHouseholds} households
          </div>
          <div className="font-display text-[32px] font-semibold leading-none text-terra">
            <span className="mr-1 text-sm font-medium text-navy-3">GHS</span>
            {aging.totalOutstanding.toLocaleString("en-GH", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </div>
          <div className="mt-1 text-xs text-navy-3">
            {plur(aging.totalInvoices, "invoice")} · oldest invoice issued{" "}
            <b className="font-semibold text-navy-2">{fmtDate(aging.oldestIssuedAt)}</b> ·{" "}
            {aging.oldestAgeDays} days ago
          </div>
        </div>
        <div className="text-right">
          <div className="mb-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-navy-3">
            Avg age
          </div>
          <div className="font-display text-base font-semibold text-navy">
            {aging.avgAgeDays} days
          </div>
        </div>
      </div>

      {/* bars */}
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        {aging.buckets.map((b) => {
          const heightPct = b.amount > 0 ? Math.max(4, (b.amount / maxBucket) * 100) : 0;
          const [p1, p2, p3] = rangeParts[b.key] ?? ["", b.label, ""];
          const insideTone = b.key === "b2" ? "text-navy" : "text-white";
          return (
            <div key={b.key} className="flex flex-col gap-2">
              <div className="relative flex h-[100px] items-end rounded-md border border-border bg-bg">
                <div
                  className={`flex w-full items-start justify-center rounded-b-[5px] pt-2 ${bucketColor[b.key]}`}
                  style={{ height: `${heightPct}%` }}
                >
                  {b.amount > 0 && (
                    <span className={`font-mono text-[11px] font-bold ${insideTone}`}>
                      {Math.round(b.amount).toLocaleString("en-GH")}
                    </span>
                  )}
                </div>
              </div>
              <div className="text-center">
                <div className="mb-px font-display text-[13px] font-semibold text-navy">
                  {p1}
                  <em className="italic text-gold">{p2}</em>
                  {p3}
                </div>
                {b.amount > 0 ? (
                  <>
                    <div className="text-[10px] text-navy-3">
                      <b className="font-semibold text-navy-2">{plur(b.invoiceCount, "invoice")}</b> ·{" "}
                      {plur(b.householdCount, "household")}
                    </div>
                    <div className="mt-1 font-mono text-[11px] font-bold text-navy">
                      {b.pct}% of outstanding
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-[10px] text-navy-3">none yet</div>
                    <div className="mt-1 font-mono text-[11px] font-bold text-navy-3">—</div>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* callout */}
      <div className="mt-5 rounded-r-lg border-l-2 border-gold bg-gold-bg px-4 py-3 text-xs leading-relaxed text-navy-2">
        <div className="mb-1 font-display text-[13px] font-semibold text-navy">
          What this shape says
        </div>
        {dominant && dominant.amount > 0 ? (
          <span>
            Most outstanding sits in the{" "}
            <b className="font-semibold text-navy">{dominant.label}</b> bucket ({dominant.pct}% of
            the balance). {agingNote(dominant.key)}
          </span>
        ) : (
          <span>No aged balances to interpret yet.</span>
        )}
      </div>
    </div>
  );
}

function agingNote(key: string): string {
  switch (key) {
    case "b1":
      return "That is the healthy pattern — recent invoices still being paid down within the first month.";
    case "b2":
      return "These families missed the early-term surge and have not caught up; watch they do not migrate to 61—90 days.";
    case "b3":
      return "Balances this old usually need direct follow-up before they harden into long-term debt.";
    default:
      return "Balances over 90 days old rarely self-resolve — these households likely need direct outreach.";
  }
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-border-2 bg-surface p-8 text-center text-sm text-navy-3">
      {children}
    </p>
  );
}
