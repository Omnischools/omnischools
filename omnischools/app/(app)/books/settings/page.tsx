import { asc, eq } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import { bookCategories } from "@/db/schema";
import { BooksTabs } from "@/components/books/books-tabs";
import { ChartOfAccounts } from "@/components/books/chart-of-accounts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Books · Settings" };

export default async function BooksSettingsPage() {
  const { school } = await requireSchool();
  const rows = await withSchool(school.id, (tx) =>
    tx
      .select({
        id: bookCategories.id,
        name: bookCategories.name,
        kind: bookCategories.kind,
        active: bookCategories.active,
      })
      .from(bookCategories)
      .where(eq(bookCategories.schoolId, school.id))
      .orderBy(asc(bookCategories.name)),
  );

  return (
    <div className="mx-auto max-w-page">
      <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-gold">
        Books
      </div>
      <h1 className="mb-1 font-display text-3xl font-semibold text-navy">
        Chart of <em className="not-italic text-gold [font-style:italic]">accounts.</em>
      </h1>
      <p className="mb-5 text-sm text-navy-3">
        The income and expense categories you book money against.
      </p>
      <BooksTabs />
      <ChartOfAccounts categories={rows} />
    </div>
  );
}
