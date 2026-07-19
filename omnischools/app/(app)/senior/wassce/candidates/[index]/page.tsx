import { redirect } from "next/navigation";
import { requireSchoolRole } from "@/lib/auth/server";
import { WASSCE_SETUP_ROLES } from "@/lib/access";
import { withSchool } from "@/lib/db/rls";
import { loadCandidateReadiness } from "@/lib/wassce/readiness-data";
import { WassceAggregateVisualizer } from "@/components/senior/wassce-aggregate-visualizer";
import { WassceReadinessPanel } from "@/components/senior/wassce-readiness-panel";
import {
  WassceAddTargetTile,
  WassceTargetControls,
} from "@/components/senior/wassce-target-panel";
import { GRADE_COLORS, GRADE_CHIP_TEXT } from "@/lib/wassce/grade-colors";
import {
  MATCH_LEGEND,
  MATCH_TIER_CLASS,
  MATCH_TIER_LABEL,
  AGGREGATE_MIN,
  AGGREGATE_MAX,
} from "@/lib/wassce/university-match";
import type { SubjectTrajectoryView, UniversityMatchTileView } from "@/lib/wassce/readiness-view";

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
  const m = data.universityMatch;
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

      {/* ================= §6 university match — CROWN JEWEL (INCR-17b) ================= */}
      <section id="match" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.12em] text-navy-3">
              {data.shortName} › University match
            </div>
            <h2 className="mt-1 font-display text-2xl font-medium text-navy">
              {m.computable && m.tiles.length > 0 ? (
                <>
                  {m.tiles.length === 1 ? "One " : `${m.tiles.length} `}
                  <em className="italic text-gold">{m.tiles.length === 1 ? "programme" : "programmes"}</em>{" "}
                  · matched and ranked
                </>
              ) : (
                <>
                  University <em className="italic text-gold">match</em>
                </>
              )}
            </h2>
            {m.computable && m.tiles.length > 0 ? (
              <div className="mt-0.5 text-[12px] text-navy-3">
                {m.tallyLabel} · projected aggregate <b className="font-mono text-navy">{m.aggregate}</b>
              </div>
            ) : null}
          </div>
          <a
            href="/senior/wassce/setup#university-targets"
            className="rounded-md border border-border-2 bg-surface px-4 py-2 text-[12px] font-semibold text-navy hover:bg-gold-bg"
          >
            View cut-off table
          </a>
        </div>

        {!m.computable ? (
          <div className="rounded-lg border border-dashed border-border-2 bg-surface p-5 text-[13px] text-navy-3">
            <b className="text-navy-2">Projection pending.</b> The university match compares the
            candidate&apos;s projected aggregate against each programme&apos;s published cut-off — with no
            computable best-3 aggregate there is no honest comparison to draw, so no band is shown.
            {m.taggedNames.length > 0 ? (
              <>
                {" "}
                Tagged programmes: <b className="text-navy-2">{m.taggedNames.join(" · ")}</b>.
              </>
            ) : null}
          </div>
        ) : (
          <>
            <div className="grid gap-3.5 lg:grid-cols-2">
              {m.tiles.map((t) => (
                <MatchTile key={t.targetId} tile={t} aggregate={m.aggregate} />
              ))}
              <WassceAddTargetTile
                candidateId={data.candidateId}
                programmeOptions={data.programmeOptions}
              />
            </div>

            {/* match-logic legend — static copy, renders even with zero targets */}
            <div className="rounded-lg border border-border bg-surface px-[22px] py-[18px]">
              <div className="mb-2.5 font-display text-[14px] font-medium text-navy">
                Match logic — five-tier band
              </div>
              <div className="grid gap-2.5 text-[11px] md:grid-cols-3 xl:grid-cols-5">
                {MATCH_LEGEND.map((l) => (
                  <div key={l.tier}>
                    <span
                      className={`inline-block rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${MATCH_TIER_CLASS[l.tier]}`}
                    >
                      {MATCH_TIER_LABEL[l.tier]}
                    </span>
                    <span className="mt-1.5 block text-navy-3">{l.gloss}</span>
                  </div>
                ))}
              </div>
              <p className="mt-3 border-t border-border pt-2.5 text-[11px] text-navy-3">
                Cut-offs are a <b className="text-navy-2">published snapshot</b> of the year stamped beside
                each figure — not live admissions data. Universities sometimes adjust cut-offs after WASSCE
                results come in if the applicant pool changes; the figures here are{" "}
                <b className="text-navy-2">indicative, not guarantees</b>. The match band is derived on
                every read from this candidate&apos;s projected aggregate — it is never stored.
              </p>
            </div>
          </>
        )}
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

