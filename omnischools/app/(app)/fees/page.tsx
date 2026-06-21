import Link from "next/link";
import { and, eq, sql, desc } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import { invoices, students } from "@/db/schema";

export const dynamic = "force-dynamic";

const ghs = (v: number) => `GHS ${v.toFixed(2)}`;

export default async function FeesPage() {
  const { school } = await requireSchool();
  const data = await withSchool(school.id, async (tx) => {
    const [totals] = await tx
      .select({
        billed: sql<number>`coalesce(sum(${invoices.billedAmount}), 0)::float`,
        paid: sql<number>`coalesce(sum(${invoices.paidAmount}), 0)::float`,
        balance: sql<number>`coalesce(sum(${invoices.balanceAmount}), 0)::float`,
      })
      .from(invoices)
      .where(and(eq(invoices.schoolId, school.id), sql`${invoices.status} <> 'VOIDED'`));

    const debtors = await tx
      .select({
        studentId: invoices.studentId,
        firstName: students.firstName,
        lastName: students.lastName,
        code: students.studentCode,
        balance: sql<number>`sum(${invoices.balanceAmount})::float`,
        maxOverdue: sql<number>`coalesce(max(case when ${invoices.dueAt} is not null and ${invoices.dueAt} < now() and ${invoices.balanceAmount} > 0 then floor(extract(epoch from (now() - ${invoices.dueAt})) / 86400) else 0 end), 0)::int`,
      })
      .from(invoices)
      .innerJoin(students, eq(invoices.studentId, students.id))
      .where(and(eq(invoices.schoolId, school.id), sql`${invoices.balanceAmount} > 0`))
      .groupBy(
        invoices.studentId,
        students.firstName,
        students.lastName,
        students.studentCode,
      )
      .orderBy(desc(sql`sum(${invoices.balanceAmount})`))
      .limit(100);

    return { totals, debtors };
  });

  const cards = [
    { label: "Billed", value: data.totals.billed },
    { label: "Collected", value: data.totals.paid },
    { label: "Outstanding", value: data.totals.balance },
  ];

  return (
    <div className="mx-auto max-w-page">
      <h1 className="mb-1 font-display text-3xl font-semibold text-navy">Fees</h1>
      <p className="mb-6 text-sm text-navy-3">
        Collections for {school.name}. Open a student to issue an invoice or record a
        payment.
      </p>

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {cards.map((c) => (
          <div key={c.label} className="bg-surface rounded-xl border border-border p-5">
            <div className="font-display text-3xl font-semibold text-navy">
              {ghs(c.value)}
            </div>
            <div className="mt-1 text-sm text-navy-3">{c.label}</div>
          </div>
        ))}
      </div>

      <h2 className="mb-3 font-display text-xl font-semibold text-navy">
        Students with a balance
      </h2>
      {data.debtors.length === 0 ? (
        <div className="border-border-2 bg-surface rounded-xl border border-dashed p-12 text-center">
          <p className="font-display text-lg text-navy">Nothing outstanding.</p>
          <p className="mt-1 text-sm text-navy-3">
            Open a student from{" "}
            <Link href="/students" className="text-gold underline">
              Students
            </Link>{" "}
            to issue an invoice.
          </p>
        </div>
      ) : (
        <div className="bg-surface overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-bg border-b border-border text-left text-xs uppercase tracking-wide text-navy-3">
              <tr>
                <th className="px-4 py-3 font-semibold">Code</th>
                <th className="px-4 py-3 font-semibold">Student</th>
                <th className="px-4 py-3 text-right font-semibold">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.debtors.map((d) => (
                <tr key={d.studentId} className="hover:bg-bg transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-navy-2">{d.code}</td>
                  <td className="px-4 py-3 font-medium text-navy">
                    <Link href={`/fees/${d.studentId}`} className="hover:text-gold">
                      {d.lastName}, {d.firstName}
                    </Link>
                    {d.maxOverdue > 0 && (
                      <span className="ml-2 rounded-pill bg-terra-bg px-2 py-0.5 text-xs font-medium text-terra">
                        Overdue {d.maxOverdue}d
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-terra">
                    {ghs(d.balance)}
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
