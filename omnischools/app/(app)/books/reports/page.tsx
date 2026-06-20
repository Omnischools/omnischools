import Link from "next/link";
import { and, eq, sql, desc } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import { bookCategories, bookEntries } from "@/db/schema";
import { BooksTabs } from "@/components/books/books-tabs";
import { ExportCsv } from "@/components/reports/export-csv";
import { schoolFile } from "@/lib/filename";

export const dynamic = "force-dynamic";
export const metadata = { title: "Books · Financial reports" };

const ghs = (n: number) =>
  `GHS ${n.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default async function BooksReportsPage({
  searchParams,
}: {
  searchParams: { year?: string };
}) {
  const { school } = await requireSchool();
  const thisYear = new Date().getFullYear();
  const year = searchParams.year && /^\d{4}$/.test(searchParams.year)
    ? Number(searchParams.year)
    : null; // null = all time

  const data = await withSchool(school.id, async (tx) => {
    const yearFilter = year
      ? sql`extract(year from ${bookEntries.entryDate}) = ${year}`
      : undefined;
    const byCat = async (kind: "INCOME" | "EXPENSE") =>
      tx
        .select({
          name: sql<string>`coalesce(${bookCategories.name}, 'Uncategorised')`,
          total: sql<string>`sum(${bookEntries.amount})`,
        })
        .from(bookEntries)
        .leftJoin(bookCategories, eq(bookEntries.categoryId, bookCategories.id))
        .where(
          yearFilter
            ? and(eq(bookEntries.schoolId, school.id), eq(bookEntries.kind, kind), yearFilter)
            : and(eq(bookEntries.schoolId, school.id), eq(bookEntries.kind, kind)),
        )
        .groupBy(sql`coalesce(${bookCategories.name}, 'Uncategorised')`)
        .orderBy(desc(sql`sum(${bookEntries.amount})`));
    return { income: await byCat("INCOME"), expense: await byCat("EXPENSE") };
  });

  const incomeRows = data.income.map((r) => ({ name: r.name, total: Number(r.total) }));
  const expenseRows = data.expense.map((r) => ({ name: r.name, total: Number(r.total) }));
  const incomeTotal = incomeRows.reduce((s, r) => s + r.total, 0);
  const expenseTotal = expenseRows.reduce((s, r) => s + r.total, 0);
  const net = incomeTotal - expenseTotal;
  const periodLabel = year ? String(year) : "All time";

  const csvRows: (string | number)[][] = [
    ["Income", "", ""],
    ...incomeRows.map((r) => ["", r.name, r.total.toFixed(2)]),
    ["", "Total income", incomeTotal.toFixed(2)],
    ["Expenses", "", ""],
    ...expenseRows.map((r) => ["", r.name, r.total.toFixed(2)]),
    ["", "Total expenses", expenseTotal.toFixed(2)],
    ["Net", "", net.toFixed(2)],
  ];

  const chip = (label: string, value: number | null) => {
    const active = value === year;
    const href = value ? `/books/reports?year=${value}` : "/books/reports";
    return (
      <Link
        key={label}
        href={href}
        className={`rounded-pill px-3 py-1 text-xs font-semibold ${active ? "bg-navy text-bg" : "bg-bg text-navy-3 hover:bg-gold-bg"}`}
      >
        {label}
      </Link>
    );
  };

  const CatTable = ({
    title,
    rows,
    total,
    tone,
  }: {
    title: string;
    rows: { name: string; total: number }[];
    total: number;
    tone: string;
  }) => (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border bg-bg px-4 py-2.5">
        <span className="font-display text-sm font-semibold text-navy">{title}</span>
        <span className={`font-mono text-sm font-semibold ${tone}`}>{ghs(total)}</span>
      </div>
      <table className="w-full text-sm">
        <tbody className="divide-y divide-border">
          {rows.length === 0 ? (
            <tr>
              <td className="px-4 py-6 text-center text-sm text-navy-3">No entries.</td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.name}>
                <td className="px-4 py-2 text-navy-2">{r.name}</td>
                <td className="px-4 py-2 text-right font-mono text-navy-2">{ghs(r.total)}</td>
                <td className="px-4 py-2 text-right text-[11px] text-navy-3">
                  {total > 0 ? `${Math.round((r.total / total) * 100)}%` : "—"}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="mx-auto max-w-page">
      <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-gold">
        Books
      </div>
      <h1 className="mb-1 font-display text-3xl font-semibold text-navy">
        Financial <em className="not-italic text-gold [font-style:italic]">reports.</em>
      </h1>
      <p className="mb-5 text-sm text-navy-3">
        Income and expenses by category — {periodLabel}.
      </p>
      <BooksTabs />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {chip("All time", null)}
          {chip(String(thisYear), thisYear)}
          {chip(String(thisYear - 1), thisYear - 1)}
        </div>
        <ExportCsv
          filename={schoolFile(school.name, `financial-summary-${year ?? "all"}.csv`)}
          headers={["Section", "Category", "Amount (GHS)"]}
          rows={csvRows}
          label="↓ Export CSV"
        />
      </div>

      {/* KPI strip */}
      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="font-display text-2xl font-semibold text-green">{ghs(incomeTotal)}</div>
          <div className="mt-1 text-sm text-navy-3">Income</div>
        </div>
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="font-display text-2xl font-semibold text-terra">{ghs(expenseTotal)}</div>
          <div className="mt-1 text-sm text-navy-3">Expenses</div>
        </div>
        <div className={`rounded-xl border p-5 ${net >= 0 ? "border-navy bg-navy text-bg" : "border-terra bg-terra-bg"}`}>
          <div className="font-display text-2xl font-semibold">{ghs(net)}</div>
          <div className={`mt-1 text-sm ${net >= 0 ? "text-gold-soft" : "text-terra"}`}>Net</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CatTable title="Income by category" rows={incomeRows} total={incomeTotal} tone="text-green" />
        <CatTable title="Expenses by category" rows={expenseRows} total={expenseTotal} tone="text-terra" />
      </div>
    </div>
  );
}
