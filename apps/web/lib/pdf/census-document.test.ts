import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
import { renderCensusPdf } from "./render-census";
import { CensusDocument } from "./census-document";
import type { CensusPdfData } from "./census-document";
import type { CensusSnapshot, CensusSections } from "@/lib/reports/census/schema";
import type { CensusEnrolment } from "@/lib/reports/census-enrolment-data";
import type { CensusSpecialNeeds, SenCategory, SenSexCount } from "@/lib/reports/census/sen-data";
import { emptySenByCategory } from "@/lib/reports/census/sen-data";
import type { CensusHandFill } from "@/lib/reports/census/hand-fill-schema";

/**
 * GOV-9 · the annual census PDF renders from the FROZEN row (AC GOV9-09/20), the §5 grid honours adopted /
 * not-adopted (07/08), un-entered HAND sections print hatched blanks (06), and the document/route enforce
 * render-from-frozen, access, cadence and no-electronic-submission. The @react-pdf render runs in Node here
 * (the vendored-React #31 footgun is absent — the same buffer streams live); the fuller guarantee is `next
 * build` compiling the PDF route (Quinn's build gate).
 */

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────
const enrolment: CensusEnrolment = {
  censusDate: "2026-08-09",
  roll: 100,
  gender: { female: 48, male: 52, total: 100 },
  byClass: [{ classId: "c1", name: "SHS 1A", level: "SHS1", female: 20, male: 25, total: 45 }],
  byLevel: [],
  ageByLevel: [],
  approvedAge: [],
  dobUnknown: 0,
};

const withCounts = (over: Partial<Record<SenCategory, SenSexCount>>): CensusSpecialNeeds => {
  const byCategory = emptySenByCategory();
  let total = 0;
  for (const [k, v] of Object.entries(over)) {
    byCategory[k as SenCategory] = v as SenSexCount;
    total += (v as SenSexCount).male + (v as SenSexCount).female;
  }
  return { adopted: true, byCategory, total };
};

function makeSections(over: Partial<CensusSections> = {}): CensusSections {
  const staff = { female: 6, male: 8, unknown: 0, total: 14 };
  return {
    enrolment: { coverage: "FULL", data: enrolment },
    ageDistribution: { coverage: "FULL", data: { roll: 100, dobUnknown: 0, levelsWithAge: 3 } },
    ownership: { coverage: "FULL", data: { ownership: "PUBLIC" } },
    specialNeeds: { coverage: "FULL", data: withCounts({ VISUAL: { male: 1, female: 0 }, HEARING: { male: 0, female: 1 } }) },
    movement: { coverage: "FULL", data: { hasPeriod: true, admissionsThisPeriod: 18, intakeFemale: 8, intakeMale: 10 } },
    repetition: { coverage: "NONE", reason: "hand-filled" },
    teachingStaff: { coverage: "FULL", data: staff },
    ptr: { coverage: "FULL", data: { ratio: 7, teachingStaff: 14, roll: 100 } },
    qualifications: { coverage: "NONE", reason: "hand-filled" },
    nonTeachingStaff: { coverage: "FULL", data: { female: 1, male: 2, unknown: 0, total: 3 } },
    salaryStatus: { coverage: "FULL", data: { schoolPaid: 10, gesPaid: 3, allowance: 1, total: 14 } },
    attendance: { coverage: "FULL", data: { schoolRate: 94, totalMarked: 1200 } },
    terminalResults: { coverage: "NONE", reason: "No BECE/WASSCE results captured yet." },
    academicPerformance: { coverage: "NONE", reason: "No end-of-term academic performance recorded yet." },
    infrastructure: { coverage: "NONE", reason: "No facilities snapshot captured yet — capture one at /reports/facilities." },
    feeding: { coverage: "NONE", reason: "hand-filled" },
    textbooks: { coverage: "NONE", reason: "hand-filled" },
    ...over,
  };
}

