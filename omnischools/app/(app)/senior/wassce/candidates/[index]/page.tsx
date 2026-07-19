import { redirect } from "next/navigation";
import { requireSchoolRole } from "@/lib/auth/server";
import { WASSCE_SETUP_ROLES } from "@/lib/access";
import { withSchool } from "@/lib/db/rls";
import { loadCandidateReadiness } from "@/lib/wassce/readiness-data";
import { WassceAggregateVisualizer } from "@/components/senior/wassce-aggregate-visualizer";
import { WassceReadinessPanel } from "@/components/senior/wassce-readiness-panel";
import { GRADE_COLORS, GRADE_CHIP_TEXT } from "@/lib/wassce/grade-colors";
import type { SubjectTrajectoryView } from "@/lib/wassce/readiness-view";

export const dynamic = "force-dynamic";

/**
 * WASSCE candidate readiness deep-dive (SHS module 4.3 / INCR-17 · `schoolup-wassce-student-readiness`).
 * The in-scope slices: §5 aggregate-construction visualizer (crown jewel), §1 identity/trajectory +
 * medical banner, §3 subject Mock1→Mock2→projected cards, §4 projection callout, §7 readiness statement
 * + parent-ack + SC-form. Everything DERIVES on read via the pure projectAggregate lib. Scoped to the
 * candidate (index-number route, tenant-unique) and role-gated to WASSCE_SETUP_ROLES. University match
 * (§6) is INCR-17b — NOT built here. Full deep-dive chrome (STPSHS panel, schedule, ledger grid) = INCR-20.
 */
