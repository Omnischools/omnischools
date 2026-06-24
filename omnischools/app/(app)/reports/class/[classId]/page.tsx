import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, sql, desc } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import { invoices, students, classes } from "@/db/schema";
import { SendReminderButton } from "@/components/reports/send-reminder-button";
import { PrintButton } from "@/components/reports/print-button";
import { ExportCsv } from "@/components/reports/export-csv";
import { schoolFile } from "@/lib/filename";
import { BackLink } from "@/components/ui/back-link";
import { EmptyState } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";

const ghs = (n: number) =>
  `GHS ${n.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (v: unknown) => Number(v ?? 0);

export default async function ClassReportPage({
  params,
}: {
  params: { classId: string };
}) {
  const { school } = await requireSchool();
  const data = await withSchool(school.id, async (tx) => {
    const [cls] = await tx
      .select({ id: classes.id, name: classes.name })
      .from(classes)
      .where(and(eq(classes.id, params.classId), eq(classes.schoolId, school.id)));
    if (!cls) return null;
    const debtors = await tx
      .select({
        studentId: students.id,
        firstName: students.firstName,
        lastName: students.lastName,
        code: students.studentCode,
        balance: sql<string>`sum(${invoices.balanceAmount})`,
        maxOverdue: sql<number>`coalesce(max(case when ${invoices.dueAt} is not null and ${invoices.dueAt} < now() and ${invoices.balanceAmount} > 0 then floor(extract(epoch from (now() - ${invoices.dueAt})) / 86400) else 0 end), 0)::int`,
      })
      .from(invoices)
      .innerJoin(students, eq(invoices.studentId, students.id))
      .where(
        and(
          eq(invoices.schoolId, school.id),
          eq(students.classId, params.classId),
          sql`${invoices.status} <> 'VOIDED'`,
          sql`${invoices.balanceAmount} > 0`,
        ),
      )
      .groupBy(students.id, students.firstName, students.lastName, students.studentCode)
      .orderBy(desc(sql`sum(${invoices.balanceAmount})`));
    return { cls, debtors };
  });

  if (!data) notFound();
  const { cls, debtors } = data;
  const total = debtors.reduce((s, d) => s + num(d.balance), 0);

  return (
    <div className="mx-auto max-w-page">
      <BackLink href="/reports" label="Reports" />
      <div className="mb-6 mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold text-navy">{cls.name}</h1>
          <p className="text-sm text-navy-3">
            {debtors.length} student{debtors.length === 1 ? "" : "s"} owe{" "}
            <b className="text-terra">{ghs(total)}</b>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PrintButton />
          {debtors.length > 0 && (
            <ExportCsv
              filename={schoolFile(school.name, `${cls.name}-debtors.csv`)}
              headers={["Code", "Student", "Days overdue", "Balance"]}
              rows={debtors.map((d) => [
                d.code,
                `${d.lastName}, ${d.firstName}`,
                String(d.maxOverdue),
                num(d.balance).toFixed(2),
              ])}
            />
          )}
        </div>
      </div>

      {debtors.length === 0 ? (
        <EmptyState tone="muted" className="p-12">
          Nothing outstanding in this class.
        </EmptyState>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-bg text-left text-xs uppercase tracking-wide text-navy-3">
              <tr>
                <th className="px-4 py-3 font-semibold">Code</th>
                <th className="px-4 py-3 font-semibold">Student</th>
                <th className="px-4 py-3 text-right font-semibold">Balance</th>
                <th className="px-4 py-3 text-right font-semibold print:hidden"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {debtors.map((d) => (
                <tr key={d.studentId} className="hover:bg-bg">
                  <td className="px-4 py-3 font-mono text-xs text-navy-2">
                    <Link href={`/fees/${d.studentId}`} className="hover:text-gold">
                      {d.code}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-medium text-navy">
                    {d.lastName}, {d.firstName}
                    {d.maxOverdue > 0 && (
                      <span className="ml-2 rounded-pill bg-terra-bg px-2 py-0.5 text-xs font-medium text-terra">
                        Overdue {d.maxOverdue}d
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-terra">
                    {ghs(num(d.balance))}
                  </td>
                  <td className="px-4 py-3 text-right print:hidden">
                    <SendReminderButton studentId={d.studentId} />
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
