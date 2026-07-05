"use server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withoutTenantScope } from "@/lib/db/rls";
import { receipts } from "@/db/schema";
import { buildReceiptData } from "@/lib/data/receipt-data";
import { renderReceiptPdf } from "@/lib/pdf/render-receipt";

/**
 * Public parent receipt access. The SMS link carries an unguessable token (factor 1); the
 * parent must also enter the student's code (factor 2) before the PDF is returned. Runs
 * unauthenticated, so the token lookup bypasses tenant scope — but every downstream query is
 * still scoped to the receipt's own school via buildReceiptData(schoolId). The PDF bytes are
 * only ever produced after the code matches, and returned inline (no public PDF route to guard).
 */
export type OpenReceiptResult =
  | { ok: true; pdfBase64: string; filename: string; receiptNumber: string; amount: string }
  | { ok: false; error: string };

const Schema = z.object({
  token: z.string().min(10).max(200),
  code: z.string().min(1, "Enter the student's ID.").max(60),
});

const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, "");
const ghs = (v: number) =>
  `GHS ${v.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function openReceipt(input: unknown): Promise<OpenReceiptResult> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Enter the student's ID." };
  }
  const { token, code } = parsed.data;
  try {
    const built = await withoutTenantScope(async (tx) => {
      const [r] = await tx
        .select({ schoolId: receipts.schoolId, paymentId: receipts.paymentId })
        .from(receipts)
        .where(eq(receipts.publicToken, token))
        .limit(1);
      if (!r) return null;
      return buildReceiptData(tx, r.schoolId, r.paymentId);
    });
    if (!built) return { ok: false, error: "This receipt link is no longer valid." };

    if (norm(built.studentCode) !== norm(code)) {
      return {
        ok: false,
        error: "That student ID doesn't match this receipt. Please check and try again.",
      };
    }

    const pdf = await renderReceiptPdf(built.data);
    return {
      ok: true,
      pdfBase64: pdf.toString("base64"),
      filename: `Receipt-${built.data.receiptNumber}.pdf`,
      receiptNumber: built.data.receiptNumber,
      amount: ghs(built.data.amount),
    };
  } catch {
    return { ok: false, error: "Could not open the receipt. Please try again." };
  }
}
