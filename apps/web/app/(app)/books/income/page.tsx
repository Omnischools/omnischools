import { and, asc, desc, eq } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import { bookCategories, bookEntries } from "@/db/schema";
import { BooksTabs } from "@/components/books/books-tabs";
import { BookEntries } from "@/components/books/book-entries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Books · Income" };

export default async function BooksIncomePage() {
  const { school } = await requireSchool();
  const data = await withSchool(school.id, async (tx) => {
    const cats = await tx
      .select({ id: bookCategories.id, name: bookCategories.name })
      .from(bookCategories)
      .where(
        and(
          eq(bookCategories.schoolId, school.id),
          eq(bookCategories.kind, "INCOME"),
          eq(bookCategories.active, true),
        ),
      )
      .orderBy(asc(bookCategories.name));
    const entries = await tx
      .select({
        id: bookEntries.id,
        entryDate: bookEntries.entryDate,
        category: bookCategories.name,
        description: bookEntries.description,
        party: bookEntries.party,
        method: bookEntries.method,
        reference: bookEntries.reference,
        amount: bookEntries.amount,
      })
      .from(bookEntries)
      .leftJoin(bookCategories, eq(bookEntries.categoryId, bookCategories.id))
      .where(and(eq(bookEntries.schoolId, school.id), eq(bookEntries.kind, "INCOME")))
      .orderBy(desc(bookEntries.entryDate))
      .limit(200);
    return { cats, entries };
  });

  return (
    <div className="mx-auto max-w-page">
      <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-gold">
        Books
      </div>
      <h1 className="mb-1 font-display text-3xl font-semibold text-navy">
        <em className="not-italic text-gold [font-style:italic]">Income.</em>
      </h1>
      <p className="mb-5 text-sm text-navy-3">
        Money the school receives — fees, dues, donations, grants.
      </p>
      <BooksTabs />
      <BookEntries kind="INCOME" categories={data.cats} entries={data.entries} />
    </div>
  );
}
