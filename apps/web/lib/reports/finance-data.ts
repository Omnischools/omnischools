import {
  and,
  asc,
  desc,
  eq,
  gte,
  isNotNull,
  isNull,
  lt,
  ne,
  sql,
} from "drizzle-orm";
import { withSchool } from "@/lib/db/rls";
import {
  invoices,
  payments,
  students,
  classes,
  receipts,
  users,
  discounts,
  discountTiers,
  feeCategories,
} from "@/db/schema";

/** Shared finance aggregates for the Reports module (hub snapshots + every detail route). */

export const ghs = (n: number) =>
  `GHS ${n.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const num = (v: unknown) => Number(v ?? 0);
export const ordinal = (n: number) =>
  n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`;

export const METHOD_LABEL: Record<string, string> = {
  MTN_MOMO: "MTN MoMo",
  TELECEL_CASH: "Telecel Cash",
  AIRTELTIGO_MONEY: "AirtelTigo Money",
  BANK_TRANSFER: "Bank transfer",
  CASH: "Cash",
  CHEQUE: "Cheque",
  OTHER: "Other",
};

export const AGING = [
  { key: "current", label: "Not yet due", tone: "bg-navy" },
  { key: "d30", label: "1–30 days overdue", tone: "bg-gold" },
  { key: "d60", label: "31–60 days overdue", tone: "bg-warn" },
  { key: "d90", label: "61–90 days overdue", tone: "bg-terra" },
  { key: "d90plus", label: "90+ days overdue", tone: "bg-terra" },
] as const;

export type YearWindow = { start: Date; end: Date } | null;

/** Sep–Aug window for an academic year label like "2025/26". */
export function yearWindow(selectedYear: string | null): YearWindow {
  if (!selectedYear) return null;
  const sy = Number.parseInt(selectedYear.slice(0, 4), 10);
  if (Number.isNaN(sy)) return null;
  return { start: new Date(Date.UTC(sy, 8, 1)), end: new Date(Date.UTC(sy + 1, 8, 1)) };
}

