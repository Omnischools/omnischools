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
   * The tier as a NOUN — "country" | "region" | "district" | "school" — for sentences that need the
   * thing, not its adjective ("No GES establishment in this {tierNoun}"). "country" at national, since
   * "this nation"/"this national" both read wrong. NOT `tierAdjective.toLowerCase()`: "regional" and
   * "national" are adjectives, not nouns, and misread in a noun slot.
   */
  tierNoun: string;
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
/**
 * THE DEGRADED SUBJECT — what to call the officer's own jurisdiction when its NAME could not be read.
 *
 * `lib/auth` now returns `jurisdictionName: null` for a sub-national officer whose chrome-only
 * jurisdiction-node read failed, instead of falling back to `institutionLabel(level)` (increment I
 * slice 3, Dex L2a). That fallback put the string "Ghana Education Service" into the crumb, the h1 and
 * — worst — the provenance SCOPE line, which is a security claim: "Ghana Education Service · sibling
 * regions not visible here" names the wrong subject on the one line that tells an officer what they are
 * NOT seeing. Null makes the absence un-ignorable, and each consumer picks its own wording.
 *
 * The chrome's wording is a GENERIC PLACE WORD ("this region"), not an error: the tier is known — it
 * came from the database resolver, not from the failed read — so the honest sentence is the one that
 * states the tier and drops the name. Sentence-initial uses get `Capitalised`.
 */
function subjectOf(level: JurisdictionLevel, jurisdictionName: string | null): string {
  if (jurisdictionName !== null) return jurisdictionName;
  switch (level) {
    case "NATIONAL":
      return "Ghana";
    case "REGION":
      return "This region";
    case "DISTRICT":
      return "This district";
    case "SCHOOL":
      return "This school";
  }
}

