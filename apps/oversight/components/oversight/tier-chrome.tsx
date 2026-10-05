import type { ReactNode } from "react";
import type { JurisdictionLevel } from "@/lib/db/rls";
import type { SchoolCoverage } from "@/lib/oversight/coverage";
import type { EnrolmentTotal } from "@/lib/oversight/enrolment";
import { formatCount, formatPupilCount } from "./kpi-card";

/* ══════════════════════════════════════════════════════════════════════════════════════════════════
 * TIER-AWARE CHROME for the one oversight dashboard (increment I slice 2, Lucy's tier map §1).
 *
 * The data on that page has been tier-polymorphic since slice 1 — every figure is read through
 * `scopeFor(officer)`, so a district officer's enrolment total already IS their district's. What was
 * hard-coded was the WORDING around it: a regional director saw their own numbers under the headline
 * "Ghana · national dashboard", which is the one kind of error a dashboard must not make. A figure
 * whose label names the wrong jurisdiction is worse than a missing figure, because it is actionable.
 *
 * ONE config, five derived strings (crumb, title, lede, banner rollup clause, provenance Source and
 * Scope), rather than `level === …` ternaries scattered through the JSX: with the branch in one place
 * a new tier is one row, and a reviewer can read the whole per-tier contract without reading the page.
 *
 * ⚠ THE SCOPE LINE IS A SECURITY CLAIM, NOT COPY (Lucy §7). "you cannot see other districts here" is
 * a statement about the RLS ceiling the officer is reading under, so it is wrong to soften, wrong to
 * generalise, and must stay true if the ceiling ever changes.
 *
 * WHY THIS IS A MODULE AND NOT A CONST IN `page.tsx`, WHICH IS WHERE THE SPEC PUTS IT. Next's
 * generated page types constrain a `page.tsx` to a known export list (`default`, `metadata`,
 * `dynamic`, …) and reject anything else — `tsc` fails with "Property 'pluralise' is incompatible with
 * index signature … not assignable to type 'never'". So a config living in the page is a config that
 * cannot be exported, and therefore cannot be unit-tested; the alternative was proving the per-tier
 * contract by rendering the whole async server component with a live session, which needs
 * `next/headers`. It sits under `components/` rather than `lib/oversight/` because it is presentation
 * — strings and two `ReactNode` builders, no database, no scope, nothing to authorise. It is NOT a
 * rendered component and adds no element to the page.
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

/** The immediate child tier's noun, SINGULAR — pluralised at the point of use. */
export type ChildNoun = "region" | "district";

export interface TierChrome {
  /**
   * The h1's lead word. `"Ghana"` at NATIONAL — a special case, and deliberately not the session's
   * `jurisdictionName`, which reads "National · Ministry of Education" and would make the headline
   * "National · Ministry of Education · national dashboard." Below national the node's own name is
   * exactly right.
   */
  titleLead: string;
  /** "National" | "Regional" | "District" — the crumb tail, the em, and the WASSCE sub-line word. */
  tierAdjective: string;
  /**
   * The child tier this officer's figures roll up FROM, or null where the children are schools.
   *
   * Null at DISTRICT is not an omission: a district's children are schools, which the "N schools
   * reporting" fragment already names, so a second "rolled up from N schools" clause would say the
   * same thing twice. It is also the gate for the period banner's rollup sentence, which the district
   * mock does not have (Lucy §1.4).
   */
  childNoun: ChildNoun | null;
  crumb: string;
  /** Provenance Scope — the ceiling, stated. Verbatim from Lucy §1.5. */
  scopeLine: string;
  /** Provenance Source when there is no child-jurisdiction rollup to count (Lucy §1.5, district row). */
  sourceWithoutChildren: string;
}

/**
 * `district` / `districts` — the pluralisation rule itself, written ONCE for this surface.
 *
 * Exported separately from `pluralise()` because callers split two ways: some need the whole phrase
 * ("3 districts"), and some already have the formatted count in their own markup and need only the
 * noun (the enrolment card's "Across 12 reporting schools", where the count is its own span). A call
 * site that hand-rolls `n === 1 ? "school" : "schools"` is a SECOND copy of this rule, and the second
 * copy is the one that is wrong when the rule changes.
 */