export async function getFinanceReport(
  schoolId: string,
  selectedYear: string | null,
  /** Explicit date window (from the PERIOD filter); overrides the academic-year window. */
  period?: { start: Date; end: Date } | null,
) {
  const win = period ?? yearWindow(selectedYear);
  // Period scopes invoices by issue date; the year selector scopes by academic-year label.
  const invFilter = period
    ? and(gte(invoices.issuedAt, period.start), lt(invoices.issuedAt, period.end))
    : selectedYear
      ? eq(invoices.academicYear, selectedYear)
      : undefined;
  const payWindow = win
    ? and(gte(payments.paidAt, win.start), lt(payments.paidAt, win.end))
    : undefined;
  const voidWindow = win
    ? and(gte(payments.voidedAt, win.start), lt(payments.voidedAt, win.end))
    : undefined;

  const [
    [totals],
    byClass,
    monthly,
    weekly,
    byMethod,
    agingRows,
    voids,
    discRows,
    discTierRows,
    [discTotal],
    catRows,
    yearRows,
  ] = await Promise.all([
    withSchool(schoolId, (tx) =>
      tx
        .select({
          billed: sql<string>`coalesce(sum(${invoices.billedAmount}), 0)`,
          collected: sql<string>`coalesce(sum(${invoices.paidAmount}), 0)`,
          outstanding: sql<string>`coalesce(sum(${invoices.balanceAmount}), 0)`,
          invoiceCount: sql<number>`count(*)`,
          studentCount: sql<number>`count(distinct ${invoices.studentId})`,
          debtorCount: sql<number>`count(distinct ${invoices.studentId}) filter (where ${invoices.balanceAmount} > 0)`,
        })
        .from(invoices)
        .where(and(eq(invoices.schoolId, schoolId), ne(invoices.status, "VOIDED"), invFilter)),
    ),
    withSchool(schoolId, (tx) =>
      tx
        .select({
          classId: classes.id,
          className: sql<string>`coalesce(${classes.name}, '— Unassigned —')`,
          billed: sql<string>`coalesce(sum(${invoices.billedAmount}), 0)`,
          collected: sql<string>`coalesce(sum(${invoices.paidAmount}), 0)`,
          outstanding: sql<string>`coalesce(sum(${invoices.balanceAmount}), 0)`,
        })
        .from(invoices)
        .innerJoin(students, eq(invoices.studentId, students.id))
        .leftJoin(classes, eq(students.classId, classes.id))
        .where(and(eq(invoices.schoolId, schoolId), ne(invoices.status, "VOIDED"), invFilter))
        .groupBy(classes.id, classes.name)
        .orderBy(desc(sql`sum(${invoices.balanceAmount})`)),
    ),
    withSchool(schoolId, (tx) =>
      tx
        .select({
          month: sql<string>`to_char(${payments.paidAt}, 'YYYY-MM')`,
          amount: sql<string>`coalesce(sum(${payments.netAmount}), 0)`,
        })
        .from(payments)
        .where(and(eq(payments.schoolId, schoolId), isNull(payments.voidedAt), payWindow))
        .groupBy(sql`to_char(${payments.paidAt}, 'YYYY-MM')`)
        .orderBy(sql`to_char(${payments.paidAt}, 'YYYY-MM')`),
    ),
    withSchool(schoolId, (tx) =>
      tx
        .select({
          weekStart: sql<string>`to_char(date_trunc('week', ${payments.paidAt}), 'YYYY-MM-DD')`,
          amount: sql<string>`coalesce(sum(${payments.netAmount}), 0)`,
        })
        .from(payments)
        .where(and(eq(payments.schoolId, schoolId), isNull(payments.voidedAt), payWindow))
        .groupBy(sql`date_trunc('week', ${payments.paidAt})`)
        .orderBy(sql`date_trunc('week', ${payments.paidAt})`),
    ),
    withSchool(schoolId, (tx) =>
      tx
        .select({
          method: payments.method,
          amount: sql<string>`coalesce(sum(${payments.netAmount}), 0)`,
          count: sql<number>`count(*)`,
        })
        .from(payments)
        .where(and(eq(payments.schoolId, schoolId), isNull(payments.voidedAt), payWindow))
        .groupBy(payments.method),
    ),
    withSchool(schoolId, (tx) =>
      tx
        .select({
          bucket: sql<string>`case
            when ${invoices.dueAt} is null or ${invoices.dueAt} >= now() then 'current'
            when now() - ${invoices.dueAt} <= interval '30 days' then 'd30'
            when now() - ${invoices.dueAt} <= interval '60 days' then 'd60'
            when now() - ${invoices.dueAt} <= interval '90 days' then 'd90'
            else 'd90plus'
          end`,
          amount: sql<string>`coalesce(sum(${invoices.balanceAmount}), 0)`,
          count: sql<number>`count(*)`,
        })
        .from(invoices)
        .where(
          and(
            eq(invoices.schoolId, schoolId),
            ne(invoices.status, "VOIDED"),
            sql`${invoices.balanceAmount} > 0`,
            invFilter,
          ),
        )
        .groupBy(sql`1`),
    ),
    withSchool(schoolId, (tx) =>
      tx
        .select({
          voidedAt: payments.voidedAt,
          amount: payments.grossAmount,
          method: payments.method,
          isRefund: payments.voidIsRefund,
          reason: payments.voidReason,
          firstName: students.firstName,
          lastName: students.lastName,
          receiptNumber: receipts.receiptNumber,
          voidedBy: users.fullName,
        })
        .from(payments)
        .innerJoin(students, eq(payments.studentId, students.id))
        .leftJoin(receipts, eq(receipts.paymentId, payments.id))
        .leftJoin(users, eq(payments.voidedByUserId, users.id))
        .where(and(eq(payments.schoolId, schoolId), isNotNull(payments.voidedAt), voidWindow))
        .orderBy(desc(payments.voidedAt))
        .limit(100),
    ),
    withSchool(schoolId, (tx) =>
      tx.select().from(discounts).where(eq(discounts.schoolId, schoolId)).orderBy(asc(discounts.name)),
    ),
    withSchool(schoolId, (tx) =>
      tx
        .select({
          discountId: discountTiers.discountId,
          rank: discountTiers.rank,
          value: discountTiers.value,
        })
        .from(discountTiers)
        .where(eq(discountTiers.schoolId, schoolId)),
    ),
    withSchool(schoolId, (tx) =>
      tx
        .select({
          total: sql<string>`coalesce(sum(${invoices.discountAmount}), 0)`,
          count: sql<number>`count(*) filter (where ${invoices.discountAmount} > 0)`,
        })
        .from(invoices)
        .where(and(eq(invoices.schoolId, schoolId), ne(invoices.status, "VOIDED"), invFilter)),
    ),
    withSchool(schoolId, (tx) =>
      tx
        .select({ id: feeCategories.id, name: feeCategories.name })
        .from(feeCategories)
        .where(eq(feeCategories.schoolId, schoolId)),
    ),
    withSchool(schoolId, (tx) =>
      tx
        .selectDistinct({ year: invoices.academicYear })
        .from(invoices)
        .where(eq(invoices.schoolId, schoolId))
        .orderBy(desc(invoices.academicYear)),
    ),
  ]);

  const billed = num(totals?.billed);
  const collected = num(totals?.collected);
  const outstanding = num(totals?.outstanding);
  const rate = billed > 0 ? Math.round((collected / billed) * 100) : 0;

  const agingMap = new Map(
    agingRows.map((r) => [r.bucket, { amount: num(r.amount), count: num(r.count) }]),
  );
  const overdueTotal = AGING.filter((b) => b.key !== "current").reduce(
    (s, b) => s + (agingMap.get(b.key)?.amount ?? 0),
    0,
  );
  const overdue30PlusCount = (["d60", "d90", "d90plus"] as const).reduce(
    (s, k) => s + (agingMap.get(k)?.count ?? 0),
    0,
  );

  const voidTotal = voids.reduce((s, v) => s + num(v.amount), 0);

  return {
    selectedYear,
    totals,
    billed,
    collected,
    outstanding,
    rate,
    byClass,
    monthly,
    weekly,
    byMethod,
    agingMap,
    overdueTotal,
    overdue30PlusCount,
    voids,
    voidTotal,
    discRows,
    discTierRows,
    discountTotal: num(discTotal?.total),
    discountedCount: num(discTotal?.count),
    catRows,
    yearRows,
  };
}

export type FinanceReport = Awaited<ReturnType<typeof getFinanceReport>>;
