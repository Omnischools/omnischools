import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { BreakdownRow, ChildBreakdown } from "@/lib/oversight/breakdown";
import { formatCount, formatPupilCount, formatRatioPercent } from "./kpi-card";
import { breakdownFooter, pluralise, type BreakdownChrome } from "./tier-chrome";

/**
 * THE CHILD BREAKDOWN TABLE (increment I slice 3, Lucy's breakdown map §4.1).
 *
 * ONE component for three tiers. The national `.region-table` and the regional `.district-table` carry
 * IDENTICAL CSS rules in the mocks and differ only in nouns and the home-row highlight, so building two
 * would be building one twice; every tier-varying string arrives in `chrome` (tier-chrome.tsx §3).
 *
 * ═══ WHAT IS NOT HERE, AND WHY — each omission is a claim this surface would otherwise make ═══════
 * · THE PTR COLUMN, the PTR sort chip and the PTR spread bar. `fact_staffing` has no ETL producer
 *   (zero writers in lib/etl/), which is the same verified reason the shipped dashboard drops the
 *   Pupil-teacher-ratio KPI card. A dash-filled column would claim the measure exists and is merely
 *   missing tonight. When a staffing arm lands, the column is additive and this file is where it goes.
 * · THE DRILL ARROW AND THE ROW LINK. The mock's rows open "that region's regional dashboard", and this
 *   slice mounts the breakdown as a section on the ONE `/` dashboard (the slice-1/2 single-route
 *   decision) — there is no per-jurisdiction route to open. A pointer cursor, a gold `→` and a gold
 *   hover tint are an invitation to a 404, so the rows are honestly static. They return with the route.
 * · THE COMPARE CHIP. The comparison workspace does not exist; the shipped `page.tsx` omits actions
 *   that point at nonexistent surfaces rather than render dead controls.
 * · BOYS/GIRLS PUPIL COLUMNS at the district tier. Explicitly out of scope: a sexed cell at school
 *   grain over PUPILS, which `lib/oversight/suppression.ts` does not cover (it is scoped to staff) and
 *   which needs an owner ruling on pupil small-cell policy. Nothing here is sexed — `sex='ALL'` is
 *   pinned — so there is nothing to suppress and nothing to invent.
 * · COVERAGE COLUMNS AT THE DISTRICT TIER. The register carries no school-node uuid, so there is no
 *   column to group by when the child is a school (Wells §3). `hasCoverage` is that ruling, rendered.
 *
 * ═══ EVERY TONE IS COMPUTED FROM THE RATIO ═══════════════════════════════════════════════════════
 * Never copied from the mock's per-row classes, which are inconsistent placeholders that contradict the
 * stated rule (the national mock paints 81.2% `good` and 84.8% `warn`). See the two band constants.
 */

/**
 * COVERAGE BANDS — the rule is STATED, verbatim, in the regional mock's own provenance row ("green
 * ≥85% · amber 70–85% · red below 70%") and is therefore the source of truth over any per-row class.
 * The same line ships as this section's "Coverage colour" provenance item, so the legend an officer
 * reads and the arithmetic that colours the cell are the same two numbers.
 */
export const COVERAGE_BANDS = { green: 0.85, amber: 0.7 } as const;

/**
 * WASSCE QUALIFICATION BANDS — ⚠ A DEMO PRESENTATION THRESHOLD, OWNER-MOVABLE, FLAGGED.
 *
 * Neither mock states a rule for the qualification pill; these cutoffs are inferred from the mock's own
 * data (its greens sit at 68–74%, its warns at 63–66%, its terras at 54–59%) and are named here rather
 * than inlined precisely so moving them is one edit by whoever owns the policy. They are NOT a measured
 * standard and nothing in the database implies them — flagged for owner confirmation of the real GES
 * qualification band policy, and deliberately not blocking on it.
 */
export const WASSCE_QUALIFICATION_BANDS = { green: 0.67, amber: 0.6 } as const;

type Tone = "green" | "warn" | "terra";

function toneFor(ratio: number, bands: { green: number; amber: number }): Tone {
  if (ratio >= bands.green) return "green";
  if (ratio >= bands.amber) return "warn";
  return "terra";
}

