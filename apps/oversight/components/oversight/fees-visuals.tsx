import { cn } from "@/lib/utils";
import {
  type FeeCategory,
  type FeeCategorySummary,
  type FeeRange,
  type SchoolFeeFigure,
  type SchoolFeeRow,
  type SchoolFeesPanel as SchoolFeesPanelData,
} from "@/lib/oversight/fees";
import { Absent, Panel, Pill } from "./primitives";
import { formatCount, formatGhs } from "./kpi-card";
import { pluralNoun } from "./tier-chrome";

/**
 * THE SCHOOL-FEES PANEL VISUALS (increment K — FEES-SURFACING-RULING, Lucy's FEES-SURFACE-MAP).
 *
 * Every figure here is a SCHOOL-level billed-fee figure or a COUNT of schools. There is deliberately NO
 * central-tendency number above school grain anywhere in this file (ruling F1/F9): `fact_fees` is
 * non-additive, so a "district average fee" is a fabrication. The only district-level reads are the
 * COUNT buckets (`FeeCountBar`, additive) and the CENTRE-LESS range (`FeeRangeBar`, two real schools).
 * Tone is NEVER green and NEVER terra on this surface — a fee is neither a performance win nor a failure
 * (ruling F11/F18); the only accents are the brand gold on the "bills a positive amount" count segment
 * and gold-soft on the range band.
 */

/** Human labels; OTHER carries its "uncategorised" caveat in the label itself (ruling F15). */
const CATEGORY_LABEL: Record<FeeCategory, string> = {
  TUITION: "Tuition",
  BOARDING: "Boarding",
  FEEDING: "Feeding",
  EXAM: "Exam",
  PTA_DUES: "PTA dues",
  OTHER: "Other charges (uncategorised)",
};

/** The noun used in the "X of N schools charge nothing for …" count sentence. */
const CATEGORY_NOUN: Record<FeeCategory, string> = {
  TUITION: "tuition",
  BOARDING: "boarding",
  FEEDING: "feeding",
  EXAM: "exam fees",
  PTA_DUES: "PTA dues",
  OTHER: "other charges",
};

/**
 * FEE_AXIS — the STATED presentation domain for the tuition range bar, in GHS (owner/Kofi-movable,
 * exactly like `PTR_AXIS` / `VACANCY_AXIS` in breakdown-visuals.tsx). It must CONTAIN every plotted
 * per-school median: `projectFee` returns null outside it and the bar is then WITHHELD WITH A NOTE
 * (fail-loud), because the caption still quotes the true range and a clamped band would misstate it.
 * Widen `hi` before plotting any real value above it; never let the projection clamp silently.
 */
export const FEE_AXIS = { lo: 0, hi: 5000 } as const;

/** A GHS amount → its 0..1 track position on FEE_AXIS, or null when it falls outside the stated axis. */
function projectFee(ghs: number): number | null {
  if (ghs < FEE_AXIS.lo || ghs > FEE_AXIS.hi) return null;
  return (ghs - FEE_AXIS.lo) / (FEE_AXIS.hi - FEE_AXIS.lo);
}

