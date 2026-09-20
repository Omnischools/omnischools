import "server-only";
import { and, asc, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { withParentScope } from "@/lib/db/rls";
import type { Tx } from "@/lib/db";
import {
  invoices,
  invoiceLineItems,
  payments,
  receipts,
  students,
  academicPeriod,
} from "@/db/schema";
import { num, daysOverdue } from "@/lib/fees-helpers";

/**
 * 🔴 INCR-BILL · the PARENT-facing Billing ("Fees") reader (SHS module 4.3 × Fees · Kofi R486–R493,
 * AC-BILL-*). The 9th widening of the 19a parent boundary. SERVER-ONLY — imports the db driver, so a client
 * component must never import it (only `pnpm build` catches that leak).
 *
 * MECHANISM (owner chose narrow grants, option a): Wells's READ-ONLY `parent_scope` opens the ROWS of
 * `invoice` / `invoice_line_item` / `payment` / `receipt` to a parent session, scoped to their OWN children
 * (a parent can SELECT but not INSERT/UPDATE/DELETE — forging a payment is denied at the DB). RLS is
 * row-level and CANNOT mask a column, so THIS PROJECTION is the ONLY column guard. NEVER select / NEVER join
 * (the deny-list — these tables STAY parent_deny, so the leak is structural too): `payment_allocation`,
 * `invoice_discount_application`, `discount` / `discount_tier` (scheme + SIBLING RANK), `fee_structure*`,
 * `fee_category`, `payment_audit_log`, and on the widened tables the confidential columns —
 * `payment.{net_amount,fee_amount,aggregator,settlement_status,method_reference,currency,recorded_by,
 * voided_by,void_reason}`, `receipt.{pdf_url}`, `invoice.{subtotal_amount,void internals}`. The discount is
 * shown ONLY as the denormalised scalar `invoice.discount_amount` — no scheme/rank table is reached.
 *
 * Own children only (RLS `student_id IN parent_student_ids`); a household sibling discount surfaces solely as
 * the NET `billed` on each child's own invoice, never another child's amount or the rank. Read-only by
 * construction — no write, no gateway, no "pay now". DRAFT + VOIDED invoices are excluded (a draft isn't
 * issued; a void was never owed). `outstanding` is computed `billed − paid` (must equal stored balance).
 */

export type BillStatus = "Paid" | "Partly paid" | "Unpaid" | "Overdue" | "Covered";

export type ParentBillingLineItem = { description: string; amount: string; isOptional: boolean };
export type ParentBillingInvoice = {
  invoiceNumber: string;
  termLabel: string | null; // academic_period.period_label (parent-readable since #278), else null
  academicYear: string;
  billed: string; // formatted GHS
  paid: string;
  outstanding: string;
  discount: string | null; // the net total scalar, only when > 0 (never the scheme/rank)
  status: BillStatus;
  dueLabel: string | null;
  lineItems: ParentBillingLineItem[];
};
export type ParentBillingReceipt = {
  date: string;
  method: string; // friendly label
  amount: string; // gross tendered
  receiptNumber: string;
  receiptLink: string | null; // /r/{token} when a public token exists
  voided: boolean;
  voidLabel: string | null; // "Refunded" | "Voided" when voided
};
export type ParentBillingChild = {
  name: string;
  studentCode: string;
  billed: string; // Σ own non-void invoices, formatted (the triad)
  paid: string;
  outstanding: string;
  outstandingValue: number; // raw, for the aggregate + zero-state
  invoices: ParentBillingInvoice[];
  receipts: ParentBillingReceipt[];
};
export type ParentBilling = {
  children: ParentBillingChild[];
  totalOutstanding: string; // Σ across the parent's own children (active school)
  totalOutstandingValue: number;
};

/* ── pure helpers (no db) ────────────────────────────────────────────────────────────────────── */

/** GHS with thousands separators (the Billing localiser — grouped digits read better on a statement). */
export const ghs = (n: number): string =>
  `GHS ${n.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Derive the parent-facing status from the stored status + the money + whether the invoice is overdue
 * (pure, unit-tested). `overdue` is the caller's `daysOverdue(dueAt) > 0` — the SAME full-day threshold the
 * staff billing dashboard uses, so a parent never sees "Overdue" a day before the office does (Dex MIN-1).
 */
export function billStatus(
  stored: string,
  paid: number,
  outstanding: number,
  overdue: boolean,
): BillStatus {
  if (stored === "EXEMPT") return "Covered"; // Free-SHS / bursary — a real zero-balance, not a fabricated bill
  if (outstanding <= 0) return "Paid";
  if (overdue) return "Overdue";
  if (paid > 0) return "Partly paid";
  return "Unpaid";
}

const METHOD_LABEL: Record<string, string> = {
  MTN_MOMO: "MTN MoMo",
  TELECEL_CASH: "Telecel Cash",
  AIRTELTIGO_MONEY: "AirtelTigo Money",
  BANK_TRANSFER: "Bank transfer",
  CASH: "Cash",
  CHEQUE: "Cheque",
  OTHER: "Other",
};
const methodLabel = (m: string): string => METHOD_LABEL[m] ?? "Other";

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
});
const dayLabel = (d: Date): string => DATE.format(d);

/* ── the loader ──────────────────────────────────────────────────────────────────────────────── */

/** MUST run on a `tx` already scoped by `withParentScope`. */
export async function loadParentBillingTx(tx: Tx, schoolId: string): Promise<ParentBilling> {
  // The parent's own children (RLS scopes `students` to own children). No child columns beyond these.
  const kids = await tx
    .select({
      id: students.id,
      firstName: students.firstName,
      lastName: students.lastName,
      studentCode: students.studentCode,
    })
    .from(students)
    .where(eq(students.schoolId, schoolId))
    .orderBy(asc(students.firstName));
  if (kids.length === 0) return { children: [], totalOutstanding: ghs(0), totalOutstandingValue: 0 };

  const childIds = kids.map((k) => k.id);

  // Invoices — own children, ISSUED reality only (DRAFT never issued; VOIDED never owed). term label via
  // academic_period (parent-readable since #278). Column guard: only the safe scalars.
  const invRows = await tx
    .select({
      id: invoices.id,
      studentId: invoices.studentId,
      invoiceNumber: invoices.invoiceNumber,
      academicYear: invoices.academicYear,
      termLabel: academicPeriod.periodLabel,
      billed: invoices.billedAmount,
      paid: invoices.paidAmount,
      discount: invoices.discountAmount,
      status: invoices.status,
      dueAt: invoices.dueAt,
    })
    .from(invoices)
    .leftJoin(
      academicPeriod,
      and(eq(academicPeriod.schoolId, invoices.schoolId), eq(academicPeriod.periodId, invoices.periodId)),
    )
    .where(
      and(
        eq(invoices.schoolId, schoolId),
        inArray(invoices.studentId, childIds),
        isNull(invoices.voidedAt),
        ne(invoices.status, "DRAFT"),
        ne(invoices.status, "VOIDED"),
      ),
    )
    .orderBy(desc(invoices.issuedAt));

  // Line items for those invoices — own-child breakdown; description/amount/isOptional ONLY.
  const invIds = invRows.map((r) => r.id);
  const liRows = invIds.length
    ? await tx
        .select({
          invoiceId: invoiceLineItems.invoiceId,
          description: invoiceLineItems.description,
          amount: invoiceLineItems.amount,
          isOptional: invoiceLineItems.isOptional,
        })
        .from(invoiceLineItems)
        .where(and(eq(invoiceLineItems.schoolId, schoolId), inArray(invoiceLineItems.invoiceId, invIds)))
    : [];
  // ponytail: a PTA-dues line item (the pta_dues_charge → invoice_line_item bridge) shows here by its
  // description AND on the PTA tab — a defensible v1 (honest, own-child). Exclude-or-label is the fast-follow.
  const liByInvoice = new Map<string, ParentBillingLineItem[]>();
  for (const li of liRows) {
    const arr = liByInvoice.get(li.invoiceId) ?? [];
    arr.push({ description: li.description, amount: ghs(num(li.amount)), isOptional: li.isOptional });
    liByInvoice.set(li.invoiceId, arr);
  }

  // Payments + their receipt (1:1). gross tendered, method, date, receipt number + /r/ link. NEVER
  // net/fee/aggregator/settlement/ref/staff — not selected.
  const payRows = await tx
    .select({
      studentId: payments.studentId,
      gross: payments.grossAmount,
      method: payments.method,
      paidAt: payments.paidAt,
      voidedAt: payments.voidedAt,
      voidIsRefund: payments.voidIsRefund,
      receiptNumber: receipts.receiptNumber,
      publicToken: receipts.publicToken,
    })
    .from(payments)
    .leftJoin(receipts, and(eq(receipts.schoolId, payments.schoolId), eq(receipts.paymentId, payments.id)))
    .where(and(eq(payments.schoolId, schoolId), inArray(payments.studentId, childIds)))
    .orderBy(desc(payments.paidAt));

  const children: ParentBillingChild[] = kids.map((kid) => {
    const myInv = invRows.filter((r) => r.studentId === kid.id);
    const invoicesOut: ParentBillingInvoice[] = myInv.map((r) => {
      const billed = num(r.billed);
      const paid = num(r.paid);
      const outstanding = billed - paid;
      const disc = num(r.discount);
      return {
        invoiceNumber: r.invoiceNumber,
        termLabel: r.termLabel,
        academicYear: r.academicYear,
        billed: ghs(billed),
        paid: ghs(paid),
        outstanding: ghs(outstanding),
        discount: disc > 0 ? ghs(disc) : null,
        status: billStatus(r.status, paid, outstanding, daysOverdue(r.dueAt) > 0),
        dueLabel: r.dueAt ? dayLabel(r.dueAt) : null,
        lineItems: liByInvoice.get(r.id) ?? [],
      };
    });
    const billedTotal = myInv.reduce((s, r) => s + num(r.billed), 0);
    const paidTotal = myInv.reduce((s, r) => s + num(r.paid), 0);
    const outstandingValue = billedTotal - paidTotal;

    const myPay = payRows.filter((p) => p.studentId === kid.id);
    const receiptsOut: ParentBillingReceipt[] = myPay.map((p) => ({
      date: dayLabel(p.paidAt),
      method: methodLabel(p.method),
      amount: ghs(num(p.gross)),
      receiptNumber: p.receiptNumber ?? "—",
      receiptLink: p.publicToken ? `/r/${p.publicToken}` : null,
      voided: p.voidedAt != null,
      voidLabel: p.voidedAt != null ? (p.voidIsRefund ? "Refunded" : "Voided") : null,
    }));

    return {
      name: `${kid.firstName} ${kid.lastName}`.trim(),
      studentCode: kid.studentCode,
      billed: ghs(billedTotal),
      paid: ghs(paidTotal),
      outstanding: ghs(outstandingValue),
      outstandingValue,
      invoices: invoicesOut,
      receipts: receiptsOut,
    };
  });

  const totalOutstandingValue = children.reduce((s, c) => s + c.outstandingValue, 0);
  return { children, totalOutstanding: ghs(totalOutstandingValue), totalOutstandingValue };
}

/** Entry point — the parent's fee statement (own children) under `withParentScope` (never `withSchool`). */
export async function loadParentBilling(schoolId: string, userId: string): Promise<ParentBilling> {
  return withParentScope(schoolId, userId, (tx) => loadParentBillingTx(tx, schoolId));
}
