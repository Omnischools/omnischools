import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSchoolRole, resolveActor } from "@/lib/auth/server";
import { SENIOR_LEDGER_ROLES, WASSCE_SETUP_ROLES, hasAnyRole } from "@/lib/access";
import { withSchool } from "@/lib/db/rls";
import { loadSubjectTeacherSurface } from "@/lib/wassce/mock-data";
import { WassceMockEntryGrid } from "@/components/senior/wassce-mock-entry-grid";
import { GRADE_COLORS, HEAT_COLORS } from "@/lib/wassce/grade-colors";
import { benchmarkDot } from "@/lib/wassce/mock-grades";
import type { BenchCell } from "@/lib/wassce/mock-view";

export const dynamic = "force-dynamic";

/**
 * WASSCE subject-teacher cohort surface (SHS module 4.3 / INCR-16 · `schoolup-wassce-subject-teacher`,
 * all 5 frames). ROUTE CARRIES NO TEACHER ID — it scopes to the SESSION teacher's `senior_subject_teacher`
 * assignment (R5); the demo URL's `/teacher/asiedu/` is a leak, deliberately not replicated. A subject
 * teacher sees ONLY their assigned (active cohort × subject); oversight roles (HoA/admin) may view any
 * subject. `?subjectId` / `?cohortId` are tenant-scoped view selectors (never a teacher id).
 *
 * Frames 01 (histogram + credit/distinction/mean), 02 (mark-entry grid) and 05 (benchmark "my cohort")
 * DERIVE from real `mock_results` (AC7/8/9). Frames 03 (topic heatmap) + 04 (intervention plan) + the
 * CPD/NTC/practical fields render SEEDED/STATIC — no per-topic table, no aggregate, no projection (AC16).
 */
