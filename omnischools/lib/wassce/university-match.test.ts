import { describe, it, expect } from "vitest";
import {
  matchBand,
  matchTier,
  matchMargin,
  matchTally,
  marginLabel,
  tierLabel,
  likelyOutcomeLabel,
  aggregateScalePct,
  cutOffLabel,
  cutOffTrendLabel,
  cutOffDifficultyClass,
  parseCutOffHistory,
  parsePrerequisiteRules,
  checkPrerequisites,
  prerequisiteLabel,
  MATCH_TIER_CLASS,
  type MatchTier,
  type PrerequisiteRule,
} from "./university-match";
import type { WassceGrade } from "./mock-grades";

/**
 * The INCR-17b crown-jewel test (Kofi AC1–AC6, AC16, AC17). The canonical fixture is Y. Aidoo's
 * projected aggregate 10 (INCR-17) against the five §6 programme cut-offs. δ = cutOff − projected;
 * a POSITIVE δ is INSIDE the cut-off (admissible) because the cut-off is the WORST aggregate admitted.
 */

const PROJECTED = 10;

/** The five §6 demo tiles, verbatim from `Surfaces/schoolup-wassce-student-readiness.html` §6. */
const TILES: { name: string; cutOff: number; isPrimary: boolean; tier: MatchTier }[] = [
  { name: "KNUST · Biochemistry", cutOff: 11, isPrimary: true, tier: "TARGET" },
  { name: "Legon · Biochemistry", cutOff: 12, isPrimary: false, tier: "COMFORTABLE" },
  { name: "KNUST · Pharmacy", cutOff: 8, isPrimary: false, tier: "STRETCH" },
  { name: "Legon · Medicine", cutOff: 6, isPrimary: false, tier: "STRETCH" },
  { name: "UCC · Biochemistry", cutOff: 14, isPrimary: false, tier: "SAFETY" },
];

describe("matchBand — the δ ladder (AC1)", () => {
  it("reproduces the five §6 tiles' COMPUTED bands", () => {
    // The primary tile's computed band is MATCH (δ +1) — TARGET is the overlay, not a band.
    expect(matchBand(PROJECTED, 11)).toBe("MATCH");
    expect(matchBand(PROJECTED, 12)).toBe("COMFORTABLE");
    expect(matchBand(PROJECTED, 8)).toBe("STRETCH");
    expect(matchBand(PROJECTED, 6)).toBe("STRETCH");
    expect(matchBand(PROJECTED, 14)).toBe("SAFETY");
  });

  it("is total and non-overlapping across EVERY boundary δ (AC3)", () => {
    expect(matchBand(10, 14)).toBe("SAFETY"); //  δ = +4  — the SAFETY floor
    expect(matchBand(10, 13)).toBe("COMFORTABLE"); //  δ = +3
    expect(matchBand(10, 12)).toBe("COMFORTABLE"); //  δ = +2  — the COMFORTABLE floor
    expect(matchBand(10, 11)).toBe("MATCH"); //  δ = +1
    expect(matchBand(10, 10)).toBe("MATCH"); //  δ =  0  — exactly on the cut-off
    expect(matchBand(10, 9)).toBe("MATCH"); //  δ = −1  — the MATCH floor
    expect(matchBand(10, 8)).toBe("STRETCH"); //  δ = −2  — first STRETCH
  });

  it("stays total at the extremes of the 6–54 scale", () => {
    expect(matchBand(6, 54)).toBe("SAFETY");
    expect(matchBand(54, 6)).toBe("STRETCH");
  });
});