function makeSnapshot(sectionsOver: Partial<CensusSections> = {}): CensusSnapshot {
  return {
    version: 1,
    cadence: "ANNUAL",
    academicYear: "2025/26",
    censusDate: "2026-08-09",
    generatedAt: "2026-08-09T00:00:00.000Z",
    period: null,
    identification: {
      schoolName: "Asankrangwa SHS", gesCode: "WR-WAW-014", schoolType: "SENIOR",
      district: "Wassa Amenfi West", region: "Western", circuit: null, ownership: "PUBLIC", yearFounded: "1991",
    },
    sections: makeSections(sectionsOver),
  };
}

function makeData(
  snapshot: CensusSnapshot,
  handFill: CensusHandFill = { version: 1 },
  status = "DRAFT",
  cadence: "MID_YEAR" | "ANNUAL" = "ANNUAL",
): CensusPdfData {
  return {
    snapshot,
    handFill,
    meta: { schoolInitials: "AS", cadence, status, generatedAtLabel: "9 Aug 2026 · 12:00", headteacherName: null },
  };
}

// The only per-render variance is PDF-format metadata, NOT census data: the trailing document-instance /ID
// (random) and the creation-date object (D:YYYYMMDDHHMMSSZ). Strip both, so what we assert byte-equal is the
// DOCUMENT CONTENT — every census figure reproduces exactly from the frozen row.
const normalise = (b: Buffer) =>
  b
    .toString("latin1")
    .replace(/\/ID \[[^\]]*\]/g, "/ID [X]")
    .replace(/\(D:\d{14}(?:Z|[+\-]\d{2}'\d{2}')?\)/g, "(D:X)");

// ── render-from-frozen + byte reproducibility ─────────────────────────────────────────────────────
describe("GOV9-20 · re-rendering the SAME frozen row is byte-reproducible", () => {
  it("two renders of one frozen (snapshot ⊕ hand_fill) are byte-identical (bar the PDF-format /ID)", async () => {
    const data = makeData(makeSnapshot(), {
      version: 1,
      repetition: { male: 5, female: 3 },
      qualifications: { trainedMale: 8, trainedFemale: 0, untrainedMale: 0, untrainedFemale: 2 },
    });
    const a = await renderCensusPdf(data);
    const b = await renderCensusPdf(data);
    expect(a.length).toBeGreaterThan(2000);
    expect(normalise(a)).toEqual(normalise(b));
  }, 20_000); // two sequential @react-pdf/fontkit renders (~2.5s each) — well over the 5s default under load

  it("NON-VACUOUS — a different frozen row renders DIFFERENT bytes (the doc reflects the data, not a constant)", async () => {
    const adopted = await renderCensusPdf(makeData(makeSnapshot()));
    const notAdopted = await renderCensusPdf(
      makeData(makeSnapshot({ specialNeeds: { coverage: "NONE", reason: "SEN register not adopted — hand-filled." } })),
    );
    expect(normalise(adopted)).not.toEqual(normalise(notAdopted));
  }, 20_000); // two sequential renders — same timeout headroom as the reproducibility test
});

