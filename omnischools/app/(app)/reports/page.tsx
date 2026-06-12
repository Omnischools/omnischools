import { and, eq, ne, isNull, sql, desc } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import { invoices, payments, students, classes } from "@/db/schema";
import { ExportCsv } from "@/components/reports/export-csv";

export const dynamic = "force-dynamic";

const ghs = (n: number) =>
  `GH₵ ${n.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

export default async function ReportsPage() {
  const { school } = await requireSchool();

  const [[totals], byClass, monthly, byMethod] = await Promise.all([
    withSchool(school.id, (tx) =>
      tx
        .select({
          billed: sql<string>`coalesce(sum(${invoices.billedAmount}), 0)`,
          collected: sql<string>`coalesce(sum(${invoices.paidAmount}), 0)`,
          outstanding: sql<string>`coalesce(sum(${invoices.balanceAmount}), 0)`,
          invoiceCount: sql<number>`count(*)`,
        })
        .from(invoices)
        .where(and(eq(invoices.schoolId, school.id), ne(invoices.status, "VOIDED"))),
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
        .where(and(eq(invoices.schoolId, school.id), ne(invoices.status, "VOIDED")))
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
        .where(and(eq(payments.schoolId, school.id), isNull(payments.voidedAt)))
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
        .where(and(eq(payments.schoolId, school.id), isNull(payments.voidedAt)))
        .groupBy(payments.method),
    ),
  ]);

  const billed = num(totals?.billed);
  const collected = num(totals?.collected);
  const outstanding = num(totals?.outstanding);
  const rate = billed > 0 ? Math.round((collected / billed) * 100) : 0;
  const maxMonth = Math.max(1, ...monthly.map((m) => num(m.amount)));

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
        </p>
      </div>

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
            filename="outstanding-by-class.csv"
            headers={["Class", "Billed", "Collected", "Outstanding"]}
            rows={byClass.map((c) => [
              c.className,
              num(c.billed).toFixed(2),
              num(c.collected).toFixed(2),
              num(c.outstanding).toFixed(2),
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
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {byClass.map((c) => (
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
                  </tr>
                ))}
              </tbody>
            </table>
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
              filename="monthly-collections.csv"
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
    </div>
  );
}
