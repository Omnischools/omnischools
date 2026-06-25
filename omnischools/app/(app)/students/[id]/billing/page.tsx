import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import { students, invoices, payments, receipts, discounts } from "@/db/schema";
import { num, daysOverdue } from "@/lib/fees-helpers";
import { IssueInvoiceForm } from "@/components/fees/issue-invoice-form";
import { RecordPaymentForm } from "@/components/fees/record-payment-form";
import { EmptyState } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";

const ghs = (v: number) =>
  `GHS ${v.toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
const titleize = (s: string) =>
  s.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const fmtDate = (d: Date | string) =>
  (d instanceof Date ? d : new Date(d)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

const INV_STATUS: Record<string, string> = {
  ISSUED: "bg-warn-bg text-warn",
  PARTIAL: "bg-gold-bg text-navy",
  PAID: "bg-green-bg text-green",
  OVERDUE: "bg-terra-bg text-terra",
  VOIDED: "bg-bg text-navy-3",
  DRAFT: "bg-bg text-navy-3",
  EXEMPT: "bg-bg text-navy-3",
};

export default async function StudentBillingPage({
  params,
}: {
  params: { id: string };
}) {
  const { school } = await requireSchool();

  const data = await withSchool(school.id, async (tx) => {
    const [student] = await tx
      .select()
      .from(students)
      .where(and(eq(students.id, params.id), eq(students.schoolId, school.id)));
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
        voidIsRefund: payments.voidIsRefund,
        receiptNumber: receipts.receiptNumber,
      })
      .from(payments)
      .leftJoin(receipts, eq(receipts.paymentId, payments.id))
      .where(eq(payments.studentId, student.id))
      .orderBy(desc(payments.recordedAt));

    const schemes = await tx
      .select({
        id: discounts.id,
        name: discounts.name,
        kind: discounts.kind,
        value: discounts.value,
        isTiered: discounts.isTiered,
      })
      .from(discounts)
      .where(and(eq(discounts.schoolId, school.id), eq(discounts.active, true)))
      .orderBy(discounts.name);

    return { student, invs, pays, schemes };
  });

  if (!data) notFound();
  const { student, invs, pays, schemes } = data;
  const studentName = `${student.firstName} ${student.lastName}`;

  const live = invs.filter((i) => i.status !== "VOIDED");
  const totalBilled = live.reduce((s, i) => s + num(i.billedAmount), 0);
  const totalPaid = live.reduce((s, i) => s + num(i.paidAmount), 0);
  const balance = live.reduce((s, i) => s + num(i.balanceAmount), 0);

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
      {/* Crumb */}
      <div className="text-xs text-navy-3">
        <Link href="/students" className="text-gold hover:underline">
          Students
        </Link>{" "}
        /{" "}
        <Link href={`/students/${student.id}`} className="text-gold hover:underline">
          {studentName}
        </Link>{" "}
        / Billing
      </div>

      {/* Header */}
      <div className="mb-8 mt-2">
        <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-gold">
          Billing · {studentName}
        </div>
        <h1 className="mt-1 font-display text-3xl font-semibold text-navy">
          {student.firstName} <em className="not-italic text-gold">{student.lastName}</em>
        </h1>
        <p className="font-mono text-xs text-navy-3">{student.studentCode}</p>
      </div>

      {/* Summary cards */}
      <div className="mb-8 grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
        <Summary label="Total billed" value={ghs(totalBilled)} tone="text-navy" />
        <Summary label="Total paid" value={ghs(totalPaid)} tone="text-green" />
        <Summary
          label="Outstanding balance"
          value={ghs(balance)}
          tone={balance > 0 ? "text-terra" : "text-green"}
        />
      </div>

      {/* Write actions — billing is the accountant's job, so both forms show. */}
      <div className="mb-8 flex flex-wrap items-start gap-3">
        <RecordPaymentForm studentId={student.id} outstanding={outstanding} />
        <IssueInvoiceForm
          studentId={student.id}
          schemes={schemes.map((s) => ({
            id: s.id,
            name: s.name,
            kind: s.kind,
            value: num(s.value),
            isTiered: s.isTiered,
          }))}
        />
      </div>

      {/* Invoices */}
      <h2 className="mb-3 font-display text-xl font-semibold text-navy">Invoices</h2>
      {invs.length === 0 ? (
        <EmptyState tone="muted" className="mb-8">
          No invoices yet.
        </EmptyState>
      ) : (
        <div className="mb-8 overflow-hidden rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-bg text-left text-xs uppercase tracking-wide text-navy-3">
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

      {/* Payments */}
      <h2 className="mb-3 font-display text-xl font-semibold text-navy">Payments</h2>
      {pays.length === 0 ? (
        <EmptyState tone="muted">No payments yet.</EmptyState>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-bg text-left text-xs uppercase tracking-wide text-navy-3">
              <tr>
                <th className="px-4 py-3 font-semibold">Receipt</th>
                <th className="px-4 py-3 font-semibold">Method</th>
                <th className="px-4 py-3 text-right font-semibold">Amount</th>
                <th className="px-4 py-3 font-semibold">Date</th>
                <th className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pays.map((p) => (
                <tr
                  key={p.id}
                  className={`transition-colors hover:bg-bg ${p.voidedAt ? "opacity-50" : ""}`}
                >
                  <td className="px-4 py-3 font-mono text-xs text-navy-2">
                    <Link
                      href={`/billing/payments/${p.id}`}
                      className="hover:text-gold hover:underline"
                    >
                      {p.receiptNumber ?? p.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-navy-2">
                    <Link href={`/billing/payments/${p.id}`} className="block">
                      {titleize(p.method)}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-navy">
                    <Link href={`/billing/payments/${p.id}`} className="block">
                      {ghs(num(p.grossAmount))}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-navy-3">
                    <Link href={`/billing/payments/${p.id}`} className="block">
                      {fmtDate(p.recordedAt)}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/billing/payments/${p.id}`} className="block">
                      {p.voidedAt ? (
                        <span
                          className={`rounded-pill px-2 py-0.5 text-xs font-medium ${
                            p.voidIsRefund
                              ? "bg-gold-bg text-navy"
                              : "bg-terra-bg text-terra"
                          }`}
                        >
                          {p.voidIsRefund ? "Refunded" : "Voided"}
                        </span>
                      ) : (
                        <span className="text-navy-2">
                          {p.settlementStatus.charAt(0) +
                            p.settlementStatus.slice(1).toLowerCase()}
                        </span>
                      )}
                    </Link>
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

function Summary({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <div className="bg-surface p-5">
      <div className="text-[9px] font-bold uppercase tracking-[0.1em] text-navy-3">
        {label}
      </div>
      <div className={`mt-1 font-display text-2xl font-semibold ${tone}`}>{value}</div>
    </div>
  );
}
