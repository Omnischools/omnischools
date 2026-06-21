"use server";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { withSchool } from "@/lib/db/rls";
import { recordAudit } from "@/lib/db/audit";
import { requireSchool, resolveActor } from "@/lib/auth/server";
import { sendSms } from "@/lib/sms";
import { safeRevalidate } from "@/lib/revalidate";
import {
  num,
  round2,
  toMoney,
  nextInvoiceNumber,
  nextReceiptNumber,
  settlementFor,
} from "@/lib/fees-helpers";
import {
  students,
  studentGuardians,
  invoices,
  invoiceLineItems,
  payments,
  paymentAllocations,
  receipts,
  paymentAuditLog,
} from "@/db/schema";

// ---------------------------------------------------------------- issue invoice
const LineItemSchema = z.object({
  description: z.string().min(1).max(200),
  amount: z.coerce.number().positive("Amount must be > 0"),
  feeCategoryId: z.string().uuid().optional().or(z.literal("")),
});
const IssueInvoiceSchema = z.object({
  studentId: z.string().uuid(),
  periodId: z.string().uuid().optional().or(z.literal("")),
  dueAt: z.string().optional().or(z.literal("")),
  discountAmount: z.coerce.number().min(0).default(0),
  lineItems: z.array(LineItemSchema).min(1, "Add at least one line item"),
});

export type IssueInvoiceResult =
  | { ok: true; invoiceId: string; invoiceNumber: string; billed: number }
  | { ok: false; error: string };

export async function issueInvoice(input: unknown): Promise<IssueInvoiceResult> {
  const { school } = await requireSchool();
  const parsed = IssueInvoiceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid invoice" };
  }
  const d = parsed.data;
  const actor = await resolveActor(school.id);

  try {
    const out = await withSchool(school.id, async (tx) => {
      const [student] = await tx
        .select({ id: students.id })
        .from(students)
        .where(and(eq(students.id, d.studentId), eq(students.schoolId, school.id)));
      if (!student) return { ok: false as const, error: "Student not found." };

      const subtotal = round2(d.lineItems.reduce((s, li) => s + li.amount, 0));
      const discount = round2(d.discountAmount);
      const billed = round2(subtotal - discount);
      if (billed < 0) return { ok: false as const, error: "Discount exceeds subtotal." };

      const invoiceNumber = await nextInvoiceNumber(tx, school.id);
      const now = new Date();
      const startYear = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
      const academicYear = `${startYear}/${String((startYear + 1) % 100).padStart(2, "0")}`;
      const [inv] = await tx
        .insert(invoices)
        .values({
          schoolId: school.id,
          studentId: d.studentId,
          invoiceNumber,
          academicYear,
          periodId: d.periodId || null,
          subtotalAmount: toMoney(subtotal),
          discountAmount: toMoney(discount),
          billedAmount: toMoney(billed),
          paidAmount: "0.00",
          balanceAmount: toMoney(billed),
          status: "ISSUED",
          dueAt: d.dueAt ? new Date(d.dueAt) : null,
        })
        .returning();

      await tx.insert(invoiceLineItems).values(
        d.lineItems.map((li) => ({
          schoolId: school.id,
          invoiceId: inv.id,
          feeCategoryId: li.feeCategoryId || null,
          description: li.description,
          amount: toMoney(li.amount),
        })),
      );

      await recordAudit(tx, {
        schoolId: school.id,
        actorUserId: actor.id ?? undefined,
        actorRole: actor.role,
        actionType: "created",
        entityType: "invoice",
        entityId: inv.id,
        after: { invoiceNumber, billed: toMoney(billed) },
        reason: "Invoice issued",
      });

      return { ok: true as const, invoiceId: inv.id, invoiceNumber, billed };
    });

    if (!out.ok) return out;
    safeRevalidate("/fees");
    safeRevalidate(`/fees/${d.studentId}`);
    return out;
  } catch {
    return { ok: false, error: "Could not issue the invoice. Please try again." };
  }
}

// --------------------------------------------------------------- record payment
const RecordPaymentSchema = z.object({
  studentId: z.string().uuid(),
  method: z.enum([
    "MTN_MOMO",
    "TELECEL_CASH",
    "AIRTELTIGO_MONEY",
    "BANK_TRANSFER",
    "CASH",
    "CHEQUE",
    "OTHER",
  ]),
  grossAmount: z.coerce.number().positive("Amount must be > 0"),
  methodReference: z.string().max(120).optional().or(z.literal("")),
  /**
   * Optional manual split across specific invoices. When omitted (or all zero),
   * the payment auto-allocates oldest-invoice-first. Any amount beyond the
   * allocations (or beyond outstanding balances) is held as credit.
   */
  allocations: z
    .array(
      z.object({
        invoiceId: z.string().uuid(),
        amount: z.coerce.number().min(0),
      }),
    )
    .optional(),
});

