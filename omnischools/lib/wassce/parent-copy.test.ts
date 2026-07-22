import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
import type { FrozenTargetUniversity } from "./university-match";
import { heroBandText } from "@/lib/pdf/readiness-band";
import {
  AGGREGATE_FAQ,
  EVERGREEN_FAQ,
  FORBIDDEN_JARGON,
  NOT_ACKNOWLEDGED_NOTE,
  SC_EXPLAINER_LEAD,
  SC_PROCESS_SUBTITLE,
  SC_PROCESS_TITLE,
  STATEMENT_SUBTITLE,
  WAEC_MAKEUP_WINDOW,
  findForbiddenJargon,
  heroBody,
  heroHeadline,
  multiSchoolNotice,
  parentSittingLabel,
  rejectedDegradeLine,
  sanitizeSnapshot,
  scExplainerBullets,
  scFaqItems,
  scSteps,
  signatureLine,
  statementBody,
  statementTitle,
  supportingChoicePhrase,
  targetGloss,
  targetLine,
  targetMetaLine,
} from "./parent-copy";

const today = new Date("2026-05-14T14:45:00Z");

const primary: FrozenTargetUniversity = {
  universityName: "Kwame Nkrumah University of Science and Technology",
  shortName: "KNUST",
  universityType: "PUBLIC",
  programmeName: "Biochemistry",
  qualification: "BSc",
  location: "Kumasi",
  cutOff: 11,
  cutOffReferenceYear: 2025,
  targetRank: "FIRST_CHOICE",
  isPrimary: true,
  projectedAggregate: 10,
  matchBand: "MATCH",
  displayTier: "TARGET",
  margin: { direction: "inside", points: 1 },
  prerequisites: { met: true, status: "MET", unmet: [], pending: [] },
};
const supporting: FrozenTargetUniversity = {
  ...primary,
  shortName: "Legon",
  isPrimary: false,
  matchBand: "COMFORTABLE",
  targetRank: null,
  margin: { direction: "inside", points: 3 },
};

/** Every parent-facing string this module can render, for the AC-COPY-3 exclusion-list sweep. */
function allRenderedCopy(): string[] {
  const out: string[] = [
    AGGREGATE_FAQ.q,
    AGGREGATE_FAQ.a,
    SC_EXPLAINER_LEAD,
    SC_PROCESS_TITLE,
    SC_PROCESS_SUBTITLE,
    STATEMENT_SUBTITLE,
    WAEC_MAKEUP_WINDOW,
    NOT_ACKNOWLEDGED_NOTE,
    multiSchoolNotice("Asankrangwa SHS"),
    rejectedDegradeLine("Yaa"),
    targetLine(primary),
    targetGloss("Yaa", primary),
    targetGloss("Yaa", { ...primary, margin: { direction: "outside", points: 2 } }),
    targetGloss("Yaa", { ...primary, margin: { direction: "on", points: 0 } }),
    targetMetaLine(primary),
    supportingChoicePhrase(supporting),
    statementTitle(true, today),
    statementTitle(false, null),
    statementBody("Yaa", 10, [primary, supporting], "commute distance to Kumasi is far from Tarkwa"),
    heroHeadline({ childFirst: "Yaa", missedCount: 3, filedTime: "Thu 14 May", acknowledged: true, makeUpCentre: "Sefwi-Wiawso", nextPaperName: "Mathematics", nextPaperDate: "Wed 3 Jun" }),
    heroHeadline({ childFirst: "Yaa", missedCount: 1, filedTime: null, acknowledged: false, makeUpCentre: null, nextPaperName: null, nextPaperDate: null }),
    heroBody({ childFirst: "Yaa", missedCount: 3, filedTime: "Thu 14 May", acknowledged: true, makeUpCentre: "Sefwi-Wiawso", nextPaperName: "Mathematics", nextPaperDate: "Wed 3 Jun" }),
    heroBody({ childFirst: "Yaa", missedCount: 3, filedTime: null, acknowledged: false, makeUpCentre: null, nextPaperName: null, nextPaperDate: null }),
    signatureLine("PHONE_OTP", "+233 24 487 6612", today) ?? "",
    signatureLine("IN_PERSON", null, today) ?? "",
    signatureLine("PDF_UPLOAD", null, today) ?? "",
  ];
  out.push(...scExplainerBullets("Yaa", "Sefwi-Wiawso"));
  out.push(...scSteps({ status: "ACKNOWLEDGED", filedAt: today, waecAcknowledgedAt: today, makeUpScheduledAt: null, makeUpCentre: "Sefwi-Wiawso", completedAt: null }).map((s) => s.label));
  for (const f of scFaqItems({ childFirst: "Yaa", nextPaperName: "Mathematics", nextPaperDate: "Wed 3 Jun", makeUpCentre: "Sefwi-Wiawso" })) {
    out.push(f.q, f.a);
  }
  for (const f of EVERGREEN_FAQ) out.push(f.q, f.a);
  return out;
}

