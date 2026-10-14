import { Fragment, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { JUR, PERIOD_ID_EXAM_COHORT } from "./fixtures/ids";
import { adminAnalytics, districtOfficer } from "./helpers";

/**
 * INCREMENT M · THE TREND SURFACE AS AN OFFICER ACTUALLY SEES IT (MULTI-YEAR-TREND-RULING
 * M9/M10/M13; ACs 1, 9, 10, 11, 12).
 *
 * tests/oversight-multi-year-trend.test.ts proves the SERIES and the PURE pill semantics. This file
 * proves the WIRING, which no unit assertion can: it renders the real server component against the
 * real database as the real app role (`ov_app`), with a successful ETL run and a controllable
 * WASSCE history, and reads the `.k-delta` pills back out of the markup. The three states the ruling
 * insists a reader must tell apart — a real signed change, a MEASURED no-change, and NO COMPARATOR —
 * are each rendered and each asserted on its own tone AND its own label, because the ruling's
 * consequential error (M10) is exactly a surface that collapses two of them.
 *
 * The scenarios differ ONLY in the prior sitting's row, so any difference in the pill is caused by
 * the history and nothing else.
 */

const RUN = "2e000000-0000-4000-8000-0000000000ff";
/** The PRIOR sitting. Its academic_year is deliberately far from any other test's planted cohorts. */
const PRIOR = {
  id: "2e000000-0000-4000-8000-000000001920",
  academicYear: "2019/20",
  endsOn: "2020-06-26",
  /** `sittingYearOf("2019/20")` — the label the pill must name as the comparator. */
  sittingYear: 2020,
};
/** The CURRENT sitting is the shared fixture's own EXAM_COHORT period (2025/26 → sitting 2026). */
const CURRENT_CANDIDATES = 200;
const CURRENT_QUALIFIED = 150; // 75% — the figure the card displays

let owner: postgres.Sql;

function chromeSession(base: unknown, jurisdictionName: string) {
  return { ...(base as object), displayName: "Test Officer", jurisdictionName };
}

/** The page's own markup, produced by invoking the server component (the house render harness). */
async function renderPage(officer: unknown): Promise<string> {
  vi.resetModules();
  vi.doMock("@/lib/auth", async (orig) => ({
    ...(await orig<typeof import("@/lib/auth")>()),
    getOfficerSession: async () => officer,
  }));
  try {
    const mod = await import("@/app/(oversight)/page");
    const tree = await (mod.default as () => Promise<unknown>)();
    return renderToStaticMarkup(createElement(Fragment, null, tree as never));
  } finally {
    vi.doUnmock("@/lib/auth");
    vi.resetModules();
  }
}

/** The KPI strip's markup ONLY — the `<section aria-label="Headline indicators">` and nothing after. */
function stripOf(markup: string): string {
  const start = markup.indexOf('aria-label="Headline indicators"');
  expect(start, "no KPI strip").toBeGreaterThan(-1);
  return markup.slice(start, markup.indexOf("</section>", start));
}

/** Every `.k-delta` pill in the KPI strip, as `{ classes, text }` in document order. */
function pillsOf(markup: string): { classes: string; text: string }[] {
  const strip = stripOf(markup);
  const out: { classes: string; text: string }[] = [];
  for (const m of strip.matchAll(
    /<span class="(mt-2 inline-flex[^"]*)"[^>]*>([\s\S]*?)<\/span><\/div>/g,
  ))
    out.push({
      classes: m[1]!,
      text: m[2]!
        .replace(/<[^>]+>/g, "")
        .replace(/&#x27;/g, "'")
        .replace(/&amp;/g, "&")
        .trim(),
    });
  return out;
}

const pillFor = (markup: string, label: string) => {
  const strip = stripOf(markup);
  const cardStart = strip.indexOf(label);
  expect(cardStart, `no card labelled "${label}"`).toBeGreaterThan(-1);
  const card = strip.slice(cardStart);
  const found = /<span class="(mt-2 inline-flex[^"]*)"[^>]*>([\s\S]*?)<\/span><\/div>/.exec(
    card,
  );
  return found
    ? {
        classes: found[1]!,
        html: found[2]!,
        text: found[2]!.replace(/<[^>]+>/g, "").trim(),
      }
    : null;
};

/** Re-plants the prior sitting (or removes it) and renders the district dashboard. */
async function renderWithPrior(qualified: number | null): Promise<string> {
  await owner`delete from fact_performance_exam where period_id = ${PRIOR.id}::uuid`;
  if (qualified !== null)
    await owner`
      insert into fact_performance_exam
        (jurisdiction_id, period_id, exam, sex, candidates, qualified, qualification_rate, source, as_of_date)
      values (${JUR.schoolPublicConsented}::uuid, ${PRIOR.id}::uuid, 'WASSCE', 'ALL',
              200, ${qualified}, ${(qualified / 2).toFixed(2)}, 'WAEC_EXTRACT', ${PRIOR.endsOn})`;
  return renderPage(chromeSession(districtOfficer, "Wassa Amenfi West"));
}

