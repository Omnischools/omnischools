import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { withoutTenantScope } from "@/lib/db/rls";
import { boardingVisitRsvpToken, schools } from "@/db/schema";
import { hashRsvpToken } from "@/lib/boarding/rsvp-token";
import { ParentRsvpForm } from "@/components/boarding/parent-rsvp-form";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Visiting-day RSVP",
  robots: { index: false, follow: false },
};

/**
 * Public parent RSVP page (/rsvp/{token}). Loads ONLY the school name from the (hashed) token so the page
 * can address the parent — the ward's name is never shown until they pass the date-of-birth factor in the
 * form (mirrors the receipt page's reveal discipline). A missing / expired / revoked link → notFound.
 */
export default async function ParentRsvpPage(props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  const info = await withoutTenantScope(async (tx) => {
    const [t] = await tx
      .select({
        schoolId: boardingVisitRsvpToken.schoolId,
        expiresAt: boardingVisitRsvpToken.expiresAt,
        revokedAt: boardingVisitRsvpToken.revokedAt,
      })
      .from(boardingVisitRsvpToken)
      .where(eq(boardingVisitRsvpToken.tokenHash, hashRsvpToken(params.token)))
      .limit(1);
    if (!t || t.revokedAt || t.expiresAt.getTime() < Date.now()) return null;
    const [s] = await tx.select({ name: schools.name }).from(schools).where(eq(schools.id, t.schoolId)).limit(1);
    return { schoolName: s?.name ?? "your child's school" };
  });
  if (!info) notFound();

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4 py-16">
      <ParentRsvpForm token={params.token} schoolName={info.schoolName} />
      <p className="mt-4 text-center text-[11px] text-navy-3">
        Powered by <span className="font-semibold text-gold">Omnischools</span>
      </p>
    </main>
  );
}
