import { Receipt } from "lucide-react";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import {
  feeStructures,
  feeStructureItems,
  feeCategories,
  discounts,
  discountTiers,
  classes,
  invoices,
  academicPeriod,
  households,
  students,
} from "@/db/schema";
import { num, daysOverdue } from "@/lib/fees-helpers";
import { InvoicesTable, type InvoiceRow } from "@/components/billing/invoices-table";
import { CreateFeeStructureForm } from "@/components/billing/create-fee-structure-form";
import { FeeStructureCard } from "@/components/billing/fee-structure-card";
import { IssueInvoicesCard } from "@/components/billing/issue-invoices-card";
import { DiscountManager } from "@/components/billing/discount-manager";
import { RemindersCard } from "@/components/billing/reminders-card";
import { FamiliesCard } from "@/components/billing/families-card";
import { EmptyState } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";

function currentAcademicYear() {
  const now = new Date();
  const start = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  return `${start}/${String((start + 1) % 100).padStart(2, "0")}`;
}

const ghs = (v: number) =>
  `GHS ${v.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export default async function BillingPage() {
  const { school } = await requireSchool();
  const year = currentAcademicYear();

  const [
    structureRows,
    itemRows,
    discountRows,
    classRows,
    feeCatRows,
    levelRows,
    yearRows,
    [summary],
    householdRows,
    memberRows,
    tierRows,
    [activeCount],
    [unInvoicedCount],
    periodRows,
    [kpi],
    [overdue],
    invoiceListRows,
  ] = await Promise.all([
    withSchool(school.id, (tx) =>
      tx
        .select()
        .from(feeStructures)
        .where(eq(feeStructures.schoolId, school.id))
        .orderBy(asc(feeStructures.name)),
    ),
    withSchool(school.id, (tx) =>
      tx
        .select()
        .from(feeStructureItems)
        .where(eq(feeStructureItems.schoolId, school.id)),
    ),
    withSchool(school.id, (tx) =>
      tx
        .select()
        .from(discounts)
        .where(eq(discounts.schoolId, school.id))
        .orderBy(asc(discounts.name)),
    ),
    withSchool(school.id, (tx) =>
      tx
        .select({ id: classes.id, name: classes.name, level: classes.level })
        .from(classes)
        .where(and(eq(classes.schoolId, school.id), eq(classes.active, true)))
        .orderBy(asc(classes.name)),
    ),
    withSchool(school.id, (tx) =>
      tx
        .select({ id: feeCategories.id, name: feeCategories.name })
        .from(feeCategories)
        .where(eq(feeCategories.schoolId, school.id))
        .orderBy(asc(feeCategories.name)),
    ),
    withSchool(school.id, (tx) =>
      tx
        .selectDistinct({ level: classes.level })
        .from(classes)
        .where(and(eq(classes.schoolId, school.id), isNotNull(classes.level)))
        .orderBy(asc(classes.level)),
    ),
    withSchool(school.id, (tx) =>
      tx
        .selectDistinct({ year: academicPeriod.academicYear })
        .from(academicPeriod)
        .where(eq(academicPeriod.schoolId, school.id))
        .orderBy(asc(academicPeriod.academicYear)),
    ),
    withSchool(school.id, (tx) =>
      tx
        .select({
          families: sql<number>`count(distinct ${invoices.studentId})`,
          total: sql<string>`coalesce(sum(${invoices.balanceAmount}), 0)`,
        })
        .from(invoices)
        .where(
          and(
            eq(invoices.schoolId, school.id),
            inArray(invoices.status, ["ISSUED", "PARTIAL", "OVERDUE"]),
            sql`${invoices.balanceAmount} > 0`,
          ),
        ),
    ),
    withSchool(school.id, (tx) =>
      tx
        .select({ id: households.id, name: households.name })
        .from(households)
        .where(eq(households.schoolId, school.id))
        .orderBy(asc(households.name)),
    ),
    withSchool(school.id, (tx) =>
      tx
        .select({
          id: students.id,
          householdId: students.householdId,
          firstName: students.firstName,
          lastName: students.lastName,
          code: students.studentCode,
          enrolledOn: students.enrolledOn,
          createdAt: students.createdAt,
        })
        .from(students)
        .where(
          and(
            eq(students.schoolId, school.id),
            isNotNull(students.householdId),
            eq(students.status, "ACTIVE"),
          ),
        ),
    ),
    withSchool(school.id, (tx) =>
      tx
        .select({
          discountId: discountTiers.discountId,
          rank: discountTiers.rank,
          value: discountTiers.value,
        })
        .from(discountTiers)
        .where(eq(discountTiers.schoolId, school.id)),
    ),
    withSchool(school.id, (tx) =>
      tx
        .select({ n: sql<number>`count(*)::int` })
        .from(students)
        .where(and(eq(students.schoolId, school.id), eq(students.status, "ACTIVE"))),
    ),
    withSchool(school.id, (tx) =>
      tx
        .select({ n: sql<number>`count(*)::int` })
        .from(students)
        .where(
          and(
            eq(students.schoolId, school.id),
            eq(students.status, "ACTIVE"),
            sql`not exists (
              select 1 from ${invoices} iv
              where iv.student_id = ${students.id}
                and iv.school_id = ${school.id}
                and iv.academic_year = ${year}
                and iv.status <> 'VOIDED'
            )`,
          ),
        ),
    ),
    withSchool(school.id, (tx) =>
      tx
        .select({
          academicYear: academicPeriod.academicYear,
          periodLabel: academicPeriod.periodLabel,
          startsOn: academicPeriod.startsOn,
          endsOn: academicPeriod.endsOn,
        })
        .from(academicPeriod)
        .where(eq(academicPeriod.schoolId, school.id))
        .orderBy(asc(academicPeriod.startsOn)),
    ),
    // KPI aggregates for the year (non-voided invoices).
    withSchool(school.id, (tx) =>
      tx
        .select({
          billed: sql<string>`coalesce(sum(${invoices.billedAmount}), 0)`,
          collected: sql<string>`coalesce(sum(${invoices.paidAmount}), 0)`,
          outstanding: sql<string>`coalesce(sum(case when ${invoices.status} in ('ISSUED','PARTIAL','OVERDUE') then ${invoices.balanceAmount} else 0 end), 0)`,
          count: sql<number>`count(*)::int`,
        })
        .from(invoices)
        .where(
          and(
            eq(invoices.schoolId, school.id),
            eq(invoices.academicYear, year),
            sql`${invoices.status} <> 'VOIDED'`,
          ),
        ),
    ),
    // Overdue > 30 days.
    withSchool(school.id, (tx) =>
      tx
        .select({
          amount: sql<string>`coalesce(sum(${invoices.balanceAmount}), 0)`,
          students: sql<number>`count(distinct ${invoices.studentId})::int`,
        })
        .from(invoices)
        .where(
          and(
            eq(invoices.schoolId, school.id),
            eq(invoices.academicYear, year),
            sql`${invoices.balanceAmount} > 0`,
            sql`${invoices.dueAt} is not null and ${invoices.dueAt} < now() - interval '30 days'`,
          ),
        ),
    ),
    // School-wide invoice list for the year (non-voided), newest first.
    withSchool(school.id, (tx) =>
      tx
        .select({
          invoiceId: invoices.id,
          studentId: invoices.studentId,
          firstName: students.firstName,
          lastName: students.lastName,
          className: students.currentClassLabel,
          invoiceNumber: invoices.invoiceNumber,
          subtotal: invoices.subtotalAmount,
          discount: invoices.discountAmount,
          billed: invoices.billedAmount,
          paid: invoices.paidAmount,
          balance: invoices.balanceAmount,
          status: invoices.status,
          dueAt: invoices.dueAt,
        })
        .from(invoices)
        .innerJoin(students, eq(invoices.studentId, students.id))
        .where(
          and(
            eq(invoices.schoolId, school.id),
            eq(invoices.academicYear, year),
            sql`${invoices.status} <> 'VOIDED'`,
          ),
        )
        .orderBy(desc(invoices.issuedAt))
        .limit(300),
    ),
  ]);

  const itemsByStructure = new Map<string, { description: string; amount: number }[]>();
  for (const it of itemRows) {
    const arr = itemsByStructure.get(it.feeStructureId) ?? [];
    arr.push({ description: it.description, amount: num(it.amount) });
    itemsByStructure.set(it.feeStructureId, arr);
  }

  const structures = structureRows.map((s) => {
    const items = itemsByStructure.get(s.id) ?? [];
    return {
      id: s.id,
      name: s.name,
      level: s.level,
      academicYear: s.academicYear,
      active: s.active,
      items,
      total: items.reduce((sum, i) => sum + i.amount, 0),
    };
  });

  // Active fee structures for the current year — what school-wide issuance bills from.
  const activeStructures = structures.filter(
    (s) => s.active && s.academicYear === year,
  );
  // Preview = first active structure (for the year) that actually has line items.
  const previewStructure = activeStructures.find((s) => s.items.length > 0) ?? null;
  const totalActive = num(activeCount?.n);
  const unInvoiced = num(unInvoicedCount?.n);

  // Levels billable by an active, non-empty structure (mirrors issueAllInvoices).
  const billableLevels = new Set(
    activeStructures.filter((s) => s.items.length > 0 && s.level).map((s) => s.level),
  );
  const classesWithoutStructure = classRows.filter(
    (c) => !c.level || !billableLevels.has(c.level),
  ).length;

  // Term label: the active academic period containing today (else latest started,
  // else last), falling back to the academic year when no periods are configured.
  const todayIso = new Date().toISOString().slice(0, 10);
  const currentPeriod =
    periodRows.find((p) => p.startsOn <= todayIso && p.endsOn >= todayIso) ??
    [...periodRows].reverse().find((p) => p.startsOn <= todayIso) ??
    periodRows[periodRows.length - 1] ??
    null;
  const termLabel = currentPeriod
    ? `${currentPeriod.periodLabel} · ${currentPeriod.academicYear}`
    : year;

  const catNameById = new Map(feeCatRows.map((c) => [c.id, c.name]));
  const tiersByDiscount = new Map<string, { rank: number; value: number }[]>();
  for (const t of tierRows) {
    const arr = tiersByDiscount.get(t.discountId) ?? [];
    arr.push({ rank: t.rank, value: num(t.value) });
    tiersByDiscount.set(t.discountId, arr);
  }
  const discountOptions = discountRows.map((d) => ({
    id: d.id,
    name: d.name,
    kind: d.kind,
    value: num(d.value),
    appliesToCategoryName: d.appliesToCategoryId
      ? (catNameById.get(d.appliesToCategoryId) ?? null)
      : null,
    durationLabel: d.durationLabel,
    requiresApproval: d.requiresApproval,
    approved: !!d.approvedAt,
    stackable: d.stackable,
    isTiered: d.isTiered,
    appliedCount: d.appliedCount,
    tiers: tiersByDiscount.get(d.id) ?? [],
  }));

  // Group members per household and rank by enrolment (earliest = 1st child).
  const sortKey = (m: { enrolledOn: string | null; createdAt: Date; code: string }) =>
    `${m.enrolledOn ?? m.createdAt.toISOString().slice(0, 10)}|${m.code}`;
  const families = householdRows
    .map((h) => ({
      id: h.id,
      name: h.name,
      members: memberRows
        .filter((m) => m.householdId === h.id)
        .sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
        .map((m, i) => ({
          id: m.id,
          name: `${m.lastName}, ${m.firstName}`,
          code: m.code,
          rank: i + 1,
        })),
    }))
    .filter((f) => f.members.length > 0);

  // ── §03 admin-billing: KPI strip + school-wide invoices ──────────────
  const kpiBilled = num(kpi?.billed);
  const kpiCollected = num(kpi?.collected);
  const kpiOutstanding = num(kpi?.outstanding);
  const kpiCount = num(kpi?.count);
  const collectedPct = kpiBilled > 0 ? Math.round((kpiCollected / kpiBilled) * 100) : 0;
  const overdueAmount = num(overdue?.amount);
  const overdueStudents = num(overdue?.students);
  const outstandingStudents = num(summary?.families);

  const invoiceRows: InvoiceRow[] = invoiceListRows.map((r) => {
    const billed = num(r.billed);
    const paid = num(r.paid);
    const balance = num(r.balance);
    const subtotal = num(r.subtotal);
    const discount = num(r.discount);
    const exempt = r.status === "EXEMPT" || (billed === 0 && subtotal > 0);
    const discountPct =
      !exempt && discount > 0 && subtotal > 0
        ? Math.round((discount / subtotal) * 100)
        : null;
    const od = balance > 0 ? daysOverdue(r.dueAt) : 0;
    let status: InvoiceRow["status"];
    if (exempt) status = "EXEMPT";
    else if (balance <= 0) status = "PAID";
    else if (od > 0 || r.status === "OVERDUE") status = "OVERDUE";
    else if (paid > 0) status = "PARTIAL";
    else status = "UNPAID";
    return {
      invoiceId: r.invoiceId,
      studentId: r.studentId,
      student: `${r.firstName} ${r.lastName}`,
      className: r.className,
      invoiceNumber: r.invoiceNumber,
      billed,
      paid,
      balance,
      discountPct,
      exempt,
      status,
      overdueDays: od,
    };
  });

  return (
    <div className="mx-auto max-w-page space-y-10">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">
          Omnischools · Billing
        </div>
        <h1 className="mt-1 font-display text-3xl font-semibold text-navy">
          What you bill, <em className="text-gold">before you collect</em>
        </h1>
        <div className="mb-3 mt-2 h-0.5 w-16 bg-gold" />
        <p className="max-w-2xl text-sm text-navy-3">
          Set up fee structures, manage discounts, generate invoices for a class, and
          chase outstanding balances. (Collecting payments lives in Fees.)
        </p>
      </div>

      {kpiCount > 0 && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Kpi
            label="Total billed"
            value={ghs(kpiBilled)}
            sub={plural(kpiCount, "invoice")}
            tone="text-navy"
          />
          <Kpi
            label="Collected"
            value={ghs(kpiCollected)}
            sub={`${collectedPct}% collected`}
            tone="text-green"
            subTone="text-green"
          />
          <Kpi
            label="Outstanding"
            value={ghs(kpiOutstanding)}
            sub={plural(outstandingStudents, "student")}
            tone="text-terra"
          />
          <Kpi
            label="Overdue > 30d"
            value={ghs(overdueAmount)}
            sub={plural(overdueStudents, "student")}
            tone="text-gold"
          />
        </div>
      )}

      <RemindersCard families={num(summary?.families)} total={num(summary?.total)} />

      {activeStructures.length === 0 ? (
        <EmptyState
          tone="default"
          icon={<Receipt className="h-5 w-5" aria-hidden />}
          title="Set up your fee structure first"
          body="A fee structure is your termly bill — Tuition, Books, Transport… Create one, then issue invoices to every student in a click."
          primary={{ label: "+ Create fee structure", href: "#fee-structures", variant: "gold" }}
        />
      ) : (
        unInvoiced > 0 && (
          <IssueInvoicesCard
            unInvoiced={unInvoiced}
            totalActive={totalActive}
            termLabel={termLabel}
            preview={
              previewStructure
                ? {
                    schoolName: school.name,
                    structureName: previewStructure.name,
                    items: previewStructure.items,
                    subtotal: previewStructure.total,
                  }
                : null
            }
            classesWithoutStructure={classesWithoutStructure}
          />
        )
      )}

      {/* Invoices — school-wide, this year (sms-mvp1 §03) */}
      {invoiceRows.length > 0 && (
        <section>
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <h2 className="font-display text-xl font-semibold text-navy">Invoices</h2>
            <span className="text-xs text-navy-3">{termLabel}</span>
          </div>
          <InvoicesTable rows={invoiceRows} />
        </section>
      )}

      {/* Fee structures */}
      <section id="fee-structures" className="scroll-mt-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-display text-xl font-semibold text-navy">Fee structures</h2>
          <CreateFeeStructureForm
            defaultYear={year}
            feeItemOptions={feeCatRows.map((c) => c.name)}
            levelOptions={levelRows.map((l) => l.level).filter((l): l is string => !!l)}
            yearOptions={yearRows.map((y) => y.year)}
          />
        </div>
        {structures.length === 0 ? (
          // No structures → the "Set up your fee structure first" hero above covers it;
          // the section just keeps its "+ New fee structure" control.
          <p className="text-sm italic text-navy-3">
            Your fee structures will appear here once you create one.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {structures.map((s) => (
              <FeeStructureCard
                key={s.id}
                structure={s}
                classes={classRows}
                discounts={discountOptions}
              />
            ))}
          </div>
        )}
      </section>

      {/* Discounts */}
      <section>
        <h2 className="mb-4 font-display text-xl font-semibold text-navy">Discounts</h2>
        <DiscountManager discounts={discountOptions} categories={feeCatRows} />
      </section>

      {/* Families & siblings */}
      <section>
        <h2 className="mb-4 font-display text-xl font-semibold text-navy">
          Families &amp; siblings
        </h2>
        <FamiliesCard families={families} />
      </section>
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone,
  subTone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: string;
  subTone?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-[18px]">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-navy-3">
        {label}
      </div>
      <div className={`mt-2.5 font-display text-2xl font-semibold ${tone}`}>{value}</div>
      <div className={`mt-1 text-[11px] ${subTone ?? "text-navy-3"}`}>{sub}</div>
    </div>
  );
}