export function pluralNoun(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

/** `3 districts` / `1 district` — the count and the noun together. */
export function pluralise(count: number, singular: string): string {
  return `${formatCount(count)} ${pluralNoun(count, singular)}`;
}

/**
 * The whole per-tier contract. A total function over `JurisdictionLevel`, including SCHOOL.
 *
 * SCHOOL cannot occur: `ref_oversight_officer` has a database guard refusing a SCHOOL-node officer
 * (Kofi R1, asserted by the fixture self-checks in tests/fixtures/analytics-seed.sql), so no session
 * can carry it. It is handled anyway because the alternative is a `Record` lookup that returns
 * `undefined` and renders "undefined dashboard" if that guard is ever relaxed — a total function is
 * the cheaper insurance, and it fails toward the tightest ceiling rather than the widest.
 */
export function tierChrome(
  level: JurisdictionLevel,
  /**
   * ⚠ KNOWN DEGRADATION, DEFERRED TO SLICE 3 (Dex L2a). The caller's value comes from
   * `lib/auth/index.ts:328`, which is `node?.name ?? institutionLabel(resolved.level)` — so when the
   * officer's own jurisdiction-node read FAILS at a sub-national tier, this parameter arrives as the
   * institution label "Ghana Education Service" rather than a place name, and the crumb, the title
   * lead and the regional Scope line all quietly say it ("Ghana Education Service · sibling regions
   * not visible here"). That is a misleading SUBJECT on a line that is a security claim, not copy.
   *
   * The fix belongs in `lib/auth` (return null and let the chrome state the absence), NOT here:
   * widening this signature to `string | null` alone would be dead code while `lib/auth` still returns
   * a non-null string for every session. So nothing changes this slice.
   */
  jurisdictionName: string,
): TierChrome {
  const withoutChildRollups =
    "Omnischools analytics DB · school feeds + WAEC & EMIS reference extracts";
  switch (level) {
    case "NATIONAL":
      return {
        titleLead: "Ghana",
        tierAdjective: "National",
        childNoun: "region",
        // Two-part at national: there is no jurisdiction segment to insert, and "Oversight · Ghana ·
        // National dashboard" would imply Ghana is one node among siblings.
        crumb: "Oversight · National dashboard",
        scopeLine: "national · no jurisdiction ceiling — all regions visible",
        sourceWithoutChildren: "Omnischools analytics DB",
      };
    case "REGION":
      return {
        titleLead: jurisdictionName,
        tierAdjective: "Regional",
        childNoun: "district",
        crumb: `Oversight · ${jurisdictionName} · Regional dashboard`,
        // Names the region, because a regional director's ceiling is a specific place.
        scopeLine: `${jurisdictionName} · sibling regions not visible here`,
        sourceWithoutChildren: "Omnischools analytics DB",
      };
    case "DISTRICT":
      return {
        titleLead: jurisdictionName,
        tierAdjective: "District",
        childNoun: null,
        crumb: `Oversight · ${jurisdictionName} · District dashboard`,
        // ⚠ ASYMMETRY WITH REGION, AND IT IS THE MOCK'S (Lucy §1.5): the district line uses the
        // generic word "district-ceiling" rather than the district's name. Preserved deliberately —
        // the claim is about the KIND of ceiling, and it reads as a rule rather than as a label.
        scopeLine: "district-ceiling · you cannot see other districts here",
        sourceWithoutChildren: withoutChildRollups,
      };
    case "SCHOOL":
      return {
        titleLead: jurisdictionName,
        tierAdjective: "School",
        childNoun: null,
        crumb: `Oversight · ${jurisdictionName} · School dashboard`,
        scopeLine: "school-ceiling · you cannot see other schools here",
        sourceWithoutChildren: withoutChildRollups,
      };
  }
}

/**
 * How many children to name — `regions` at national, `districts` at region, nothing below.
 *
 * Both counts come off the ONE coverage read (lib/oversight/coverage.ts) and both are nullable for
 * the same reason, so "no count to state" survives selection instead of collapsing to 0.
 */
export function childCountOf(
  chrome: TierChrome,
  coverage: SchoolCoverage | null,
): number | null {
  if (coverage === null || chrome.childNoun === null) return null;
  return chrome.childNoun === "region" ? coverage.regions : coverage.districts;
}

/**
 * The period banner's last sentence, or null when there is none to make.
 *
 * Omitted at DISTRICT (no child jurisdictions — Lucy §1.4) and when the count is 1, because "the sum
 * or mean of 1 district" is not a roll-up, it is the same number restated.
 */
export function rollupClause(
  chrome: TierChrome,
  childCount: number | null,
): string | null {
  if (chrome.childNoun === null || childCount === null || childCount <= 1) return null;
  return `Every figure is the sum or mean of ${pluralise(childCount, chrome.childNoun)}.`;
}

/**
 * Provenance Source: `… · 14 district rollups`, or the tier's no-children phrasing.
 *
 * NOTE the noun stays SINGULAR and it is `rollup` that pluralises — "14 district rollups", the slice-1
 * string, not "14 districts rollups". So this does NOT use `pluralise()`: the compound reads as
 * "rollups of the district kind", and the one helper would make it agree in the wrong place.
 */
export function sourceLine(chrome: TierChrome, childCount: number | null): string {
  if (chrome.childNoun === null || childCount === null)
    return chrome.sourceWithoutChildren;
  return `Omnischools analytics DB · ${formatCount(childCount)} ${chrome.childNoun} rollup${
    childCount === 1 ? "" : "s"
  }`;
}

/** Lucy's `.lede b` — the bolded stat fragments. */
function Stat({ children }: { children: ReactNode }) {
  return <b className="text-navy-2">{children}</b>;
}

/**
 * THE LEDE, as fragments the caller joins with " · ".
 *
 * Two shapes, chosen by `childNoun` (Lucy §1.3):
 *   · NATIONAL / REGION — "Rolled up from N {children} · M of K schools reporting into Omnischools ·
 *     P pupils", the slice-1 pattern with the child noun swapped.
 *   · DISTRICT — one clause, "Reporting on N schools that report into Omnischools". A district has no
 *     child jurisdictions to roll up from, and its own schools are the subject rather than a
 *     denominator, so the mock's sentence is a different shape rather than the same one shortened.
 *
 * Every fragment is dropped individually when its read is unavailable: a shorter true sentence beats
 * a sentence with a placeholder in it (the slice-1 honesty rule). `null` arguments mean "not
 * stateable" — the caller has already applied the one display rule.
 *
 * NOT BUILT, and flagged rather than faked: the district mock's "31 of 37 basic schools and 3 of 3
 * senior high schools" split. It needs the register counted by school level, which no read produces
 * (Lucy §1.3 rules it an optional enhancement). The DSA wording from the same mock sentence
 * ("schools that have signed the GES data-sharing agreement") is superseded and must not return —
 * there is no data-sharing agreement to sign.
 */
export function buildLedeFragments(
  chrome: TierChrome,
  coverage: SchoolCoverage | null,
  enrolment: EnrolmentTotal | null,
): ReactNode[] {
  const fragments: ReactNode[] = [];

  if (chrome.childNoun === null) {
    if (coverage !== null) {
      fragments.push(
        <>
          Reporting on <Stat>{pluralise(coverage.reporting, "school")}</Stat> that report
          into Omnischools
        </>,
      );
    }
    return fragments;
  }

  if (coverage !== null) {
    const childCount = childCountOf(chrome, coverage);
    // Null child count ⇒ the register names none, so the clause is dropped rather than rendered as
    // "0 regions" (the type carries the absence — see coverage.ts).
    if (childCount !== null) {
      fragments.push(
        <>
          Rolled up from <Stat>{pluralise(childCount, chrome.childNoun)}</Stat>
        </>,
      );
    }
    fragments.push(
      <>
        <Stat>
          {formatCount(coverage.reporting)} of {formatCount(coverage.registered)} schools
        </Stat>{" "}
        reporting into Omnischools
      </>,
    );
  }
  if (enrolment !== null) {
    fragments.push(
      <>
        {/* The SAME formatter the enrolment card uses (Dex M4): one screen must not state one
            number two ways — "2.41M" on the card and "2,410,000" in the lede. */}
        <Stat>{formatPupilCount(enrolment.total)} pupils</Stat>
      </>,
    );
  }
  return fragments;
}

/** `{titleLead} · <em>{tier} dashboard.</em>` — the trailing period stays INSIDE the em (Lucy §1.2). */
export function buildTitle(chrome: TierChrome): ReactNode {
  return (
    <>
      {chrome.titleLead} ·{" "}
      <em className="accent-italic">{chrome.tierAdjective.toLowerCase()} dashboard.</em>
    </>
  );
}