const TEXT_TONE: Record<Tone, string> = {
  green: "text-green",
  warn: "text-warn",
  terra: "text-terra",
};

const PILL_TONE: Record<Tone, string> = {
  green: "bg-green-bg text-green",
  warn: "bg-warn-bg text-warn",
  terra: "bg-terra-bg text-terra",
};

/**
 * The 2-letter badge (`.rb`/`.db`), ALWAYS derived from the name.
 *
 * There is no column for it and there must not be one: `dim_jurisdiction.ges_code` exists but is
 * populated only on SCHOOL rows (where it is the EMIS id), so it is NULL on every region and district
 * this table ranks (Wells §8.1). Initials of the first two words, which is what the mock's GA / AS / WE
 * / WW actually are.
 */
export function initialsOf(name: string): string {
  const letters = name
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase());
  return letters.length > 0 ? letters.join("") : "—";
}

/** The muted `—`: a cell with no measure. Never a fabricated 0, never a confident green. */
function Absent() {
  return (
    <span className="text-navy-3" title="No return filed">
      —
    </span>
  );
}

/** `.num` — JetBrains Mono, bold, centred. Every numeric cell in the mock. */
function Num({ children, bold }: { children: ReactNode; bold?: boolean }) {
  return (
    <span className={cn("font-mono text-[12px] text-navy", bold && "font-bold")}>
      {children}
    </span>
  );
}

/**
 * `.qpill` — a borderless mono percentage chip, tone by band.
 *
 * NOT the shared `Pill` primitive, and the difference is deliberate rather than cosmetic: `Pill` is a
 * bordered, uppercase-tracked 10px label for a CATEGORY (STATUTORY, GRANTED). This is a measured
 * percentage, so it keeps the mono face the rest of the numerics use.
 */
function QualPill({ rate }: { rate: number }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-pill px-[9px] py-[3px] font-mono text-[11px] font-bold",
        PILL_TONE[toneFor(rate, WASSCE_QUALIFICATION_BANDS)],
      )}
    >
      {formatRatioPercent(rate, 0)}%
    </span>
  );
}

const TH = "border-b border-border-2 bg-bg px-3 py-2 text-[9px] font-bold uppercase tracking-[0.12em] text-navy-3";
const TD = "border-b border-border-1 px-3 py-[9px] align-middle";

/**
 * The name cell: the derived badge + the child's name in Fraunces.
 *
 * A NULL name is rendered as an absence rather than as a guess. It means the level-pinned hop was
 * mis-levelled, or that `dim_jurisdiction`'s own policy withheld the node — never that some other
 * child's name could stand in for it (Wells §2: the worst case is a null label, never a sibling's name).
 */
function NameCell({ row, home }: { row: BreakdownRow; home: boolean }) {
  return (
    <div className="flex items-center gap-2">
      {row.name === null ? null : (
        <span
          aria-hidden
          className={cn(
            "flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md font-display text-[9px] font-semibold",
            home ? "bg-gold text-navy" : "bg-navy text-bg",
          )}
        >
          {initialsOf(row.name)}
        </span>
      )}
      <span
        className={cn(
          "font-display text-[13px] font-semibold",
          row.name === null ? "italic text-navy-3" : "text-navy",
        )}
      >
        {row.name ?? "Name unavailable"}
      </span>
    </div>
  );
}

