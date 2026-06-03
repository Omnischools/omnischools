import { eq, sql } from "drizzle-orm";
import { invoices, receipts } from "@/db/schema";
import type { Tx } from "@/lib/db";

/** Round to 2 dp, avoiding binary float drift. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** A money string ("340.00") for numeric columns. */
export function toMoney(n: number): string {
  return round2(n).toFixed(2);
}

/** Parse a numeric column (string) to a number. */
export function num(v: string | number | null | undefined): number {
  return v == null ? 0 : Number(v);
}

function yy(): string {
  return String(new Date().getFullYear() % 100).padStart(2, "0");
}

export async function nextInvoiceNumber(tx: Tx, schoolId: string): Promise<string> {
  const [{ count }] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(invoices)
    .where(eq(invoices.schoolId, schoolId));
  return `INV${yy()}${String(count + 1).padStart(4, "0")}`;
}

export async function nextReceiptNumber(tx: Tx, schoolId: string): Promise<string> {
  const [{ count }] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(receipts)
    .where(eq(receipts.schoolId, schoolId));
  return `RCT${yy()}${String(count + 1).padStart(4, "0")}`;
}

/** MVP1 settlement status by method (cash settles immediately; momo/bank confirmed). */
export function settlementFor(method: string): "SETTLED" | "CONFIRMED" | "PENDING" {
  if (method === "CASH") return "SETTLED";
  if (
    method === "BANK_TRANSFER" ||
    method.endsWith("_MOMO") ||
    method.endsWith("_MONEY") ||
    method === "TELECEL_CASH"
  )
    return "CONFIRMED";
  return "PENDING";
}