export default async function WassceCandidateReadinessPage(props: {
  params: Promise<{ index: string }>;
}) {
  const { school } = await requireSchoolRole(WASSCE_SETUP_ROLES);
  if (school.schoolType === "BASIC") redirect("/gradebook");

  const { index } = await props.params;
  const data = await withSchool(school.id, (tx) =>
    loadCandidateReadiness(tx, school.id, decodeURIComponent(index)),
  );

  if (!data) {
    return (
      <div className="mx-auto max-w-page">
        <div className="rounded-xl border border-dashed border-border-2 bg-surface p-12 text-center text-sm text-navy-3">
          No WASSCE candidate found for index number <b className="text-navy-2">{index}</b> in this school.
        </div>
      </div>
    );
  }

  const p = data.projection;
  const aggText = p.computable ? String(p.aggregate) : "—";

  return (
    <div className="mx-auto max-w-page space-y-8">
      {/* ---- page head ---- */}
      <div className="border-b border-border pb-4">
        <div className="text-[11px] uppercase tracking-[0.12em] text-navy-3">
          {data.shortName} › Aggregate construction
        </div>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <h1 className="font-display text-2xl font-medium text-navy">
            Aggregate · <em className="italic text-gold">{aggText}</em> · construction shown
          </h1>
          <div className="text-right text-[12px] text-navy-3">
            <div className="font-mono text-navy-2">{data.indexNumber}</div>
            <div>{data.programmeLabel}</div>
          </div>
        </div>
      </div>

      {/* ================= §1 medical-disruption banner (open SC-12 only) ================= */}
      {data.openMedicalSc ? (
        <div
          className="grid grid-cols-[auto_1fr] items-start gap-4 rounded-xl px-5 py-4 text-bg"
          style={{ background: "linear-gradient(135deg, #B84A39, #8B3829)" }}
        >
          <span
            className="flex h-[38px] w-[38px] items-center justify-center rounded-md font-display text-lg"
            style={{ background: "rgba(255,255,255,0.16)" }}
          >
            ⚕
          </span>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] opacity-70">
              Active medical disruption · WAEC {data.openMedicalSc.scForm} filed
            </div>
            <div className="mt-1 font-display text-lg font-medium">
              {data.fullName} has an open{" "}
              <em className="italic" style={{ color: "#F5D4C9" }}>
                {data.openMedicalSc.scForm}
              </em>{" "}
              special consideration · make-up scheduling in progress
            </div>
            <div className="mt-1 text-[12px] leading-relaxed opacity-90">
              {data.openMedicalSc.waecRef ? (
                <>
                  WAEC ref <span className="font-mono">{data.openMedicalSc.waecRef}</span> ·{" "}
                </>
              ) : null}
              status {data.openMedicalSc.statusLabel}. The projected aggregate holds on the Mock-2 signal —
              a missed live paper does not degrade the number until the make-up sitting is scored.
            </div>
          </div>
        </div>
      ) : null}

      {/* ================= §1 identity + trajectory strip ================= */}
      <section className="grid gap-4 lg:grid-cols-[280px_1fr]">
        {/* projected-aggregate identity cell */}
        <div className="rounded-lg border border-border bg-surface p-5">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-navy-3">
            Projected aggregate
          </div>
          <div className="mt-1 font-display text-5xl font-medium text-green">{aggText}</div>
          <div className="mt-1 text-[12px] text-navy-3">Mock 2 predictor · WASSCE in flight</div>
          <div className="mt-3 border-t border-border pt-3 text-[12px] text-navy-2">
            <div>
              <b className="text-navy">{data.fullName}</b>
            </div>
            <div className="font-mono text-[11px] text-navy-3">{data.indexNumber}</div>
          </div>
        </div>

        {/* trajectory strip */}
        {p.computable ? (
          <div className="grid grid-cols-3 gap-4">
            <TrajCell stage="Mock 1 · calibration" agg={p.mock1Aggregate} band={p.mock1BandLabel} tint="warn" />
            <TrajCell
              stage="Mock 2 · predictor"
              agg={p.mock2Aggregate}
              band={p.mock2BandLabel}
              tint="green"
              arrow={p.deltaLabel}
            />
            <TrajCell
              stage="WASSCE projected"
              agg={p.aggregate}
              band={p.projectedBandLabel}
              tint="gold"
              arrow={p.holding ? "→ holding" : null}
              projected
            />
          </div>
        ) : (
          <div className="flex items-center rounded-lg border border-dashed border-border-2 bg-surface p-5 text-[13px] text-navy-3">
            Trajectory unavailable until the predictor projection is computable.
          </div>
        )}
      </section>

      {/* trust line */}
      <p className="text-[12px] leading-relaxed text-navy-3">
        The Mock 2 → projected step is a holding projection. Omnischools does not adjust the projected
        aggregate for any missed paper until the make-up sitting is scored — adjusting now would build
        false signal into university-target conversations. The aggregate band reads as projected.
      </p>

      {/* ================= §5 aggregate-construction visualizer — CROWN JEWEL ================= */}
      <section id="aggregate" className="space-y-3">
        <h2 className="font-display text-2xl font-medium text-navy">
          Aggregate <em className="italic text-gold">construction</em>
        </h2>
        <WassceAggregateVisualizer projection={p} />
      </section>

      {/* ================= §3 subject-by-subject cards ================= */}
      <section id="subjects" className="space-y-3">
        <h2 className="font-display text-2xl font-medium text-navy">
          Subjects · <em className="italic text-gold">Mock 1</em> → <em className="italic text-gold">Mock 2</em> → projected
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          {data.subjects.map((s) => (
            <SubjectCard key={s.name} subject={s} />
          ))}
        </div>
      </section>

      {/* ================= §4 projection callout (contextual narration) ================= */}
      <section id="ledger-trajectory">
        <div
          className="rounded-lg border-t-[3px] border-gold-soft p-5"
          style={{ background: "linear-gradient(135deg, #F5EBDC, var(--gold-bg))" }}
        >
          <h5 className="font-display text-[15px] font-medium text-navy">
            How <em className="italic text-gold">this trajectory</em> produces the projection
          </h5>
          <p className="mt-1.5 text-[12px] leading-relaxed text-navy-2">
            The projection is <b className="text-navy">Mock-2-anchored</b>: the predictor mock&apos;s
            effective grade per subject is the projected WASSCE grade (Decision 2), and the aggregate is
            the deterministic best-3 of those grades. The Mock 1 → Mock 2 trajectory is context — it does
            not adjust the number (a hidden trajectory model is exactly the drift Decision 12 forbids). The
            six-semester score ledger is a supporting read (INCR-20), never the formula.
          </p>
        </div>
      </section>

      {/* ================= §7 readiness statement + SC xmod + write panel ================= */}
      <section id="context" className="space-y-4">
        <h2 className="font-display text-2xl font-medium text-navy">
          Readiness <em className="italic text-gold">statement</em> + special consideration
        </h2>

        {/* parent-ack artifact */}
        {data.statement ? (
          <div className="grid grid-cols-[auto_1fr_auto] items-center gap-5 rounded-lg border border-border bg-surface p-5">
            <span
              className={`flex h-12 w-12 items-center justify-center rounded-md font-display text-xl ${
                data.statement.parentAcknowledged ? "bg-green-bg text-green" : "bg-bg text-navy-3"
              }`}
            >
              {data.statement.parentAcknowledged ? "✓" : "—"}
            </span>
            <div>
              <div className="font-display text-[16px] font-medium text-navy">
                {data.statement.parentAckTitle ??
                  `Readiness statement generated · ${data.statement.generatedAtLabel} · awaiting parent acknowledgement`}
              </div>
              <div className="mt-0.5 text-[12px] text-navy-3">
                {data.statement.parentAckMeta ??
                  `Projected aggregate ${data.statement.projectedAggregate ?? "—"} · ${data.statement.projectedBand ?? ""}`}
              </div>
            </div>
            <a
              href={data.statement.pdfHref}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border border-border-2 bg-surface px-4 py-2 text-[12px] font-semibold text-gold hover:bg-gold-bg"
            >
              View PDF →
            </a>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border-2 bg-surface p-5 text-[13px] text-navy-3">
            No readiness statement generated yet.
          </div>
        )}

        {/* SC xmod cards */}
        {data.scForms.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-3">
            {data.scForms.map((s) => (
              <div key={s.scForm} className="rounded-lg border border-border bg-surface p-4">
                <div className="text-[10px] font-bold uppercase tracking-wide text-gold">WAEC</div>
                <div className="mt-0.5 font-display text-[15px] font-medium text-navy">
                  {s.scForm} special consideration
                </div>
                <div className="mt-1 text-[12px] text-navy-3">
                  {s.scopeLabel} · {s.statusLabel}
                  {s.waecRef ? (
                    <>
                      {" · "}
                      <span className="font-mono">{s.waecRef}</span>
                    </>
                  ) : null}
                  {s.filedAtLabel ? ` · filed ${s.filedAtLabel}` : ""}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {/* write panel */}
        <WassceReadinessPanel
          candidateId={data.candidateId}
          scForms={data.scForms}
          hasStatement={data.statement != null}
          parentAcknowledged={data.statement?.parentAcknowledged ?? false}
          canGenerate={data.canGenerate}
          generateBlockedReason={data.generateBlockedReason}
        />
      </section>
    </div>
  );
}

/* ------------------------------- presentational ------------------------------- */

function TrajCell({
  stage,
  agg,
  band,
  tint,
  arrow,
  projected,
}: {
  stage: string;
  agg: number | null;
  band: string | null;
  tint: "warn" | "green" | "gold";
  arrow?: string | null;
  projected?: boolean;
}) {
  const barColor = tint === "warn" ? "bg-warn" : tint === "green" ? "bg-green" : "bg-gold";
  return (
    <div
      className={`rounded-lg border p-4 ${projected ? "border-gold-soft" : "border-border"}`}
      style={projected ? { background: "linear-gradient(135deg, #F5EBDC, var(--gold-bg))" } : undefined}
    >
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-navy-3">{stage}</div>
        {arrow ? <span className="text-[11px] font-bold text-green">{arrow}</span> : null}
      </div>
      <div className="mt-1 font-display text-4xl font-medium text-navy">{agg ?? "—"}</div>
      <div className="text-[11px] text-navy-3">aggregate</div>
      <div className="mt-2 h-1.5 rounded bg-bg">
        <div className={`h-1.5 rounded ${barColor}`} style={{ width: agg != null ? `${Math.max(8, 100 - agg * 1.7)}%` : "0%" }} />
      </div>
      {band ? <div className="mt-1.5 text-[11px] text-navy-2">{band}</div> : null}
    </div>
  );
}

function GradeChip({ grade, sm }: { grade: string | null; sm?: boolean }) {
  if (!grade) return <span className="text-navy-3">—</span>;
  return (
    <span
      className={`inline-flex items-center justify-center rounded-sm font-display font-semibold ${sm ? "h-6 min-w-[26px] px-1 text-[11px]" : "h-8 min-w-[32px] px-1.5 text-[13px]"}`}
      style={{ background: GRADE_COLORS[grade as keyof typeof GRADE_COLORS] ?? "#5C6675", color: GRADE_CHIP_TEXT }}
    >
      {grade}
    </span>
  );
}

function SubjectCard({ subject: s }: { subject: SubjectTrajectoryView }) {
  const accent = s.type === "CORE" ? "var(--gold)" : "var(--green)";
  return (
    <div
      className="rounded-lg border border-border bg-surface p-4"
      style={{ borderTop: `3px solid ${accent}` }}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-display text-[16px] font-medium text-navy">{s.name}</div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-navy-3">
            {s.typeLabel}
          </div>
        </div>
        <GradeChip grade={s.finalGrade} />
      </div>
      <div className="mt-3 grid grid-cols-[auto_1fr_auto_1fr_auto] items-center gap-2 rounded-sm bg-bg p-2.5 text-[10px] text-navy-3">
        <span>M1</span>
        <GradeChip grade={s.mock1} sm />
        <span>M2</span>
        <GradeChip grade={s.mock2} sm />
        <span>WASSCE —</span>
      </div>
      {s.dropped ? (
        <div className="mt-2 text-[11px] text-navy-3">
          Not in the best-3 for its pool — this subject does not count toward the aggregate per WAEC&apos;s
          best-3 rule.
        </div>
      ) : null}
    </div>
  );
}
