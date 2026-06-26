import Link from "next/link";
import { and, asc, eq, notInArray, sql } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import {
  users,
  roles,
  roleAssignments,
  staffProfiles,
  staffCompensation,
  students,
} from "@/db/schema";
import { NON_STAFF_ROLE_CODES, roleLabel, isTeachingStaff } from "@/lib/staff-roles";
import { qualificationLabel } from "@/lib/staff-qualifications";

export const dynamic = "force-dynamic";

const ghs = (v: number) =>
  `GHS ${v.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const initialsOf = (full: string | null) => {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const monthYear = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { month: "short", year: "numeric" });

/** Whole years between an ISO date and today (floored). */
function yearsSince(iso: string, today: string): number {
  const b = new Date(iso + "T00:00:00Z");
  const t = new Date(today + "T00:00:00Z");
  let y = t.getUTCFullYear() - b.getUTCFullYear();
  if (
    t.getUTCMonth() < b.getUTCMonth() ||
    (t.getUTCMonth() === b.getUTCMonth() && t.getUTCDate() < b.getUTCDate())
  )
    y--;
  return Math.max(0, y);
}

const STATUS_LABEL: Record<string, string> = {
  SCHOOL_PAID: "School-paid",
  GES_PAID: "GES-paid",
  ALLOWANCE: "Allowance",
};
const METHOD_LABEL: Record<string, string> = { BANK: "Bank", CASH: "Cash", MOMO: "MoMo" };
const CADENCE_LABEL: Record<string, string> = { MONTHLY: "Monthly", TERMLY: "Termly" };

type CompRow = {
  salaryStatus: string;
  monthlyAmount: string;
  payMethod: string;
  payCadence: string;
  ssnitDeduction: string;
  payeDeduction: string;
  effectiveFrom: string | null;
};

export default async function StaffCompensationPage() {
  const { school } = await requireSchool();
  const today = new Date().toISOString().slice(0, 10);

  const { rows, compRows, profileRows, tenureRows, activeStudents } = await withSchool(
    school.id,
    async (tx) => {
      const [rows, compRows, profileRows, tenureRows, [{ activeStudents }]] =
        await Promise.all([
          tx
            .select({
              userId: users.id,
              name: users.fullName,
              code: roles.code,
              label: roles.label,
            })
            .from(roleAssignments)
            .innerJoin(users, eq(roleAssignments.userId, users.id))
            .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
            .where(
              and(
                eq(roleAssignments.schoolId, school.id),
                notInArray(roles.code, NON_STAFF_ROLE_CODES),
              ),
            )
            .orderBy(asc(users.fullName)),
          tx
            .select({
              userId: staffCompensation.userId,
              salaryStatus: staffCompensation.salaryStatus,
              monthlyAmount: staffCompensation.monthlyAmount,
              payMethod: staffCompensation.payMethod,
              payCadence: staffCompensation.payCadence,
              ssnitDeduction: staffCompensation.ssnitDeduction,
              payeDeduction: staffCompensation.payeDeduction,
              effectiveFrom: staffCompensation.effectiveFrom,
            })
            .from(staffCompensation)
            .where(eq(staffCompensation.schoolId, school.id)),
          tx
            .select({
              userId: staffProfiles.userId,
              level: staffProfiles.qualificationLevel,
            })
            .from(staffProfiles)
            .where(eq(staffProfiles.schoolId, school.id)),
          // Earliest role start per user → tenure.
          tx
            .select({
              userId: roleAssignments.userId,
              firstStart: sql<string>`min(${roleAssignments.startDate})`,
            })
            .from(roleAssignments)
            .where(eq(roleAssignments.schoolId, school.id))
            .groupBy(roleAssignments.userId),
          tx
            .select({ activeStudents: sql<number>`count(*)::int` })
            .from(students)
            .where(and(eq(students.schoolId, school.id), eq(students.status, "ACTIVE"))),
        ]);
      return { rows, compRows, profileRows, tenureRows, activeStudents };
    },
  );

  // Group roles per user (mirrors the staff list).
  const byUser = new Map<
    string,
    { userId: string; name: string | null; codes: string[]; primaryLabel: string }
  >();
  for (const r of rows) {
    let g = byUser.get(r.userId);
    if (!g) {
      g = { userId: r.userId, name: r.name, codes: [], primaryLabel: "" };
      byUser.set(r.userId, g);
    }
    g.codes.push(r.code);
    if (!g.primaryLabel) g.primaryLabel = roleLabel(r.code, r.label);
  }

  const compByUser = new Map<string, CompRow>(compRows.map((c) => [c.userId, c]));
  const qualByUser = new Map(profileRows.map((p) => [p.userId, p.level]));
  const tenureByUser = new Map(tenureRows.map((t) => [t.userId, t.firstStart]));

  const staff = Array.from(byUser.values()).map((s) => {
    const comp = compByUser.get(s.userId) ?? null;
    const monthly = comp ? Number(comp.monthlyAmount) : 0;
    const ssnit = comp ? Number(comp.ssnitDeduction) : 0;
    const paye = comp ? Number(comp.payeDeduction) : 0;
    return {
      ...s,
      qualLevel: qualByUser.get(s.userId) ?? null,
      firstStart: tenureByUser.get(s.userId) ?? null,
      comp,
      monthly,
      ssnit,
      paye,
      net: monthly - ssnit - paye,
      teaching: isTeachingStaff(s.codes),
    };
  });

  // ── Hero formulas ───────────────────────────────────────────────────────
  const schoolPaid = staff.filter((s) => s.comp?.salaryStatus === "SCHOOL_PAID");
  const monthlyPayroll = schoolPaid.reduce((sum, s) => sum + s.net, 0); // NET
  const schoolPaidCount = schoolPaid.length;
  const teacherCount = staff.filter((s) => s.teaching).length;
  const captured = staff.filter((s) => s.comp).length;
  const total = staff.length;

  // ── Subtotal (school-paid only) ─────────────────────────────────────────
  const grossSchoolPaid = schoolPaid.reduce((sum, s) => sum + s.monthly, 0);
  const netSchoolPaid = schoolPaid.reduce((sum, s) => sum + s.net, 0);

  return (
    <div className="mx-auto max-w-page">
      {/* ── Breadcrumb ─────────────────────────────────────────── */}
      <div className="mb-2 text-xs text-navy-3">
        <Link href="/staff" className="text-gold hover:underline">
          ← Back to staff
        </Link>
      </div>

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="mb-6">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">
          Staff · Compensation
        </div>
        <h1 className="mt-1 font-display text-3xl font-semibold text-navy">
          Staff <em className="not-italic text-gold">compensation</em>
        </h1>
        <div className="mb-3 mt-2 h-0.5 w-16 bg-gold" />
        <p className="max-w-2xl text-sm text-navy-3">
          Monthly pay, statuses and deductions — the school-paid total feeds the books&apos;
          salaries line.
        </p>
      </div>

      {/* ── Hero tiles ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-navy bg-navy p-5 text-bg">
          <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-gold-soft">
            Monthly payroll
          </div>
          <div className="mt-1 font-display text-3xl font-semibold leading-tight">
            {ghs(monthlyPayroll)}
          </div>
          <div className="mt-0.5 text-[11px] text-gold-soft">net · school-paid staff</div>
        </div>
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-navy-3">
            School-paid
          </div>
          <div className="mt-1 font-display text-4xl font-semibold text-navy">
            {schoolPaidCount}
          </div>
          <div className="mt-0.5 text-[11px] text-navy-3">
            of {total} staff on payroll
          </div>
        </div>
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-navy-3">
            Pupil-teacher ratio
          </div>
          <div className="mt-1 font-display text-4xl font-semibold text-navy">
            {teacherCount > 0 ? `1 : ${Math.round(activeStudents / teacherCount)}` : "—"}
          </div>
          <div className="mt-0.5 text-[11px] text-navy-3">
            {teacherCount} teaching · {activeStudents} students
          </div>
        </div>
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-navy-3">
            Captured
          </div>
          <div className="mt-1 font-display text-4xl font-semibold text-navy">
            {captured}
            <span className="text-2xl text-navy-3"> / {total}</span>
          </div>
          <div className="mt-0.5 text-[11px] text-navy-3">have a comp. record</div>
        </div>
      </div>

      {staff.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-border-2 bg-surface p-8 text-center text-sm text-navy-3">
          No staff yet — add staff to capture their compensation.
        </p>
      ) : (
        <>
          {captured === 0 && (
            <p className="mt-5 text-xs text-navy-3">
              No compensation captured yet — set a record from each staff profile.
            </p>
          )}

          {/* ── Roster table ───────────────────────────────────── */}
          <div className="mt-5 overflow-hidden rounded-xl border border-border bg-surface">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-bg text-left text-xs uppercase tracking-wide text-navy-3">
                <tr>
                  <th className="px-4 py-3 font-semibold">Staff member</th>
                  <th className="px-4 py-3 font-semibold">Qualification</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Monthly comp.</th>
                  <th className="px-4 py-3 font-semibold">Deductions</th>
                  <th className="px-4 py-3 font-semibold">Tenure</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {staff.map((s) => (
                  <tr key={s.userId} className="transition-colors hover:bg-bg">
                    {/* Staff member */}
                    <td className="px-4 py-3">
                      <Link
                        href={`/staff/${s.userId}`}
                        className="flex items-center gap-3 group"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold-bg font-display text-xs font-semibold text-navy">
                          {initialsOf(s.name)}
                        </span>
                        <span>
                          <span className="block font-medium text-navy group-hover:text-gold">
                            {s.name ?? "—"}
                          </span>
                          <span className="block text-xs text-navy-3">
                            {s.primaryLabel}
                          </span>
                        </span>
                      </Link>
                    </td>

                    {/* Qualification */}
                    <td className="px-4 py-3">
                      {s.qualLevel ? (
                        <span className="text-navy-2">{qualificationLabel(s.qualLevel)}</span>
                      ) : (
                        <span className="text-navy-3">—</span>
                      )}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      <StatusPill status={s.comp?.salaryStatus ?? null} />
                    </td>

                    {/* Monthly comp. */}
                    <td className="px-4 py-3">
                      {s.comp ? (
                        <span>
                          <span className="block font-mono text-navy">{ghs(s.monthly)}</span>
                          <span className="block text-xs text-navy-3">
                            {METHOD_LABEL[s.comp.payMethod] ?? s.comp.payMethod} ·{" "}
                            {CADENCE_LABEL[s.comp.payCadence] ?? s.comp.payCadence}
                          </span>
                        </span>
                      ) : (
                        <span className="text-navy-3">Not set</span>
                      )}
                    </td>

                    {/* Deductions */}
                    <td className="px-4 py-3">
                      {s.comp && (s.ssnit > 0 || s.paye > 0) ? (
                        <span className="font-mono text-xs text-navy-2">
                          {s.ssnit > 0 && <span className="block">−{ghs(s.ssnit)} SSNIT</span>}
                          {s.paye > 0 && <span className="block">−{ghs(s.paye)} PAYE</span>}
                        </span>
                      ) : (
                        <span className="text-navy-3">—</span>
                      )}
                    </td>

                    {/* Tenure */}
                    <td className="px-4 py-3">
                      {s.firstStart ? (
                        <span className="text-navy-2">
                          {yearsSince(s.firstStart, today)}{" "}
                          {yearsSince(s.firstStart, today) === 1 ? "year" : "years"}
                          <span className="block text-xs text-navy-3">
                            since {monthYear(s.firstStart)}
                          </span>
                        </span>
                      ) : (
                        <span className="text-navy-3">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border bg-gold-bg text-sm">
                  <td className="px-4 py-3 font-semibold text-navy" colSpan={3}>
                    {schoolPaidCount} school-paid {schoolPaidCount === 1 ? "staff" : "staff"} ·
                    monthly payroll
                    <span className="block text-[11px] font-normal text-navy-3">
                      GES-paid excluded
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-navy" colSpan={2}>
                    <span className="block text-[11px] uppercase tracking-wide text-navy-3">
                      Gross
                    </span>
                    {ghs(grossSchoolPaid)}
                  </td>
                  <td className="px-4 py-3 font-mono font-semibold text-navy">
                    <span className="block text-[11px] uppercase tracking-wide text-navy-3">
                      Net
                    </span>
                    {ghs(netSchoolPaid)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="mt-3 text-xs text-navy-3">
            Compensation is set per staff member — open any row to edit it from the profile.
          </p>
        </>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string | null }) {
  if (!status) {
    return (
      <span className="rounded-pill bg-bg px-2.5 py-0.5 text-[11px] font-semibold text-navy-3">
        Not set
      </span>
    );
  }
  const label = STATUS_LABEL[status] ?? status;
  if (status === "GES_PAID") {
    return (
      <span className="rounded-pill bg-gold-bg px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-gold">
        {label}
      </span>
    );
  }
  if (status === "ALLOWANCE") {
    return (
      <span className="rounded-pill bg-bg px-2.5 py-0.5 text-[11px] font-semibold text-navy-3">
        {label}
      </span>
    );
  }
  // SCHOOL_PAID — neutral/navy
  return (
    <span className="rounded-pill bg-navy px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-bg">
      {label}
    </span>
  );
}