/** 0..1 → a percent of a track's width. */
function pct(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

/** A count as a percent of N, for a count-bar segment width. */
function segPct(count: number, total: number): string {
  return total === 0 ? "0%" : `${((count / total) * 100).toFixed(1)}%`;
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════════
 * §5 — THE COUNT-BUCKET BAR (ruling F7). The mock's segmented fee bar, with the segment widths
 * repurposed from GHS amounts (BANNED, F1) to SCHOOL COUNTS (additive, honest). The three buckets sum
 * to N, so the bar always fills the track exactly.
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

function countSentence(summary: FeeCategorySummary, schoolCount: number): string {
  const noun = CATEGORY_NOUN[summary.category];
  return (
    `${formatCount(summary.chargesNothing)} of ${formatCount(schoolCount)} ` +
    `${pluralNoun(schoolCount, "school")} charge nothing for ${noun} · ` +
    `${formatCount(summary.positive)} bill a positive amount · ` +
    `${formatCount(summary.notBilled)} do not bill it`
  );
}

function FeeCountBar({
  summary,
  schoolCount,
}: {
  summary: FeeCategorySummary;
  schoolCount: number;
}) {
  const { category, positive, chargesNothing, notBilled } = summary;
  const isOther = category === "OTHER";
  return (
    <div className={cn("mb-[14px] last:mb-0", isOther && "opacity-75")}>
      <div className="mb-[5px] flex items-baseline justify-between gap-3">
        <span
          className={cn("text-[12px] font-bold", isOther ? "text-navy-3" : "text-navy")}
        >
          {CATEGORY_LABEL[category]}
        </span>
        <span className="font-mono text-[12px] font-semibold text-navy-3">
          {formatCount(schoolCount)} {pluralNoun(schoolCount, "school")}
        </span>
      </div>
      {/* The segmented bar — inline `style` width IS the datum (the sanctioned one use, cf. SpreadBar).
          Gold = bills a positive amount; navy = charges a real 0 (NEVER green, F11); muted = not billed. */}
      <div className="flex h-[16px] overflow-hidden rounded-[4px]" aria-hidden>
        {positive > 0 ? (
          <span
            className="h-full bg-gold"
            style={{ width: segPct(positive, schoolCount) }}
          />
        ) : null}
        {chargesNothing > 0 ? (
          <span
            className="h-full bg-navy"
            style={{ width: segPct(chargesNothing, schoolCount) }}
          />
        ) : null}
        {notBilled > 0 ? (
          <span
            className="h-full border border-border-2 bg-bg"
            style={{ width: segPct(notBilled, schoolCount) }}
          />
        ) : null}
      </div>
      <p className="mt-[5px] text-[10.5px] text-navy-3">
        {countSentence(summary, schoolCount)}
      </p>
    </div>
  );
}

/** The one shared legend under all count bars (ruling F7 wording). */
function CountLegend() {
  const items: { tone: string; label: string }[] = [
    { tone: "bg-gold", label: "Bills a positive amount" },
    { tone: "bg-navy", label: "Charges nothing — a billed GHS 0" },
    { tone: "border border-border-2 bg-bg", label: "Not billed this term" },
  ];
  return (
    <div className="mt-[14px] flex flex-wrap gap-x-[14px] gap-y-[10px] border-t border-border-1 pt-[12px]">
      {items.map((item) => (
        <span
          key={item.label}
          className="flex items-center gap-[6px] text-[10px] font-semibold text-navy-2"
        >
          <span aria-hidden className={cn("h-[9px] w-[9px] rounded-[2px]", item.tone)} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════════
 * §6 — THE CENTRE-LESS TUITION RANGE (ruling F8). SpreadBar's visual idiom (bg-bg track, gold-soft
 * band, two end-dots) but with NO centre: no mean marker, no midpoint, no "mean" text — any centre
 * figure here would be the banned district average (F1). Both end-dots are neutral navy: the cheapest
 * school is not "good" and the priciest is not "bad" (fees are never ranked, F18).
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

export function FeeRangeBar({ range }: { range: FeeRange }) {
  const lowPos = projectFee(range.min.median);
  const highPos = projectFee(range.max.median);
  const rangeText = `${formatGhs(range.min.median)} – ${formatGhs(range.max.median)}`;
  const endpoints = (
    <>
      Lowest: {range.min.name ?? "a school"} (typical {formatGhs(range.min.median)}) ·
      Highest: {range.max.name ?? "a school"} (typical {formatGhs(range.max.median)}).
    </>
  );

  // FAIL LOUD, never a clamped band: a median outside the stated axis withholds the bar WITH its reason,
  // but the range itself (axis-independent) is still stated — withholding the drawing is the honest
  // move; withholding the figure would be a second, unnecessary loss (the vacancy-spread precedent).
  if (lowPos === null || highPos === null) {
    return (
      <div className="mt-4 border-t border-border-1 pt-3">
        <p className="text-[10.5px] italic text-navy-3">
          The tuition range is not drawn: a school&apos;s typical bill falls outside the
          stated axis ({formatGhs(FEE_AXIS.lo)} to {formatGhs(FEE_AXIS.hi)}), and a band
          that clamped it would misstate the spread. Widen FEE_AXIS. Schools range from{" "}
          <b className="text-navy-2">{rangeText}</b> for tuition. {endpoints}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 border-t border-border-1 pt-3">
      <div className="flex items-center gap-3">
        <span className="w-[140px] shrink-0 text-[11.5px] font-semibold text-navy">
          Tuition · schools range
        </span>
        <span className="relative h-[26px] flex-1 rounded-md bg-bg">
          {/* the low-to-high band — NO centre marker (ruling F8) */}
          <span
            aria-hidden
            className="absolute bottom-[5px] top-[5px] rounded-[4px] bg-gold-soft"
            style={{ left: pct(lowPos), right: pct(1 - highPos) }}
          />
          {/* both end-dots NEUTRAL NAVY — no good/bad end, no green, no terra (ruling F18) */}
          <span
            aria-hidden
            className="absolute top-1/2 h-[11px] w-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-navy"
            style={{ left: pct(lowPos) }}
          />
          <span
            aria-hidden
            className="absolute top-1/2 z-10 h-[11px] w-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-navy"
            style={{ left: pct(highPos) }}
          />
        </span>
        <span className="w-[120px] shrink-0 text-right font-mono text-[10px] font-bold text-navy-2">
          {rangeText}
        </span>
      </div>
      <p className="mt-2 text-[10.5px] text-navy-3">
        Schools range from <b className="text-navy-2">{rangeText}</b> for tuition — the
        lowest- and highest-billing school&apos;s typical bill. {endpoints} There is no
        district average: fees do not combine across schools.
      </p>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════════
 * §7 — THE PER-SCHOOL ROWS. The three-state cell is the most consequential visual (ruling F11/F12):
 * a billed amount, a REAL "charges nothing" 0, and an ABSENT "not billed" — each must be instantly
 * separable, and a billed 0 is NEVER rendered as the muted em-dash absence.
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

const OWNERSHIP_LABEL: Record<NonNullable<SchoolFeeRow["ownershipType"]>, string> = {
  PUBLIC: "Public",
  PRIVATE: "Private",
  MISSION: "Mission",
};
const OWNERSHIP_TONE: Record<
  NonNullable<SchoolFeeRow["ownershipType"]>,
  "navy" | "gold" | "muted"
> = {
  PUBLIC: "navy",
  PRIVATE: "gold",
  MISSION: "muted",
};
const SCHOOL_TYPE_LABEL: Record<NonNullable<SchoolFeeRow["schoolType"]>, string> = {
  KG: "KG",
  PRIMARY: "Primary",
  JHS: "JHS",
  SHS: "SHS",
  COMBINED: "Combined",
};

/** The two-letter initials badge, the breakdown table's `.sc-badge` idiom. */
function initialsOf(name: string | null): string {
  if (!name) return "—";
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase());
  return letters.length > 0 ? letters.join("") : "—";
}

function FeeCell({
  figure,
  freeShs,
}: {
  figure: SchoolFeeFigure | undefined;
  /** A billed-0 TUITION cell on a public SHS — the Free-SHS policy fact (ruling F11). */
  freeShs?: boolean;
}) {
  // NOT BILLED — absence. The muted em-dash with its own title, distinct from a billed 0 (ruling F12).
  if (figure === undefined) return <Absent title="Not billed this term" />;
  // CHARGES NOTHING — a REAL billed 0.00, a stated figure in neutral navy, never green, never an
  // em-dash (ruling F11). The Free-SHS chip rides along for a public SHS tuition row.
  if (figure.zero) {
    return (
      <span className="inline-flex flex-col gap-0.5">
        <span className="font-mono text-[12px] text-navy">{formatGhs(0)}</span>
        <span className="text-[9.5px] text-navy-3">charges nothing</span>
        {freeShs ? (
          <span className="mt-0.5">
            <Pill tone="gold">Free SHS</Pill>
          </span>
        ) : null}
      </span>
    );
  }
  // BILLED — median (the typical bill) AND mean, always together (ruling F5/F13). Neutral navy.
  return (
    <span className="inline-flex flex-col gap-0.5">
      <span className="font-mono text-[12px] text-navy">
        typical {formatGhs(figure.median)}
      </span>
      <span className="text-[9.5px] text-navy-3">avg {formatGhs(figure.mean)}</span>
    </span>
  );
}

function SchoolRow({
  school,
  categories,
}: {
  school: SchoolFeeRow;
  categories: FeeCategory[];
}) {
  return (
    <tr>
      <td className="border-b border-border-1 px-3 py-[9px] align-middle">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md bg-bg font-mono text-[10px] font-bold text-navy-3"
          >
            {initialsOf(school.name)}
          </span>
          <span className="min-w-0">
            <span className="block font-display text-[13px] text-navy">
              {school.name ?? "Name unavailable"}
            </span>
            <span className="mt-0.5 flex flex-wrap items-center gap-1">
              {school.ownershipType ? (
                <Pill tone={OWNERSHIP_TONE[school.ownershipType]}>
                  {OWNERSHIP_LABEL[school.ownershipType]}
                </Pill>
              ) : null}
              {school.schoolType ? (
                <Pill tone="muted">{SCHOOL_TYPE_LABEL[school.schoolType]}</Pill>
              ) : null}
              {/* Its whole visible fee book is uncategorised — the resolver's coverage signal (F15). */}
              {school.onlyOther ? (
                <Pill tone="muted">only uncategorised charges</Pill>
              ) : null}
            </span>
          </span>
        </div>
      </td>
      {categories.map((category) => {
        const figure = school.figures[category];
        const freeShs =
          category === "TUITION" &&
          school.ownershipType === "PUBLIC" &&
          school.schoolType === "SHS" &&
          figure?.zero === true;
        return (
          <td
            key={category}
            className="border-b border-border-1 px-3 py-[9px] text-left align-middle"
          >
            <FeeCell figure={figure} freeShs={freeShs} />
          </td>
        );
      })}
    </tr>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════════
 * THE PANEL — the DISTRICT body. Takes a RESOLVED value (the section unwraps the Reading, exactly as
 * TeacherEstablishmentPanel takes a resolved breakdown). Structure: count bars → legend → tuition
 * range → per-school table → captions.
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

export function SchoolFeesPanel({
  data,
  termLabel,
}: {
  data: SchoolFeesPanelData;
  /** "Term n" — the fees panel's own TERM-grain vintage (ruling F20), distinct from the annual strip. */
  termLabel: string | null;
}) {
  const { schoolCount, summaries, schools, tuitionRange, tuitionSkew } = data;
  // Columns are the categories any school filed, already in FEE_CATEGORY_ORDER (TUITION first, OTHER
  // last) — the summaries carry exactly that set.
  const categories = summaries.map((s) => s.category);
  const meta = termLabel === null ? "GHS · billed" : `GHS · billed · ${termLabel}`;

  return (
    <Panel
      title={
        <>
          School <em className="accent-italic">fees</em>
        </>
      }
      meta={meta}
    >
      {/* §5 — the count-bucket bars, the primary district-level read (counts, never amounts). */}
      <div>
        {summaries.map((summary) => (
          <FeeCountBar
            key={summary.category}
            summary={summary}
            schoolCount={schoolCount}
          />
        ))}
        <CountLegend />
      </div>

      {/* §6 — the centre-less tuition range. Omitted entirely when fewer than two schools carry a
          figure (ruling F8) — no zero-width bar. */}
      {tuitionRange === null ? null : <FeeRangeBar range={tuitionRange} />}

      {/* §7 — the per-school table. No total row and no total column: a district-level fee amount is
          banned (ruling F6/F9). */}
      <div className="mt-4 overflow-x-auto border-t border-border-1 pt-4">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr>
              <th className="border-b border-border-2 bg-bg px-3 py-2 text-[9px] font-bold uppercase tracking-[0.12em] text-navy-3">
                School
              </th>
              {categories.map((category) => (
                <th
                  key={category}
                  className={cn(
                    "border-b border-border-2 bg-bg px-3 py-2 text-[9px] font-bold uppercase tracking-[0.12em]",
                    category === "OTHER" ? "text-navy-3" : "text-navy-3",
                  )}
                >
                  {CATEGORY_LABEL[category]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {schools.map((school) => (
              <SchoolRow
                key={school.jurisdictionId}
                school={school}
                categories={categories}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* §8 — captions. The skew flag only where a shown tuition mean materially tops its median
          (ruling F13), and the billed-students denominator caveat, always (ruling F16). */}
      {tuitionSkew ? (
        <p className="mt-3 text-[10.5px] italic text-navy-3">
          Where the average sits above the typical bill, a few larger bills pull the
          average up.
        </p>
      ) : null}
      <p className="mt-2 text-[10.5px] text-navy-3">
        Every figure is a mean and median over the students{" "}
        <b className="text-navy-2">billed</b> for that category, not all pupils —
        &ldquo;what this costs here&rdquo;, not &ldquo;what an average pupil pays&rdquo;.
        Fees are billed, not collected, and do not combine across schools, so there is no
        district fee average.
      </p>
    </Panel>
  );
}
