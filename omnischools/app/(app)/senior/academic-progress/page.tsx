import { redirect } from "next/navigation";
import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { requireSchool } from "@/lib/auth/server";
import { withSchool } from "@/lib/db/rls";
import { academicPeriod } from "@/db/schema";
import { loadVhmProgress, type VhmProgressRow } from "@/lib/score-ledger/vhm-progress";
import { VhmProgressTable } from "@/components/senior/vhm-progress-table";

export const dynamic = "force-dynamic";

export default async function AcademicProgressPage({
  searchParams,
}: {
  searchParams: { periodId?: string };
}) {
  const { school } = await requireSchool();
  // Senior-only management surface.
  if (school.schoolType === "BASIC") redirect("/gradebook");

  const periods = await withSchool(school.id, (tx) =>
    tx
      .select()
      .from(academicPeriod)
      .where(eq(academicPeriod.schoolId, school.id))
      .orderBy(asc(academicPeriod.periodNumber)),
  );
  const activePeriod =
    periods.find((p) => p.periodId === searchParams.periodId) ??
    periods[periods.length - 1];

  let rows: VhmProgressRow[] = [];
  if (activePeriod) {
    rows = await withSchool(school.id, (tx) =>
      loadVhmProgress(tx, school.id, activePeriod.periodId, new Date()),
    );
  }

  const total = rows.length;
  const ready = rows.filter((r) => r.status === "ready").length;
  const behind = rows.filter((r) => r.status === "behind").length;
  const atRisk = rows.filter((r) => r.status === "at_risk").length;
  const termLabel = activePeriod?.periodLabel ?? "this semester";

  // At-risk flags (§2), computed on-the-fly from the same completion data.
  const inactiveFlags = rows.filter((r) => r.flags.length > 0);
  const notReady = rows.filter((r) => r.status !== "ready");
  const behindTeachers = Array.from(
    new Set(notReady.map((r) => r.teacherName ?? "Unassigned")),
  );

  return (
    <div className="mx-auto max-w-page">
      {/* Hero (§1.2) */}
      <div className="mb-5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">
          Senior · Vice Headmaster · Academic progress
          {activePeriod ? ` · ${activePeriod.academicYear} ${activePeriod.periodLabel}` : ""}
        </div>
        <h1 className="mt-1 font-display text-3xl font-semibold text-navy">
          Score ledger <em className="italic text-gold">progress.</em>
        </h1>
        <div className="mb-3 mt-2 h-0.5 w-16 bg-gold" />
        <p className="max-w-2xl text-sm text-navy-3">
          {total} class-subject {total === 1 ? "combination" : "combinations"} ·{" "}
          <span className="font-semibold text-green">{ready} ready</span> ·{" "}
          <span className="font-semibold text-gold">{behind} behind</span> ·{" "}
          <span className="font-semibold text-terra">{atRisk} at risk</span> for {termLabel}.
        </p>
      </div>

      {/* Period tabs (only when more than one). */}
      {periods.length > 1 && (
        <div className="mb-5 flex flex-wrap gap-2">
          {periods.map((p) => {
            const active = p.periodId === activePeriod?.periodId;
            return (
              <Link
                key={p.periodId}
                href={`/senior/academic-progress?periodId=${p.periodId}`}
                className={
                  active
                    ? "rounded-md border border-gold bg-gold-bg px-3 py-1.5 text-sm font-semibold text-navy"
                    : "rounded-md border border-border-2 bg-surface px-3 py-1.5 text-sm text-navy-3 hover:bg-gold-bg"
                }
              >
                {p.periodLabel}
              </Link>
            );
          })}
        </div>
      )}

      {/* Discipline banner (§1.3) — the completion-not-scores contract, made visible. Non-negotiable. */}
      <div className="mb-5 flex items-start gap-3 rounded-xl bg-navy px-5 py-4 text-bg">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gold font-display text-sm italic text-navy">
          i
        </span>
        <p className="text-xs leading-relaxed text-bg">
          This view shows{" "}
          <em className="font-display italic text-gold">completion progress</em>, not the
          score values themselves. You see which categories each teacher has entered; the
          marks remain the teacher&apos;s domain until the semester is closed. To inspect
          actual scores, open the gradebook — that access is audit-logged.
        </p>
      </div>

      {/* Completion table (§1.4) */}
      <section className="mb-6">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-lg font-semibold text-navy">
            Teacher × class ·{" "}
            <em className="italic text-gold">
              {total} {total === 1 ? "combination" : "combinations"}
            </em>
          </h2>
          <span className="text-[10px] uppercase tracking-wide text-navy-3">
            Sorted by STPSHS readiness · most behind first
          </span>
        </div>
        <VhmProgressTable rows={rows} />
      </section>

      {/* At-risk flags (§2) — computed from the completion data. */}
      <section>
        <h2 className="mb-3 font-display text-lg font-semibold text-navy">
          Risks <em className="italic text-gold">this week.</em>
        </h2>
        {inactiveFlags.length === 0 && notReady.length === 0 ? (
          <div className="rounded-[11px] border border-border bg-bg px-[18px] py-4 text-[11px] text-navy-3">
            <span className="font-display text-[13px] italic text-navy">No flags.</span>{" "}
            Every class-subject is tracking on schedule.
          </div>
        ) : (
          <div className="space-y-3">
            {inactiveFlags.map((r) => (
              <div
                key={`inactive-${r.classId}:${r.subjectId}`}
                className="flex items-start gap-3 rounded-[11px] border border-terra bg-terra-bg px-[18px] py-3.5"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-terra font-display italic text-bg">
                  !
                </span>
                <div>
                  <p className="text-sm text-navy-2">
                    <strong className="text-navy">{r.teacherName ?? "A teacher"}</strong> has
                    not touched the ledger for {r.className} · {r.subjectName} in{" "}
                    {r.daysInactive} days.
                  </p>
                  <p className="mt-0.5 text-[9.5px] font-bold uppercase tracking-[0.04em] text-navy-3">
                    Rule: teacher inactivity 14+ days during semester · severity high
                  </p>
                </div>
              </div>
            ))}
            {notReady.length > 0 && (
              <div className="flex items-start gap-3 rounded-[11px] border border-gold bg-gold-bg px-[18px] py-3.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gold font-display italic text-navy">
                  !
                </span>
                <div>
                  <p className="text-sm text-navy-2">
                    <strong className="text-navy">
                      {notReady.length} of {total} class-subject combinations
                    </strong>{" "}
                    are not yet STPSHS-ready. Teachers behind:{" "}
                    {behindTeachers.join(", ")}.
                  </p>
                  <p className="mt-0.5 text-[9.5px] font-bold uppercase tracking-[0.04em] text-navy-3">
                    Rule: STPSHS window approaching with incomplete entries · severity high
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
