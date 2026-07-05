import { and, asc, desc, eq } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
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
import { renderReceiptPdf } from "@/lib/pdf/render-receipt";
import type { ReceiptData } from "@/lib/pdf/receipt-document";

// @react-pdf/renderer is Node-only (fontkit); never run this on the edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
 * GET /api/receipts/[paymentId] — the authenticated staff receipt download. Renders the
 * receipt for a payment to a PDF and streams it inline. Scoped to the caller's school via
 * requireSchool + withSchool, so a staffer can only ever pull their own school's receipts.
 * (The public, tokened parent-facing link is a separate slice.)
 */
export async function GET(
  _req: Request,
  { params }: { params: { paymentId: string } },
) {
  const { school } = await requireSchool();

  const built = await withSchool(school.id, async (tx): Promise<ReceiptData | null> => {
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
      .where(and(eq(payments.id, params.paymentId), eq(payments.schoolId, school.id)));
    if (!p) return null;

    const [receipt] = await tx
      .select({
        receiptNumber: receipts.receiptNumber,
        generatedAt: receipts.generatedAt,
      })
      .from(receipts)
      .where(eq(receipts.paymentId, p.id))
      .limit(1);
    if (!receipt) return null; // no receipt on record → nothing to render

    const [sc] = await tx
      .select({ name: schools.name, address: schools.address, gesCode: schools.gesCode })
      .from(schools)
      .where(eq(schools.id, school.id));

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

    const schoolName = sc?.name ?? school.name;
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

    return {
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
        sub: guardian
          ? `${guardian.phone} · ${titleize(guardian.relationship)}`
          : null,
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
  });

  if (!built) {
    return new Response("Receipt not found", { status: 404 });
  }

  const pdf = await renderReceiptPdf(built);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Receipt-${built.receiptNumber}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
