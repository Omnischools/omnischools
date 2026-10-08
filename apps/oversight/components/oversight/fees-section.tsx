import type { JurisdictionLevel } from "@/lib/db/rls";
import { isOk, type Reading } from "@/lib/oversight/reading";
import type { SchoolFeesPanel as SchoolFeesPanelData } from "@/lib/oversight/fees";
import { Panel } from "./primitives";
import { SchoolFeesPanel } from "./fees-visuals";

/**
 * THE FEES SECTION — the tier gate and fail-soft wrapper for the school-fees panel (increment K).
 *
 * ═══ DISTRICT TIER ONLY (ruling F2 / AC-1,2) ═════════════════════════════════════════════════════
 * `fact_fees` is non-additive and carries rows only at SCHOOL grain, so a real per-school figure can be
 * shown only where the officer's children ARE schools — the DISTRICT tier. At REGION and NATIONAL the
 * children are districts/regions with no fees rows and no derivable figure, so this section renders an
 * explicit DRILL-DOWN NOTE and NO amounts — honest absence, never a fabricated regional/national mean.
 * The gate lives here (the section owns the one `level` branch, exactly as `BreakdownSection` does) and
 * is ALSO enforced in the reader (`getSchoolFees` returns unavailable off-district) as defence in depth.
 *
 * ═══ FAIL-SOFT ON ITS OWN `Reading` (ruling F14 / AC-20) ═════════════════════════════════════════
 * It is its own `<section>` with its own `Reading`: an unreadable fees read renders the note below and
 * leaves the KPI strip and the breakdown section standing. The panel is NOT a KPI card — the four-card
 * strip is untouched.
 */

/** The drill-down note's wording, per tier (ruling F2, verbatim). */
const DRILL_DOWN: Partial<Record<JurisdictionLevel, string>> = {
  REGION:
    "School fees are published per school. Drill into a district to see its schools' fee figures — there is no regional fee average to show.",
  NATIONAL:
    "School fees are published per school. Drill into a region, then a district, to see its schools' fee figures — there is no national fee average to show.",
};

function FeesNote({ children }: { children: string }) {
  return (
    <Panel
      title={
        <>
          School <em className="accent-italic">fees</em>
        </>
      }
      meta="GHS · billed · per school"
    >
      <p className="text-xs italic text-navy-3">{children}</p>
    </Panel>
  );
}

export function FeesSection({
  level,
  reading,
  termLabel,
}: {
  level: JurisdictionLevel;
  reading: Reading<SchoolFeesPanelData>;
  /** "Term n" — passed only so the panel can state its own term vintage (ruling F20). */
  termLabel: string | null;
}) {
  // REGION / NATIONAL: the honest drill-down note, no amounts. (SCHOOL cannot occur — no school-tier
  // officer — but it falls through to the DISTRICT path's reader, which is bounded to that one school.)
  if (level === "REGION" || level === "NATIONAL") {
    return <FeesNote>{DRILL_DOWN[level]!}</FeesNote>;
  }

  // DISTRICT: the real panel, or the fail-soft note when the read is unavailable.
  if (!isOk(reading)) {
    return (
      <FeesNote>
        The per-school fee figures could not be read for this term. The rest of this
        dashboard is unaffected.
      </FeesNote>
    );
  }

  return <SchoolFeesPanel data={reading.value} termLabel={termLabel} />;
}