// ── SEN §5 states (07/08) + honest-blank (06) render without throwing (exercises the compile-fenced branches)
describe("GOV9-07/08/06 · §5 adopted / not-adopted / blank all render; the doc never crashes on a coverage shape", () => {
  it("adopted (FULL, incl. a captured zero grid) renders — auto 12-cell", async () => {
    const zeroGrid: CensusSpecialNeeds = { adopted: true, byCategory: emptySenByCategory(), total: 0 };
    const pdf = await renderCensusPdf(makeData(makeSnapshot({ specialNeeds: { coverage: "FULL", data: zeroGrid } })));
    expect(pdf.length).toBeGreaterThan(2000);
  });

  it("not-adopted + an ENTERED hand-fill grid renders (GOV9-08 entered → grid)", async () => {
    const hand: CensusHandFill = {
      version: 1,
      specialNeeds: {
        VISUAL: { male: 1, female: 0 }, HEARING: { male: 0, female: 0 }, PHYSICAL: { male: 0, female: 0 },
        INTELLECTUAL: { male: 0, female: 0 }, SPEECH: { male: 0, female: 0 }, OTHER: { male: 0, female: 0 },
      },
    };
    const snap = makeSnapshot({ specialNeeds: { coverage: "NONE", reason: "SEN register not adopted — hand-filled." } });
    const pdf = await renderCensusPdf(makeData(snap, hand));
    expect(pdf.length).toBeGreaterThan(2000);
  });

  it("not-adopted + NO hand-fill → a hatched blank renders (GOV9-06 honest blank, never a 0 grid)", async () => {
    const snap = makeSnapshot({ specialNeeds: { coverage: "NONE", reason: "SEN register not adopted — hand-filled." } });
    const pdf = await renderCensusPdf(makeData(snap, { version: 1 }));
    expect(pdf.length).toBeGreaterThan(2000);
  });

  it("a maximally-empty snapshot (every arm NONE/NA, no hand-fill) still renders a hatched form", async () => {
    const none = (): CensusSections[keyof CensusSections] => ({ coverage: "NONE", reason: "not captured" });
    const sections = Object.fromEntries(
      Object.keys(makeSections()).map((k) => [k, k === "salaryStatus" ? { coverage: "NOT_APPLICABLE", reason: "no payroll" } : none()]),
    ) as unknown as CensusSections;
    const pdf = await renderCensusPdf(makeData({ ...makeSnapshot(), sections }));
    expect(pdf.length).toBeGreaterThan(2000);
  });
});

// ── document source: declaration (11) + wet signature/stamp (12) + no-electronic (19) ──────────────
describe("GOV9-11/12/19 · the document — declaration, WET signature, no electronic submission", () => {
  const doc = readFileSync(resolve(cwd(), "lib/pdf/census-document.tsx"), "utf8");

  it("carries the statutory declaration incl. the 'equally my responsibility' load-bearing clause (11)", () => {
    expect(doc).toMatch(/equally my responsibility/);
    expect(doc).toMatch(/Ghana Education Service/);
    expect(doc).toMatch(/accurate and complete/);
  });

  it("the signature line is BLANK for a pen — the typed name is a label, never a forged glyph (12)", () => {
    // the name prints (or a blank space when null); there is NO simulated signature ('.sig-mark'/rotation).
    expect(doc).toMatch(/meta\.headteacherName\s*\?\?\s*" "/);
    expect(doc).toMatch(/Headteacher signature/);
    expect(doc).not.toMatch(/sig-mark|Florence Addo|rotate/i);
  });

  it("the stamp is an empty placeholder box, not a printed stamp graphic (12)", () => {
    expect(doc).toMatch(/School stamp/);
  });

  it("states print-and-sign only — no electronic submission (19)", () => {
    expect(doc).toMatch(/print-and-sign/);
    expect(doc).toMatch(/does not submit it electronically/);
  });
});

