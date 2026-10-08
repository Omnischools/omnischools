import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type {
  CpdStatus,
  NtcProvenance,
  StatusRate,
  StatusValue,
  TeacherCpdPanel as TeacherCpdPanelData,
} from "@/lib/oversight/cpd";
import { Absent, Panel } from "./primitives";
import { formatCount, formatRatio, formatRatioPercent } from "./kpi-card";
import { pluralNoun } from "./tier-chrome";
import { DEMO_CHIP_TOOLTIP, isDemo } from "./cpd-tone";

/**
 * THE TEACHER CPD & PLC PANEL VISUALS (increment L — CPD-SURFACING-RULING, Lucy's CPD-SURFACE-MAP).
 *
 * Two clearly-separated sub-sections, because the two cuts are different period grains AND different
 * provenance (C16): sub-section A is PLC participation on the TERM cut (real-shape operational
 * aggregates, UN-CHIPPED); sub-section B is CPD points and national compliance on the ANNUAL cut, where
 * every NTC-derived figure carries the inline DEMO chip ON THE FIGURE (C6) — a screenshot of a single
 * number must still read as demo.
 *
 * ⚠ THE FOUR DISPLAY STATES ARE THE POINT OF THIS FILE (C10/C11). A NULL NTC column renders the muted
 * `<Absent/>` with the NTC sourcing title — NEVER a 0 and NEVER a 0%, because "0% of teachers met the
 * national CPD requirement" is both false and actionable. A measured zero renders a definite 0 WITH ITS
 * WORD, visually distinct from that absence. A demo figure renders the number plus the chip. Nothing in
 * this file coalesces an absent figure into a number: `renderCpdStatus` branches on the reader's
 * discriminated status and has no numeric fallback.
 *
 * Tone: neutral navy on every figure, the amber `warn` family on the chip, gold-soft on the bars and
 * the parity band. NEVER green, and never terra on a synthetic figure — see `cpd-tone.ts`.
 */

/** The ABSENT state's title — the NTC sourcing gate, stated in the officer's words (C10 state 3). */
export const ABSENT_NTC_TITLE =
  "Not yet sourced from NTC — the live NTC CPD feed is not connected";

/* ══════════════════════════════════════════════════════════════════════════════════════════════════
 * §2 — THE DEMO CHIP. Renders IFF the reader's one switch says DEMO; `null` otherwise, so flipping to
 * LIVE (or ABSENT) removes every chip on the surface with no second branch to maintain (AC-6).
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

export function DemoChip({ provenance }: { provenance: NtcProvenance }) {
  if (!isDemo(provenance)) return null;
  // NOT COLOUR ALONE: the literal word DEMO plus the verbatim tooltip, so a greyscale screenshot and a
  // screen reader carry the same warning as the amber. `warn` is the token amber for
  // "illustrative/pending" — deliberately distinct from the shortage terra and the brand gold.
  return (
    <span
      title={DEMO_CHIP_TOOLTIP}
      className="ml-1 inline-flex items-center rounded-pill border border-warn bg-warn-bg px-1.5 py-[1px] font-mono text-[9px] font-bold uppercase tracking-wide text-warn"
    >
      DEMO
    </span>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════════
 * §6 — THE FOUR-STATE RENDERER. One function, four states, no numeric fallback.
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

export function renderCpdStatus(
  status: CpdStatus,
  {
    text,
    zeroText,
    provenance,
    absentTitle,
  }: {
    /** The figure with its word — e.g. "47 teachers", "62%". Used for MEASURED and DEMO. */
    text: string;
    /** The definite-zero phrasing, WITH its word and never an em-dash (C10 state 2). */
    zeroText?: string;
    provenance: NtcProvenance;
    absentTitle?: string;
  },
): ReactNode {
  // STATE 3 — ABSENT. The muted em-dash with its own title. Never a 0, never a 0%.
  if (status === "ABSENT") return <Absent title={absentTitle ?? ABSENT_NTC_TITLE} />;
  // STATE 2 — a REAL ZERO. A fact, so neutral navy: not styled green, not styled terra.
  if (status === "REAL_ZERO")
    return <span className="font-mono text-navy">{zeroText ?? text}</span>;
  // STATE 4 — DEMO: the figure, its word, and the chip ON THE FIGURE. STATE 1 — MEASURED: the figure.
  return (
    <span className="font-mono text-navy">
      {text}
      {status === "DEMO" ? <DemoChip provenance={provenance} /> : null}
    </span>
  );
}

