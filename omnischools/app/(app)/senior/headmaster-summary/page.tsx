import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { requireSchoolRole } from "@/lib/auth/server";
import { SENIOR_MANAGEMENT_ROLES } from "@/lib/access";
import { withSchool } from "@/lib/db/rls";
import { academicPeriod } from "@/db/schema";
import {
  loadVhmProgress,
  rollupBySubject,
  type RollupBlocker,
  type SubjectRollup,
  type VhmProgressRow,
} from "@/lib/score-ledger/vhm-progress";

export const dynamic = "force-dynamic";

const classesLabel = (n: number) => `${n} class${n === 1 ? "" : "es"}`;
const daysLabel = (d: number | null) =>
  d == null ? "no activity yet" : `${d} day${d === 1 ? "" : "s"} inactive`;

/** A blocking teacher rendered on the at-risk / escalation card: name · classes · staleness.
 * NEVER a score and NEVER a case narrative (HM64-10b — the surface's illness/support-plan copy
 * has no data source and is deliberately omitted). */
function blockerText(b: RollupBlocker): string {
  return `${b.teacherName ?? "A teacher"}'s ${classesLabel(b.classesAffected)} flagged; ${daysLabel(
    b.daysInactive,
  )}`;
}

function BucketCard({
  label,
  count,
  borderClass,
  accentClass,
  suffix,
  children,
}: {
  label: string;
  count: number;
  borderClass: string;
  accentClass: string;
  suffix: string;
  children: ReactNode;
}) {
  return (
    <div className={`rounded-[11px] border bg-surface px-5 py-[18px] ${borderClass}`}>
      <div className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-navy-3">
        {label}
      </div>
      <div className="font-display text-[36px] font-semibold leading-none text-navy">
        <em className={`italic ${accentClass}`}>{count}</em>
      </div>
      <div className="mt-1.5 text-xs font-medium text-navy-3">{suffix}</div>
      <div className="mt-3 border-t border-border pt-3 text-[10.5px] leading-relaxed text-navy-2">
        {children}
      </div>
    </div>
  );
}

/** Subject names joined by " · " (bold navy) — the fully-ready card's list (NO teacher names, HM64-10a). */
function SubjectNames({ subjects, empty }: { subjects: SubjectRollup[]; empty: string }) {
  if (subjects.length === 0) return <span className="text-navy-3">{empty}</span>;
  return (
    <>
      {subjects.map((s, i) => (
        <span key={s.subjectId}>
          {i > 0 ? " · " : ""}
          <b className="font-bold text-navy">{s.subjectName}</b>
        </span>
      ))}
    </>
  );
}