describe("matchTier — TARGET is the primary overlay, not a band (AC2)", () => {
  it("renders TARGET for the primary choice regardless of its computed band", () => {
    expect(matchTier(PROJECTED, 11, true)).toBe("TARGET");
    expect(matchTier(PROJECTED, 6, true)).toBe("TARGET"); // a primary STRETCH still renders TARGET
    expect(matchTier(PROJECTED, 54, true)).toBe("TARGET");
  });

  it("renders MATCH for the SAME programme when it is NOT the primary — the unexercised §6 state", () => {
    // No demo tile shows MATCH: the only δ+1 programme is the primary, so it renders TARGET. This is
    // the state the surface defines in its legend but never exercises (Lucy Part G / Part I #3).
    expect(matchTier(PROJECTED, 11, false)).toBe("MATCH");
    expect(matchTier(PROJECTED, 10, false)).toBe("MATCH");
    expect(matchTier(PROJECTED, 9, false)).toBe("MATCH");
    expect(MATCH_TIER_CLASS.MATCH).toBe("bg-green-bg text-[#1E5A35]");
  });

  it("every tier badge class is SOLID — no slash-opacity on a raw-hex token", () => {
    for (const cls of Object.values(MATCH_TIER_CLASS)) expect(cls).not.toMatch(/\/\d/);
  });
});

describe("the §6 header tally (AC4)", () => {
  it("reproduces '1 target · 1 comfortable · 2 stretch · 1 safety' from the five tiles", () => {
    const tiers = TILES.map((t) => matchTier(PROJECTED, t.cutOff, t.isPrimary));
    expect(tiers).toEqual(TILES.map((t) => t.tier));
    expect(matchTally(tiers)).toBe("1 target · 1 comfortable · 2 stretch · 1 safety");
  });

  it("omits zero-count tiers and counts a MATCH tile when one exists", () => {
    expect(matchTally(["MATCH", "MATCH", "TARGET"])).toBe("1 target · 2 match");
    expect(matchTally([])).toBe("");
  });
});

describe("margins + display copy (AC5)", () => {
  it("reports each tile's margin/gap exactly as the surface's meta chip", () => {
    expect(marginLabel(matchMargin(PROJECTED, 11))).toBe("Margin · 1 inside");
    expect(marginLabel(matchMargin(PROJECTED, 12))).toBe("Margin · 2 inside");
    expect(marginLabel(matchMargin(PROJECTED, 8))).toBe("Gap · 2 outside");
    expect(marginLabel(matchMargin(PROJECTED, 6))).toBe("Gap · 4 outside");
    expect(marginLabel(matchMargin(PROJECTED, 14))).toBe("Margin · 4 inside");
    expect(marginLabel(matchMargin(PROJECTED, 10))).toBe("Margin · on the cut-off");
  });

  it("suffixes the badge + likely-outcome copy off the gap magnitude", () => {
    expect(tierLabel("TARGET", matchMargin(PROJECTED, 11))).toBe("Target · primary choice");
    expect(tierLabel("STRETCH", matchMargin(PROJECTED, 8))).toBe("Stretch");
    expect(tierLabel("STRETCH", matchMargin(PROJECTED, 6))).toBe("Stretch · highly competitive");
    expect(likelyOutcomeLabel(matchMargin(PROJECTED, 8))).toBe("Likely outcome · waitlist");
    expect(likelyOutcomeLabel(matchMargin(PROJECTED, 6))).toBe(
      "Likely outcome · unlikely · interview required",
    );
    expect(likelyOutcomeLabel(matchMargin(PROJECTED, 14))).toBeNull(); // inside → no outcome chip
  });
});

describe("aggregateScalePct — ONE linear 6→54 scale (Lucy A.8)", () => {
  it("maps the labelled domain endpoints and clamps outside it", () => {
    expect(aggregateScalePct(6)).toBe(0);
    expect(aggregateScalePct(54)).toBe(100);
    expect(aggregateScalePct(30)).toBe(50);
    expect(aggregateScalePct(0)).toBe(0);
    expect(aggregateScalePct(99)).toBe(100);
  });

  it("places 'You · 10' left of a higher cut-off and right of a lower one (comparable across tiles)", () => {
    const you = aggregateScalePct(10);
    expect(you).toBeLessThan(aggregateScalePct(14)); // SAFETY — cut-off to the right
    expect(you).toBeGreaterThan(aggregateScalePct(6)); // STRETCH — cut-off to the left
  });
});