/** The component form, for a figure that sits on its own line. */
export function CpdCell(props: {
  status: CpdStatus;
  text: string;
  zeroText?: string;
  provenance: NtcProvenance;
  absentTitle?: string;
}) {
  const { status, ...rest } = props;
  return <>{renderCpdStatus(status, rest)}</>;
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════════
 * formatters — points as stored numeric, rates at one decimal (the house precision).
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

/** CPD points as stored (`numeric`), trimmed of a pointless trailing ".00". */
function formatPoints(points: number): string {
  return Number.isInteger(points) ? formatCount(points) : formatRatio(points, 2);
}

/** A 0..1 rate as "62.4%" — one decimal, the house precision for a Σ÷Σ tier figure. */
function pctText(rate: number): string {
  return `${formatRatioPercent(rate, 1)}%`;
}

/** A 0..1 rate as a bar width. Clamped, because a width is not a figure — the sentence carries that. */
function barWidth(rate: number): string {
  return `${(Math.min(1, Math.max(0, rate)) * 100).toFixed(1)}%`;
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ THE UNIT OF A `StatusRate` IS NOT ALWAYS A 0..1 FRACTION — AND IT MUST BE STATED (Quinn RED-1).
 *
 * Five metrics on this panel carry a sex split, and FOUR of them are fractions of a population (PLC
 * coverage, participation, the CPD-threshold rate, each category coverage). The fifth — B1's
 * `pointsMean` — is Σcpd_points_total ÷ Σcpd_points_teacher_count, i.e. POINTS PER TEACHER: a 10.18-pt
 * mean is not 1,018%. Formatting every sexed figure as a percentage printed exactly that, on the
 * DEMO-chipped, GES-facing number — the misread C6 exists to prevent.
 *
 * So the unit is a CLOSED union and `ParityRow` REQUIRES it: there is deliberately NO default. The next
 * sexed non-fraction metric cannot silently inherit the percentage formatter, because a call site that
 * does not state its unit is a TYPE ERROR — the same discipline `ParityDotTone`/`SpreadBar.endTones`
 * uses for the green dot. The headline in B1 and its parity row read the SAME formatter, so the two can
 * never disagree about what the figure is.
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

export type CpdUnit = "RATE" | "POINTS";

/** A figure in its own unit: a fraction as a percentage, a points mean as points. */
function unitText(unit: CpdUnit, value: number): string {
  return unit === "RATE" ? pctText(value) : `${formatPoints(value)} pts`;
}

/** The gap between two figures, in the unit's OWN points — percentage points, or CPD points. */
function gapText(unit: CpdUnit, delta: number): string {
  return unit === "RATE"
    ? `${formatRatio(delta * 100, 1)} percentage points`
    : `${formatRatio(delta, 2)} CPD points`;
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════════
 * §4 — THE PLC PROGRESS BAR (the CPD mock's `.progress-cell` idiom): a label line, a gold-soft fill on
 * a `bg-bg` track, and the mono figure. The inline `style={{width}}` is the sanctioned one use — the
 * width IS the datum (the `SpreadBar`/`FeeCountBar` justification).
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

export function PlcProgressBar({
  label,
  rate,
  figure,
}: {
  label: ReactNode;
  /** 0..1, already re-derived Σnum÷Σden by the reader. */
  rate: number;
  figure: string;
}) {
  return (
    <div className="mb-[14px] last:mb-0">
      <div className="mb-[5px] flex items-baseline justify-between gap-3">
        <span className="text-[12px] text-navy">{label}</span>
        <span className="font-mono text-[12px] font-semibold text-navy">{figure}</span>
      </div>
      <div className="h-[8px] overflow-hidden rounded-[4px] bg-bg" aria-hidden>
        <span className="block h-full rounded-[4px] bg-gold-soft" style={{ width: barWidth(rate) }} />
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════════
 * §5 — THE SEX / GIRLS'-ACCESS PARITY ROW. A GAP FRAME, NEVER A RANKING (C14).
 *
 * Both figures are NEUTRAL NAVY and the band between them IS the gap: neither sex is "better", so there
 * is no good end, no mean marker and no ranking. `ParityDotTone` is a CLOSED union for exactly the
 * reason `SpreadBar`'s `endTones` is (breakdown-visuals.tsx): it makes a green dot a TYPE ERROR rather
 * than a quiet re-introduction of a valence this frame must not carry.
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

type ParityDotTone = "bg-navy";

export function ParityRow({
  label,
  female,
  male,
  provenance,
  unit,
  axisMax,
  endTones = { low: "bg-navy", high: "bg-navy" },
}: {
  /** The parity sentence, with both figures substituted in by the caller (the C14 wording). */
  label: ReactNode;
  female: StatusRate;
  male: StatusRate;
  /** DEMO on an NTC-sourced metric chips EACH sexed figure (C6/C14); PLC metrics carry no chip. */
  provenance: NtcProvenance;
  /**
   * ⚠ REQUIRED, with NO default — see the unit note above. "RATE" for a 0..1 fraction, "POINTS" for a
   * points-per-teacher mean. Omitting it is a type error rather than a silent percentage.
   */
  unit: CpdUnit;
  /**
   * The STATED axis the two dots are projected onto, for a unit that is not already 0..1 (POINTS:
   * pass the statutory target, e.g. 20). Without it a POINTS row WITHHOLDS the track rather than
   * clamping both dots to the rail — the figures and the gap are still stated (the `FeeRangeBar`
   * fail-loud posture: withhold the drawing, never the figure).
   */
  axisMax?: number | null;
  endTones?: { low: ParityDotTone; high: ParityDotTone };
}) {
  const figure = (side: StatusRate, who: string): ReactNode => (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-[10px] uppercase tracking-wide text-navy-3">{who}</span>
      {renderCpdStatus(side.status, {
        text: side.rate === undefined ? "" : unitText(unit, side.rate),
        zeroText: side.rate === undefined ? unitText(unit, 0) : unitText(unit, side.rate),
        provenance,
      })}
    </span>
  );

  // The two-dot track is drawn only when BOTH sexes have a figure AND the unit has an axis to project
  // onto — a sex whose denominator is zero renders `<Absent/>` above and has no position on the track
  // (never a 0% dot at the rail), and a POINTS row with no stated axis is withheld rather than clamped.
  const scale = unit === "RATE" ? 1 : (axisMax ?? 0);
  const hasFigures = female.rate !== undefined && male.rate !== undefined;
  const canPlot = hasFigures && scale > 0;
  const low = canPlot ? Math.min(female.rate!, male.rate!) / scale : 0;
  const high = canPlot ? Math.max(female.rate!, male.rate!) / scale : 0;
  // The GAP is in the metric's own unit, computed from the FIGURES (never from the track positions).
  const gap = hasFigures ? Math.abs(female.rate! - male.rate!) : null;

  return (
    <div className="mt-2 border-l-2 border-border-1 pl-3">
      <p className="text-[10.5px] text-navy-3">{label}</p>
      <div className="mt-1 flex items-center gap-3">
        <span className="flex items-baseline gap-3">
          {figure(female, "women")}
          {figure(male, "men")}
        </span>
        {canPlot ? (
          <span className="relative h-[10px] flex-1 rounded-[4px] bg-bg" aria-hidden>
            {/* the band between the two figures IS the gap — no centre, no good end */}
            <span
              className="absolute bottom-[2px] top-[2px] rounded-[2px] bg-gold-soft"
              style={{ left: barWidth(low), right: barWidth(1 - high) }}
            />
            <span
              className={cn(
                "absolute top-1/2 h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface",
                endTones.low,
              )}
              style={{ left: barWidth(low) }}
            />
            <span
              className={cn(
                "absolute top-1/2 h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface",
                endTones.high,
              )}
              style={{ left: barWidth(high) }}
            />
          </span>
        ) : null}
      </div>
      {gap === null ? null : (
        <p className="mt-1 text-[10px] text-navy-3">
          A gap of {gapText(unit, gap)}. Neither figure is a target — the signal is the
          gap.
        </p>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════════
 * sub-section scaffolding
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

function SubHeader({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-navy-3">
      {children}
    </h3>
  );
}

function Line({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-[12px] text-navy">{children}</p>;
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════════
 * THE PANEL. Takes a RESOLVED `TeacherCpdPanel` (the section unwraps the `Reading`, exactly as
 * `SchoolFeesPanel`/`TeacherEstablishmentPanel` do).
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

export function CpdPanel({
  data,
  termLabel,
  annualLabel,
  tierNoun,
}: {
  data: TeacherCpdPanelData;
  /** "Term n" — sub-section A's own TERM-grain vintage (C16), distinct from B's. */
  termLabel: string | null;
  /** "2025/26" — sub-section B's ANNUAL vintage. */
  annualLabel: string | null;
  /** "country" / "region" / "district" — the subject noun for a tier sentence (tier-chrome). */
  tierNoun: string;
}) {
  const p = data.ntcProvenance;
  const target = data.ntcCpdTarget;
  const targetClause = target === null ? "the national CPD requirement" : `the national CPD requirement (${formatPoints(target)} pts)`;

  return (
    <Panel
      title={
        <>
          Teacher <em className="accent-italic">CPD &amp; PLC</em>
        </>
      }
      meta="professional learning · CPD points"
    >
      {/* ── A · PLC PARTICIPATION (TERM) — every figure un-chipped real-shape (C6/C9) ───────────── */}
      <div>
        <SubHeader>PLC participation · {termLabel ?? "this term"}</SubHeader>

        {/* A1 — schools running a PLC. sex='ALL' only; NO sex split (sex-invariant, AC-18). */}
        {data.termAvailable || data.schoolsRunning.schools > 0 ? (
          <Line>
            {data.schoolsRunning.count === 0 ? (
              <span className="font-mono text-navy">
                No school in this {tierNoun} runs a Professional Learning Community yet (0
                of {formatCount(data.schoolsRunning.schools)}).
              </span>
            ) : (
              <span className="font-mono text-navy">
                {formatCount(data.schoolsRunning.count)} of{" "}
                {formatCount(data.schoolsRunning.schools)}{" "}
                {pluralNoun(data.schoolsRunning.schools, "school")} run a Professional
                Learning Community.
              </span>
            )}
          </Line>
        ) : (
          <Line>
            <Absent title="No PLC data for this term" />
          </Line>
        )}

        {/* A2 — PLC coverage: Σteachers_in_plc ÷ Σteacher_headcount. SEXED (parity). */}
        <div className="mt-3">
          {data.plcCoverage.status === "ABSENT" ? (
            <Line>
              Teachers taking part in a PLC:{" "}
              <Absent title="No PLC data for this term" />
            </Line>
          ) : (
            <PlcProgressBar
              label={
                <>
                  {formatCount(data.plcCoverage.num ?? 0)} of{" "}
                  {formatCount(data.plcCoverage.den ?? 0)} teachers take part in a PLC
                </>
              }
              rate={data.plcCoverage.rate ?? 0}
              figure={
                data.plcCoverage.status === "REAL_ZERO"
                  ? "0% — no teacher is in a PLC here"
                  : pctText(data.plcCoverage.rate ?? 0)
              }
            />
          )}
          {data.plcCoverage.bySex ? (
            <ParityRow
              label={
                <>
                  Women teachers in a PLC vs men — a parity read, not a ranking.
                </>
              }
              female={data.plcCoverage.bySex.female}
              male={data.plcCoverage.bySex.male}
              provenance={p}
              unit="RATE"
            />
          ) : null}
        </div>

        {/* A3 — participation rate: Σattendance_events ÷ Σattendance_expected. SEXED (parity). */}
        <div className="mt-3">
          <Line>
            {renderCpdStatus(data.participation.status, {
              text: `${pctText(data.participation.rate ?? 0)} of expected PLC sessions were attended.`,
              zeroText: "0% — sessions ran but no attendance was logged.",
              provenance: p,
              absentTitle: "No PLC attendance data for this term",
            })}
          </Line>
          {data.participation.bySex ? (
            <ParityRow
              label="Women teachers attended their expected PLC sessions at this rate, against men's."
              female={data.participation.bySex.female}
              male={data.participation.bySex.male}
              provenance={p}
              unit="RATE"
            />
          ) : null}
        </div>

        {/* A4 — session coverage: Σsessions_held ÷ Σsessions_expected. SEX-INVARIANT: no parity row. */}
        <div className="mt-3">
          {data.sessionCoverage.status === "ABSENT" ? (
            <Line>
              Planned PLC sessions held:{" "}
              <Absent title="No school here set a PLC cadence for this term" />
            </Line>
          ) : (
            <PlcProgressBar
              label={
                <>
                  {formatCount(data.sessionCoverage.num ?? 0)} of{" "}
                  {formatCount(data.sessionCoverage.den ?? 0)} planned PLC sessions were
                  held
                </>
              }
              rate={data.sessionCoverage.rate ?? 0}
              figure={
                data.sessionCoverage.status === "REAL_ZERO"
                  ? `0 of ${formatCount(data.sessionCoverage.den ?? 0)} held`
                  : pctText(data.sessionCoverage.rate ?? 0)
              }
            />
          )}
        </div>

        <p className="mt-3 text-[10.5px] text-navy-3">
          PLC figures are this term&apos;s, aggregated from schools&apos; own Professional
          Learning Community registers. Coverage and rates are re-derived from pooled counts
          — never an average of school rates.
        </p>
      </div>

      {/* ── B · CPD POINTS & NATIONAL COMPLIANCE (ANNUAL) — NTC figures each chipped (C6) ───────── */}
      <div className="mt-5 border-t border-border-1 pt-4">
        <SubHeader>
          CPD points &amp; national compliance · {annualLabel ?? "this year"} · annual
        </SubHeader>
        {isDemo(p) ? (
          <p className="mt-1 text-[10.5px] italic text-navy-3">
            NTC figures below are illustrative demo data — each is marked DEMO. Only
            PLC-earned points are measured.
          </p>
        ) : null}
        {p === "ABSENT" ? (
          <p className="mt-1 text-[10.5px] italic text-navy-3">
            CPD points by NTC category and national compliance are not yet sourced — the
            live NTC CPD feed is not connected. Nothing below is shown as a zero.
          </p>
        ) : null}

        {/* B1 — the headline mean. Denominator is cpd_points_teacher_count, NOT headcount (AC-14). */}
        <div className="mt-3">
          {data.pointsMean.status === "ABSENT" ? (
            <Line>
              CPD points per teacher: <Absent title={ABSENT_NTC_TITLE} />
            </Line>
          ) : (
            <>
              <p className="font-display text-[26px] leading-none text-navy">
                <em className="accent-italic text-gold">
                  {formatPoints(data.pointsMean.rate ?? 0)}
                </em>
                {target === null ? null : (
                  <span className="text-[16px] text-navy-3">
                    {" "}
                    / {formatPoints(target)}
                  </span>
                )}{" "}
                <span className="text-[13px] text-navy-3">pts</span>
                {isDemo(p) ? <DemoChip provenance={p} /> : null}
              </p>
              <p className="mt-1 text-[10.5px] text-navy-3">
                averaged over the {formatCount(data.pointsMean.den ?? 0)}{" "}
                {pluralNoun(data.pointsMean.den ?? 0, "teacher")} who earned any CPD this
                year — not over all {formatCount(data.headcount)} on roll.
              </p>
            </>
          )}
          {/* B1-subset — C8's un-chipped real PLC subset. ABSENT in the demo state by construction:
              the ETL folds the observed PLC floor into Mandatory, so no column carries it alone. */}
          <p className="mt-1 text-[10.5px] text-navy-3">
            of which PLC-earned:{" "}
            {renderCpdStatus(data.plcEarnedPoints.status, {
              text: `${formatPoints(data.plcEarnedPoints.value ?? 0)} pts`,
              zeroText: "0 pts — no PLC points were earned",
              provenance: p,
              absentTitle:
                "PLC-earned points are not recorded apart from the demo NTC top-up in the Mandatory class",
            })}
          </p>
          {data.pointsMean.bySex ? (
            <ParityRow
              label="Women's mean CPD points against men's — a parity read, not a ranking."
              female={data.pointsMean.bySex.female}
              male={data.pointsMean.bySex.male}
              provenance={p}
              /* ⚠ POINTS, not a rate: this mean is points per teacher (Quinn RED-1). The track is
                 projected onto the STATED statutory target, the same scale as the headline above;
                 with no agreed target the dots are withheld and the figures still stated. */
              unit="POINTS"
              axisMax={target}
            />
          ) : null}
        </div>

        {/* B2 — the three NTC category totals. Each DEMO-chipped; ABSENT when unsourced. */}
        <div className="mt-4 border-t border-border-1 pt-3">
          <Line>
            Mandatory:{" "}
            {renderCpdStatus(data.mandatory.status, {
              text: `${formatPoints(data.mandatory.value ?? 0)} pts`,
              zeroText: "0 pts",
              provenance: p,
            })}
          </Line>
          <p className="text-[10px] text-navy-3">
            {isDemo(p)
              ? "includes the PLC-earned points measured above; the non-PLC (NCPD) half is illustrative."
              : "a PLC-only partial — the non-PLC (NCPD) half of Mandatory has no source yet."}
          </p>
          <Line>
            Specialised:{" "}
            {renderCpdStatus(data.specialised.status, {
              text: `${formatPoints(data.specialised.value ?? 0)} pts`,
              zeroText: "0 pts",
              provenance: p,
            })}
          </Line>
          <Line>
            Recommended:{" "}
            {renderCpdStatus(data.recommended.status, {
              text: `${formatPoints(data.recommended.value ?? 0)} pts`,
              zeroText: "0 pts",
              provenance: p,
            })}
          </Line>
          {/* B2-recon — shown ONLY when all three categories are populated (C8/AC-9). */}
          {data.categoriesReconcile && data.pointsTotal.value !== undefined ? (
            <p className="mt-2 text-[10.5px] text-navy-3">
              Mandatory + Specialised + Recommended ={" "}
              {formatPoints(data.pointsTotal.value)} total CPD points this year.
            </p>
          ) : null}

          {/* B2-cov — three INDEPENDENT coverage rates. They OVERLAP and never sum (AC-17). */}
          <div className="mt-3 space-y-2">
            {(
              [
                ["Mandatory", data.mandatoryCov],
                ["Specialised", data.specialisedCov],
                ["Recommended", data.recommendedCov],
              ] as [string, StatusRate][]
            ).map(([label, cov]) => (
              <div key={label}>
                <p className="text-[11.5px] text-navy">
                  {cov.status === "ABSENT" ? (
                    <>
                      {label} points earned by: <Absent title={ABSENT_NTC_TITLE} />
                    </>
                  ) : (
                    renderCpdStatus(cov.status, {
                      text: `${formatCount(cov.num ?? 0)} of ${formatCount(
                        cov.den ?? 0,
                      )} teachers earned ${label} points — ${pctText(cov.rate ?? 0)}`,
                      zeroText: `0 of ${formatCount(
                        cov.den ?? 0,
                      )} teachers earned ${label} points`,
                      provenance: p,
                    })
                  )}
                </p>
                {cov.bySex ? (
                  <ParityRow
                    label={`Women vs men earning ${label} points — a parity read.`}
                    female={cov.bySex.female}
                    male={cov.bySex.male}
                    provenance={p}
                    unit="RATE"
                  />
                ) : null}
              </div>
            ))}
            <p className="text-[10px] italic text-navy-3">
              The three category counts overlap — a teacher earning in two classes is counted
              in both — so they are three independent coverage rates and never a sum.
            </p>
          </div>
        </div>

        {/* B3 — the C11 showcase. DEMO figure / ABSENT "not yet sourced" / a definite adverse 0. */}
        <div className="mt-4 border-t border-border-1 pt-3">
          <Line>
            {renderCpdStatus(data.threshold.status, {
              text: `${formatCount(data.threshold.value ?? 0)} of ${formatCount(
                data.headcount,
              )} teachers met ${targetClause}`,
              zeroText: `0 teachers met ${targetClause}`,
              provenance: p,
            })}
          </Line>
          {data.thresholdRate.status === "ABSENT" ? null : (
            <p className="mt-1 text-[11.5px] text-navy">
              {renderCpdStatus(data.thresholdRate.status, {
                text: `${pctText(data.thresholdRate.rate ?? 0)} of teachers on roll`,
                zeroText: "0% of teachers on roll",
                provenance: p,
              })}
            </p>
          )}
          {data.thresholdRate.bySex ? (
            <ParityRow
              label="Women against men meeting the national CPD requirement — a parity read, not a ranking."
              female={data.thresholdRate.bySex.female}
              male={data.thresholdRate.bySex.male}
              provenance={p}
              unit="RATE"
            />
          ) : null}
        </div>

        {/* B4 — the school's OWN PLC target, as a COUNT. Never a summed target (C13/AC-16). */}
        <div className="mt-4 border-t border-border-1 pt-3">
          <Line>
            {data.plcTargetMet.status === "ABSENT" ? (
              <>
                Schools meeting their own PLC target:{" "}
                <Absent
                  title={
                    isDemo(p)
                      ? "Not stateable while CPD points carry the demo NTC top-up — the school's own target is PLC-only"
                      : "No school here has a configured PLC target"
                  }
                />
              </>
            ) : (
              <span className="font-mono text-navy">
                {data.plcTargetMet.count === 0
                  ? `No school met its own PLC target (0 of ${formatCount(
                      data.plcTargetMet.schools,
                    )})`
                  : `${formatCount(data.plcTargetMet.count ?? 0)} of ${formatCount(
                      data.plcTargetMet.schools,
                    )} ${pluralNoun(
                      data.plcTargetMet.schools,
                      "school",
                    )} met their own PLC target`}
                {data.annualPlcTarget === null
                  ? "."
                  : ` (${formatPoints(data.annualPlcTarget)} PLC pts).`}
              </span>
            )}
          </Line>
          <p className="text-[10px] text-navy-3">
            A school&apos;s own PLC target is the cadence it set itself — it is not the
            national CPD requirement, and the two are never substituted for one another.
          </p>
        </div>

        {/* partial NTC coverage, stated rather than silently averaged over fewer schools */}
        {isDemo(p) && data.ntcSchools < data.annualSchools ? (
          <p className="mt-3 text-[10.5px] italic text-navy-3">
            The demo NTC figures cover {formatCount(data.ntcSchools)} of{" "}
            {formatCount(data.annualSchools)}{" "}
            {pluralNoun(data.annualSchools, "school")} here; the rest are not sourced and
            are shown as absent, never as zero.
          </p>
        ) : null}
      </div>

      {/* small-cell suppression (lib/oversight/suppression.ts) — stated, never silent */}
      {data.suppressionCaveat !== null ? (
        <p className="mt-4 border-t border-border-1 pt-3 text-[10.5px] italic text-navy-3">
          {data.suppressionCaveat}
        </p>
      ) : null}
    </Panel>
  );
}

export type { TeacherCpdPanelData, StatusValue };
