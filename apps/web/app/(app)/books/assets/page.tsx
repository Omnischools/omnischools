import { desc, eq } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import { fixedAssets } from "@/db/schema";
import { BooksTabs } from "@/components/books/books-tabs";
import { FixedAssets } from "@/components/books/fixed-assets";

export const dynamic = "force-dynamic";
export const metadata = { title: "Books · Fixed assets" };

export default async function BooksAssetsPage() {
  const { school } = await requireSchool();
  const assets = await withSchool(school.id, (tx) =>
    tx
      .select({
        id: fixedAssets.id,
        name: fixedAssets.name,
        acquiredOn: fixedAssets.acquiredOn,
        originalCost: fixedAssets.originalCost,
        accumulatedDepreciation: fixedAssets.accumulatedDepreciation,
        condition: fixedAssets.condition,
      })
      .from(fixedAssets)
      .where(eq(fixedAssets.schoolId, school.id))
      .orderBy(desc(fixedAssets.createdAt)),
  );

  return (
    <div className="mx-auto max-w-page">
      <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-gold">
        Books
      </div>
      <h1 className="mb-1 font-display text-3xl font-semibold text-navy">
        Fixed <em className="not-italic text-gold [font-style:italic]">assets.</em>
      </h1>
      <p className="mb-5 text-sm text-navy-3">
        Capital items — buildings, vehicles, equipment — with cost, depreciation and book
        value.
      </p>
      <BooksTabs />
      <FixedAssets assets={assets} />
    </div>
  );
}
