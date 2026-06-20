import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import { attendanceCorrections, attendanceRecords, students, users } from "@/db/schema";
import { CorrectionActions } from "@/components/attendance/correction-actions";

export const dynamic = "force-dynamic";

const fmt = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
const fmtWhen = (d: Date | string) => {
  const dt = d instanceof Date ? d : new Date(d);
  return Number.isNaN(dt.getTime())
    ? ""
    : dt.toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
};

export default async function CorrectionsPage() {
  const { school } = await requireSchool();
  const rows = await withSchool(school.id, (tx) =>
    tx
      .select({
        id: attendanceCorrections.id,
        requestedStatus: attendanceCorrections.requestedStatus,
        reason: attendanceCorrections.reason,
        status: attendanceCorrections.status,
        createdAt: attendanceCorrections.createdAt,
        date: attendanceRecords.date,
        currentStatus: attendanceRecords.status,
        firstName: students.firstName,
        lastName: students.lastName,
        requestedBy: users.fullName,
      })
      .from(attendanceCorrections)
      .innerJoin(
        attendanceRecords,
        eq(attendanceCorrections.attendanceRecordId, attendanceRecords.id),
      )
      .innerJoin(students, eq(attendanceRecords.studentId, students.id))
      .leftJoin(users, eq(attendanceCorrections.requestedByUserId, users.id))
      .where(eq(attendanceCorrections.schoolId, school.id))
      .orderBy(desc(attendanceCorrections.createdAt))
      .limit(100),
  );
  const pending = rows.filter((r) => r.status === "PENDING");

  return (
    <div className="mx-auto max-w-page">
      <Link href="/attendance" className="text-sm text-navy-3 hover:text-gold">
        ← Attendance
      </Link>
      <h1 className="mb-1 mt-2 font-display text-3xl font-semibold text-navy">
        Attendance corrections
      </h1>
      <p className="mb-6 text-sm text-navy-3">
        {pending.length} awaiting your co-sign · teacher-requested changes to a saved
        record.
      </p>

      {rows.length === 0 ? (
        <div className="border-border-2 bg-surface rounded-xl border border-dashed p-12 text-center">
          <p className="font-display text-lg text-navy">No correction requests.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div
              key={r.id}
              className="bg-surface flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-4 py-3"
            >
              <div className="min-w-0">
                <div className="font-medium text-navy">
                  {r.lastName}, {r.firstName}{" "}
                  <span className="text-xs text-navy-3">· {r.date}</span>
                </div>
                <div className="text-xs text-navy-3">
                  {fmt(r.currentStatus)} →{" "}
                  <span className="font-semibold text-navy-2">
                    {fmt(r.requestedStatus)}
                  </span>{" "}
                  · {r.reason}
                </div>
                <div className="mt-0.5 text-[11px] text-navy-3">
                  Requested by{" "}
                  <span className="font-medium text-navy-2">
                    {r.requestedBy ?? "a teacher"}
                  </span>
                  {fmtWhen(r.createdAt) ? ` · ${fmtWhen(r.createdAt)}` : ""}
                </div>
              </div>
              {r.status === "PENDING" ? (
                <CorrectionActions correctionId={r.id} />
              ) : (
                <span
                  className={`rounded-pill px-2 py-0.5 text-xs font-medium ${r.status === "APPROVED" ? "bg-green-bg text-green" : "bg-terra-bg text-terra"}`}
                >
                  {fmt(r.status)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
