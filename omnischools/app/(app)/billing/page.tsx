import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import {
  feeStructures,
  feeStructureItems,
  feeCategories,
  discounts,
  classes,
  invoices,
  academicPeriod,
  households,
  students,
} from "@/db/schema";
import { num } from "@/lib/fees-helpers";
import { CreateFeeStructureForm } from "@/components/billing/create-fee-structure-form";
import { FeeStructureCard } from "@/components/billing/fee-structure-card";
import { DiscountManager } from "@/components/billing/discount-manager";
import { RemindersCard } from "@/components/billing/reminders-card";
import { FamiliesCard } from "@/components/billing/families-card";

export const dynamic = "force-dynamic";

function currentAcademicYear() {
  const now = new Date();
  const start = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  return `${start}/${String((start + 1) % 100).padStart(2, "0")}`;
}

export default async function BillingPage() {
  const { school } = await requireSchool();

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
        .select({ id: classes.id, name: classes.name })
        .from(classes)
        .where(and(eq(classes.schoolId, school.id), eq(classes.active, true)))
        .orderBy(asc(classes.name)),
    ),
    withSchool(school.id, (tx) =>
      tx
        .select({ name: feeCategories.name })
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
      items,
      total: items.reduce((sum, i) => sum + i.amount, 0),
    };
  });

  const discountOptions = discountRows.map((d) => ({
    id: d.id,
    name: d.name,
    kind: d.kind,
    value: num(d.value),
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

  return (
    <div className="mx-auto max-w-page space-y-10">
      <div>
        <h1 className="font-display text-3xl font-semibold text-navy">Billing</h1>
        <p className="text-sm text-navy-3">
          Set up fee structures, manage discounts, generate invoices for a class, and
          chase outstanding balances. (Collecting payments lives in Fees.)
        </p>
      </div>

      <RemindersCard families={num(summary?.families)} total={num(summary?.total)} />

      {/* Fee structures */}
      <section>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-display text-xl font-semibold text-navy">Fee structures</h2>
          <CreateFeeStructureForm
            defaultYear={currentAcademicYear()}
            feeItemOptions={feeCatRows.map((c) => c.name)}
            levelOptions={levelRows.map((l) => l.level).filter((l): l is string => !!l)}
            yearOptions={yearRows.map((y) => y.year)}
          />
        </div>
        {structures.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border-2 bg-surface p-10 text-center text-sm text-navy-3">
            No fee structures yet. Create one (e.g. “JHS 1 — {currentAcademicYear()}”) to
            bill a whole class in one click.
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
        <DiscountManager discounts={discountOptions} />
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