export default async function HeadmasterSummaryPage(props: {
  searchParams: Promise<{ periodId?: string }>;
}) {
  const searchParams = await props.searchParams;
  // Management-only surface (§6.2 / §D14): Vice Headmaster, Headmaster, Admin — same gate as the
  // per-teacher progress view this rolls up (HM64-13). No new access.
  const { school } = await requireSchoolRole(SENIOR_MANAGEMENT_ROLES);
  // Senior-only (mirrors the academic-progress redirect).
  if (school.schoolType === "BASIC") redirect("/gradebook");

  const periods = await withSchool(school.id, (tx) =>
    tx
      .select()
      .from(academicPeriod)
      .where(eq(academicPeriod.schoolId, school.id))
      .orderBy(asc(academicPeriod.periodNumber)),
  );
  const activePeriod =
    periods.find((p) => p.periodId === searchParams.periodId) ?? periods[periods.length - 1];

  let rows: VhmProgressRow[] = [];
  if (activePeriod) {
    rows = await withSchool(school.id, (tx) =>
      loadVhmProgress(tx, school.id, activePeriod.periodId, new Date()),
    );
  }

  // The cascade — a pure reduction of the same rows the VHM table shows (HM64-14).
  const rollups = rollupBySubject(rows);
  const total = rollups.length;
  const fully = rollups.filter((s) => s.bucket === "fully_ready");
  const partial = rollups.filter((s) => s.bucket === "partial");
  const atRisk = rollups.filter((s) => s.bucket === "at_risk");
  // Most-behind first ⇒ the first at-risk subject is the single most-urgent (HM64-16).
  const escalation = atRisk[0];
  const escalationBlocker = escalation?.blockers[0];

  const fullProgressHref = activePeriod
    ? `/senior/academic-progress?periodId=${activePeriod.periodId}`
    : "/senior/academic-progress";

  return (
    <div className="mx-auto max-w-page">
      {/* Hero — the shared page voice + the roll-up's own title (§3.1). Proxy framing only, NO
          literal days-until-STPSHS countdown (HM64-19; no stpshs_opens_on field exists). */}
      <div className="mb-5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">
          Senior · Headmaster · Semester-end summary
          {activePeriod ? ` · ${activePeriod.academicYear} ${activePeriod.periodLabel}` : ""}
        </div>
        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="font-display text-3xl font-semibold text-navy">
            Where the school <em className="italic text-gold">stands.</em>
          </h1>
          <Link
            href={fullProgressHref}
            className="text-sm font-semibold text-gold hover:underline"
          >
            Open full progress view →
          </Link>
        </div>
        <div className="mb-3 mt-2 h-0.5 w-16 bg-gold" />
        <p className="max-w-2xl text-sm text-navy-3">
          {total} {total === 1 ? "subject" : "subjects"} across the school ·{" "}
          <span className="font-semibold text-terra">{atRisk.length} at risk</span> ·{" "}
          <span className="font-semibold text-gold">{partial.length} partial</span> ·{" "}
          <span className="font-semibold text-green">{fully.length} ready</span> for STPSHS.
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
                href={`/senior/headmaster-summary?periodId=${p.periodId}`}
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

      {/* Discipline banner (§6.2) — completion, not scores. Present on this route (HM64-11). */}
      <div className="mb-5 flex items-start gap-3 rounded-xl bg-navy px-5 py-4 text-bg">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gold font-display text-sm italic text-navy">
          i
        </span>
        <p className="text-xs leading-relaxed text-bg">
          This roll-up shows{" "}
          <em className="font-display italic text-gold">readiness completion</em>, not the score
          values themselves. It counts which subjects have every teacher finished; the marks remain
          the teacher&apos;s domain until the semester is closed.
        </p>
      </div>

      {!activePeriod ? (
        <div className="rounded-xl border border-dashed border-border-2 bg-surface p-12 text-center text-sm text-navy-3">
          No academic period is set up yet. Create a semester in Academic periods to roll up ledger
          readiness.
        </div>
      ) : total === 0 ? (
        // Honest empty (HM64-17) — no fabricated zero cards.
        <div className="rounded-xl border border-dashed border-border-2 bg-surface p-12 text-center text-sm text-navy-3">
          No subjects to roll up yet. Set up teaching assignments in Classes &amp; subjects to track
          STPSHS readiness.
        </div>
      ) : (
        <>
          <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.08em] text-navy-3">
            Subject-level readiness · cascaded from per-teacher progress
          </div>

          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
            <BucketCard
              label="Subjects fully ready"
              count={fully.length}
              borderClass="border-green"
              accentClass="text-green"
              suffix={`of ${total} subjects · all teachers complete`}
            >
              <SubjectNames subjects={fully} empty="No subjects fully ready yet." />
            </BucketCard>

            <BucketCard
              label="Subjects partially ready"
              count={partial.length}
              borderClass="border-gold"
              accentClass="text-gold"
              suffix={`of ${total} subjects · 1 or more teachers behind`}
            >
              {partial.length === 0 ? (
                <span className="text-navy-3">No subjects partially behind.</span>
              ) : (
                partial.map((s, i) => (
                  <span key={s.subjectId}>
                    {i > 0 ? " · " : ""}
                    <b className="font-bold text-navy">{s.subjectName}</b> ({s.teacherComplete} of{" "}
                    {s.teacherTotal} teachers complete)
                  </span>
                ))
              )}
            </BucketCard>

            <BucketCard
              label="Subjects at risk"
              count={atRisk.length}
              borderClass="border-terra"
              accentClass="text-terra"
              suffix={`of ${total} subjects · zero teachers ready`}
            >
              {atRisk.length === 0 ? (
                <span className="text-navy-3">Every subject on track for STPSHS.</span>
              ) : (
                atRisk.map((s, i) => (
                  <div key={s.subjectId} className={i > 0 ? "mt-1.5" : ""}>
                    <b className="font-bold text-navy">{s.subjectName}</b> —{" "}
                    {s.blockers.map(blockerText).join(", ")}
                  </div>
                ))
              )}
            </BucketCard>
          </div>

          {/* Escalation card (§3.3) — names the single most-urgent blocker + classes + staleness.
              NO case narrative, NO score (HM64-10b). Absent when nothing is at risk. */}
          {escalation && escalationBlocker && (
            <div className="mt-[22px] grid grid-cols-1 items-center gap-3.5 rounded-xl border-[1.5px] border-gold bg-gold-bg px-[22px] py-4 sm:grid-cols-[auto_1fr]">
              <div className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-gold font-display text-base italic text-navy">
                !
              </div>
              <p className="text-xs leading-relaxed text-navy-2">
                Most urgent action item:{" "}
                <strong className="text-navy">{escalationBlocker.teacherName ?? "A teacher"}</strong>{" "}
                on <strong className="text-navy">{escalation.subjectName}</strong> —{" "}
                {classesLabel(escalationBlocker.classesAffected)} affected,{" "}
                {daysLabel(escalationBlocker.daysInactive)}, no scores entered. This is where the
                school&apos;s STPSHS readiness is most at risk.
              </p>
            </div>
          )}

          {/* Provenance strip (§3.5) — states out loud that the roll-up is the table reduced. */}
          <div className="mt-[22px] flex flex-wrap gap-[18px] rounded-[10px] border border-border bg-bg px-[18px] py-3.5 text-[10.5px] text-navy-3">
            <div>
              <b className="font-semibold text-navy-2">Source data</b> · per-teacher ledger progress,
              same as Vice Headmaster view
            </div>
            <div>
              <b className="font-semibold text-navy-2">Aggregation</b> · grouped by subject across all
              classes
            </div>
            <div>
              <b className="font-semibold text-navy-2">Refresh</b> · live as teachers enter
            </div>
          </div>
        </>
      )}
    </div>
  );
}