describe("cut-off snapshot honesty (Lucy Part E)", () => {
  it("always renders the reference year — never a bare number", () => {
    expect(cutOffLabel(11, 2025)).toBe("11 (2025)");
  });

  it("returns NO trend from a single-year history — a snapshot cannot back a trend claim", () => {
    expect(cutOffTrendLabel([{ year: 2025, cutOff: 11 }])).toBeNull();
    expect(cutOffTrendLabel([])).toBeNull();
  });

  it("states the trend only from a real multi-year history, each year stamped", () => {
    const stable = [
      { year: 2023, cutOff: 11 },
      { year: 2024, cutOff: 11 },
      { year: 2025, cutOff: 11 },
    ];
    expect(cutOffTrendLabel(stable)).toBe("Trend · stable 3 yrs · 11 (2023) · 11 (2024) · 11 (2025)");
    expect(
      cutOffTrendLabel([
        { year: 2023, cutOff: 13 },
        { year: 2024, cutOff: 12 },
        { year: 2025, cutOff: 11 },
      ]),
    ).toBe("Trend · 13 (2023) → 11 (2025) over 3 yrs");
  });

  it("parses + sorts a jsonb history and drops malformed entries", () => {
    expect(
      parseCutOffHistory([{ year: 2025, cutOff: 11 }, { year: 2023, cutOff: 13 }, { bad: true }, null]),
    ).toEqual([
      { year: 2023, cutOff: 13 },
      { year: 2025, cutOff: 11 },
    ]);
    expect(parseCutOffHistory(null)).toEqual([]);
  });

  it("colours the §3 cut-off table by DIFFICULTY — inverted from green=good (documented)", () => {
    expect(cutOffDifficultyClass(6)).toBe("text-terra"); // hardest
    expect(cutOffDifficultyClass(8)).toBe("text-terra");
    expect(cutOffDifficultyClass(11)).toBe("text-warn");
    expect(cutOffDifficultyClass(19)).toBe("text-warn");
    expect(cutOffDifficultyClass(24)).toBe("text-green"); // easiest
  });
});