export type RecordPaymentResult =
  | {
      ok: true;
      paymentId: string;
      receiptNumber: string;
      allocated: number;
      credit: number;
    }
  | { ok: false; error: string };

export async function recordPayment(input: unknown): Promise<RecordPaymentResult> {
  const { school } = await requireSchool();
  const parsed = RecordPaymentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid payment" };
  }
  const d = parsed.data;
  const actor = await resolveActor(school.id);

  try {
    const out = await withSchool(school.id, async (tx) => {
      const [student] = await tx
        .select({ id: students.id })
        .from(students)
        .where(and(eq(students.id, d.studentId), eq(students.schoolId, school.id)));
      if (!student) return { ok: false as const, error: "Student not found." };

      const gross = round2(d.grossAmount);
      const [payment] = await tx
        .insert(payments)
        .values({
          schoolId: school.id,
          studentId: d.studentId,
          recordedByUserId: actor.id ?? undefined,
          grossAmount: toMoney(gross),
          netAmount: toMoney(gross),
          method: d.method,
          methodReference: d.methodReference || null,
          settlementStatus: settlementFor(d.method),
        })
        .returning();

      await tx.insert(paymentAuditLog).values({
        schoolId: school.id,
        paymentId: payment.id,
        eventType: "CREATED",
        actorUserId: actor.id ?? undefined,
        afterState: { gross: toMoney(gross), method: d.method },
      });

      const outstanding = await tx
        .select()
        .from(invoices)
        .where(
          and(
            eq(invoices.schoolId, school.id),
            eq(invoices.studentId, d.studentId),
            inArray(invoices.status, ["ISSUED", "PARTIAL", "OVERDUE"]),
            sql`${invoices.balanceAmount} > 0`,
          ),
        )
        .orderBy(asc(invoices.issuedAt));

      // Build the allocation plan: a manual per-invoice split when one is given,
      // else auto oldest-invoice-first. Manual entries are validated against the
      // current outstanding balances before anything is written.
      type PlanEntry = {
        inv: (typeof outstanding)[number];
        applied: number;
        method: "MANUAL" | "AUTO_OLDEST_FIRST";
      };
      const byId = new Map(outstanding.map((inv) => [inv.id, inv] as const));
      const manualByInvoice = new Map<string, number>();
      for (const a of d.allocations ?? []) {
        const amt = round2(a.amount);
        if (amt <= 0) continue;
        manualByInvoice.set(a.invoiceId, round2((manualByInvoice.get(a.invoiceId) ?? 0) + amt));
      }

      const plan: PlanEntry[] = [];
      if (manualByInvoice.size > 0) {
        let manualTotal = 0;
        for (const [invoiceId, applied] of Array.from(manualByInvoice)) {
          const inv = byId.get(invoiceId);
          if (!inv) {
            return {
              ok: false as const,
              error: "An allocation target is not an outstanding invoice.",
            };
          }
          if (applied > num(inv.balanceAmount)) {
            return {
              ok: false as const,
              error: `Allocation to ${inv.invoiceNumber} exceeds its balance.`,
            };
          }
          manualTotal = round2(manualTotal + applied);
          plan.push({ inv, applied, method: "MANUAL" });
        }
        if (manualTotal > gross) {
          return { ok: false as const, error: "Allocations exceed the payment amount." };
        }
      } else {
        let rem = gross;
        for (const inv of outstanding) {
          if (rem <= 0) break;
          const applied = round2(Math.min(num(inv.balanceAmount), rem));
          if (applied <= 0) continue;
          plan.push({ inv, applied, method: "AUTO_OLDEST_FIRST" });
          rem = round2(rem - applied);
        }
      }

      let remaining = gross;
      let allocated = 0;
      for (const { inv, applied, method } of plan) {
        await tx.insert(paymentAllocations).values({
          schoolId: school.id,
          paymentId: payment.id,
          invoiceId: inv.id,
          allocationType: "INVOICE",
          amount: toMoney(applied),
          allocationMethod: method,
          allocatedByUserId: actor.id ?? undefined,
        });

        const newPaid = round2(num(inv.paidAmount) + applied);
        const newBal = round2(num(inv.billedAmount) - newPaid);
        await tx
          .update(invoices)
          .set({
            paidAmount: toMoney(newPaid),
            balanceAmount: toMoney(newBal),
            status: newBal <= 0 ? "PAID" : "PARTIAL",
            paidAt: newBal <= 0 ? new Date() : null,
          })
          .where(eq(invoices.id, inv.id));

        await tx.insert(paymentAuditLog).values({
          schoolId: school.id,
          paymentId: payment.id,
          invoiceId: inv.id,
          eventType: "ALLOCATION_ADDED",
          actorUserId: actor.id ?? undefined,
          afterState: { applied: toMoney(applied), invoice: inv.invoiceNumber, method },
        });

        remaining = round2(remaining - applied);
        allocated = round2(allocated + applied);
      }

      // overpayment → unapplied credit
      const credit = round2(remaining);
      if (credit > 0) {
        await tx.insert(paymentAllocations).values({
          schoolId: school.id,
          paymentId: payment.id,
          invoiceId: null,
          allocationType: "CREDIT",
          amount: toMoney(credit),
          allocationMethod: "MANUAL",
          allocatedByUserId: actor.id ?? undefined,
        });
      }

      const receiptNumber = await nextReceiptNumber(tx, school.id);
      await tx.insert(receipts).values({
        schoolId: school.id,
        paymentId: payment.id,
        receiptNumber,
        studentId: d.studentId,
      });

      return {
        ok: true as const,
        paymentId: payment.id,
        receiptNumber,
        allocated,
        credit,
      };
    });

    if (!out.ok) return out;

    // guardian receipt SMS (stub)
    const [guardian] = await withSchool(school.id, (tx) =>
      tx
        .select({ phone: studentGuardians.phone })
        .from(studentGuardians)
        .where(
          and(
            eq(studentGuardians.studentId, d.studentId),
            eq(studentGuardians.isPrimary, true),
          ),
        )
        .limit(1),
    );
    if (guardian) {
      await sendSms(
        guardian.phone,
        `${school.shortName ?? "Omnischools"}: Payment of GHS ${toMoney(d.grossAmount)} received. Receipt ${out.receiptNumber}. Thank you.`,
      );
    }

    safeRevalidate("/fees");
    safeRevalidate(`/fees/${d.studentId}`);
    return out;
  } catch {
    return { ok: false, error: "Could not record the payment. Please try again." };
  }
}

