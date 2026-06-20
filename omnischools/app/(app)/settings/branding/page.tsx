import Link from "next/link";
import { eq } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import { schools } from "@/db/schema";
import { BrandingForm } from "@/components/settings/branding-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Branding & identity" };

export default async function BrandingPage() {
  const { school } = await requireSchool();

  const data = await withSchool(school.id, async (tx) => {
    const [row] = await tx
      .select({
        name: schools.name,
        logoUrl: schools.logoUrl,
        stampUrl: schools.stampUrl,
        brandColor: schools.brandColor,
      })
      .from(schools)
      .where(eq(schools.id, school.id));
    return row;
  });

  return (
    <div className="mx-auto max-w-page">
      <Link href="/settings" className="text-sm text-navy-3 hover:text-gold">
        ← Settings
      </Link>
      <div className="mb-6 mt-2">
        <h1 className="font-display text-3xl font-semibold text-navy">
          Branding &amp; <em className="not-italic text-gold [font-style:italic]">identity.</em>
        </h1>
        <p className="text-sm text-navy-3">
          Your logo, official stamp and brand colour — used on receipts, statements and PDFs.
        </p>
      </div>

      <BrandingForm
        schoolName={data?.name ?? school.name}
        initial={{
          logoUrl: data?.logoUrl ?? "",
          stampUrl: data?.stampUrl ?? "",
          brandColor: data?.brandColor ?? "",
        }}
      />
    </div>
  );
}