describe("checkPrerequisites (AC16 / AC17)", () => {
  // KNUST Biochemistry, as seeded: the universal English + Core-Maths baseline + the programme
  // specifics, including the "Physics OR Elective Mathematics" anyOf group.
  const KNUST_BIOCHEM: PrerequisiteRule[] = [
    { subject: "English Language", minGrade: "C6" },
    { subject: "Mathematics (Core)", minGrade: "C6" },
    { subject: "Integrated Science", minGrade: "C6" },
    { subject: "Chemistry", minGrade: "C6" },
    { subject: "Biology", minGrade: "C6" },
    { anyOf: ["Physics", "Elective Mathematics"], minGrade: "C6" },
  ];

  const AIDOO_REGISTERED = [
    "English Language",
    "Mathematics (Core)",
    "Integrated Science",
    "Social Studies",
    "Biology",
    "Chemistry",
    "Physics",
    "Elective Mathematics",
  ];
  const AIDOO_GRADES: Record<string, WassceGrade> = {
    "English Language": "B3",
    "Mathematics (Core)": "B2",
    "Integrated Science": "A1",
    "Social Studies": "B3",
    Biology: "A1",
    Chemistry: "A1",
    Physics: "B2",
    "Elective Mathematics": "C4",
  };

  it("MET for Y. Aidoo — the anyOf group is satisfied by Physics alone", () => {
    const check = checkPrerequisites(KNUST_BIOCHEM, AIDOO_GRADES, AIDOO_REGISTERED);
    expect(check).toEqual({ met: true, status: "MET", unmet: [], pending: [] });
    expect(prerequisiteLabel(check, KNUST_BIOCHEM)).toBe("Prerequisites · met");
    // The verbose (primary-tile) chip elides the universal English + Core-Maths baseline.
    expect(prerequisiteLabel(check, KNUST_BIOCHEM, true)).toBe(
      "Prerequisites · Integrated Science + Chemistry + Biology + Physics or Elective Mathematics credit · met",
    );
  });

  it("keeps the anyOf group MET when only the OTHER member credits", () => {
    const noPhysics = { ...AIDOO_GRADES, Physics: "F9" as WassceGrade }; // Elec Maths C4 carries it
    expect(checkPrerequisites(KNUST_BIOCHEM, noPhysics, AIDOO_REGISTERED).status).toBe("MET");
  });

  it("is UNMET when a rule's grade is below credit, and names the rule", () => {
    const weakChem = { ...AIDOO_GRADES, Chemistry: "D7" as WassceGrade };
    const check = checkPrerequisites(KNUST_BIOCHEM, weakChem, AIDOO_REGISTERED);
    expect(check.met).toBe(false);
    expect(check.status).toBe("UNMET");
    expect(check.unmet).toEqual(["Chemistry"]);
    expect(prerequisiteLabel(check, KNUST_BIOCHEM)).toBe("Prerequisites · Chemistry · not met");
  });

  it("is UNMET when the candidate is not REGISTERED for a required subject", () => {
    const noBio = AIDOO_REGISTERED.filter((s) => s !== "Biology");
    expect(checkPrerequisites(KNUST_BIOCHEM, AIDOO_GRADES, noBio).unmet).toEqual(["Biology"]);
  });

  it("is UNMET when BOTH members of an anyOf group fail", () => {
    const neither = { ...AIDOO_GRADES, Physics: "E8" as WassceGrade, "Elective Mathematics": "F9" as WassceGrade };
    expect(checkPrerequisites(KNUST_BIOCHEM, neither, AIDOO_REGISTERED).unmet).toEqual([
      "Physics or Elective Mathematics",
    ]);
  });

  /** The candidate is registered but the predictor has not graded these subjects yet. */
  const ungraded = (...subjects: string[]): Record<string, WassceGrade> =>
    Object.fromEntries(Object.entries(AIDOO_GRADES).filter(([k]) => !subjects.includes(k)));

  it("is PENDING — registered but ungraded — and UNMET outranks PENDING", () => {
    const pending = checkPrerequisites(KNUST_BIOCHEM, ungraded("Chemistry"), AIDOO_REGISTERED);
    expect(pending).toEqual({ met: false, status: "PENDING", unmet: [], pending: ["Chemistry"] });
    expect(prerequisiteLabel(pending, KNUST_BIOCHEM)).toBe("Prerequisites · Chemistry · pending");

    // One unmet + one pending at once → the whole programme reads UNMET (the harder truth wins).
    const mixed = checkPrerequisites(
      KNUST_BIOCHEM,
      { ...ungraded("Chemistry", "Biology"), "Integrated Science": "D7" },
      AIDOO_REGISTERED,
    );
    expect(mixed.status).toBe("UNMET");
    expect(mixed.unmet).toEqual(["Integrated Science"]);
    expect(mixed.pending).toEqual(["Chemistry", "Biology"]);
  });

  it("every seeded rule set carries the universal English + Core-Maths credit baseline (AC17)", () => {
    const named = KNUST_BIOCHEM.filter((r): r is { subject: string; minGrade: WassceGrade } => "subject" in r);
    expect(named.some((r) => r.subject === "English Language" && r.minGrade === "C6")).toBe(true);
    expect(named.some((r) => r.subject === "Mathematics (Core)" && r.minGrade === "C6")).toBe(true);
  });

  it("parses jsonb rules and drops malformed ones", () => {
    expect(
      parsePrerequisiteRules([
        { subject: "Chemistry", minGrade: "C6" },
        { anyOf: ["Physics", "Elective Mathematics"], minGrade: "C6" },
        { subject: "Biology" }, // no minGrade
        "nonsense",
      ]),
    ).toEqual([
      { subject: "Chemistry", minGrade: "C6" },
      { anyOf: ["Physics", "Elective Mathematics"], minGrade: "C6" },
    ]);
    expect(parsePrerequisiteRules(undefined)).toEqual([]);
    // No rules at all → vacuously met (a programme with no published prerequisites).
    expect(checkPrerequisites([], {}, []).status).toBe("MET");
  });
});