// ── route source: render-from-frozen (09), access (17), cadence (18), DRAFT-downloadable (13), 404 (16), no-submit (19)
describe("GOV9-09/13/16/17/18/19 · the download route", () => {
  const route = readFileSync(resolve(cwd(), "app/api/reports/statutory/census/route.ts"), "utf8");

  it("gates on requireSchoolRole(CENSUS_WRITE_ROLES) (17)", () => {
    expect(route).toMatch(/requireSchoolRole\(\s*CENSUS_WRITE_ROLES\s*\)/);
  });

  it("keys on the SESSION school id, reads only the `year` param — never a URL/body school id (17)", () => {
    expect(route).toMatch(/eq\(\s*censusReturn\.schoolId,\s*school\.id\s*\)/);
    expect(route).toMatch(/searchParams\.get\(\s*["'`]year["'`]\s*\)/);
    expect(route).not.toMatch(/searchParams\.get\(\s*["'`]schoolId/);
  });

  it("renders from the FROZEN row (parse the stored snapshot + hand_fill) — NEVER a live re-compose (09)", () => {
    expect(route).toMatch(/parseCensusSnapshot\(\s*row\.autoSnapshot\s*\)/);
    expect(route).toMatch(/parseCensusHandFill\(\s*row\.handFill\s*\)/);
    expect(route).toMatch(/renderCensusPdf/);
    // the generator is the LIVE re-compose; the render path must not import or call it.
    expect(route).not.toMatch(/generateCensusSnapshot/);
  });

  it("is cadence-selectable — reads a `cadence` param, supports MID_YEAR, defaults ANNUAL (18/GOV-9b)", () => {
    expect(route).toMatch(/searchParams\.get\(\s*["'`]cadence["'`]\s*\)/);
    expect(route).toMatch(/MID_YEAR/);
    expect(route).toMatch(/eq\(\s*censusReturn\.cadence,\s*cadence\s*\)/);
    // the ternary pins the DEFAULT to ANNUAL (only an explicit MID_YEAR selects mid-year).
    expect(route).toMatch(/["'`]MID_YEAR["'`]\s*:\s*["'`]ANNUAL["'`]/);
  });

  it("is downloadable in DRAFT — it does NOT require status COMPLETED (13)", () => {
    expect(route).not.toMatch(/eq\(\s*censusReturn\.status,\s*["'`]COMPLETED["'`]\s*\)/);
    expect(route).toMatch(/application\/pdf/);
    expect(route).toMatch(/no-store/);
    expect(route).toMatch(/runtime\s*=\s*["'`]nodejs["'`]/);
  });

  it("404s when no row exists for the cadence — no row → no PDF (16)", () => {
    expect(route).toMatch(/status:\s*404/);
    expect(route).toMatch(/census has been generated yet/);
  });

  it("is a GET-only download — no submit/upload/POST path (19)", () => {
    expect(route).toMatch(/export async function GET/);
    expect(route).not.toMatch(/export async function (POST|PUT|PATCH)/);
  });
});

// ── cadence / access wiring on the page + actions (18/17) — GOV-9b cadence-aware ───────────────────
describe("GOV9-18/17 · the completion panel + actions are cadence-aware + management-gated", () => {
  it("the census page mounts CensusCompletionPanel for BOTH cadences, passing the cadence (GOV-9b)", () => {
    const page = readFileSync(
      resolve(cwd(), "app/(app)/reports/statutory/generate-annual-census/page.tsx"),
      "utf8",
    );
    expect(page).toMatch(/CensusCompletionPanel/);
    expect(page).toMatch(/cadence=\{cadence\}/);
    // no longer gated on ANNUAL — mid-year gets the panel too.
    expect(page).not.toMatch(/cadence === "ANNUAL"\s*&&\s*[\s\S]*CensusCompletionPanel/);
  });

  it("both actions gate on CENSUS_WRITE_ROLES + a DRAFT lock; saveCensusHandFill is ANNUAL-only, markCensusCompleted is cadence-aware", () => {
    const actions = readFileSync(resolve(cwd(), "lib/actions/census.ts"), "utf8");
    expect(actions).toMatch(/saveCensusHandFill/);
    expect(actions).toMatch(/markCensusCompleted/);
    // hand-fill is annual-only (its sections don't exist mid-year); completion is cadence-parameterised.
    expect(actions).toMatch(/eq\(\s*censusReturn\.cadence,\s*["'`]ANNUAL["'`]\s*\)/);
    expect(actions).toMatch(/eq\(\s*censusReturn\.cadence,\s*cadence\s*\)/);
    const draftLocks = actions.match(/eq\(\s*censusReturn\.status,\s*["'`]DRAFT["'`]\s*\)/g) ?? [];
    expect(draftLocks.length).toBeGreaterThanOrEqual(2);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// GOV-9b · the census PDF is CADENCE-AWARE. A MID_YEAR run renders ONLY the mid-year section set;
// an ANNUAL run is UNCHANGED (all 13 sections + the §5 grid). The rendered PDF's content streams are
// FlateDecode-compressed (verified: no section title is greppable in the raw buffer), so the SECTION
// SET is asserted STRUCTURALLY — walk the React element tree CensusDocument returns (each section is a
// named function-component element, gated inline on `meta.cadence` in the body, the same tree @react-pdf
// renders). Buffer renders back it up: neither cadence throws, and mid-year is strictly SMALLER — the
// annual-only sections are OMITTED, not hatched.
// ════════════════════════════════════════════════════════════════════════════════════════════════
type El = { type?: unknown; props?: Record<string, unknown> & { children?: unknown } };
function walkEls(node: unknown, out: El[]): El[] {
  if (node == null || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const n of node) walkEls(n, out);
    return out;
  }
  const el = node as El;
  if (typeof el.type === "function") out.push(el); // a section is a function component; @react-pdf primitives are not
  if (el.props && "children" in el.props) walkEls(el.props.children, out);
  return out;
}
const nameOf = (e: El) => (e.type as { name?: string }).name ?? "";
const sectionEls = (data: CensusPdfData) => walkEls(CensusDocument({ data }), []);
const sectionNames = (data: CensusPdfData) => sectionEls(data).map(nameOf).filter(Boolean);
const propsOf = (data: CensusPdfData, name: string) => sectionEls(data).find((e) => nameOf(e) === name)?.props;

const midData = (hf: CensusHandFill = { version: 1 }) => makeData(makeSnapshot(), hf, "DRAFT", "MID_YEAR");
const annualData = (hf: CensusHandFill = { version: 1 }) => makeData(makeSnapshot(), hf, "DRAFT", "ANNUAL");

// the section set a mid-year run renders (in document order) + the always-on Declaration.
const MID_YEAR_SET = ["Identification", "Enrolment", "AgeDistribution", "Movement", "Staff", "Attendance", "Declaration"];
// the annual-only sections a mid-year run MUST OMIT (they belong to the annual return; a hatch here would be noise).
const ANNUAL_ONLY = ["SpecialNeeds", "Terminal", "Performance", "Infrastructure", "Repetition", "Feeding", "Textbooks"];

describe("GOV-9b · a MID_YEAR run renders ONLY the mid-year section set", () => {
  it("renders identification/enrolment/age/movement/staff/attendance + declaration — the EXACT mid-year set", () => {
    expect(sectionNames(midData())).toEqual(MID_YEAR_SET);
  });

  it("OMITS every annual-only section (SEN §5, terminal, performance, infrastructure, repetition, feeding, textbooks)", () => {
    const names = sectionNames(midData());
    for (const s of ANNUAL_ONLY) expect(names).not.toContain(s);
  });

  it("the mid-year PDF renders — a real, non-throwing document", async () => {
    const pdf = await renderCensusPdf(midData());
    expect(pdf.length).toBeGreaterThan(2000);
  });

  it("mid-year Movement is ADMISSIONS-ONLY — annual=false, no exits hand-fill (no `hand`), numbered §4", () => {
    const p = propsOf(midData(), "Movement")!;
    expect(p.annual).toBe(false);
    expect(p.hand).toBeUndefined(); // the exits hatch (`annual ? hf.movementExits : undefined`) is not passed mid-year
    expect(p.n).toBe("4");
  });

  it("mid-year Staff is teaching/non-teaching/PTR-ONLY — annual=false, no salary/qualifications (no `hand`), numbered §5", () => {
    const p = propsOf(midData(), "Staff")!;
    expect(p.annual).toBe(false);
    expect(p.hand).toBeUndefined(); // no qualifications hand-fill, and the salary block is `annual`-gated in the section
    expect(p.n).toBe("5");
  });

  it("Attendance is the last numbered section (§6) on a mid-year run", () => {
    expect(propsOf(midData(), "Attendance")!.n).toBe("6");
  });
});

describe("GOV-9b · an ANNUAL run is UNCHANGED — all 13 sections + the §5 grid (regression)", () => {
  it("renders all 13 sections (incl. §5/SpecialNeeds) + declaration, in order", () => {
    const names = sectionNames(annualData());
    expect(names).toEqual([
      "Identification", "Enrolment", "AgeDistribution", "SpecialNeeds", "Movement", "Staff", "Attendance",
      "Terminal", "Performance", "Infrastructure", "Repetition", "Feeding", "Textbooks", "Declaration",
    ]);
    expect(names.filter((s) => s !== "Declaration")).toHaveLength(13);
    for (const s of ANNUAL_ONLY) expect(names).toContain(s);
  });

  it("annual Movement carries the exits hand-fill (annual=true, `hand` present, §5); Staff carries salary/qualifications (annual=true, §6)", () => {
    const data = annualData({ version: 1, movementExits: { withdrawals: 2, transfersIn: 1, transfersOut: 0 } });
    const mv = propsOf(data, "Movement")!;
    expect(mv.annual).toBe(true);
    expect(mv.hand).toBeDefined();
    expect(mv.n).toBe("5");
    const st = propsOf(data, "Staff")!;
    expect(st.annual).toBe(true);
    expect(st.n).toBe("6");
  });

  it("the annual PDF renders and is STRICTLY LARGER than the mid-year one (annual-only sections are real content, not omitted hatches)", async () => {
    const mid = await renderCensusPdf(midData());
    const ann = await renderCensusPdf(annualData());
    expect(ann.length).toBeGreaterThan(2000);
    expect(mid.length).toBeLessThan(ann.length);
  });

  it("each cadence is byte-reproducible in ITS cadence, and mid ≠ annual bytes (the section gate is observable, deterministic)", async () => {
    const m1 = await renderCensusPdf(midData());
    const m2 = await renderCensusPdf(midData());
    expect(normalise(m1)).toEqual(normalise(m2));
    const a1 = await renderCensusPdf(annualData());
    expect(normalise(m1)).not.toEqual(normalise(a1));
  });
});

describe("GOV-9b · the cover / footer / declaration REFERENCE the cadence", () => {
  const doc = readFileSync(resolve(cwd(), "lib/pdf/census-document.tsx"), "utf8");

  it("gates every annual-only section on `annual` (meta.cadence === 'ANNUAL')", () => {
    expect(doc).toMatch(/const annual = meta\.cadence === "ANNUAL"/);
    expect(doc).toMatch(/\{annual && <SpecialNeeds/);
    expect(doc).toMatch(/\{annual && <Terminal/);
    expect(doc).toMatch(/\{annual && <Infrastructure/);
    expect(doc).toMatch(/\{annual && <Textbooks/);
  });

  it("the cover kicker + labels swap ANNUAL / MID-YEAR by cadence", () => {
    expect(doc).toMatch(/annual \? "ANNUAL" : "MID-YEAR"/);
    expect(doc).toMatch(/cadenceLabel = annual \? "Annual" : "Mid-year"/);
  });

  it("the declaration copy is cadence-worded (a 'mid-year' vs 'annual' census)", () => {
    expect(doc).toMatch(/meta\.cadence === "MID_YEAR" \? "mid-year" : "annual"/);
    expect(doc).toMatch(/this \{cad\} census/);
  });
});

describe("GOV-9b · the completion panel is cadence-aware — mid-year has NO hand-fill form", () => {
  const panel = readFileSync(resolve(cwd(), "components/reports/census/census-completion-panel.tsx"), "utf8");

  it("the hand-fill form is gated ANNUAL-only (`annual && !locked`) — a mid-year run never mounts it", () => {
    expect(panel).toMatch(/const annual = cadence === "ANNUAL"/);
    expect(panel).toMatch(/\{annual && !locked && \(\s*<form onSubmit=\{onSave\}/);
  });

  it("a mid-year run (`!annual && !locked`) shows Download + Complete only — no <form>", () => {
    expect(panel).toMatch(/\{!annual && !locked && \(/);
    expect(panel).toMatch(/CompleteButton/);
  });

  it("the Download-PDF link carries the run's cadence (so the route selects the mid-year row)", () => {
    expect(panel).toMatch(/cadence=\$\{cadence\}/);
  });
});
