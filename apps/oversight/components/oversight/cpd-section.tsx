import { isOk, type Reading } from "@/lib/oversight/reading";
import type { TeacherCpdPanel as TeacherCpdPanelData } from "@/lib/oversight/cpd";
import { Panel } from "./primitives";
import { CpdPanel } from "./cpd-visuals";

/**
 * THE CPD SECTION — the tier-polymorphic wrapper and fail-soft boundary for the "Teacher CPD & PLC"
 * panel (increment L, C16 / AC-20).
 *
 * ═══ NO TIER GATE — IT RENDERS AT NATIONAL, REGION AND DISTRICT ALIKE (C12/C13) ══════════════════
 * Unlike `FeesSection`, this section has no `level` branch and wants none. A fee is non-additive in
 * space, so there is literally no regional fee to show; CPD/PLC is different — its counts are additive
 * and its rates roll up honestly by Σnumerator ÷ Σdenominator at every tier (the reader does the
 * roll-up). So the ONLY absence this section can show is the read's own, never a tier gate. `tierNoun`
 * is passed purely so the panel's sentences name the officer's own subject ("no school in this region").
 *
 * ═══ ITS OWN `Reading`, AND MOUNTED AS A PAGE SIBLING (surface map §1, the flagged DEPARTURE) ═════
 * The panel is NOT derived from `breakdown` — it has its own reader (`getTeacherCpd`) and its own
 * `Reading` — so a broken breakdown roll-up must not take it down, and an unreadable CPD read must
 * leave the KPI strip, the breakdown section and the fees section standing. Of the two equivalent
 * mounts the surface map sanctions, this takes the `FeesSection` precedent: `page.tsx` renders
 * `<CpdSection/>` as its own sibling immediately after `<BreakdownSection>`. That is the lighter change
 * (no new prop threaded through `BreakdownSection`, no fragment refactor of its two return branches)
 * and it is structurally independent of the breakdown-unavailable early-return, which is the property
 * AC-20 actually asks for. It is mounted EXACTLY ONCE.
 */

function CpdNote({ children }: { children: string }) {
  return (
    <Panel
      title={
        <>
          Teacher <em className="accent-italic">CPD &amp; PLC</em>
        </>
      }
      meta="professional learning · CPD points"
    >
      <p className="text-xs italic text-navy-3">{children}</p>
    </Panel>
  );
}

export function CpdSection({
  reading,
  tierNoun,
  termLabel,
  annualLabel,
}: {
  reading: Reading<TeacherCpdPanelData>;
  /** "country" / "region" / "district" — from `tierChrome()`, never a second tier-word table. */
  tierNoun: string;
  /** "Term n" — sub-section A's TERM vintage (C16). */
  termLabel: string | null;
  /** "2025/26" — sub-section B's ANNUAL vintage, stated distinctly from A's. */
  annualLabel: string | null;
}) {
  if (!isOk(reading)) {
    return (
      <CpdNote>
        Teacher CPD &amp; PLC figures could not be read. The rest of this dashboard is
        unaffected.
      </CpdNote>
    );
  }
  return (
    <CpdPanel
      data={reading.value}
      termLabel={termLabel}
      annualLabel={annualLabel}
      tierNoun={tierNoun}
    />
  );
}
