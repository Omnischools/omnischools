import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import { buildReceiptData } from "@/lib/data/receipt-data";
import { renderReceiptPdf } from "@/lib/pdf/render-receipt";

// @react-pdf/renderer is Node-only (fontkit); never run this on the edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/receipts/[paymentId] — the authenticated staff receipt download. Renders the
 * receipt for a payment to a PDF and streams it inline. Scoped to the caller's school via
 * requireSchool + withSchool, so a staffer can only ever pull their own school's receipts.
 * (The public, tokened parent-facing link is lib/actions/public-receipt.ts.)
 */
export async function GET(
  _req: Request,
  { params }: { params: { paymentId: string } },
) {
  const { school } = await requireSchool();

  const built = await withSchool(school.id, (tx) =>
    buildReceiptData(tx, school.id, params.paymentId),
  );
  if (!built) return new Response("Receipt not found", { status: 404 });

  const pdf = await renderReceiptPdf(built.data);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Receipt-${built.data.receiptNumber}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