export default async function WassceSubjectTeacherPage(props: {
  searchParams: Promise<{ subjectId?: string; cohortId?: string }>;
}) {
  const searchParams = await props.searchParams;
  const { user, school } = await requireSchoolRole(SENIOR_LEDGER_ROLES);
  if (school.schoolType === "BASIC") redirect("/gradebook");

  const isOversight = hasAnyRole(user.roles, WASSCE_SETUP_ROLES);
  const actor = await resolveActor(school.id);
  const data = await withSchool(school.id, (tx) =>
    loadSubjectTeacherSurface(tx, school.id, actor.id, isOversight, {
      subjectId: searchParams.subjectId,
      cohortId: searchParams.cohortId,
    }),
  );

  if (!data) {
    return (
      <div className="mx-auto max-w-page">
        <div className="rounded-xl border border-dashed border-border-2 bg-surface p-12 text-center text-sm text-navy-3">
          No frozen WASSCE cohort has been set up for this school yet.
        </div>
      </div>
    );
  }

  if (!data.subject) {
    return (
      <div className="mx-auto max-w-page">
        <div className="rounded-xl border border-dashed border-border-2 bg-surface p-12 text-center text-sm text-navy-3">
          You have no WASSCE subject assignment for this cohort. The subject-teacher view shows only the
          cohort × subject you are assigned to teach.
        </div>
      </div>
    );
  }

  const s = data.stats;
  const subjectName = data.subject.name;
  const qs = (patch: Record<string, string>) => {
    const p = new URLSearchParams();
    if (searchParams.cohortId) p.set("cohortId", searchParams.cohortId);
    if (searchParams.subjectId) p.set("subjectId", searchParams.subjectId);
    for (const [k, v] of Object.entries(patch)) p.set(k, v);
    return `?${p.toString()}`;
  };

  return (
    <div className="mx-auto max-w-page space-y-8">
      {/* ---- page head ---- */}
      <div className="border-b border-border pb-4">
        <div className="text-[11px] uppercase tracking-[0.12em] text-navy-3">
          WASSCE {data.cohort.examYear} › {subjectName} · F3 Science
        </div>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <h1 className="font-display text-2xl font-medium text-navy">
            {subjectName} · <em className="italic text-gold">F3</em> · my cohort
          </h1>
          <div className="flex flex-col items-end gap-1.5">
            {data.subjectOptions.length > 1 && (
              <div className="flex flex-wrap gap-1.5">
                {data.subjectOptions.map((o) => (
                  <Link
                    key={o.id}
                    href={qs({ subjectId: o.id })}
                    className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${
                      o.id === data.subject!.id
                        ? "border-navy bg-navy text-bg"
                        : "border-border-2 bg-surface text-navy-2 hover:bg-gold-bg"
                    }`}
                  >
                    {o.name}
                  </Link>
                ))}
              </div>
            )}
            {data.cohortOptions.length > 1 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wide text-navy-3">Cohort</span>
                {data.cohortOptions.map((c) => (
                  <Link
                    key={c.id}
                    href={qs({ cohortId: c.id })}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                      c.id === data.cohort.id
                        ? "border-navy bg-navy text-bg"
                        : "border-border-2 bg-surface text-navy-2 hover:bg-gold-bg"
                    }`}
                  >
                    F{c.frozen ? "3" : "2"} · {c.examYear}
                    {!c.frozen ? " · writable" : ""}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
        {!data.cohort.frozen && (
          <p className="mt-2 rounded-md bg-gold-bg px-3 py-1.5 text-[12px] text-navy-2">
            In-flight cohort ({data.cohort.examYear}) — its scheduled Mock 1 is open for mark-entry.
          </p>
        )}
      </div>

      {/* ================= §01 — My cohort ================= */}
      <section id="cohort" className="space-y-4">
        {/* teacher identity — persona is static (cross-module HR/NTC); the assignment count derives */}
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-4 rounded-xl border border-border bg-surface p-4">
          <span
            className="flex h-[60px] w-[60px] items-center justify-center rounded-xl font-display text-[22px] text-gold"
            style={{ background: "linear-gradient(135deg, var(--navy), var(--navy-2))" }}
          >
            SA
          </span>
          <div>
            <div className="font-display text-[22px] font-medium text-navy">
              Mr S. <em className="italic text-gold">Asiedu</em>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-navy-3">
              <span>
                <b className="text-navy">Subject</b> · {subjectName} · F3
              </span>
              <span>
                <b className="text-navy">Form Master</b> · F3 Slessor
              </span>
              <span>
                <b className="text-navy">HOD Science</b>
              </span>
              <span>
                <b className="text-navy">NTC Licence</b> · GA-TL-78423 · valid to 2028
              </span>
              <span>
                <b className="text-navy">PLC</b> · Science HOD PLC · 12 sessions YTD
              </span>
            </div>
          </div>
          <span className="rounded-full bg-gold-bg px-3 py-1 text-[11px] font-semibold text-gold">
            {s.candidates} candidates assigned
          </span>
        </div>

        {/* countdown strip — cells 2/3/4 derive; cells 1/5 seeded (subject clock / practical attendance) */}
        <div className="grid gap-3 md:grid-cols-5">
          <StripCell
            accent="terra"
            label="Days to Chemistry paper"
            value="—"
            meta="Subject clock · wassce_paper_sittings (seeded)"
          />
          <StripCell
            accent="green"
            label="Mock 2 credit rate"
            value={`${s.creditPct}%`}
            meta={`${s.aboveCredit} / ${s.candidates} at C6 or better`}
          />
          <StripCell
            accent="gold"
            label="Mock 2 distinction rate"
            value={`${s.distinctionPct}%`}
            meta={`${s.distinctionCount} / ${s.candidates} at A1 or B2`}
          />
          <StripCell
            label="Mock 2 cohort mean"
            value={s.meanGrade ?? "—"}
            meta={s.mock1MeanGrade ? `from Mock 1 mean ${s.mock1MeanGrade}` : "—"}
          />
          <StripCell label="Practical · attendance" value="—" meta="Sat/not-sat flag — not in INCR-16" />
        </div>

        {/* distribution histogram — DERIVED from the predictor grades (AC9) */}
        <div className="rounded-lg border border-border bg-surface p-5">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-display text-[15px] font-medium text-navy">
              Grade distribution · Mock 1 → Mock 2 → {subjectName} paper
            </h3>
            <span className="text-[10px] uppercase tracking-wide text-navy-3">
              {s.candidates} candidates · 9-grade scale
            </span>
          </div>
          <div className="flex h-[180px] items-end gap-1.5 border-b border-border">
            {s.histogram.map((h) => {
              const pct = Math.round((h.count / s.histogramMax) * 100);
              const empty = h.count === 0;
              return (
                <div key={h.grade} className="flex flex-1 flex-col items-center justify-end">
                  {!empty && (
                    <span className="mb-1 font-display text-[14px] font-semibold text-navy">{h.count}</span>
                  )}
                  <div
                    className="w-full rounded-t"
                    style={{
                      height: `${Math.max(empty ? 2 : 6, pct)}%`,
                      background: empty ? "var(--bg)" : GRADE_COLORS[h.grade],
                    }}
                  />
                  <span
                    className={`mt-1 font-display text-[12px] font-semibold ${empty ? "text-navy-3" : "text-navy"}`}
                  >
                    {h.grade}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <SumCell
              accent="green"
              lead={`${s.aboveCredit} / ${s.candidates} above credit`}
              body={`${s.candidates ? Math.round((s.aboveCredit / s.candidates) * 100) : 0}% at C6 or better — tertiary-eligible`}
            />
            <SumCell
              lead={`${s.distinctionCount} / ${s.candidates} distinction`}
              body={`${s.distinctionPct}% at B2 or better — strongest band`}
            />
            <SumCell
              lead={`${s.histogram.filter((h) => h.grade === "C5" || h.grade === "C6").reduce((a, b) => a + b.count, 0)} / ${s.candidates} borderline`}
              body="C5–C6 band — the focus zone for the final push"
            />
          </div>
        </div>
      </section>

      {/* ================= §02 — Candidate trajectory · THE mark-entry surface ================= */}
      <section id="students" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-2xl font-medium text-navy">
            {s.candidates} <em className="italic text-gold">candidates</em>
          </h2>
          <span className="text-[11px] text-navy-3">
            {data.cohort.frozen
              ? "marking complete — read-only"
              : "in-flight cohort — Mock 1 open for mark-entry"}
          </span>
        </div>
        <WassceMockEntryGrid
          rows={data.rows}
          columns={data.columns}
          subjectId={data.subject.id}
          canWrite={data.canWriteSubject}
          predictorColumnId={data.predictorColumnId}
        />
      </section>

      {/* ================= §03 — Topic heatmap · SEEDED/STATIC (no per-topic table in INCR-16) ================= */}
      <section id="heatmap" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-2xl font-medium text-navy">
            Where the <em className="italic text-gold">cohort</em> is weak
          </h2>
          <span className="rounded-full bg-bg px-2 py-0.5 text-[10px] uppercase tracking-wide text-navy-3">
            static · needs a per-topic table (deferred)
          </span>
        </div>
        <div className="overflow-x-auto rounded-lg border border-border bg-surface p-4">
          <table className="w-full min-w-[720px] border-collapse text-[11px]">
            <thead className="text-[10px] font-bold uppercase tracking-wide text-navy-3">
              <tr className="border-b border-border">
                <th className="px-2 py-2 text-left">Topic</th>
                <th className="px-2 py-2 text-center">A1</th>
                <th className="px-2 py-2 text-center">B2–B3</th>
                <th className="px-2 py-2 text-center">C4–C6</th>
                <th className="px-2 py-2 text-center">D7–E8</th>
                <th className="px-2 py-2 text-center">F9</th>
                <th className="px-2 py-2 text-center">Cohort avg</th>
              </tr>
            </thead>
            <tbody>
              {TOPIC_HEATMAP.map((t) => (
                <tr key={t.topic} className="border-b border-border">
                  <td className="px-2 py-2">
                    <div className="font-semibold text-navy">{t.topic}</div>
                    <div className="text-[10px] text-navy-3">{t.meta}</div>
                  </td>
                  {t.cells.map((c, i) => (
                    <HeatCell key={i} count={c.n} level={c.h} />
                  ))}
                  <HeatCell label={t.avg.g} level={t.avg.h} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ================= §04 — Final 24 days · intervention plan · SEEDED/STATIC ================= */}
      <section id="plan" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-2xl font-medium text-navy">
            The <em className="italic text-gold">final</em> 24 days
          </h2>
          <span className="rounded-full bg-bg px-2 py-0.5 text-[10px] uppercase tracking-wide text-navy-3">
            static · plan text + co-sign deferred
          </span>
        </div>
        <div className="grid gap-3.5 md:grid-cols-3">
          {INTERVENTION_TIERS.map((t) => (
            <div
              key={t.eyebrow}
              className="rounded-lg border border-border bg-surface p-4"
              style={{ borderTop: `3px solid ${t.color}` }}
            >
              <div className="text-[10px] font-bold uppercase" style={{ color: t.color }}>
                {t.eyebrow}
              </div>
              <div className="mt-1 font-display text-[15px] font-medium text-navy">{t.title}</div>
              <div className="mt-2 border-b border-border pb-2 text-[12px] text-navy-2">{t.students}</div>
              <ul className="mt-2 space-y-1.5 text-[11.5px] text-navy-2">
                {t.plan.map((p) => (
                  <li key={p} className="before:mr-1 before:text-gold before:content-['·']">
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* ================= §05 — Benchmark · my cohort vs school, region, national ================= */}
      {data.benchmark && (
        <section id="benchmark" className="space-y-3">
          <h2 className="font-display text-2xl font-medium text-navy">
            How does <em className="italic text-gold">my</em> cohort compare?
          </h2>
          <div className="grid gap-4 rounded-lg border border-border bg-surface p-5 md:grid-cols-2">
            <BenchCellView cell={data.benchmark.credit} />
            <BenchCellView cell={data.benchmark.distinction} />
          </div>
          <div className="rounded-lg border border-border bg-bg px-3 py-2 text-[11px] text-navy-3">
            <b className="text-navy-2">Data quality</b> · <Dot cls="bg-green" />{" "}
            <b>Strong</b> direct measurement · <Dot cls="bg-gold" /> <b>Moderate</b> annual snapshot ·{" "}
            <Dot cls="bg-warn" /> <b>Directional</b> interpolated from coarser data.
          </div>
          <div className="rounded-lg border border-gold-soft bg-gold-bg p-4 text-[12px] text-navy-2">
            <div className="font-display text-[14px] font-medium text-navy">
              Mr Asiedu&apos;s CPD record on this cohort
            </div>
            <p className="mt-1">
              Three-year teaching cycle · joined them in F1 (Sep 2023) · 142 lessons taught · 18 mock
              assessments marked · 12 Science HOD PLC sessions attended · 1 CPD-credited equilibria
              pedagogy session led at the Western Region NTC convention (+15 CPD points). NTC licence
              renewal eligible at end of cycle.{" "}
              <span className="text-navy-3">(cross-module HR/NTC — static)</span>
            </p>
          </div>
        </section>
      )}
    </div>
  );
}

/* ------------------------------- derived-frame helpers ------------------------------- */

function StripCell({
  accent,
  label,
  value,
  meta,
}: {
  accent?: "terra" | "green" | "gold";
  label: string;
  value: string;
  meta: string;
}) {
  const border = accent === "terra" ? "border-l-terra" : accent === "green" ? "border-l-green" : accent === "gold" ? "border-l-gold" : "";
  const valColor = accent === "terra" ? "text-terra" : accent === "green" ? "text-green" : accent === "gold" ? "text-gold" : "text-navy";
  return (
    <div className={`rounded-lg border border-border ${accent ? `border-l-[3px] ${border}` : ""} bg-surface p-3`}>
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-navy-3">{label}</div>
      <div className={`mt-1 font-display text-[26px] font-medium leading-none ${valColor}`}>{value}</div>
      <div className="mt-1 text-[11px] text-navy-3">{meta}</div>
    </div>
  );
}

function SumCell({ accent, lead, body }: { accent?: "green"; lead: string; body: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg p-3">
      <div className={`font-display text-[18px] font-semibold ${accent === "green" ? "text-green" : "text-navy"}`}>
        {lead}
      </div>
      <div className="mt-0.5 text-[11px] text-navy-2">{body}</div>
    </div>
  );
}

function HeatCell({ count, label, level }: { count?: number; label?: string; level: keyof typeof HEAT_COLORS }) {
  const c = HEAT_COLORS[level];
  return (
    <td className="px-1 py-1 text-center">
      <span
        className="inline-flex h-7 w-full min-w-[34px] items-center justify-center rounded font-display text-[11px] font-semibold"
        style={{ background: c.bg, color: c.text }}
      >
        {label ?? (count === 0 ? "" : count)}
      </span>
    </td>
  );
}

function Dot({ cls }: { cls: string }) {
  return <span className={`inline-block h-2 w-2 rounded-full align-middle ${cls}`} />;
}

function BenchCellView({ cell }: { cell: BenchCell }) {
  return (
    <div>
      <div className="mb-2 font-display text-[14px] font-medium text-navy">{cell.title}</div>
      <div className="space-y-2">
        {cell.rows.map((r) => {
          const dot = benchmarkDot(r.quality);
          return (
            <div key={r.label} className="grid grid-cols-[150px_1fr_44px] items-center gap-2">
              <div>
                <div className="text-[12px] font-semibold text-navy">{r.label}</div>
                <div className={`text-[9px] ${dot.key === "weak" ? "font-semibold text-warn" : "text-navy-3"}`}>
                  <Dot cls={dot.dotClass} /> {r.source}
                  {r.caveatPp != null && r.quality === "DIRECTIONAL" ? ` · ± ${r.caveatPp} pp` : ""}
                </div>
              </div>
              <div className="h-2 rounded bg-bg">
                <div
                  className="h-2 rounded"
                  style={{
                    width: `${Math.min(100, r.value)}%`,
                    background: dot.key === "strong" ? "var(--green)" : dot.key === "mod" ? "var(--gold)" : "var(--warn)",
                  }}
                />
              </div>
              <div className="text-right font-mono text-[12px] font-semibold text-navy">{r.value}%</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------- seeded/static section content (Lucy map §3/§4) ------------------------------- */

type Heat = keyof typeof HEAT_COLORS;
const TOPIC_HEATMAP: {
  topic: string;
  meta: string;
  cells: { n: number; h: Heat }[];
  avg: { g: string; h: Heat };
}[] = [
  { topic: "Organic chemistry", meta: "12 questions · 24% of paper", cells: [{ n: 12, h: "h5" }, { n: 11, h: "h4" }, { n: 5, h: "h2" }, { n: 0, h: "h0" }, { n: 0, h: "h0" }], avg: { g: "B2", h: "h4" } },
  { topic: "Inorganic · transition metals", meta: "8 questions · 16% of paper", cells: [{ n: 9, h: "h5" }, { n: 10, h: "h4" }, { n: 7, h: "h3" }, { n: 2, h: "h1" }, { n: 0, h: "h0" }], avg: { g: "B3", h: "h3" } },
  { topic: "Stoichiometry & mole concept", meta: "6 questions · 12% of paper", cells: [{ n: 10, h: "h5" }, { n: 12, h: "h4" }, { n: 6, h: "h2" }, { n: 0, h: "h0" }, { n: 0, h: "h0" }], avg: { g: "B2", h: "h4" } },
  { topic: "Atomic structure & bonding", meta: "5 questions · 10% of paper", cells: [{ n: 8, h: "h5" }, { n: 13, h: "h4" }, { n: 7, h: "h3" }, { n: 0, h: "h0" }, { n: 0, h: "h0" }], avg: { g: "B3", h: "h3" } },
  { topic: "Acids · bases · salts", meta: "5 questions · 10% of paper", cells: [{ n: 11, h: "h5" }, { n: 10, h: "h4" }, { n: 6, h: "h2" }, { n: 1, h: "h0" }, { n: 0, h: "h0" }], avg: { g: "B2", h: "h4" } },
  { topic: "Equilibria · Le Chatelier", meta: "5 questions · 10% of paper", cells: [{ n: 4, h: "h3" }, { n: 9, h: "h3" }, { n: 12, h: "h2" }, { n: 3, h: "h1" }, { n: 0, h: "h0" }], avg: { g: "C4", h: "h2" } },
  { topic: "Electrochemistry", meta: "4 questions · 8% of paper", cells: [{ n: 3, h: "h2" }, { n: 8, h: "h3" }, { n: 12, h: "h2" }, { n: 4, h: "h1" }, { n: 1, h: "h0" }], avg: { g: "C5", h: "h1" } },
  { topic: "Reaction kinetics", meta: "3 questions · 6% of paper", cells: [{ n: 7, h: "h4" }, { n: 11, h: "h4" }, { n: 9, h: "h3" }, { n: 1, h: "h1" }, { n: 0, h: "h0" }], avg: { g: "B3", h: "h3" } },
  { topic: "Energetics & thermochemistry", meta: "3 questions · 6% of paper", cells: [{ n: 6, h: "h4" }, { n: 9, h: "h3" }, { n: 10, h: "h2" }, { n: 3, h: "h1" }, { n: 0, h: "h0" }], avg: { g: "C4", h: "h2" } },
  { topic: "Industrial chemistry · contemporary", meta: "2 questions · 4% of paper", cells: [{ n: 7, h: "h4" }, { n: 12, h: "h4" }, { n: 8, h: "h3" }, { n: 1, h: "h0" }, { n: 0, h: "h0" }], avg: { g: "B3", h: "h3" } },
];

const INTERVENTION_TIERS = [
  {
    eyebrow: "Tier 1 · urgent intervention",
    title: "Borderline credit",
    color: "#B84A39",
    students: "The C5–C6 band — the FOCUS candidates (derived from Mock-2 bands).",
    plan: [
      "8 hrs after-school tutoring (Mon + Wed, weeks 1–4)",
      "Pair-tutor with a top-3 student for inorganic — Saturday mornings",
      "Daily 20-min question set on the weakest topic (equilibria + electrochem)",
      "Weekly parent SMS update · pre-paper boost session Fri 5 Jun",
    ],
  },
  {
    eyebrow: "Tier 2 · focused improvement",
    title: "Move B3 → B2 or B2 → A1",
    color: "#C8975B",
    students: "The B3 / newly-B2 band · all within reach of a one-grade lift in 24 days.",
    plan: [
      "Whole-class focus on equilibria + electrochem (2 lessons each)",
      "WAEC past-paper practice · weekly · marked by Mr Asiedu",
      "Topic-specific resource pack per weak topic",
      "Mid-cycle check-in · Sat 24 May",
    ],
  },
  {
    eyebrow: "Tier 3 · consolidate strengths",
    title: "A1 / B2 band · hold the line",
    color: "#2F6B47",
    students: "The A1/B2 band · low risk of slipping if confidence is maintained.",
    plan: [
      "Self-directed past-paper drills · weekly check-in only",
      "Peer-tutor assignments (top 3 paired with Tier 1 students)",
      "Stretch material on industrial chem + contemporary issues",
      "Pre-paper boost session optional · Fri 5 Jun",
    ],
  },
];
