import Link from "next/link";
import { notFound } from "next/navigation";
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
} from "@/db/schema";
import { num } from "@/lib/fees-helpers";
import { VoidRefundDrawer } from "@/components/billing/void-refund-drawer";

export const dynamic = "force-dynamic";

const ghs = (v: number) =>
  `GHS ${v.toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
const titleize = (s: string) =>
  s.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const fmtDateTime = (d: Date | string) =>
  (d instanceof Date ? d : new Date(d)).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export default async function PaymentDetailPage(
  props: {
    params: Promise<{ paymentId: string }>;
  }
) {
  const params = await props.params;
  const { school } = await requireSchool();

  const data = await withSchool(school.id, async (tx) => {
    const [payment] = await tx
      .select({
        id: payments.id,
        studentId: payments.studentId,
        grossAmount: payments.grossAmount,
        netAmount: payments.netAmount,
        method: payments.method,
        methodReference: payments.methodReference,
        settlementStatus: payments.settlementStatus,
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
    if (!payment) return null;

    const [guardian] = await tx
      .select({ name: studentGuardians.name, phone: studentGuardians.phone })
      .from(studentGuardians)
      .where(eq(studentGuardians.studentId, payment.studentId))
      .orderBy(desc(studentGuardians.isPrimary))
      .limit(1);

    const [receipt] = await tx
      .select({
        receiptNumber: receipts.receiptNumber,
        generatedAt: receipts.generatedAt,
        voidedAt: receipts.voidedAt,
      })
      .from(receipts)
      .where(eq(receipts.paymentId, payment.id))
      .limit(1);

    const allocs = await tx
      .select({
        id: paymentAllocations.id,
        allocationType: paymentAllocations.allocationType,
        amount: paymentAllocations.amount,
        voidedAt: paymentAllocations.voidedAt,
        invoiceId: paymentAllocations.invoiceId,
        invoiceNumber: invoices.invoiceNumber,
        academicYear: invoices.academicYear,
      })
      .from(paymentAllocations)
      .leftJoin(invoices, eq(paymentAllocations.invoiceId, invoices.id))
      .where(eq(paymentAllocations.paymentId, payment.id))
      .orderBy(asc(paymentAllocations.allocatedAt));

    const audit = await tx
      .select({
        id: paymentAuditLog.id,
        eventType: paymentAuditLog.eventType,
        actorType: paymentAuditLog.actorType,
        afterState: paymentAuditLog.afterState,
        notes: paymentAuditLog.notes,
        createdAt: paymentAuditLog.createdAt,
        actorName: users.fullName,
      })
      .from(paymentAuditLog)
      .leftJoin(users, eq(paymentAuditLog.actorUserId, users.id))
      .where(eq(paymentAuditLog.paymentId, payment.id))
      .orderBy(desc(paymentAuditLog.createdAt));

    return { payment, guardian, receipt, allocs, audit };
  });

  if (!data) notFound();
  const { payment, guardian, receipt, allocs, audit } = data;

  const payer = guardian?.name ?? "—";
  const studentName = `${payment.studentFirst} ${payment.studentLast}`;
  const classLabel = payment.className ?? payment.classLabel ?? "—";
  const gross = num(payment.grossAmount);
  const isRefund = !!payment.voidedAt && payment.voidIsRefund;
  const isVoid = !!payment.voidedAt && !payment.voidIsRefund;

  // Money is "applied to" only via live (non-voided) invoice allocations.
  const invoiceAllocs = allocs.filter(
    (a) => a.allocationType === "INVOICE" && !a.voidedAt && a.invoiceId,
  );

  const status = isRefund
    ? { label: "Refunded", cls: "bg-gold-bg text-navy" }
    : isVoid
      ? { label: "Voided", cls: "bg-terra-bg text-terra" }
      : { label: "Confirmed", cls: "bg-green-bg text-green" };

  return (
    <div className="mx-auto max-w-page">
      {/* Crumb */}
      <div className="text-xs text-navy-3">
        <Link href="/billing" className="text-gold hover:underline">
          Billing
        </Link>{" "}
        / Payments / <span className="font-mono">{payment.id.slice(0, 8)}</span>
      </div>

      {/* Header */}
      <div className="mb-8 mt-2 flex flex-wrap items-start justify-between gap-4">
        <h1 className="font-display text-3xl font-semibold text-navy">
          Payment from <em className="not-italic text-gold">{payer}</em>
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          {receipt ? (
            <a
              href={`/api/receipts/${payment.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border border-navy bg-navy px-3.5 py-2 text-sm font-semibold text-bg transition-colors hover:bg-navy-deep"
            >
              Download receipt PDF
            </a>
          ) : (
            <span className="cursor-not-allowed rounded-md border border-border-2 px-3.5 py-2 text-sm font-semibold text-navy-3 opacity-60">
              No receipt to download
            </span>
          )}
          {payment.voidedAt ? (
            <span
              className={`rounded-md px-3.5 py-2 text-sm font-semibold ${
                isRefund ? "bg-gold-bg text-navy" : "bg-terra-bg text-terra"
              }`}
            >
              {isRefund ? "Refunded" : "Voided"}
              {payment.voidReason ? ` · ${payment.voidReason}` : ""}
            </span>
          ) : (
            <VoidRefundDrawer
              paymentId={payment.id}
              amount={gross}
              payer={payer}
              studentName={studentName}
              receiptNumber={receipt?.receiptNumber ?? "—"}
            />
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* Left column */}
        <div className="space-y-6">
          {/* Payment record */}
          <section className="rounded-xl border border-border bg-surface p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-navy-3">
                  Payment record
                </div>
                <div
                  className={`mt-1 font-display text-4xl font-semibold ${
                    payment.voidedAt ? "text-navy-3" : "text-green"
                  }`}
                >
                  {ghs(gross)}
                </div>
              </div>
              <span
                className={`rounded-pill px-2.5 py-1 text-xs font-semibold ${status.cls}`}
              >
                {status.label}
              </span>
            </div>

            <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
              <Field label="Amount" value={ghs(gross)} />
              <Field
                label="Date paid"
                value={payment.paidAt ? fmtDateTime(payment.paidAt) : "—"}
              />
              <Field
                label="Method"
                value={titleize(payment.method)}
                sub={payment.methodReference ?? undefined}
              />
              <Field
                label="Transaction ID"
                value={payment.methodReference ?? "—"}
                mono
              />
              <Field label="Received from" value={payer} />
              <Field
                label="For"
                value={studentName}
                sub={`${classLabel} · ${payment.studentCode}`}
              />
            </dl>

            {/* Applied to */}
            <div className="mt-6 border-t border-border pt-5">
              <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.1em] text-navy-3">
                Applied to
              </div>
              {invoiceAllocs.length === 0 ? (
                <p className="text-sm text-navy-3">
                  Not applied to any invoice — held as credit.
                </p>
              ) : (
                <ul className="space-y-2">
                  {invoiceAllocs.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center justify-between gap-4 rounded-lg border border-border bg-bg px-4 py-3"
                    >
                      <div className="min-w-0">
                        <span className="font-mono text-sm font-semibold text-gold">
                          {a.invoiceNumber}
                        </span>
                        <span className="ml-2 text-xs text-navy-3">
                          {a.academicYear ?? ""}
                        </span>
                      </div>
                      <span className="shrink-0 font-medium text-navy">
                        {ghs(num(a.amount))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* Receipt issued */}
          <section className="rounded-xl border border-border bg-surface p-6">
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-navy-3">
              Receipt issued
            </div>
            {receipt ? (
              <>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
                  <span className="font-mono text-lg font-semibold text-gold">
                    {receipt.receiptNumber}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <a
                      href={`/api/receipts/${payment.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-md border border-border-2 px-2.5 py-1 text-xs font-semibold text-navy transition-colors hover:border-gold-soft"
                    >
                      View
                    </a>
                    <a
                      href={`/api/receipts/${payment.id}`}
                      download
                      className="rounded-md border border-border-2 px-2.5 py-1 text-xs font-semibold text-navy transition-colors hover:border-gold-soft"
                    >
                      Download
                    </a>
                    <button
                      type="button"
                      disabled
                      title="Emailing parents is coming soon"
                      className="cursor-not-allowed rounded-md border border-border-2 px-2.5 py-1 text-xs font-semibold text-navy-3 opacity-60"
                    >
                      Email
                    </button>
                  </div>
                </div>
                <p className="mt-3 text-xs text-navy-3">
                  {receipt.voidedAt ? (
                    <span className="text-terra line-through">
                      Generated {fmtDateTime(receipt.generatedAt)}
                    </span>
                  ) : (
                    <>Generated {fmtDateTime(receipt.generatedAt)}</>
                  )}
                  {receipt.voidedAt && (
                    <span className="ml-2 font-semibold text-terra no-underline">
                      · voided
                    </span>
                  )}
                </p>
              </>
            ) : (
              <p className="mt-1 text-sm text-navy-3">No receipt on record.</p>
            )}
          </section>
        </div>

        {/* Right column — Audit trail */}
        <aside>
          <section className="rounded-xl border border-border bg-surface p-6">
            <div className="mb-4 text-[11px] font-bold uppercase tracking-[0.1em] text-navy-3">
              Audit trail
            </div>
            {audit.length === 0 ? (
              <p className="text-sm text-navy-3">No recorded events for this payment.</p>
            ) : (
              <ol className="space-y-4">
                {audit.map((e) => {
                  const after = (e.afterState ?? {}) as { isRefund?: boolean };
                  const dot =
                    e.eventType === "VOIDED" && after.isRefund === true
                      ? "bg-gold"
                      : e.eventType === "VOIDED" || e.eventType === "ALLOCATION_VOIDED"
                        ? "bg-terra"
                        : e.eventType === "REFUNDED"
                          ? "bg-gold"
                          : "bg-green";
                  return (
                    <li key={e.id} className="flex gap-3">
                      <span
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot}`}
                        aria-hidden
                      />
                      <div className="min-w-0">
                        <div className="text-sm text-navy">
                          <b className="font-semibold">{titleize(e.eventType)}</b>
                          {e.notes ? (
                            <span className="text-navy-2"> — {e.notes}</span>
                          ) : null}
                        </div>
                        <div className="text-[11px] text-navy-3">
                          {fmtDateTime(e.createdAt)} ·{" "}
                          {e.actorName ?? titleize(e.actorType)}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  sub,
  mono,
}: {
  label: string;
  value: string;
  sub?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-[11px] font-bold uppercase tracking-[0.1em] text-navy-3">
        {label}
      </dt>
      <dd className={`mt-0.5 text-sm text-navy ${mono ? "font-mono" : ""}`}>{value}</dd>
      {sub && <dd className="text-xs text-navy-3">{sub}</dd>}
    </div>
  );
}