// ----------------------------------------------------------------- void payment
const VoidPaymentSchema = z.object({
  paymentId: z.string().uuid(),
  reason: z
    .string()
    .trim()
    .min(3, "Give a reason for voiding (at least 3 characters).")
    .max(300),
  isRefund: z.coerce.boolean().default(false),
});

export type VoidPaymentResult = { ok: true } | { ok: false; error: string };

export async function voidPayment(input: unknown): Promise<VoidPaymentResult> {
  const { school } = await requireSchool();
  const parsed = VoidPaymentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }
  const d = parsed.data;
  const actor = await resolveActor(school.id);

  try {
    const out = await withSchool(school.id, async (tx) => {
      const [payment] = await tx
        .select()
        .from(payments)
        .where(and(eq(payments.id, d.paymentId), eq(payments.schoolId, school.id)));
      if (!payment) return { ok: false as const, error: "Payment not found." };
      if (payment.voidedAt) return { ok: false as const, error: "Already voided." };

      const allocs = await tx
        .select()
        .from(paymentAllocations)
        .where(
          and(
            eq(paymentAllocations.paymentId, payment.id),
            eq(paymentAllocations.allocationType, "INVOICE"),
          ),
        );

      for (const a of allocs) {
        if (a.voidedAt || !a.invoiceId) continue;
        const [inv] = await tx
          .select()
          .from(invoices)
          .where(eq(invoices.id, a.invoiceId));
        if (inv) {
          const newPaid = round2(num(inv.paidAmount) - num(a.amount));
          const newBal = round2(num(inv.billedAmount) - newPaid);
          await tx
            .update(invoices)
            .set({
              paidAmount: toMoney(Math.max(0, newPaid)),
              balanceAmount: toMoney(newBal),
              status: newPaid <= 0 ? "ISSUED" : "PARTIAL",
              paidAt: null,
            })
            .where(eq(invoices.id, inv.id));
        }
        await tx
          .update(paymentAllocations)
          .set({ voidedAt: new Date() })
          .where(eq(paymentAllocations.id, a.id));
      }

      await tx
        .update(payments)
        .set({
          voidedAt: new Date(),
          voidedByUserId: actor.id ?? undefined,
          voidReason: d.reason,
          voidIsRefund: d.isRefund,
        })
        .where(eq(payments.id, payment.id));
      await tx
        .update(receipts)
        .set({ voidedAt: new Date() })
        .where(eq(receipts.paymentId, payment.id));

      await tx.insert(paymentAuditLog).values({
        schoolId: school.id,
        paymentId: payment.id,
        eventType: "VOIDED",
        actorUserId: actor.id ?? undefined,
        beforeState: { settlementStatus: payment.settlementStatus },
        afterState: { isRefund: d.isRefund, reason: d.reason },
        notes: `${d.isRefund ? "Refunded" : "Voided"}: ${d.reason}`,
      });

      return { ok: true as const, studentId: payment.studentId };
    });

    if (!out.ok) return out;
    safeRevalidate("/fees");
    safeRevalidate(`/fees/${out.studentId}`);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not void the payment. Please try again." };
  }
}
