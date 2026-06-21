import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import { students, invoices, payments, receipts } from "@/db/schema";
import { num, daysOverdue } from "@/lib/fees-helpers";
import { IssueInvoiceForm } from "@/components/fees/issue-invoice-form";
import { RecordPaymentForm } from "@/components/fees/record-payment-form";
import { VoidPaymentButton } from "@/components/fees/void-payment-button";

export const dynamic = "force-dynamic";

const ghs = (v: number) => `GHS ${v.toFixed(2)}`;

const INV_STATUS: Record<string, string> = {
  ISSUED: "bg-warn-bg text-warn",
  PARTIAL: "bg-gold-bg text-navy",
  PAID: "bg-green-bg text-green",
  OVERDUE: "bg-terra-bg text-terra",
  VOIDED: "bg-bg text-navy-3",
  DRAFT: "bg-bg text-navy-3",
  EXEMPT: "bg-bg text-navy-3",
};

export default async function StudentFeesPage({
  params,
}: {
  params: { studentId: string };
}) {
  const { school } = await requireSchool();
  const data = await withSchool(school.id, async (tx) => {
    const [student] = await tx
      .select()
      .from(students)
      .where(and(eq(students.id, params.studentId), eq(students.schoolId, school.id)));
    if (!student) return null;
    const invs = await tx
      .select()
      .from(invoices)
      .where(eq(invoices.studentId, student.id))
      .orderBy(desc(invoices.issuedAt));
    const pays = await tx
      .select({
        id: payments.id,
        grossAmount: payments.grossAmount,
        method: payments.method,
        settlementStatus: payments.settlementStatus,
        recordedAt: payments.recordedAt,
        voidedAt: payments.voidedAt,
        voidReason: payments.voidReason,
        voidIsRefund: payments.voidIsRefund,
        receiptNumber: receipts.receiptNumber,
      })
      .from(payments)
      .leftJoin(receipts, eq(receipts.paymentId, payments.id))
      .where(eq(payments.studentId, student.id))
      .orderBy(desc(payments.recordedAt));
    return { student, invs, pays };
  });

  if (!data) notFound();
  const { student, invs, pays } = data;
  const balance = invs
    .filter((i) => i.status !== "VOIDED")
    .reduce((s, i) => s + num(i.balanceAmount), 0);
  // Outstanding invoices, oldest first (invs come newest-first), for allocation.
  const outstanding = invs
    .filter(
      (i) => i.status !== "VOIDED" && i.status !== "PAID" && num(i.balanceAmount) > 0,
    )
    .slice()
    .reverse()
    .map((i) => ({
      id: i.id,
      invoiceNumber: i.invoiceNumber,
      balance: num(i.balanceAmount),
    }));

  return (
    <div className="mx-auto max-w-page">
      <Link href="/fees" className="text-sm text-navy-3 hover:text-gold">
        ← Fees
      </Link>
      <div className="mb-6 mt-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold text-navy">
            {student.firstName} {student.lastName}
          </h1>
          <p className="font-mono text-xs text-navy-3">{student.studentCode}</p>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wide text-navy-3">Balance</div>
          <div
            className={`font-display text-3xl font-semibold ${balance > 0 ? "text-terra" : "text-green"}`}
          >
            {ghs(balance)}
          </div>
        </div>
      </div>

      <div className="mb-8 flex flex-wrap items-start gap-3">
        <RecordPaymentForm studentId={student.id} outstanding={outstanding} />
        <IssueInvoiceForm studentId={student.id} />
      </div>

      <h2 className="mb-3 font-display text-xl font-semibold text-navy">Invoices</h2>
      {invs.length === 0 ? (
        <p className="mb-8 text-sm text-navy-3">No invoices yet.</p>
      ) : (
        <div className="bg-surface mb-8 overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-bg border-b border-border text-left text-xs uppercase tracking-wide text-navy-3">
              <tr>
                <th className="px-4 py-3 font-semibold">Invoice</th>
                <th className="px-4 py-3 text-right font-semibold">Billed</th>
                <th className="px-4 py-3 text-right font-semibold">Paid</th>
                <th className="px-4 py-3 text-right font-semibold">Balance</th>
                <th className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {invs.map((i) => {
                const overdue =
                  i.status !== "VOIDED" &&
                  i.status !== "PAID" &&
                  num(i.balanceAmount) > 0
                    ? daysOverdue(i.dueAt)
                    : 0;
                return (
                  <tr key={i.id}>
                    <td className="px-4 py-3 font-mono text-xs text-navy-2">
                      {i.invoiceNumber}
                    </td>
                    <td className="px-4 py-3 text-right text-navy">
                      {ghs(num(i.billedAmount))}
                    </td>
                    <td className="px-4 py-3 text-right text-navy-2">
                      {ghs(num(i.paidAmount))}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-navy">
                      {ghs(num(i.balanceAmount))}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`rounded-pill px-2 py-0.5 text-xs font-medium ${INV_STATUS[i.status]}`}
                        >
                          {i.status.charAt(0) + i.status.slice(1).toLowerCase()}
                        </span>
                        {overdue > 0 && (
                          <span className="rounded-pill bg-terra-bg px-2 py-0.5 text-xs font-medium text-terra">
                            Overdue {overdue}d
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mb-3 font-display text-xl font-semibold text-navy">Payments</h2>
      {pays.length === 0 ? (
        <p className="text-sm text-navy-3">No payments yet.</p>
      ) : (
        <div className="bg-surface overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-bg border-b border-border text-left text-xs uppercase tracking-wide text-navy-3">
              <tr>
                <th className="px-4 py-3 font-semibold">Receipt</th>
                <th className="px-4 py-3 font-semibold">Method</th>
                <th className="px-4 py-3 text-right font-semibold">Amount</th>
                <th className="px-4 py-3 font-semibold">Settlement</th>
                <th className="px-4 py-3 font-semibold"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pays.map((p) => (
                <tr key={p.id} className={p.voidedAt ? "opacity-50" : ""}>
                  <td className="px-4 py-3 font-mono text-xs text-navy-2">
                    {p.receiptNumber ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-navy-2">
                    {p.method.replaceAll("_", " ").toLowerCase()}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-navy">
                    {ghs(num(p.grossAmount))}
                  </td>
                  <td className="px-4 py-3 text-navy-2">
                    {p.voidedAt ? (
                      <div>
                        <span className="rounded-pill bg-terra-bg px-2 py-0.5 text-xs font-medium text-terra">
                          {p.voidIsRefund ? "Refunded" : "Voided"}
                        </span>
                        {p.voidReason && (
                          <div className="mt-1 max-w-[16rem] text-xs text-navy-3">
                            {p.voidReason}
                          </div>
                        )}
                      </div>
                    ) : (
                      p.settlementStatus.charAt(0) +
                      p.settlementStatus.slice(1).toLowerCase()
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {!p.voidedAt && <VoidPaymentButton paymentId={p.id} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
