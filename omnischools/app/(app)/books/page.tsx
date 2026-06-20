import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import { bookEntries, bookCategories, fixedAssets } from "@/db/schema";
import { BooksTabs } from "@/components/books/books-tabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Books" };

const ghs = (n: number) =>
  `GHS ${n.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (d: string) => {
  const dt = new Date(`${d}T00:00:00`);
  return Number.isNaN(dt.getTime())
    ? d
    : dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

export default async function BooksDashboardPage() {
  const { school } = await requireSchool();

  const data = await withSchool(school.id, async (tx) => {
    const totals = await tx
      .select({ kind: bookEntries.kind, sum: sql<string>`coalesce(sum(${bookEntries.amount}),0)` })
      .from(bookEntries)
      .where(eq(bookEntries.schoolId, school.id))
      .groupBy(bookEntries.kind);
    const recent = await tx
      .select({
        id: bookEntries.id,
        kind: bookEntries.kind,
        entryDate: bookEntries.entryDate,
        amount: bookEntries.amount,
        description: bookEntries.description,
        party: bookEntries.party,
        category: bookCategories.name,
      })
      .from(bookEntries)
      .leftJoin(bookCategories, eq(bookEntries.categoryId, bookCategories.id))
      .where(eq(bookEntries.schoolId, school.id))
      .orderBy(desc(bookEntries.entryDate))
      .limit(8);
    const [assets] = await tx
      .select({
        count: sql<number>`count(*)::int`,
        bookValue: sql<string>`coalesce(sum(${fixedAssets.originalCost} - ${fixedAssets.accumulatedDepreciation}),0)`,
      })
      .from(fixedAssets)
      .where(eq(fixedAssets.schoolId, school.id));
    const [{ catCount }] = await tx
      .select({ catCount: sql<number>`count(*)::int` })
      .from(bookCategories)
      .where(eq(bookCategories.schoolId, school.id));
    return { totals, recent, assets, catCount };
  });

  const income = Number(data.totals.find((t) => t.kind === "INCOME")?.sum ?? 0);
  const expense = Number(data.totals.find((t) => t.kind === "EXPENSE")?.sum ?? 0);
  const net = income - expense;
  const assetValue = Number(data.assets?.bookValue ?? 0);

  return (
    <div className="mx-auto max-w-page">
      <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-gold">
        Books
      </div>
      <h1 className="mb-1 font-display text-3xl font-semibold text-navy">
        School <em className="not-italic text-gold [font-style:italic]">accounts.</em>
      </h1>
      <p className="mb-5 text-sm text-navy-3">
        Income, expenses and assets — the school&apos;s own books, alongside fee collection.
      </p>
      <BooksTabs />

      {data.catCount === 0 && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gold-soft bg-gold-bg px-5 py-4">
          <div>
            <div className="font-display text-base font-medium text-navy">
              Set up your chart of accounts first
            </div>
            <p className="text-[12px] text-navy-2">
              Define income &amp; expense categories, then start booking entries.
            </p>
          </div>
          <Link
            href="/books/settings"
            className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep"
          >
            Open settings →
          </Link>
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="font-display text-2xl font-semibold text-green">{ghs(income)}</div>
          <div className="mt-1 text-sm text-navy-3">Income</div>
        </div>
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="font-display text-2xl font-semibold text-terra">{ghs(expense)}</div>
          <div className="mt-1 text-sm text-navy-3">Expenses</div>
        </div>
        <div
          className={`rounded-xl border p-5 ${net >= 0 ? "border-navy bg-navy text-bg" : "border-terra bg-terra-bg"}`}
        >
          <div className="font-display text-2xl font-semibold">{ghs(net)}</div>
          <div className={`mt-1 text-sm ${net >= 0 ? "text-gold-soft" : "text-terra"}`}>
            Net position
          </div>
        </div>
        <Link
          href="/books/assets"
          className="rounded-xl border border-border bg-surface p-5 transition-colors hover:border-gold-soft"
        >
          <div className="font-display text-2xl font-semibold text-navy">{ghs(assetValue)}</div>
          <div className="mt-1 text-sm text-navy-3">
            Fixed assets {data.assets?.count ? `· ${data.assets.count}` : ""}
          </div>
        </Link>
      </div>

      {/* Recent entries */}
      <div className="mt-6">
        <h2 className="mb-2 font-display text-lg font-semibold text-navy">Recent entries</h2>
        {data.recent.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border-2 bg-surface p-10 text-center text-sm text-navy-3">
            No entries yet. Record income and expenses from their tabs (coming next).
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-bg text-left text-xs uppercase tracking-wide text-navy-3">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Date</th>
                  <th className="px-4 py-2.5 font-semibold">Category</th>
                  <th className="px-4 py-2.5 font-semibold">Detail</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.recent.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-navy-2">
                      {fmtDate(r.entryDate)}
                    </td>
                    <td className="px-4 py-2.5 text-navy-2">{r.category ?? "—"}</td>
                    <td className="px-4 py-2.5 text-navy-2">
                      {r.description || r.party || "—"}
                    </td>
                    <td
                      className={`whitespace-nowrap px-4 py-2.5 text-right font-medium ${r.kind === "INCOME" ? "text-green" : "text-terra"}`}
                    >
                      {r.kind === "INCOME" ? "+" : "−"}
                      {ghs(Number(r.amount))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