/**
 * One §6 university-match tile. Every figure arrives pre-derived from the loader; the ONLY layout maths
 * here is placing the two markers at their already-computed percentages on the shared 6→54 scale (Lucy
 * A.8 — the surface's hand-tuned inline `left:` values are deliberately NOT copied). The five badge
 * tints are solid classes from `MATCH_TIER_CLASS` — no slash-opacity on a raw-hex token.
 */
function MatchTile({ tile, aggregate }: { tile: UniversityMatchTileView; aggregate: number }) {
  const preClass =
    tile.prerequisiteStatus === "UNMET"
      ? "text-terra"
      : tile.prerequisiteStatus === "PENDING"
        ? "text-warn"
        : "text-navy-3";
  return (
    <div
      className={`relative overflow-hidden rounded-lg border border-border bg-surface px-5 py-[18px] ${tile.isPrimary ? "border-l-4 border-l-gold" : ""}`}
      style={
        tile.isPrimary
          ? { background: "linear-gradient(to right, var(--gold-bg) 0%, var(--surface) 12%)" }
          : undefined
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-display text-[15px] font-medium text-navy">{tile.name}</div>
          <div className="text-[12px] text-navy-3">{tile.programmeLine}</div>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${tile.tierClass}`}
        >
          {tile.tierLabel}
        </span>
      </div>

      {/* projected-vs-cut-off bar — both markers on ONE linear 6→54 scale */}
      <div className="mt-5 grid grid-cols-[64px_1fr_64px] items-center gap-2.5 text-[11px] text-navy-3">
        <span>
          Best <b className="font-mono text-navy">{AGGREGATE_MIN}</b>
        </span>
        <div
          className="relative h-2 rounded"
          style={{
            background: "linear-gradient(to right, var(--green) 0%, var(--gold) 70%, var(--terra) 100%)",
          }}
        >
          <Marker pct={tile.cutOffPct} label={`Cut-off · ${tile.cutOff}`} tone="cutoff" />
          {/* "You · N" is the §5 headline aggregate, passed down — ONE number per candidate (AC7). */}
          <Marker pct={tile.youPct} label={`You · ${aggregate}`} tone="you" />
        </div>
        <span className="text-right">
          Worst <b className="font-mono text-navy">{AGGREGATE_MAX}</b>
        </span>
      </div>

      <div className="mt-6 flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-2.5 text-[11px] text-navy-3">
        <span>
          <b className="text-navy">Cut-off</b> · {tile.cutOffLabel}
        </span>
        {tile.trendLabel ? <span>{tile.trendLabel}</span> : null}
        <span>{tile.marginLabel}</span>
        {tile.likelyOutcomeLabel ? <span>{tile.likelyOutcomeLabel}</span> : null}
        <span className={preClass}>{tile.prerequisiteLabel}</span>
      </div>

      <WassceTargetControls tile={tile} />
    </div>
  );
}

/** A bar marker: a 2px navy/terra tick with its value label above the bar. */
function Marker({ pct, label, tone }: { pct: number; label: string; tone: "you" | "cutoff" }) {
  return (
    <span
      className="absolute -top-1 flex w-0 flex-col items-center"
      style={{ left: `${pct}%` }}
      aria-hidden={false}
    >
      <span
        className={`absolute -top-4 whitespace-nowrap text-[10px] font-semibold ${tone === "you" ? "text-navy" : "text-terra"}`}
      >
        {label}
      </span>
      <span className={`block h-3.5 w-0.5 ${tone === "you" ? "bg-navy" : "bg-terra"}`} />
    </span>
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