beforeAll(async () => {
  owner = adminAnalytics();
  // A successful run, because every KPI value (and therefore every pill) is gated on one.
  await owner`
    insert into etl_run (run_id, started_at, finished_at, status)
    values (${RUN}::uuid, now() - interval '2 hours', now() - interval '1 hour', 'SUCCESS')`;
  await owner`
    insert into dim_period (period_id, academic_year, term, period_type, starts_on, ends_on, is_current)
    values (${PRIOR.id}::uuid, ${PRIOR.academicYear}, null, 'EXAM_COHORT',
            '2020-05-04', ${PRIOR.endsOn}, false)`;
  // The CURRENT sitting: 150/200 = 75%, in the officer's own district.
  await owner`
    insert into fact_performance_exam
      (jurisdiction_id, period_id, exam, sex, candidates, qualified, qualification_rate, source, as_of_date)
    values (${JUR.schoolPublicConsented}::uuid, ${PERIOD_ID_EXAM_COHORT}::uuid, 'WASSCE', 'ALL',
            ${CURRENT_CANDIDATES}, ${CURRENT_QUALIFIED}, 75.00, 'WAEC_EXTRACT', '2026-06-26')`;
});

afterAll(async () => {
  await owner`delete from fact_performance_exam
               where period_id = any(array[${PRIOR.id}::uuid, ${PERIOD_ID_EXAM_COHORT}::uuid])`;
  await owner`delete from dim_period where period_id = ${PRIOR.id}::uuid`;
  await owner`delete from etl_run where run_id = ${RUN}::uuid`;
  await owner.end({ timeout: 5 });
});

describe("the WASSCE pill as rendered: real change, measured zero, no comparator (AC9/AC10)", () => {
  it("AC9 · with ONE sitting the pill is the flat em-dash — no fake ▲ 0%, no fabricated direction", async () => {
    const markup = await renderWithPrior(null);
    const pill = pillFor(markup, "WASSCE qualification")!;
    expect(pill.text).toBe("— no prior sitting yet");
    expect(pill.classes).toContain("bg-bg");
    expect(pill.classes).toContain("text-navy-3");
    expect(pill.classes).not.toContain("green");
    expect(pill.classes).not.toContain("terra");
    expect(pill.html).not.toContain("▲");
    expect(pill.html).not.toContain("▼");
    expect(pill.text).not.toContain("0%");
    expect(pill.text).not.toContain("0 pts");
    // The card itself still shows the sitting's real figure — the MISSING thing is the comparator.
    const strip = stripOf(markup);
    expect(strip).toContain("WASSCE qualification");
    expect(strip).toContain("75");
  });

  it("AC9/AC10 · a real RISE is a green ▲ in percentage POINTS, naming the prior sitting", async () => {
    // 75% now against 50% then — the delta is the difference of two independently re-derived Σ/Σ
    // rates, in POINTS, and the comparator year is on the face of the pill.
    const pill = pillFor(await renderWithPrior(100), "WASSCE qualification")!;
    // `pill.text` strips tags but keeps text content, so it merges the aria-hidden glyph, the sr-only
    // direction word and the visible label: "▲" + "up " + "25 pts vs 2020". The DIRECTION reaches a
    // screen reader through that sr-only word, never through the glyph or the colour alone (Dex B1 /
    // WCAG 1.4.1); the visible figure is the absolute size.
    expect(pill.text).toBe(`▲up 25 pts vs ${PRIOR.sittingYear}`);
    expect(pill.html).toContain('<span class="sr-only">up </span>');
    expect(pill.classes).toContain("bg-green-bg");
    expect(pill.classes).toContain("text-green");
    expect(pill.html).toContain("▲");
    expect(pill.html).not.toContain("▼");
    // Not a percentage-of-a-percentage and not a ratio: 25 POINTS, never "50%".
    expect(pill.text).not.toContain("%");
  });

  it("a real FALL is a terra ▼ — the sign follows the data, not the surface's optimism", async () => {
    // 75% now against 90% then → −15 points.
    const pill = pillFor(await renderWithPrior(180), "WASSCE qualification")!;
    // "▼" + "down " + "15 pts vs 2020" (see the rise test for why the merged text reads this way).
    expect(pill.text).toBe(`▼down 15 pts vs ${PRIOR.sittingYear}`);
    expect(pill.html).toContain('<span class="sr-only">down </span>');
    expect(pill.classes).toContain("bg-terra-bg");
    expect(pill.classes).toContain("text-terra");
    // The figure is the ABSOLUTE size; the direction is the sr-only word, the tone and the glyph — but
    // never a signed "-15" in the visible label.
    expect(pill.text).not.toContain("-15");
  });

  it("AC10 · an EQUAL pair is a MEASURED no-change — flat tone, definite words, NO em-dash", async () => {
    // 75% now against 75% then: two comparator years exist, so this is a measurement, not an absence.
    const pill = pillFor(await renderWithPrior(150), "WASSCE qualification")!;
    expect(pill.text).toBe(`no change vs ${PRIOR.sittingYear}`);
    expect(pill.classes).toContain("bg-bg");
    expect(pill.classes).toContain("text-navy-3");
    // THE DISTINCTION THE RULING CALLS THE CONSEQUENTIAL ONE: the measured zero carries no em-dash,
    // and the absent state carries no "no change". A reader can tell them apart at a glance.
    expect(pill.text).not.toContain("—");
    expect(pill.html).not.toContain("▲");
    expect(pill.html).not.toContain("▼");
  });

  it("AC10 · the two flat states are the same TONE but never the same TEXT", async () => {
    const absent = pillFor(await renderWithPrior(null), "WASSCE qualification")!;
    const zero = pillFor(await renderWithPrior(150), "WASSCE qualification")!;
    expect(zero.classes).toBe(absent.classes); // both `.flat`
    expect(zero.text).not.toBe(absent.text); // but never confusable
  });
});

