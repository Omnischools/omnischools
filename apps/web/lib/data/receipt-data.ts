import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import {
  payments,
  receipts,
  paymentAllocations,
  paymentAuditLog,
  invoices,
  students,
  studentGuardians,
  classes,
  users,
  schools,
} from "@/db/schema";
import { num } from "@/lib/fees-helpers";
import { amountInWordsGhs } from "@/lib/number-to-words";
import type { Tx } from "@/lib/db";
import type { ReceiptData } from "@/lib/pdf/receipt-document";

const METHOD_LABELS: Record<string, string> = {
  MTN_MOMO: "MTN MoMo",
  TELECEL_CASH: "Telecel Cash",
  AIRTELTIGO_MONEY: "AirtelTigo Money",
  BANK_TRANSFER: "Bank transfer",
  CASH: "Cash",
  CHEQUE: "Cheque",
  OTHER: "Other",
};
const titleize = (s: string) =>
  s.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const fmtDateTime = (d: Date | string) =>
  (d instanceof Date ? d : new Date(d))
    .toLocaleString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
    .replace(",", " ·");
const initialsOf = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "S";

/**
 * Build the presentational data for a receipt PDF from a payment. Shared by the authenticated
 * staff route (via withSchool) and the public tokened parent flow (via withoutTenantScope) —
 * one builder so a receipt renders identically either way. `schoolId` scopes every query;
 * returns null if the payment/receipt isn't found. Also returns the student's code so callers
 * that need to verify a viewer (the parent flow) don't re-query.
 */
export async function buildReceiptData(
  tx: Tx,
  schoolId: string,
  paymentId: string,
): Promise<{ data: ReceiptData; studentCode: string } | null> {
  const [p] = await tx
    .select({
      id: payments.id,
      studentId: payments.studentId,
      grossAmount: payments.grossAmount,
      method: payments.method,
      methodReference: payments.methodReference,
      paidAt: payments.paidAt,
      recordedAt: payments.recordedAt,
      voidedAt: payments.voidedAt,
      voidReason: payments.voidReason,
      voidIsRefund: payments.voidIsRefund,
      studentFirst: students.firstName,
      studentLast: students.lastName,
      studentCode: students.studentCode,
      classLabel: students.currentClassLabel,
      className: classes.name,
    })
    .from(payments)
    .innerJoin(students, eq(payments.studentId, students.id))
    .leftJoin(classes, eq(students.classId, classes.id))
    .where(and(eq(payments.id, paymentId), eq(payments.schoolId, schoolId)));
  if (!p) return null;

  const [receipt] = await tx
    .select({ receiptNumber: receipts.receiptNumber, generatedAt: receipts.generatedAt })
    .from(receipts)
    .where(eq(receipts.paymentId, p.id))
    .limit(1);
  if (!receipt) return null;

  const [sc] = await tx
    .select({ name: schools.name, address: schools.address, gesCode: schools.gesCode })
    .from(schools)
    .where(eq(schools.id, schoolId));

  const [guardian] = await tx
    .select({
      name: studentGuardians.name,
      phone: studentGuardians.phone,
      relationship: studentGuardians.relationship,
    })
    .from(studentGuardians)
    .where(eq(studentGuardians.studentId, p.studentId))
    .orderBy(desc(studentGuardians.isPrimary))
    .limit(1);

  const allocs = await tx
    .select({
      amount: paymentAllocations.amount,
      invoiceNumber: invoices.invoiceNumber,
      academicYear: invoices.academicYear,
    })
    .from(paymentAllocations)
    .innerJoin(invoices, eq(paymentAllocations.invoiceId, invoices.id))
    .where(
      and(
        eq(paymentAllocations.paymentId, p.id),
        eq(paymentAllocations.allocationType, "INVOICE"),
      ),
    )
    .orderBy(asc(paymentAllocations.allocatedAt));

  const auditRows = await tx
    .select({
      eventType: paymentAuditLog.eventType,
      actorName: users.fullName,
      createdAt: paymentAuditLog.createdAt,
    })
    .from(paymentAuditLog)
    .leftJoin(users, eq(paymentAuditLog.actorUserId, users.id))
    .where(eq(paymentAuditLog.paymentId, p.id))
    .orderBy(asc(paymentAuditLog.createdAt));

  const gross = num(p.grossAmount);
  const recordedByName = auditRows[0]?.actorName ?? null;
  const voidEvent = auditRows.find((e) => String(e.eventType).includes("VOID"));
  const schoolName = sc?.name ?? "School";
  const classLabel = p.className ?? p.classLabel ?? null;

  const lines: ReceiptData["lines"] =
    allocs.length > 0
      ? allocs.map((a) => ({
          main: "Fees payment",
          sub: `${a.academicYear ?? ""} · ${a.invoiceNumber}`.trim(),
          period: a.academicYear ?? null,
          amount: num(a.amount),
        }))
      : [{ main: "Payment on account", sub: null, period: null, amount: gross }];

  const data: ReceiptData = {
    school: {
      name: schoolName,
      initials: initialsOf(schoolName),
      addressLine: sc?.address ?? null,
      idLine: sc?.gesCode ? `School ID: ${sc.gesCode}` : null,
    },
    receiptNumber: receipt.receiptNumber,
    issuedAt: fmtDateTime(receipt.generatedAt ?? p.paidAt ?? p.recordedAt),
    payer: {
      name: guardian?.name ?? "—",
      sub: guardian ? `${guardian.phone} · ${titleize(guardian.relationship)}` : null,
    },
    student: {
      name: `${p.studentFirst} ${p.studentLast}`,
      sub: [classLabel, p.studentCode].filter(Boolean).join(" · ") || null,
    },
    amount: gross,
    amountInWords: amountInWordsGhs(gross),
    lines,
    allocations:
      allocs.length > 1
        ? allocs.map((a) => ({
            invoiceNumber: a.invoiceNumber,
            description: a.academicYear ?? "",
            amount: num(a.amount),
          }))
        : null,
    method: {
      label: METHOD_LABELS[p.method] ?? titleize(p.method),
      reference: p.methodReference,
      sub: null,
    },
    recordedBy: recordedByName ? { name: recordedByName, role: null } : null,
    context: null,
    voided: p.voidedAt
      ? {
          at: fmtDateTime(p.voidedAt),
          by: voidEvent?.actorName ?? null,
          reason: p.voidReason,
          replacement: null,
        }
      : null,
  };

  return { data, studentCode: p.studentCode };
}
