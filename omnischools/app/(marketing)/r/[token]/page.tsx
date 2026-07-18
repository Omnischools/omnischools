import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { withoutTenantScope } from "@/lib/db/rls";
import { receipts, schools } from "@/db/schema";
import { ReceiptGate } from "@/components/receipt/receipt-gate";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "View receipt",
  robots: { index: false, follow: false },
};

/**
 * Public parent receipt page (/r/{token}). Loads only the school name from the token so the
 * page can address the parent — student name, amount and the PDF stay hidden until the code
 * is verified in <ReceiptGate>.
 */
export default async function PublicReceiptPage(
  props: {
    params: Promise<{ token: string }>;
  }
) {
  const params = await props.params;
  const info = await withoutTenantScope(async (tx) => {
    const [r] = await tx
      .select({ schoolId: receipts.schoolId })
      .from(receipts)
      .where(eq(receipts.publicToken, params.token))
      .limit(1);
    if (!r) return null;
    const [s] = await tx
      .select({ name: schools.name })
      .from(schools)
      .where(eq(schools.id, r.schoolId));
    return { schoolName: s?.name ?? "Your school" };
  });
  if (!info) notFound();

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4 py-16">
      <ReceiptGate token={params.token} schoolName={info.schoolName} />
      <p className="mt-4 text-center text-[11px] text-navy-3">
        Powered by <span className="font-semibold text-gold">Omnischools</span>
      </p>
    </main>
  );
}
