import { redirect } from "next/navigation";
import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { requireSchoolRole } from "@/lib/auth/server";
import { SENIOR_MANAGEMENT_ROLES } from "@/lib/access";
import { withSchool } from "@/lib/db/rls";
import { academicPeriod } from "@/db/schema";
import { loadVhmProgress, type VhmProgressRow } from "@/lib/score-ledger/vhm-progress";
import { VhmProgressTable } from "@/components/senior/vhm-progress-table";

export const dynamic = "force-dynamic";

/** The five filter dimensions (spec §6.1), URL-param driven — the same `?periodId` precedent. */
type FilterParams = {
  periodId?: string;
  teacher?: string;
  subject?: string;
  form?: string;
  programme?: string;
  status?: string;
};
const FILTER_KEYS = ["teacher", "subject", "form", "programme", "status"] as const;

const PROGRAMME_LABEL: Record<string, string> = {
  GENERAL_ARTS: "General Arts",
  GENERAL_SCIENCE: "General Science",
  BUSINESS: "Business",
  AGRICULTURE: "Agriculture",
  VISUAL_ARTS: "Visual Arts",
  HOME_ECONOMICS: "Home Economics",
  TECHNICAL: "Technical",
};
const STATUS_LABEL: Record<string, string> = {
  ready: "Ready",
  behind: "Behind",
  at_risk: "At risk",
};
const STATUS_ACTIVE_CLS: Record<string, string> = {
  ready: "bg-green-bg text-green border-green",
  behind: "bg-gold-bg text-gold border-gold",
  at_risk: "bg-terra-bg text-terra border-terra",
};

/** First-seen-wins distinct-by-value (preserves the most-behind-first order of the source rows). */
function dedupe(opts: { value: string; label: string }[]): { value: string; label: string }[] {
  const seen = new Set<string>();
  const out: { value: string; label: string }[] = [];
  for (const o of opts) {
    if (seen.has(o.value)) continue;
    seen.add(o.value);
    out.push(o);
  }
  return out;
}

/** Build a href toggling one filter value, preserving every other active param (server-filtered). */
function toggleHref(current: FilterParams, key: keyof FilterParams, value: string): string {
  const p = new URLSearchParams();
  if (current.periodId) p.set("periodId", current.periodId);
  for (const k of FILTER_KEYS) {
    if (k === key) continue;
    const v = current[k];
    if (v) p.set(k, v);
  }
  if (current[key] !== value) p.set(key, value); // click-again clears (toggle)
  const qs = p.toString();
  return qs ? `/senior/academic-progress?${qs}` : "/senior/academic-progress";
}

function ChipGroup({
  label,
  options,
  activeValue,
  current,
  paramKey,
  activeClsFor,
}: {
  label: string;
  options: { value: string; label: string }[];
  activeValue: string | undefined;
  current: FilterParams;
  paramKey: keyof FilterParams;
  activeClsFor?: (value: string) => string;
}) {
  if (options.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <span className="text-[10px] font-bold uppercase tracking-[0.13em] text-navy-3">{label}</span>
      {options.map((o) => {
        const active = activeValue === o.value;
        const activeCls = activeClsFor ? activeClsFor(o.value) : "bg-navy text-bg border-navy";
        return (
          <Link
            key={o.value}
            href={toggleHref(current, paramKey, o.value)}
            className={`rounded-full border px-[11px] py-[5px] text-[11px] font-semibold ${
              active ? activeCls : "border-border-2 bg-surface text-navy-2 hover:bg-gold-bg"
            }`}
          >
            {o.label}
          </Link>
        );
      })}
    </div>
  );
}

