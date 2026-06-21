import { and, eq, ne, isNull, isNotNull, asc, gte, lt, sql, desc } from "drizzle-orm";
import Link from "next/link";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import {
  invoices,
  payments,
  students,
  classes,
  receipts,
  users,
  discounts,
  discountTiers,
  feeCategories,
} from "@/db/schema";
import { ExportCsv } from "@/components/reports/export-csv";
import { schoolFile } from "@/lib/filename";

const ordinal = (n: number) =>
  n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`;

export const dynamic = "force-dynamic";

const ghs = (n: number) =>
  `GHS ${n.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (v: unknown) => Number(v ?? 0);

const METHOD_LABEL: Record<string, string> = {
  MTN_MOMO: "MTN MoMo",
  TELECEL_CASH: "Telecel Cash",
  AIRTELTIGO_MONEY: "AirtelTigo Money",
  BANK_TRANSFER: "Bank transfer",
  CASH: "Cash",
  CHEQUE: "Cheque",
  OTHER: "Other",
};

export default async function ReportsPage({
  searchParams,
}: {
  searchParams?: { year?: string };
}) {
  const { school } = await requireSchool();

  // Period scope: an academic year ("2025/26") narrows every figure. Invoices
  // filter by their academic_year column; payments/voids by the Sep–Aug window.
  const selectedYear =
    searchParams?.year && searchParams.year !== "all" ? searchParams.year : null;
  let windowStart: Date | null = null;
  let windowEnd: Date | null = null;
  if (selectedYear) {
    const sy = Number.parseInt(selectedYear.slice(0, 4), 10);
    if (!Number.isNaN(sy)) {
      windowStart = new Date(Date.UTC(sy, 8, 1));
      windowEnd = new Date(Date.UTC(sy + 1, 8, 1));
    }
  }
  const yearInv = selectedYear ? eq(invoices.academicYear, selectedYear) : undefined;
  const payWindow =
    windowStart && windowEnd
      ? and(gte(payments.paidAt, windowStart), lt(payments.paidAt, windowEnd))
      : undefined;
  const voidWindow =
    windowStart && windowEnd
      ? and(gte(payments.voidedAt, windowStart), lt(payments.voidedAt, windowEnd))
      : undefined;

  const [
    [totals],
    byClass,
    monthly,
    byMethod,
    agingRows,
    voids,
    discRows,
    discTierRows,
    [discTotal],
    catRows,
    yearRows,
  ] = await Promise.all([
    withSchool(school.id, (tx) =>
      tx
        .select({
          billed: sql<string>`coalesce(sum(${invoices.billedAmount}), 0)`,
          collected: sql<string>`coalesce(sum(${invoices.paidAmount}), 0)`,
          outstanding: sql<string>`coalesce(sum(${invoices.balanceAmount}), 0)`,
          invoiceCount: sql<number>`count(*)`,
        })
        .from(invoices)
        .where(
          and(eq(invoices.schoolId, school.id), ne(invoices.status, "VOIDED"), yearInv),
        ),
    ),
    withSchool(school.id, (tx) =>
      tx
        .select({
          className: sql<string>`coalesce(${classes.name}, '— Unassigned —')`,
          billed: sql<string>`coalesce(sum(${invoices.billedAmount}), 0)`,
          collected: sql<string>`coalesce(sum(${invoices.paidAmount}), 0)`,
          outstanding: sql<string>`coalesce(sum(${invoices.balanceAmount}), 0)`,
        })
        .from(invoices)
        .innerJoin(students, eq(invoices.studentId, students.id))
        .leftJoin(classes, eq(students.classId, classes.id))
        .where(
          and(eq(invoices.schoolId, school.id), ne(invoices.status, "VOIDED"), yearInv),
        )
        .groupBy(classes.name)
        .orderBy(desc(sql`sum(${invoices.balanceAmount})`)),
    ),
    withSchool(school.id, (tx) =>
      tx
        .select({
          month: sql<string>`to_char(${payments.paidAt}, 'YYYY-MM')`,
          amount: sql<string>`coalesce(sum(${payments.netAmount}), 0)`,
        })
        .from(payments)
        .where(and(eq(payments.schoolId, school.id), isNull(payments.voidedAt), payWindow))
        .groupBy(sql`to_char(${payments.paidAt}, 'YYYY-MM')`)
        .orderBy(sql`to_char(${payments.paidAt}, 'YYYY-MM')`),
    ),
    withSchool(school.id, (tx) =>
      tx
        .select({
          method: payments.method,
          amount: sql<string>`coalesce(sum(${payments.netAmount}), 0)`,
          count: sql<number>`count(*)`,
        })
        .from(payments)
        .where(and(eq(payments.schoolId, school.id), isNull(payments.voidedAt), payWindow))
        .groupBy(payments.method),
    ),
    // Outstanding balance bucketed by how far past due it is.
    withSchool(school.id, (tx) =>
      tx
        .select({
          bucket: sql<string>`case
            when ${invoices.dueAt} is null or ${invoices.dueAt} >= now() then 'current'
            when now() - ${invoices.dueAt} <= interval '30 days' then 'd30'
            when now() - ${invoices.dueAt} <= interval '60 days' then 'd60'
            when now() - ${invoices.dueAt} <= interval '90 days' then 'd90'
            else 'd90plus'
          end`,
          amount: sql<string>`coalesce(sum(${invoices.balanceAmount}), 0)`,
          count: sql<number>`count(*)`,
        })
        .from(invoices)
        .where(
          and(
            eq(invoices.schoolId, school.id),
            ne(invoices.status, "VOIDED"),
            sql`${invoices.balanceAmount} > 0`,
            yearInv,
          ),
        )
        .groupBy(sql`1`),
    ),
    // Voided / refunded payments (audit-grade reason capture from the Fees void flow).
    withSchool(school.id, (tx) =>
      tx
        .select({
          voidedAt: payments.voidedAt,
          amount: payments.grossAmount,
          method: payments.method,
          isRefund: payments.voidIsRefund,
          reason: payments.voidReason,
          firstName: students.firstName,
          lastName: students.lastName,
          receiptNumber: receipts.receiptNumber,
          voidedBy: users.fullName,
        })
        .from(payments)
        .innerJoin(students, eq(payments.studentId, students.id))
        .leftJoin(receipts, eq(receipts.paymentId, payments.id))
        .leftJoin(users, eq(payments.voidedByUserId, users.id))
        .where(
          and(eq(payments.schoolId, school.id), isNotNull(payments.voidedAt), voidWindow),
        )
        .orderBy(desc(payments.voidedAt))
        .limit(100),
    ),
    withSchool(school.id, (tx) =>
      tx
        .select()
        .from(discounts)
        .where(eq(discounts.schoolId, school.id))
        .orderBy(asc(discounts.name)),
    ),
    withSchool(school.id, (tx) =>
      tx
        .select({
          discountId: discountTiers.discountId,
          rank: discountTiers.rank,
          value: discountTiers.value,
        })
        .from(discountTiers)
        .where(eq(discountTiers.schoolId, school.id)),
    ),
    withSchool(school.id, (tx) =>
      tx
        .select({
          total: sql<string>`coalesce(sum(${invoices.discountAmount}), 0)`,
          count: sql<number>`count(*) filter (where ${invoices.discountAmount} > 0)`,
        })
        .from(invoices)
        .where(
          and(eq(invoices.schoolId, school.id), ne(invoices.status, "VOIDED"), yearInv),
        ),
    ),
    withSchool(school.id, (tx) =>
      tx
        .select({ id: feeCategories.id, name: feeCategories.name })
        .from(feeCategories)
        .where(eq(feeCategories.schoolId, school.id)),
    ),
    withSchool(school.id, (tx) =>
      tx
        .selectDistinct({ year: invoices.academicYear })
        .from(invoices)
        .where(eq(invoices.schoolId, school.id))
        .orderBy(desc(invoices.academicYear)),
    ),
  ]);

  const billed = num(totals?.billed);
  const collected = num(totals?.collected);
  const outstanding = num(totals?.outstanding);
  const rate = billed > 0 ? Math.round((collected / billed) * 100) : 0;
  const maxMonth = Math.max(1, ...monthly.map((m) => num(m.amount)));
  const classRate = (b: unknown, c: unknown) =>
    num(b) > 0 ? Math.round((num(c) / num(b)) * 100) : 0;

  const AGING = [
    { key: "current", label: "Not yet due", tone: "bg-navy" },
    { key: "d30", label: "1–30 days overdue", tone: "bg-gold" },
    { key: "d60", label: "31–60 days overdue", tone: "bg-warn" },
    { key: "d90", label: "61–90 days overdue", tone: "bg-terra" },
    { key: "d90plus", label: "90+ days overdue", tone: "bg-terra" },
  ];
  const agingMap = new Map(
    agingRows.map((r) => [r.bucket, { amount: num(r.amount), count: num(r.count) }]),
  );
  const agingMax = Math.max(1, ...AGING.map((b) => agingMap.get(b.key)?.amount ?? 0));
  const overdueTotal = AGING.filter((b) => b.key !== "current").reduce(
    (s, b) => s + (agingMap.get(b.key)?.amount ?? 0),
    0,
  );

  const catName = new Map(catRows.map((c) => [c.id, c.name]));
  const tiersByDiscount = new Map<string, { rank: number; value: number }[]>();
  for (const t of discTierRows) {
    const arr = tiersByDiscount.get(t.discountId) ?? [];
    arr.push({ rank: t.rank, value: num(t.value) });
    tiersByDiscount.set(t.discountId, arr);
  }
  const discountTotal = num(discTotal?.total);
  const discountedCount = num(discTotal?.count);
  const discountValueText = (d: (typeof discRows)[number]) => {
    if (d.isTiered) {
      return (tiersByDiscount.get(d.id) ?? [])
        .sort((a, b) => a.rank - b.rank)
        .map(
          (t) =>
            `${ordinal(t.rank)} ${d.kind === "PERCENT" ? `${t.value}%` : ghs(t.value)}`,
        )
        .join(" · ");
    }
    return d.kind === "PERCENT" ? `${num(d.value)}%` : ghs(num(d.value));
  };

  const kpis = [
    {
      label: "Total billed",
      value: ghs(billed),
      sub: `${num(totals?.invoiceCount)} invoices`,
    },
    { label: "Collected", value: ghs(collected), sub: `${rate}% of billed` },
    { label: "Outstanding", value: ghs(outstanding), sub: "across all classes" },
    {
      label: "Collection rate",
      value: `${rate}%`,
      sub: rate >= 80 ? "healthy" : "needs follow-up",
    },
  ];

  return (
    <div className="mx-auto max-w-page space-y-8">
      <div>
        <h1 className="font-display text-3xl font-semibold text-navy">Reports</h1>
        <p className="text-sm text-navy-3">
          Fees collected, outstanding by class, and collection trends — for the bursar.
          {selectedYear && (
            <>
              {" "}
              Showing <b className="text-navy">{selectedYear}</b>.
            </>
          )}
        </p>
      </div>

      {yearRows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-navy-3">
            Period
          </span>
          <PeriodPill href="/reports" active={!selectedYear}>
            All time
          </PeriodPill>
          {yearRows.map((y) => (
            <PeriodPill
              key={y.year}
              href={`/reports?year=${encodeURIComponent(y.year)}`}
              active={selectedYear === y.year}
            >
              {y.year}
            </PeriodPill>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl border border-border bg-surface p-5">
            <div className="text-xs font-semibold uppercase tracking-wide text-navy-3">
              {k.label}
            </div>
            <div className="mt-1.5 font-display text-2xl font-semibold text-navy">
              {k.value}
            </div>
            <div className="mt-0.5 text-xs text-navy-3">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Outstanding by class */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-navy">
            Outstanding by class
          </h2>
          <ExportCsv
            filename={schoolFile(school.name, "outstanding-by-class.csv")}
            headers={["Class", "Billed", "Collected", "Outstanding", "Rate %"]}
            rows={byClass.map((c) => [
              c.className,
              num(c.billed).toFixed(2),
              num(c.collected).toFixed(2),
              num(c.outstanding).toFixed(2),
              String(classRate(c.billed, c.collected)),
            ])}
          />
        </div>
        {byClass.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border-2 bg-surface p-8 text-center text-sm text-navy-3">
            No invoices yet. Issue fees from the Fees module to see collections here.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-bg text-left text-xs uppercase tracking-wide text-navy-3">
                <tr>
                  <th className="px-4 py-3 font-semibold">Class</th>
                  <th className="px-4 py-3 text-right font-semibold">Billed</th>
                  <th className="px-4 py-3 text-right font-semibold">Collected</th>
                  <th className="px-4 py-3 text-right font-semibold">Outstanding</th>
                  <th className="px-4 py-3 text-right font-semibold">Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {byClass.map((c) => {
                  const r = classRate(c.billed, c.collected);
                  return (
                    <tr key={c.className} className="hover:bg-bg">
                      <td className="px-4 py-3 font-medium text-navy">{c.className}</td>
                      <td className="px-4 py-3 text-right text-navy-2">
                        {ghs(num(c.billed))}
                      </td>
                      <td className="px-4 py-3 text-right text-green">
                        {ghs(num(c.collected))}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-terra">
                        {ghs(num(c.outstanding))}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-medium ${r >= 80 ? "text-green" : r >= 50 ? "text-navy-2" : "text-terra"}`}
                      >
                        {r}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Aging of receivables */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-navy">
            Aging of receivables
          </h2>
          <ExportCsv
            filename={schoolFile(school.name, "aging.csv")}
            headers={["Bucket", "Outstanding", "Invoices"]}
            rows={AGING.map((b) => {
              const a = agingMap.get(b.key);
              return [b.label, num(a?.amount).toFixed(2), String(a?.count ?? 0)];
            })}
          />
        </div>
        {outstanding <= 0 ? (
          <p className="rounded-xl border border-dashed border-border-2 bg-surface p-8 text-center text-sm text-navy-3">
            Nothing outstanding — every invoice is settled.
          </p>
        ) : (
          <div className="rounded-xl border border-border bg-surface p-5">
            <p className="mb-3 text-sm text-navy-3">
              <b className="text-terra">{ghs(overdueTotal)}</b> overdue of{" "}
              <b className="text-navy">{ghs(outstanding)}</b> outstanding
            </p>
            <div className="space-y-2">
              {AGING.map((b) => {
                const a = agingMap.get(b.key);
                const amt = a?.amount ?? 0;
                return (
                  <div key={b.key} className="flex items-center gap-3">
                    <span className="w-40 shrink-0 text-xs text-navy-2">{b.label}</span>
                    <div className="h-5 flex-1 overflow-hidden rounded-full bg-bg">
                      <div
                        className={`h-full rounded-full ${b.tone}`}
                        style={{ width: `${(amt / agingMax) * 100}%` }}
                      />
                    </div>
                    <span className="w-14 shrink-0 text-right text-[11px] text-navy-3">
                      {a?.count ?? 0} inv
                    </span>
                    <span className="w-28 shrink-0 text-right text-xs font-medium text-navy-2">
                      {ghs(amt)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Monthly trend */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold text-navy">
              Monthly collections
            </h2>
            <ExportCsv
              filename={schoolFile(school.name, "monthly-collections.csv")}
              headers={["Month", "Collected"]}
              rows={monthly.map((m) => [m.month, num(m.amount).toFixed(2)])}
            />
          </div>
          {monthly.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border-2 bg-surface p-8 text-center text-sm text-navy-3">
              No payments recorded yet.
            </p>
          ) : (
            <div className="space-y-2 rounded-xl border border-border bg-surface p-5">
              {monthly.map((m) => (
                <div key={m.month} className="flex items-center gap-3">
                  <span className="w-16 shrink-0 font-mono text-xs text-navy-3">
                    {m.month}
                  </span>
                  <div className="h-5 flex-1 overflow-hidden rounded-full bg-bg">
                    <div
                      className="h-full rounded-full bg-navy"
                      style={{ width: `${(num(m.amount) / maxMonth) * 100}%` }}
                    />
                  </div>
                  <span className="w-28 shrink-0 text-right text-xs font-medium text-navy-2">
                    {ghs(num(m.amount))}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* By method */}
        <section>
          <h2 className="mb-3 font-display text-lg font-semibold text-navy">
            Collections by method
          </h2>
          {byMethod.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border-2 bg-surface p-8 text-center text-sm text-navy-3">
              No payments recorded yet.
            </p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-surface">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-border">
                  {byMethod.map((m) => (
                    <tr key={m.method} className="hover:bg-bg">
                      <td className="px-4 py-3 font-medium text-navy">
                        {METHOD_LABEL[m.method] ?? m.method}
                      </td>
                      <td className="px-4 py-3 text-navy-3">{num(m.count)} payments</td>
                      <td className="px-4 py-3 text-right font-medium text-navy-2">
                        {ghs(num(m.amount))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* Voids & refunds */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-navy">
            Voids &amp; refunds
          </h2>
          {voids.length > 0 && (
            <ExportCsv
              filename={schoolFile(school.name, "voids-refunds.csv")}
              headers={[
                "Date",
                "Student",
                "Receipt",
                "Amount",
                "Method",
                "Type",
                "Reason",
                "By",
              ]}
              rows={voids.map((v) => [
                v.voidedAt ? new Date(v.voidedAt).toISOString().slice(0, 10) : "",
                `${v.lastName}, ${v.firstName}`,
                v.receiptNumber ?? "",
                num(v.amount).toFixed(2),
                METHOD_LABEL[v.method] ?? v.method,
                v.isRefund ? "Refund" : "Void",
                v.reason ?? "",
                v.voidedBy ?? "",
              ])}
            />
          )}
        </div>
        {voids.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border-2 bg-surface p-8 text-center text-sm text-navy-3">
            No voided or refunded payments.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-bg text-left text-xs uppercase tracking-wide text-navy-3">
                <tr>
                  <th className="px-4 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3 font-semibold">Student</th>
                  <th className="px-4 py-3 font-semibold">Receipt</th>
                  <th className="px-4 py-3 text-right font-semibold">Amount</th>
                  <th className="px-4 py-3 font-semibold">Type</th>
                  <th className="px-4 py-3 font-semibold">Reason</th>
                  <th className="px-4 py-3 font-semibold">By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {voids.map((v, i) => (
                  <tr key={i} className="hover:bg-bg">
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-navy-3">
                      {v.voidedAt
                        ? new Date(v.voidedAt).toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })
                        : "—"}
                    </td>
                    <td className="px-4 py-3 font-medium text-navy">
                      {v.lastName}, {v.firstName}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-navy-2">
                      {v.receiptNumber ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-navy">
                      {ghs(num(v.amount))}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-pill px-2 py-0.5 text-xs font-medium ${v.isRefund ? "bg-terra-bg text-terra" : "bg-bg text-navy-3"}`}
                      >
                        {v.isRefund ? "Refund" : "Void"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-navy-2">{v.reason ?? "—"}</td>
                    <td className="px-4 py-3 text-navy-3">{v.voidedBy ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Discounts given */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-navy">Discounts given</h2>
          {discRows.length > 0 && (
            <ExportCsv
              filename={schoolFile(school.name, "discounts.csv")}
              headers={[
                "Discount",
                "Value",
                "Applies to",
                "Tiered",
                "Approval",
                "Applied",
              ]}
              rows={discRows.map((d) => [
                d.name,
                discountValueText(d),
                d.appliesToCategoryId
                  ? (catName.get(d.appliesToCategoryId) ?? "Whole invoice")
                  : "Whole invoice",
                d.isTiered ? "Yes" : "No",
                d.requiresApproval ? (d.approvedAt ? "Approved" : "Pending") : "—",
                String(d.appliedCount),
              ])}
            />
          )}
        </div>
        <p className="mb-3 text-sm text-navy-3">
          <b className="text-navy">{ghs(discountTotal)}</b> discounted across{" "}
          {discountedCount} invoice{discountedCount === 1 ? "" : "s"}.
        </p>
        {discRows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border-2 bg-surface p-8 text-center text-sm text-navy-3">
            No discounts configured. Set them up under Billing.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-bg text-left text-xs uppercase tracking-wide text-navy-3">
                <tr>
                  <th className="px-4 py-3 font-semibold">Discount</th>
                  <th className="px-4 py-3 font-semibold">Value</th>
                  <th className="px-4 py-3 font-semibold">Applies to</th>
                  <th className="px-4 py-3 text-right font-semibold">Applied</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {discRows.map((d) => (
                  <tr key={d.id} className="hover:bg-bg">
                    <td className="px-4 py-3 font-medium text-navy">
                      {d.name}
                      {d.requiresApproval && !d.approvedAt && (
                        <span className="ml-2 rounded-pill bg-warn-bg px-2 py-0.5 text-[11px] font-medium text-warn">
                          Pending approval
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-navy-2">{discountValueText(d)}</td>
                    <td className="px-4 py-3 text-navy-2">
                      {d.appliesToCategoryId
                        ? (catName.get(d.appliesToCategoryId) ?? "Whole invoice")
                        : "Whole invoice"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-navy-2">
                      {d.appliedCount}×
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function PeriodPill({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`rounded-pill border px-3 py-1 text-xs font-semibold transition-colors ${
        active
          ? "border-navy bg-navy text-bg"
          : "border-border-2 bg-surface text-navy-2 hover:border-gold"
      }`}
    >
      {children}
    </Link>
  );
}