describe("AC-COPY-3 — no forbidden staff jargon reaches a parent", () => {
  it("the exclusion-list regex catches its own targets (guard is real, not vacuous)", () => {
    expect(findForbiddenJargon("this is a moderated grade")).not.toHaveLength(0);
    expect(findForbiddenJargon("Top tier · 6–12")).not.toHaveLength(0);
    expect(findForbiddenJargon("Missed · medical")).not.toHaveLength(0);
    expect(findForbiddenJargon("reg_flag = ON_MEDICAL")).not.toHaveLength(0);
    expect(FORBIDDEN_JARGON.length).toBeGreaterThan(10);
  });

  it("every rendered parent string is clean", () => {
    for (const s of allRenderedCopy()) {
      expect(findForbiddenJargon(s), s).toHaveLength(0);
    }
  });

  // Quinn MINOR-1: the copy-constant sweep above misses jargon typed DIRECTLY into the parent page/
  // layout JSX (tab labels, section headings, "View signed PDF", …). Scan the (parent) route source's
  // visible text nodes too, so a future edit that hard-codes a forbidden term in the page is caught —
  // not only ones routed through this module.
  it("no forbidden jargon in the parent route's own JSX text", () => {
    const files = [
      "app/(parent)/wassce/page.tsx",
      "app/(parent)/layout.tsx",
    ].map((p) => resolve(cwd(), p));
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      // JSX text children only (`>visible text<`) — where parent-visible prose lives; ignores
      // className/href/expression code, which is not shown to a parent.
      for (const m of src.matchAll(/>\s*([A-Za-z][^<>{}]*?)\s*</g)) {
        const text = m[1].trim();
        if (text.length < 3) continue;
        expect(findForbiddenJargon(text), `${file}: "${text}"`).toHaveLength(0);
      }
    }
  });
});

describe("AC-COPY-4 — the readiness PDF strips the cohort band for a parent (register parity, R6)", () => {
  it("staff PDF keeps the band; parent PDF shows only the plain gloss", () => {
    const band = "Top tier · 6–12";
    expect(heroBandText(band, "staff")).toBe("Top tier · 6–12 · lower is better (6 best · 54 worst)");
    const parent = heroBandText(band, "parent");
    expect(parent).toBe("lower is better (6 best · 54 worst)");
    // The exact cohort-tier vocabulary R6 hides on-screen must not survive into the parent's PDF either.
    expect(findForbiddenJargon(parent)).toHaveLength(0);
    expect(parent).not.toMatch(/Top tier/i);
    expect(parent).not.toMatch(/\d\s*–\s*\d/);
  });
});

