import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import { invoices, students, classes, studentGuardians } from "@/db/schema";
import { getFinanceReport, ghs, num } from "@/lib/reports/finance-data";
import { ExportCsv } from "@/components/reports/export-csv";
import { PrintButton } from "@/components/reports/print-button";
import { ReportHeader } from "@/components/reports/report-header";
import { BulkRemindersButton } from "@/components/reports/bulk-reminders-button";
import { OutstandingTable, type DebtorRow, type DebtorBucket } from "@/components/reports/outstanding-table";
import { schoolFile } from "@/lib/filename";

export const dynamic = "force-dynamic";
export const metadata = { title: "Outstanding balances" };

const WEEK_MS = 7 * 86_400_000;
const weekday = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "short" });
const shortDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

function bucketOf(oldestDue: Date | string | null, now: number): { bucket: DebtorBucket; label: string } {
  if (!oldestDue) return { bucket: "notYetDue", label: "No due date" };
  const due = new Date(oldestDue).getTime();
  const overdue = Math.floor((now - due) / 86_400_000);
  if (overdue > 30) return { bucket: "d30plus", label: `${overdue} days` };
  if (overdue >= 1) return { bucket: "d1to30", label: `${overdue} days` };
  if (due - now <= WEEK_MS) return { bucket: "dueThisWeek", label: `due ${weekday(new Date(due))}` };
  return { bucket: "notYetDue", label: `due ${shortDate(new Date(due))}` };
}