export function tierChrome(
  level: JurisdictionLevel,
  /**
   * NULLABLE since slice 3 (Dex L2a): null ⇒ the officer's own node label could not be read. See
   * `subjectOf()` above for the wording, and `lib/auth/index.ts` for why a sub-national absence is
   * never papered over with the institution label.
   */
  jurisdictionName: string | null,
): TierChrome {
  const withoutChildRollups =
    "Omnischools analytics DB · school feeds + WAEC & EMIS reference extracts";
  // The place word every sub-national string below shares, so a degraded read cannot be handled three
  // ways in one config.
  const subject = subjectOf(level, jurisdictionName);
  /**
   * The crumb's middle segment, DROPPED when there is no name — "Oversight · This region · Regional
   * dashboard" reads as a place called "This region". Dropping it falls back to the national crumb's
   * own two-part shape, which is a true sentence at any tier.
   */
  const crumb = (tier: string): string =>
    jurisdictionName === null
      ? `Oversight · ${tier} dashboard`
      : `Oversight · ${jurisdictionName} · ${tier} dashboard`;
  switch (level) {
    case "NATIONAL":
      return {
        titleLead: "Ghana",
        tierAdjective: "National",
        tierNoun: "country",
        childNoun: "region",
        // Two-part at national: there is no jurisdiction segment to insert, and "Oversight · Ghana ·
        // National dashboard" would imply Ghana is one node among siblings.
        crumb: "Oversight · National dashboard",
        scopeLine: "national · no jurisdiction ceiling — all regions visible",
        sourceWithoutChildren: "Omnischools analytics DB",
      };
    case "REGION":
      return {
        titleLead: subject,
        tierAdjective: "Regional",
        tierNoun: "region",
        childNoun: "district",
        crumb: crumb("Regional"),
        // Names the region, because a regional director's ceiling is a specific place — or says "this
        // region" when the name is unreadable, which is still true and still a ceiling.
        scopeLine: `${jurisdictionName ?? "this region"} · sibling regions not visible here`,
        sourceWithoutChildren: "Omnischools analytics DB",
      };
    case "DISTRICT":
      return {
        titleLead: subject,
        tierAdjective: "District",
        tierNoun: "district",
        childNoun: null,
        crumb: crumb("District"),
        // ⚠ ASYMMETRY WITH REGION, AND IT IS THE MOCK'S (Lucy §1.5): the district line uses the
        // generic word "district-ceiling" rather than the district's name. Preserved deliberately —
        // the claim is about the KIND of ceiling, and it reads as a rule rather than as a label. It is
        // therefore also unaffected by a failed name read.
        scopeLine: "district-ceiling · you cannot see other districts here",
        sourceWithoutChildren: withoutChildRollups,
      };
    case "SCHOOL":
      return {
        titleLead: subject,
        tierAdjective: "School",
        tierNoun: "school",
        childNoun: null,
        crumb: crumb("School"),
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

/* ══════════════════════════════════════════════════════════════════════════════════════════════════
 * THE BREAKDOWN SECTION'S PER-TIER STRINGS (increment I slice 3, Lucy's breakdown map §3).
 *
 * The same argument as `tierChrome()` above, applied to the second section on the page: the breakdown
 * is ONE tier-polymorphic surface — a national officer's table lists regions, a regional officer's
 * lists districts, a district officer's lists schools — so every tier-varying string is a row in this
 * config rather than a `level === …` ternary in the table's JSX. The one genuinely tier-divergent piece
 * of LAYOUT (the national spread panel vs. the regional rank strip) is the single `officer.level` gate,
 * and it lives in the section component.
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

export interface BreakdownChrome {
  /** `region` / `district` / `school` — the noun the fail-soft banner's body sentence uses. */
  childNounSingular: string;
  /** `regions` / `districts` / `schools` — headings, captions, the "Showing N of M …" clause. */
  childNounPlural: string;
  /** The name column's `th` (Lucy §4.1 column 1). */
  childColumnHeader: string;
  /** The all-empty state, inside the table (Lucy §6). */
  emptyStateCopy: string;
  /** Identical at every tier today, in the config so a tier could diverge without touching JSX. */
  rankedByCaption: string;
  /** The fail-soft banner's title (Lucy §6) — per tier, because it names what is missing. */
  unavailableTitle: string;
  /**
   * The total row's label. The SHAPES differ per tier and the difference is Lucy's, not an accident:
   * national repeats the noun ("Ghana · all 16 regions") because "Ghana" does not carry it, while
   * regional drops it ("Western Region · all 14") because the region's name already does.
   */
  totalRowLabel: (childCount: number) => string;
  /**
   * The footer's bold tail, or null when there is nothing TRUE to put there.
   *
   * ⚠ DELIBERATE DEVIATION FROM LUCY §3.1's VERBATIM STRINGS, and it is the honesty rule, not a
   * shortcut. Her national tail is "tap any region to drill into its districts and schools" — but this
   * slice mounts the breakdown as a section on the ONE `/` dashboard (the slice-1/2 single-route
   * decision), and there is no per-region dashboard route to tap through to. Rendering that sentence
   * would promise a surface that does not exist, which is the same call the shipped `page.tsx` makes
   * about its three missing actions. So: dropped at national, and at region reduced to the half that
   * IS true — naming the highlighted home row, and only when a home row actually came back.
   */
  drillHint: (homeName: string | null) => string | null;
}

export function breakdownChrome(
  level: JurisdictionLevel,
  jurisdictionName: string | null,
): BreakdownChrome {
  // The same subject the dashboard chrome above uses, so the total row and the h1 cannot disagree
  // about what this officer's jurisdiction is called.
  const subject = subjectOf(level, jurisdictionName);
  switch (level) {
    case "NATIONAL":
      return {
        childNounSingular: "region",
        childNounPlural: "regions",
        childColumnHeader: "Region",
        emptyStateCopy: "No regions reporting yet",
        rankedByCaption: "sorted by WASSCE qualification",
        unavailableTitle: "Regional breakdown is temporarily unavailable",
        // The literal "Ghana", the same special case as `titleLead` at this tier.
        totalRowLabel: (count) => `Ghana · all ${formatCount(count)} regions`,
        drillHint: () => null,
      };
    case "REGION":
      return {
        childNounSingular: "district",
        childNounPlural: "districts",
        childColumnHeader: "District",
        emptyStateCopy: "No districts reporting yet",
        rankedByCaption: "sorted by WASSCE qualification",
        unavailableTitle: "District breakdown is temporarily unavailable",
        totalRowLabel: (count) => `${subject} · all ${formatCount(count)}`,
        drillHint: (homeName) =>
          homeName === null ? null : `your home district ${homeName} is highlighted`,
      };
    case "DISTRICT":
    case "SCHOOL":
      return {
        childNounSingular: "school",
        childNounPlural: "schools",
        childColumnHeader: "School",
        emptyStateCopy: "No schools reporting yet",
        rankedByCaption: "sorted by WASSCE qualification",
        unavailableTitle: "School breakdown is temporarily unavailable",
        // The noun is repeated here for the national reason: a district's name does not carry it.
        totalRowLabel: (count) => `${subject} · all ${formatCount(count)} schools`,
        drillHint: () => null,
      };
  }
}

/**
 * The breakdown panel's title — `The 16 <em>regions.</em>`, with the count DERIVED.
 *
 * Lucy §2: the mock spells the count as a word ("The sixteen regions") and hard-codes it; the real lead
 * takes the numeral from the read. A null count (the read is unavailable) drops the count rather than
 * leaving an empty slot. The trailing period stays INSIDE the em, as everywhere else.
 */
export function buildBreakdownTitle(
  chrome: BreakdownChrome,
  childCount: number | null,
): ReactNode {
  return (
    <>
      The {childCount === null ? null : `${formatCount(childCount)} `}
      <em className="accent-italic">{chrome.childNounPlural}.</em>
    </>
  );
}

/**
 * `Showing 14 of 14 districts · sorted by WASSCE qualification` (+ the bold tail, when there is one).
 *
 * `shown` and `total` are BOTH counted from the returned rows — the mock's "6 of 16" is mock
 * pagination, and this surface renders every row the read returned, so they are equal until pagination
 * exists. The same discipline `coverage.ts` applies to its region count: never a constant 16.
 */
export function breakdownFooter(
  chrome: BreakdownChrome,
  shown: number,
  total: number,
): string {
  return `Showing ${formatCount(shown)} of ${formatCount(total)} ${pluralNoun(
    total,
    chrome.childNounSingular,
  )} · ${chrome.rankedByCaption}`;
}