export default async function AcademicProgressPage(
  props: {
    searchParams: Promise<FilterParams>;
  }
) {
  const searchParams = await props.searchParams;
  // Management-only surface (§6.2 / §D14): Vice Headmaster, Headmaster, Admin.
  const { school } = await requireSchoolRole(SENIOR_MANAGEMENT_ROLES);
  // Senior-only.
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

  let allRows: VhmProgressRow[] = [];
  if (activePeriod) {
    allRows = await withSchool(school.id, (tx) =>
      loadVhmProgress(tx, school.id, activePeriod.periodId, new Date()),
    );
  }

  // Filter options derived from the UNFILTERED rows (so a narrowing filter never hides its own
  // sibling options). Order preserved from the most-behind-first load — no re-sort (HM64-24).
  const teacherOpts = dedupe(
    allRows
      .filter((r) => r.teacherUserId)
      .map((r) => ({ value: r.teacherUserId as string, label: r.teacherName ?? "Unassigned" })),
  );
  const subjectOpts = dedupe(allRows.map((r) => ({ value: r.subjectId, label: r.subjectName })));
  const formOpts = dedupe(
    allRows
      .filter((r) => r.classLevel)
      .map((r) => ({ value: r.classLevel as string, label: r.classLevel as string })),
  );
  const programmeOpts = dedupe(
    allRows
      .filter((r) => r.classProgramme)
      .map((r) => ({
        value: r.classProgramme as string,
        label: PROGRAMME_LABEL[r.classProgramme as string] ?? (r.classProgramme as string),
      })),
  );
  const statusOpts = (["ready", "behind", "at_risk"] as const)
    .filter((s) => allRows.some((r) => r.status === s))
    .map((s) => ({ value: s, label: STATUS_LABEL[s] }));

  // Server-side filter — AND across dimensions. No filter ⇒ rows === allRows, same order (HM64-24).
  const rows = allRows.filter(
    (r) =>
      (!searchParams.teacher || r.teacherUserId === searchParams.teacher) &&
      (!searchParams.subject || r.subjectId === searchParams.subject) &&
      (!searchParams.form || r.classLevel === searchParams.form) &&
      (!searchParams.programme || r.classProgramme === searchParams.programme) &&
      (!searchParams.status || r.status === searchParams.status),
  );
  const anyFilter = FILTER_KEYS.some((k) => searchParams[k]);

  const total = rows.length;
  const ready = rows.filter((r) => r.status === "ready").length;
  const behind = rows.filter((r) => r.status === "behind").length;
  const atRisk = rows.filter((r) => r.status === "at_risk").length;
  const termLabel = activePeriod?.periodLabel ?? "this semester";

  // At-risk flags (§2), computed on-the-fly from the same completion data.
  const inactiveFlags = rows.filter((r) => r.flags.length > 0);
  const notReady = rows.filter((r) => r.status !== "ready");
  const behindNames = Array.from(
    new Set(notReady.map((r) => r.teacherName ?? "Unassigned")),
  );
  const behindLabel =
    behindNames.length <= 6
      ? behindNames.join(", ")
      : `${behindNames.slice(0, 6).join(", ")}, and ${behindNames.length - 6} more`;

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

      {/* Filter bar (§6.1) — teacher · subject · form · programme · status. URL-param driven,
          server-filtered; chips toggle. Governs the table below. */}
      {activePeriod && allRows.length > 0 && (
        <div className="mb-5 flex flex-col gap-3 rounded-xl border border-border bg-surface px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.13em] text-navy-3">
              Filter
            </span>
            {anyFilter && (
              <Link
                href={
                  activePeriod
                    ? `/senior/academic-progress?periodId=${activePeriod.periodId}`
                    : "/senior/academic-progress"
                }
                className="text-[11px] font-semibold text-gold hover:underline"
              >
                Clear filters
              </Link>
            )}
          </div>
          <ChipGroup
            label="Teacher"
            options={teacherOpts}
            activeValue={searchParams.teacher}
            current={searchParams}
            paramKey="teacher"
          />
          <ChipGroup
            label="Subject"
            options={subjectOpts}
            activeValue={searchParams.subject}
            current={searchParams}
            paramKey="subject"
          />
          <ChipGroup
            label="Form"
            options={formOpts}
            activeValue={searchParams.form}
            current={searchParams}
            paramKey="form"
          />
          <ChipGroup
            label="Programme"
            options={programmeOpts}
            activeValue={searchParams.programme}
            current={searchParams}
            paramKey="programme"
          />
          <ChipGroup
            label="Status"
            options={statusOpts}
            activeValue={searchParams.status}
            current={searchParams}
            paramKey="status"
            activeClsFor={(v) => STATUS_ACTIVE_CLS[v] ?? "bg-navy text-bg border-navy"}
          />
        </div>
      )}

      {/* Empty-when-filtered — distinct from the no-assignments state (data exists, filter hid it). */}
      {activePeriod && allRows.length > 0 && rows.length === 0 && (
        <div className="mb-6 rounded-xl border border-dashed border-border-2 bg-surface p-10 text-center text-sm text-navy-3">
          No class-subject combinations match these filters.{" "}
          <Link
            href={
              activePeriod
                ? `/senior/academic-progress?periodId=${activePeriod.periodId}`
                : "/senior/academic-progress"
            }
            className="font-semibold text-gold hover:underline"
          >
            Clear filters
          </Link>
        </div>
      )}

      {/* Completion table (§1.4) + risk flags — hidden only when a filter excludes everything
          (the no-assignments empty state stays the table's own, preserving shipped behavior). */}
      {!(activePeriod && allRows.length > 0 && rows.length === 0) && (
        <>
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
                    are not yet STPSHS-ready. Teachers behind: {behindLabel}.
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
        </>
      )}
    </div>
  );
}