describe("AC-COPY-5 — the sitting pill map (exact, no NaN, no staff label)", () => {
  it("sat → attended", () => {
    expect(parentSittingLabel({ satAt: today, exemptedAt: null, scheduledDate: "2026-05-12", isNext: false, scRejected: false }, today)).toEqual({ text: "Sat · attended", kind: "sat" });
  });
  it("exempted + open SC → Postponed · SC-12 filed (never 'Missed · medical')", () => {
    const p = parentSittingLabel({ satAt: null, exemptedAt: today, scheduledDate: "2026-05-13", isNext: false, scRejected: false }, today);
    expect(p).toEqual({ text: "Postponed · SC-12 filed", kind: "missed" });
    expect(p.text).not.toMatch(/missed/i);
  });
  it("exempted + REJECTED SC → Not sat · school to advise", () => {
    expect(parentSittingLabel({ satAt: null, exemptedAt: today, scheduledDate: "2026-05-13", isNext: false, scRejected: true }, today)).toEqual({ text: "Not sat · school to advise", kind: "missed" });
  });
  it("earliest future → Next paper · N days", () => {
    expect(parentSittingLabel({ satAt: null, exemptedAt: null, scheduledDate: "2026-06-03", isNext: true, scRejected: false }, today)).toEqual({ text: "Next paper · 20 days", kind: "next" });
  });
  it("other future → In N days (singular day handled)", () => {
    expect(parentSittingLabel({ satAt: null, exemptedAt: null, scheduledDate: "2026-05-15", isNext: false, scRejected: false }, today)).toEqual({ text: "In 1 day", kind: "upcoming" });
  });
  it("null / unparseable date → Upcoming, NEVER 'In NaN days'", () => {
    const p = parentSittingLabel({ satAt: null, exemptedAt: null, scheduledDate: null, isNext: false, scRejected: false }, today);
    expect(p).toEqual({ text: "Upcoming", kind: "upcoming" });
    expect(p.text).not.toMatch(/nan/i);
  });
});

describe("AC-COPY-8 — signature honesty", () => {
  it("PHONE_OTP renders the honest string — no 'Phone-OTP signature', no HH:MM stamp", () => {
    const line = signatureLine("PHONE_OTP", "+233 24 487 6612", today)!;
    expect(line).toContain("recorded by the school");
    expect(line).toContain("confirmed by phone");
    expect(line).not.toMatch(/phone-?otp signature/i);
    expect(line).not.toMatch(/\b\d{1,2}:\d{2}\b/); // no minute-precision time
  });
  it("IN_PERSON / PDF_UPLOAD have honest variants (no signature/OTP crypto framing)", () => {
    expect(signatureLine("IN_PERSON", null, today)!).toMatch(/in person/i);
    expect(signatureLine("PDF_UPLOAD", null, today)!).toMatch(/signed form/i);
    expect(signatureLine("PHONE_OTP", null, today)!).not.toMatch(/otp/i);
  });
  it("no acknowledgement date → no signature line (the caller shows the not-acknowledged note + NO button)", () => {
    expect(signatureLine("PHONE_OTP", "+233 24 487 6612", null)).toBeNull();
    expect(NOT_ACKNOWLEDGED_NOTE).toMatch(/not yet acknowledged/i);
    expect(NOT_ACKNOWLEDGED_NOTE).not.toMatch(/sign|otp|button/i);
  });
});

describe("AC-COPY-4 — the band is stripped (R6)", () => {
  it("sanitizeSnapshot drops the cohort-tier band and never leaks a tier label", () => {
    const out = sanitizeSnapshot({
      mock2Aggregate: 14,
      projectedAggregate: 10,
      band: "Top tier",
      subjects: [{ name: "Chemistry", type: "ELECTIVE", grade: "B2", counted: true, band: "Top tier" }],
    });
    expect("band" in out).toBe(false);
    expect(out.projectedAggregate).toBe(10);
    expect(out.subjects.every((s) => !("band" in s))).toBe(true);
    expect(JSON.stringify(out)).not.toMatch(/top tier/i);
    expect(JSON.stringify(out)).not.toMatch(/\d–\d/);
  });
  it("handles junk input without throwing", () => {
    expect(sanitizeSnapshot(null)).toEqual({ projectedAggregate: null, subjects: [] });
    expect(sanitizeSnapshot("nonsense")).toEqual({ projectedAggregate: null, subjects: [] });
  });
});