export default async function OutstandingPage() {
  const { school } = await requireSchool();
  const now = Date.now();

  const [r, debtorRows] = await Promise.all([
    getFinanceReport(school.id, null),
    withSchool(school.id, (tx) =>
      tx
        .select({
          studentId: students.id,
          firstName: students.firstName,
          lastName: students.lastName,
          code: students.studentCode,
          className: sql<string>`coalesce(${classes.name}, '— Unassigned —')`,
          billed: sql<string>`coalesce(sum(${invoices.billedAmount}), 0)`,
          paid: sql<string>`coalesce(sum(${invoices.paidAmount}), 0)`,
          balance: sql<string>`coalesce(sum(${invoices.balanceAmount}), 0)`,
          oldestDue: sql<string | null>`min(${invoices.dueAt}) filter (where ${invoices.balanceAmount} > 0)`,
        })
        .from(invoices)
        .innerJoin(students, eq(invoices.studentId, students.id))
        .leftJoin(classes, eq(students.classId, classes.id))
        .where(and(eq(invoices.schoolId, school.id), ne(invoices.status, "VOIDED")))
        .groupBy(students.id, students.firstName, students.lastName, students.studentCode, classes.name)
        .having(sql`coalesce(sum(${invoices.balanceAmount}), 0) > 0`),
    ),
  ]);

  const ids = debtorRows.map((d) => d.studentId);
  const guardians = ids.length
    ? await withSchool(school.id, (tx) =>
        tx
          .select({
            studentId: studentGuardians.studentId,
            name: studentGuardians.name,
            phone: studentGuardians.phone,
            isPrimary: studentGuardians.isPrimary,
          })
          .from(studentGuardians)
          .where(inArray(studentGuardians.studentId, ids)),
      )
    : [];
  const primary = new Map<string, { name: string; phone: string }>();
  for (const g of guardians) {
    if (g.isPrimary || !primary.has(g.studentId)) primary.set(g.studentId, { name: g.name, phone: g.phone });
  }

  const rows: DebtorRow[] = debtorRows
    .map((d) => {
      const { bucket, label } = bucketOf(d.oldestDue, now);
      const g = primary.get(d.studentId) ?? null;
      const row: DebtorRow = {
        studentId: d.studentId,
        name: `${d.firstName} ${d.lastName}`,
        initials: `${d.firstName[0] ?? ""}${d.lastName[0] ?? ""}`.toUpperCase(),
        code: d.code,
        className: d.className,
        billed: ghs(num(d.billed)),
        paid: ghs(num(d.paid)),
        balance: ghs(num(d.balance)),
        guardianName: g?.name ?? null,
        guardianPhone: g?.phone ?? null,
        bucket,
        agingLabel: label,
      };
      return { row, bal: num(d.balance) };
    })
    .sort((a, b) => b.bal - a.bal)
    .map((x) => x.row);

  const classList = Array.from(new Set(rows.map((d) => d.className))).sort();
  const overdueCount = rows.filter((d) => d.bucket === "d1to30" || d.bucket === "d30plus").length;
  const over30 = rows.filter((d) => d.bucket === "d30plus").length;

  // 4-card aging strip (per-student bucketing of total balance)
  const STRIP: { key: DebtorBucket; label: string; accent: string; note: string }[] = [
    { key: "notYetDue", label: "Not yet due", accent: "#5C6675", note: "due later this term" },
    { key: "dueThisWeek", label: "Due this week", accent: "#2F6B47", note: "expected to settle" },
    { key: "d1to30", label: "1–30 days overdue", accent: "#C58A2E", note: "gentle reminder due" },
    { key: "d30plus", label: "30+ days overdue", accent: "#B84A39", note: "escalation needed" },
  ];
  const stripData = (k: DebtorBucket) => {
    const list = debtorRows.filter((d) => bucketOf(d.oldestDue, now).bucket === k);
    return { amount: list.reduce((s, d) => s + num(d.balance), 0), count: list.length };
  };

  return (
    <div className="mx-auto max-w-page">
      <ReportHeader
        crumb="Outstanding balances"
        pre="Who hasn't"
        gold="paid"
        lede="Unpaid balances grouped by how far past due they are. Send a reminder straight to the guardian."
        actions={
          <>
            <BulkRemindersButton count={overdueCount} />
            <ExportCsv
              filename={schoolFile(school.name, "outstanding.csv")}
              headers={["Student", "Class", "Billed", "Paid", "Balance", "Guardian", "Phone", "Aging"]}
              rows={rows.map((d) => [
                d.name,
                d.className,
                d.billed.replace("GHS ", ""),
                d.paid.replace("GHS ", ""),
                d.balance.replace("GHS ", ""),
                d.guardianName ?? "",
                d.guardianPhone ?? "",
                d.agingLabel,
              ])}
            />
            <PrintButton label="Export PDF" />
          </>
        }
      />

      {/* Hero callout */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-terra/40 bg-terra-bg/40 p-5">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-navy-3">Currently outstanding</div>
          <div className="mt-1 font-display text-3xl font-semibold text-terra">{ghs(r.outstanding)}</div>
        </div>
        <p className="max-w-sm text-sm text-navy-3">
          <b className="text-navy-2">{rows.length}</b> student{rows.length === 1 ? "" : "s"} with unpaid
          balances · <b className="text-terra">{over30}</b> overdue 30+ days.
        </p>
      </div>

      {/* Aging strip */}
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border-2 bg-surface p-8 text-center text-sm text-navy-3">
          Nothing outstanding — every invoice is settled.
        </p>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {STRIP.map((s) => {
              const d = stripData(s.key);
              return (
                <div
                  key={s.key}
                  style={{ borderTopWidth: 3, borderTopColor: s.accent }}
                  className="rounded-xl border border-border bg-surface p-4"
                >
                  <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-navy-3">{s.label}</div>
                  <div className="mt-1.5 font-display text-xl font-semibold text-navy">{ghs(d.amount)}</div>
                  <div className="mt-0.5 text-[11px] text-navy-3">
                    {d.count} student{d.count === 1 ? "" : "s"} · {s.note}
                  </div>
                </div>
              );
            })}
          </div>

          <OutstandingTable rows={rows} classes={classList} />
        </>
      )}
    </div>
  );
}
