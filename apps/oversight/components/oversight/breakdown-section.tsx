import type { JurisdictionLevel } from "@/lib/db/rls";
import { isOk, type Reading } from "@/lib/oversight/reading";
import type { ChildBreakdown } from "@/lib/oversight/breakdown";
import { Banner, Panel, Provenance } from "./primitives";
import { BreakdownTable, COVERAGE_BANDS } from "./breakdown-table";
import { RankStrip, SpreadPanel, TeacherEstablishmentPanel } from "./breakdown-visuals";
import { breakdownChrome, buildBreakdownTitle, tierChrome } from "./tier-chrome";
import { formatRatioPercent } from "./kpi-card";

/**
 * THE BREAKDOWN SECTION — Lucy's Section 02, mounted as a SECTION on the one `/` dashboard.
 *
 * ROUTING, SETTLED: no new route and no nav change. Lucy's §0.1 leaves the call to the implementer
 * between a sibling `/breakdown` route and a second section below the KPI strip, and the second is the
 * one consistent with everything already shipped: slices 1 and 2 settled on ONE tier-polymorphic
 * dashboard serving three tiers, the shell's single "Dashboard" link lands there at every tier, and the
 * breakdown's own total row is required to equal the KPI strip's figures — which is a claim far easier to
 * keep true, and to read, when the two sit on one screen. A `/breakdown` route would also need a
 * tier-aware nav label and a shell edit, which §0.1 says must be coordinated separately.
 *
 * The section owns the ONE `officer.level` gate this slice has: national gets the spread panel, region
 * gets the rank strip, and a district mount gets neither (Lucy §4.5). Every other tier difference is a
 * string in `breakdownChrome()`.
 *
 * ═══ THE TEACHER-ESTABLISHMENT PANEL MOUNTS HERE, UNGATED (Kofi V8, Dex N1) ══════════════════════
 * It is a SIBLING of the spread panel and the rank strip, and the one of the three that is NOT behind a
 * tier gate: it renders at NATIONAL, REGION and DISTRICT alike (AC-13), including the district mount
 * where the other two render nothing. Mounting it here rather than from `page.tsx` is what makes the
 * unread case report ONCE — the banner below is the section's single statement that the roll-up could
 * not be read, and the panel (which takes a RESOLVED breakdown) never stacks a second note above it.
 */
export function BreakdownSection({
  level,
  jurisdictionName,
  homeId,
  breakdown,
  /** The resolved TERM, as the table's own provenance — "which period is this a figure OF". */
  termLabel,
  /** The resolved SITTING. Wells trap 4: the table must state the sitting it ranks on. */
  sittingLabel,
}: {
  level: JurisdictionLevel;
  jurisdictionName: string | null;
  /** The officer's own node — the home-row comparison (see `BreakdownTable`). */
  homeId: string | null;
  breakdown: Reading<ChildBreakdown>;
  termLabel: string | null;
  sittingLabel: string | null;
}) {
  const chrome = breakdownChrome(level, jurisdictionName);

  if (!isOk(breakdown)) {
    /**
     * FAIL-SOFT, INLINE (Lucy §6). The page does not throw and the KPI strip above is untouched: an
     * unread roll-up is a data-availability state, not an error the officer caused, so the banner is
     * WARN (amber) and never terra — the same rule `primitives.tsx` states for the gate banners.
     *
     * This is also where the reconciliation failure surfaces: if Σchildren ≠ the total row, the read
     * returns `unavailable` rather than printing a total that is not the sum of what is above it.
     */
    return (
      <section aria-label="Child breakdown">
        <Banner tone="warn" glyph="⚠" title={chrome.unavailableTitle}>
          The per-{chrome.childNounSingular} roll-up could not be read. The headline
          figures above are unaffected.
        </Banner>
      </section>
    );
  }

  const value = breakdown.value;
  const vintage = [termLabel, sittingLabel].filter((part) => part !== null).join(" · ");

  return (
    <section aria-label="Child breakdown" className="space-y-6">
      {/*
        THE TEACHER-ESTABLISHMENT PANEL (VACANCY-SURFACING-RULING V8), first in the section and so still
        directly below the KPI strip, and NOT a fifth KPI card: the strip's four cards sit on a clean
        2×2 / 1×4 grid, and a fifth single-number vacancy card would be the exact net-cancellation trap
        the ruling exists to close (V7) — a near-zero national net hides large northern shortages
        cancelled by southern surpluses. The panel presents the two GROSS magnitudes instead, with the
        net subordinate and labelled, and the vacancy-rate dispersion that is the actual equity signal.

        It is DERIVED FROM THE SAME `breakdown` READ the table below uses, so the panel, the table's
        total-row cell and the comparison benchmark are one set of sums from one staffing scan (V11) —
        not a second read that could disagree. Ungated by tier: see the file note.
      */}
      <TeacherEstablishmentPanel
        breakdown={value}
        chrome={chrome}
        /* The officer's OWN tier as a NOUN, for the absence sentence ("No GES establishment in this
           {tierNoun}"). From tierChrome so every tier reads a real noun — "country" at national,
           "region"/"district"/"school" below — never the adjective ("regional" is not a noun). */
        tierNoun={tierChrome(level, jurisdictionName).tierNoun}
      />

      {/* Regional reading order: rank cards ABOVE the table. National's spread sits BELOW it. */}
      {level === "REGION" ? <RankStrip breakdown={value} /> : null}

      <Panel
        title={buildBreakdownTitle(chrome, value.children.length)}
        meta={vintage === "" ? undefined : vintage}
        /* The Panel's own padding is removed: the toolbar, the table and the footer caption each carry
           their own full-bleed rule, which is the mock's structure. */
        className="[&>div]:p-0"
      >
        <BreakdownTable breakdown={value} chrome={chrome} homeId={homeId} />
      </Panel>

      {level === "NATIONAL" ? <SpreadPanel breakdown={value} chrome={chrome} /> : null}

      {/*
        Lucy §7, with the two items that describe surfaces this slice does not build dropped rather than
        rendered as promises: "Tap a row" (there is no per-jurisdiction dashboard to open — the rows are
        honestly static) and "Select + Compare" (no comparison workspace, and no Compare chip for the line
        to document). Both return with their surfaces. What is kept is verbatim, and the "Coverage colour"
        item is the STATED threshold rule that `COVERAGE_BANDS` computes from — one source, two readers.
      */}
      <Provenance
        items={[
          [
            "Ranked by",
            "WASSCE qualification · Σ qualified ÷ Σ candidates, never the mean of school rates",
          ],
          [
            "Coverage colour",
            `green ≥${formatRatioPercent(COVERAGE_BANDS.green, 0)}% · amber ${formatRatioPercent(
              COVERAGE_BANDS.amber,
              0,
            )}–${formatRatioPercent(COVERAGE_BANDS.green, 0)}% · red below ${formatRatioPercent(
              COVERAGE_BANDS.amber,
              0,
            )}%`,
          ],
          ["Read rate with coverage", "a low rate at thin coverage is unsettled"],
          ...(level === "NATIONAL"
            ? ([
                [
                  "The spread",
                  "best-to-worst range · the disparity national policy targets",
                ],
              ] as [string, string][])
            : []),
        ]}
      />
    </section>
  );
}