export function BreakdownTable({
  breakdown,
  chrome,
  homeId,
}: {
  breakdown: ChildBreakdown;
  chrome: BreakdownChrome;
  /**
   * The officer's OWN node, so a child row that IS it can be gold-tinted (Lucy's `tr.home`).
   *
   * Presentation, and deliberately not a field on the read: the comparison is between an id already in
   * the payload and the session's own node, so doing it here keeps every `scope.*` field out of the
   * query module — the same discipline that keeps a second hand-written copy of the ceiling from
   * appearing in app SQL. In practice no row matches today (a region officer's children are districts,
   * none of which is the region), so the tint and its footer clause are both correctly absent rather
   * than faked.
   */
  homeId: string | null;
}) {
  const { children, unattributed, total, hasCoverage } = breakdown;
  const isHome = (row: BreakdownRow): boolean =>
    row.childId !== null && row.childId === homeId;
  const homeRow = children.find(isHome) ?? null;
  const columns = hasCoverage ? 6 : 4;

  /** One cell renderer per measure, so the child rows, the unattributed row and the total agree. */
  const schoolsCell = (row: BreakdownRow) =>
    row.schoolsReporting === null || row.schoolsRegistered === null ? (
      <Absent />
    ) : (
      <Num bold>
        {formatCount(row.schoolsReporting)} / {formatCount(row.schoolsRegistered)}
      </Num>
    );

  const enrolmentCell = (row: BreakdownRow) =>
    row.enrolment === null ? (
      <Absent />
    ) : (
      // The SAME formatter the enrolment KPI card uses: one screen must not state one number two ways.
      <Num bold>{formatPupilCount(row.enrolment)}</Num>
    );

  const candidatesCell = (row: BreakdownRow) =>
    row.candidates === null ? <Absent /> : <Num>{formatCount(row.candidates)}</Num>;

  return (
    <div>
      {/*
        THE TOOLBAR, PRESENTATIONAL (Lucy §4.1's sanctioned fallback). The sort is applied server-side
        — WASSCE qualification, descending — and client re-sorting is not in this slice, so the chips
        are static pill spans and not controls: the active one states what the ranking IS, and the other
        two name the measures a later slice will sort by. They are not `Button` primitives and nothing
        here is focusable, so no keyboard user is offered a control that does nothing. PTR and Compare
        are omitted entirely (see the file note).
      */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border-1 px-5 py-3">
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-navy-3">
          Sort
        </span>
        <span className="rounded-pill bg-navy px-2.5 py-0.5 text-[10px] font-semibold text-bg">
          WASSCE qualification
        </span>
        <span className="rounded-pill border border-border-2 bg-surface px-2.5 py-0.5 text-[10px] text-navy-3">
          Enrolment
        </span>
        {hasCoverage ? (
          <span className="rounded-pill border border-border-2 bg-surface px-2.5 py-0.5 text-[10px] text-navy-3">
            Coverage
          </span>
        ) : null}
      </div>

      {/* §8: the table scrolls rather than reflowing — the mono numerics stay column-aligned. */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">
            {chrome.childNounPlural}, {chrome.rankedByCaption}
          </caption>
          <thead>
            <tr>
              <th scope="col" className={TH}>
                {chrome.childColumnHeader}
              </th>
              {hasCoverage ? (
                <>
                  <th scope="col" className={cn(TH, "text-center")}>
                    Schools (on / total)
                  </th>
                  <th scope="col" className={cn(TH, "text-center")}>
                    Coverage
                  </th>
                </>
              ) : null}
              <th scope="col" className={cn(TH, "text-center")}>
                Enrolment
              </th>
              <th scope="col" className={cn(TH, "text-center")}>
                WASSCE qual.
              </th>
              {/*
                THE RANKING WEIGHT, VISIBLE (Wells §5). The rank cards below ignore children with fewer
                than 30 candidates, and that floor governs the superlative claim only — so the count it
                keys on has to be on the row, or the floor would be concealing rather than qualifying.
              */}
              <th scope="col" className={cn(TH, "text-center")}>
                Candidates
              </th>
            </tr>
          </thead>
          <tbody>
            {children.length === 0 && unattributed === null ? (
              <tr>
                <td
                  colSpan={columns}
                  className={cn(TD, "py-6 text-center text-xs italic text-navy-3")}
                >
                  {chrome.emptyStateCopy}
                </td>
              </tr>
            ) : null}

            {children.map((row) => (
              <tr
                key={row.childId ?? "child"}
                // Lucy §4.1's `tr.home`: the officer's own node, gold-tinted at the mock's 0.06 alpha
                // via the nearest token-opacity utility. Never a raw rgba.
                className={isHome(row) ? "bg-gold/5" : undefined}
              >
                <td className={TD}>
                  <NameCell row={row} home={isHome(row)} />
                </td>
                {hasCoverage ? (
                  <>
                    <td className={cn(TD, "text-center")}>{schoolsCell(row)}</td>
                    <td className={cn(TD, "text-center")}>
                      {row.coverageRatio === null ? (
                        <Absent />
                      ) : (
                        <span
                          className={cn(
                            "font-mono text-[11px] font-bold",
                            TEXT_TONE[toneFor(row.coverageRatio, COVERAGE_BANDS)],
                          )}
                        >
                          {formatRatioPercent(row.coverageRatio, 1)}%
                        </span>
                      )}
                    </td>
                  </>
                ) : null}
                <td className={cn(TD, "text-center")}>{enrolmentCell(row)}</td>
                <td className={cn(TD, "text-center")}>
                  {row.wassceRate === null ? <Absent /> : <QualPill rate={row.wassceRate} />}
                </td>
                <td className={cn(TD, "text-center")}>{candidatesCell(row)}</td>
              </tr>
            ))}

            {/*
              ⚠ THE UNATTRIBUTED BUCKET, RENDERED. A fact row whose level-pinned ancestor hop found
              nothing — a mis-parented school — lands here. It must NEVER be silently filtered: dropping
              it makes Σchildren < the total row below, which is the one failure this grain cannot afford
              (Wells §1.3). It is not a child, so it carries no badge and is not counted in "Showing N".
            */}
            {unattributed === null ? null : (
              <tr className="bg-bg">
                <td className={TD}>
                  <span className="font-display text-[13px] font-semibold text-navy-2">
                    Unattributed
                    {unattributed.schoolsFiling === null
                      ? null
                      : ` — ${pluralise(unattributed.schoolsFiling, "school")}`}
                  </span>
                  <span className="mt-0.5 block text-[10px] text-navy-3">
                    not placed under any {chrome.childNounSingular} in the jurisdiction spine
                  </span>
                </td>
                {hasCoverage ? (
                  <>
                    <td className={cn(TD, "text-center")}>{schoolsCell(unattributed)}</td>
                    <td className={cn(TD, "text-center")}>
                      <Absent />
                    </td>
                  </>
                ) : null}
                <td className={cn(TD, "text-center")}>{enrolmentCell(unattributed)}</td>
                <td className={cn(TD, "text-center")}>
                  {unattributed.wassceRate === null ? (
                    <Absent />
                  ) : (
                    <QualPill rate={unattributed.wassceRate} />
                  )}
                </td>
                <td className={cn(TD, "text-center")}>{candidatesCell(unattributed)}</td>
              </tr>
            )}

            {/*
              THE TOTAL ROW — the `()` grouping set, from the SAME scan as the rows above it, which is
              what makes it their actual sum rather than a second query that can disagree. Every cell is
              gold-tinted and bold; its coverage stays plain `.num` with NO tone, which is both mocks'
              treatment and is right: a tone is a judgement about a child, and the total is the subject
              the whole page is already about.
            */}
            <tr className="bg-gold-bg font-bold">
              <td className={cn(TD, "font-display text-[13px] text-navy")}>
                {chrome.totalRowLabel(children.length)}
              </td>
              {hasCoverage ? (
                <>
                  <td className={cn(TD, "text-center")}>{schoolsCell(total)}</td>
                  <td className={cn(TD, "text-center")}>
                    {total.coverageRatio === null ? (
                      <Absent />
                    ) : (
                      <Num bold>{formatRatioPercent(total.coverageRatio, 1)}%</Num>
                    )}
                  </td>
                </>
              ) : null}
              <td className={cn(TD, "text-center")}>{enrolmentCell(total)}</td>
              <td className={cn(TD, "text-center")}>
                {total.wassceRate === null ? <Absent /> : <QualPill rate={total.wassceRate} />}
              </td>
              <td className={cn(TD, "text-center")}>{candidatesCell(total)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/*
        The footer caption. `shown` and `total` are both the returned row count — the mock's "6 of 16" is
        its own pagination, and this table renders every row the read returned.
      */}
      <p className="border-t border-border-1 px-5 py-3 text-center text-[11px] italic text-navy-3">
        {breakdownFooter(chrome, children.length, children.length)}
        {(() => {
          const hint = chrome.drillHint(homeRow?.name ?? null);
          return hint === null ? null : (
            <>
              {" · "}
              <b className="font-bold not-italic text-navy-2">{hint}</b>
            </>
          );
        })()}
      </p>
    </div>
  );
}