describe("the pills the trend must NOT produce (AC1/AC11/AC12)", () => {
  let markup = "";
  beforeAll(async () => {
    markup = await renderWithPrior(100); // the richest state: a real WASSCE trend is on screen
  });

  it("AC12 · enrolment and coverage carry the flat em-dash with the accrues-forward tooltip", () => {
    for (const label of ["Total enrolment", "School coverage"]) {
      const pill = pillFor(markup, label)!;
      expect(pill.text, label).toBe("— no prior year yet");
      expect(pill.classes, label).toContain("bg-bg");
      expect(pill.classes, label).not.toContain("green");
      expect(pill.classes, label).not.toContain("terra");
      // The tooltip is the honesty, and it must NOT imply a feed/backfill is coming (M2/M13).
      expect(pill.html, label).toContain(
        'title="No prior-year comparator yet — the trend appears as further years are measured."',
      );
      expect(pill.html, label).not.toContain("not yet sourced from a feed");
    }
  });

  it("AC1 · no enrolment/coverage/staffing pill carries a FIGURE or a DEMO chip", () => {
    for (const label of ["Total enrolment", "School coverage"]) {
      const pill = pillFor(markup, label)!;
      expect(pill.text, label).not.toMatch(/\d/); // no year-over-year value, ever
      expect(pill.html, label).not.toContain("DEMO");
    }
    // The ONLY pill on the strip carrying a signed direction is the WASSCE one.
    const directional = pillsOf(markup).filter(
      (p) => p.text.includes("▲") || p.text.includes("▼"),
    );
    expect(directional.length).toBe(1);
    expect(directional[0]!.text).toContain("pts vs");
  });

  it("AC11 · the PTR pill is the GES-norm TARGET chip and is not gated on any history", async () => {
    const withTrend = pillFor(markup, "Pupil-teacher ratio")!;
    expect(withTrend.text).toMatch(/GES level norms$/);
    expect(withTrend.html).not.toContain("▲");
    expect(withTrend.html).not.toContain("▼");
    expect(withTrend.text).not.toContain("pts");
    expect(withTrend.text).not.toContain("vs");
    // …and it is IDENTICAL with no exam history at all: a target comparison needs no comparator year,
    // so the trend increment must neither suppress it nor convert it into a YoY.
    const noHistory = pillFor(
      await renderWithPrior(null),
      "Pupil-teacher ratio",
    )!;
    expect(noHistory.text).toBe(withTrend.text);
    expect(noHistory.classes).toBe(withTrend.classes);
  });

  it("the strip carries exactly four pills — one per card, none invented for attendance or fees (AC18/AC17)", async () => {
    const pills = pillsOf(markup);
    expect(pills.length).toBe(4);
    const strip = stripOf(markup);
    expect(strip.toLowerCase()).not.toContain("attendance");
    expect(strip.toLowerCase()).not.toContain("fee");
  });
});

describe("AC19 · the provenance ledger explains a trend exactly when one is on screen (M13)", () => {
  // M13's wording, apostrophe-free fragments (renderToStaticMarkup escapes `'` → `&#x27;`, so a phrase
  // with an apostrophe would never match the raw markup). These are distinctive to the trend caveat.
  const OPENING = "Change is measured between closed exam sittings";
  const REDERIVE = "never carried forward or averaged";

  it("a real signed change puts the between-sitting re-derivation caveat in the ledger", async () => {
    const markup = await renderWithPrior(100); // ▲ 25 pts vs 2020 is on the strip
    expect(markup).toContain(OPENING);
    expect(markup).toContain(REDERIVE);
  });

  it("a MEASURED no-change is still a real comparison, so the caveat is present", async () => {
    const markup = await renderWithPrior(150); // "no change vs 2020" — measured, not absent
    expect(markup).toContain(OPENING);
  });

  it("an ABSENT trend (em-dash pill) carries NO ledger line claiming a change", async () => {
    const markup = await renderWithPrior(null); // "— no prior sitting yet" em-dash
    // The pill is on screen, but no provenance line explains a change the page is not making.
    expect(pillFor(markup, "WASSCE qualification")!.text).toBe("— no prior sitting yet");
    expect(markup).not.toContain(OPENING);
    expect(markup).not.toContain(REDERIVE);
  });
});
