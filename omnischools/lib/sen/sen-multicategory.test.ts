import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
import {
  aggregateCensusSpecialNeeds,
  SEN_CATEGORIES,
  type SenCategory,
} from "@/lib/reports/census/sen-data";
import type { SenRecord, SenAccommodationRecord } from "@/lib/sen/register-data";

/**
 * GOV-10c (R445) · SEN multi-category — the invariants a static read + a pure function + a render can prove
 * (AC GOV10-43/44/46/47/48/50/51/52 + the dormant GOV10-55). The BEHAVIOURAL DB proofs (one parent row,
 * category NOT NULL, the primary∈secondary CHECK, DB-accepts-a-dup-so-the-app-refine-is-sole-guard, a
 * PENDING full-category-set with detail NULL, §5-counts-each-student-once, the grantee full-set, backfill
 * no-op) are the committed-fixtures round-trip in scripts/verify-sen-multicategory.ts
 * (`pnpm db:verify-sen-multicategory`, 34/34, Quinn ran it live).
 *
 * The model (Kofi §3, reconciled): ONE sen_register row per student; `category` = the primary/census
 * bucket; `secondary_categories` = a detail-FREE array of additional categories; the DETAIL cluster is
 * PER-STUDENT, not per-category. So the census reads `category` ONLY (the honesty invariant holds) and the
 * admin/grantee surfaces show the full set with the primary flagged.
 */
const src = (rel: string) => readFileSync(resolve(cwd(), rel), "utf8");
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const schema = stripComments(src("db/schema/sen-register.ts"));
const actions = stripComments(src("lib/actions/sen.ts"));
const reader = stripComments(src("lib/sen/register-data.ts"));
const senData = stripComments(src("lib/reports/census/sen-data.ts"));
const generate = stripComments(src("lib/reports/census/generate.ts"));

const cellSum = (byCategory: Record<SenCategory, { male: number; female: number }>): number =>
  SEN_CATEGORIES.reduce((s, c) => s + byCategory[c].male + byCategory[c].female, 0);

// ── GOV10-43 · the app-layer distinctness refine (a "use server" module exports only actions, so the ──
//    pure refine cannot be unit-called; we source-pin the EXACT predicate + its wiring into BOTH shapes.
//    The DB-accepts-a-dup half is proven behaviourally in verify-sen-multicategory.ts, which makes this
//    refine the SOLE dup guard — so the pin is load-bearing, not redundant.
describe("GOV10-43 · categoriesDistinct rejects primary∈secondary AND a duplicated secondary, on create + edit", () => {
  it("the refine tests BOTH `!secondary.includes(primary)` AND `Set(secondary).size === secondary.length`", () => {
    const def = actions.slice(actions.indexOf("const categoriesDistinct"), actions.indexOf("const CATEGORIES_MSG"));
    expect(def, "the refine bars the primary from the secondary set").toMatch(/!sec\.includes\(v\.category\)/);
    expect(def, "the refine bars a duplicated secondary (array-is-a-set)").toMatch(/new Set\(sec\)\.size === sec\.length/);
  });
  it("BOTH RecordShape (create) and EditShape (edit) apply `.refine(categoriesDistinct, …)` so a hand-crafted request is refused", () => {
    expect((actions.match(/\.refine\(categoriesDistinct,\s*CATEGORIES_MSG\)/g) ?? []).length).toBe(2);
    // and the secondary array is a bounded set of the SAME six-value category enum (not free text).
    expect(actions).toMatch(/const SECONDARY_CATEGORIES = z\.array\(CATEGORY\)\.max\(\d+\)\.optional\(\)/);
    expect(actions).toMatch(/secondaryCategories:\s*SECONDARY_CATEGORIES/);
  });
  it("the write actions persist the secondaries on the ONE parent row (create + edit), never a second row", () => {
    // create: secondaries go into the base insert values (a census/operational tag, allowed on PENDING).
    expect(actions).toMatch(/secondaryCategories:\s*d\.secondaryCategories \?\? \[\]/);
    // edit: the same, on an UPDATE .set — one row per student (R415) is untouched.
    expect(actions).toMatch(/\.set\(\{[\s\S]*?secondaryCategories:\s*d\.secondaryCategories \?\? \[\][\s\S]*?\}\)/);
  });
});

// ── GOV10-44 · the DETAIL is per-student; secondary_categories is a bare enum array, no per-category detail ─
describe("GOV10-44 · secondary categories are a detail-FREE enum array on the parent row (no per-category detail)", () => {
  it("the schema stores secondary_categories as a bare sen_category[] — no is_primary / severity / detail beside it", () => {
    expect(schema).toMatch(/secondaryCategories:\s*senCategoryEnum\("secondary_categories"\)\.array\(\)/);
    // no child category table carrying per-category rows/detail — the array IS the mechanism (Kofi §3).
    expect(schema).not.toContain("sen_register_category");
    expect(schema).not.toMatch(/is_primary/);
  });
  it("the detail cluster columns appear ONCE (singular) on sen_register — not duplicated per category", () => {
    for (const col of ["severity", "supportNotes", "accommodations", "diagnosisSource"]) {
      // each detail column is declared exactly once in the table (a per-category model would repeat them).
      const decls = schema.match(new RegExp(`${col}:\\s*\\w`, "g")) ?? [];
      expect(decls.length, `${col} is a single per-student column`).toBe(1);
    }
  });
});

// ── GOV10-46/47 · §5 counts each student ONCE under primary; folding secondaries in is a RED (non-vacuous) ─
describe("GOV10-46/47 · the census aggregate counts each student once under the PRIMARY category", () => {
  // A fixture with two multi-category students (the reader maps ONE (primary, sex) row per student).
  const roster = [
    { primary: "HEARING" as SenCategory, secondaries: ["INTELLECTUAL"] as SenCategory[], sex: "FEMALE" },
    { primary: "VISUAL" as SenCategory, secondaries: [] as SenCategory[], sex: "MALE" },
    { primary: "PHYSICAL" as SenCategory, secondaries: ["VISUAL", "SPEECH"] as SenCategory[], sex: "FEMALE" },
  ];
  const headcount = roster.length; // 3 distinct SEN students

  it("total == Σ12 == distinct headcount, and a secondary category's cell is NEVER inflated", () => {
    const primaryRows = roster.map((s) => ({ category: s.primary, sex: s.sex })); // the reader's real mapping
    const { byCategory, total } = aggregateCensusSpecialNeeds(primaryRows);
    expect(total).toBe(headcount);
    expect(cellSum(byCategory)).toBe(headcount);
    // Ada's INTELLECTUAL, Cyn's VISUAL + SPEECH are SECONDARY → their cells reflect PRIMARIES only.
    expect(byCategory.INTELLECTUAL).toEqual({ male: 0, female: 0 });
    expect(byCategory.SPEECH).toEqual({ male: 0, female: 0 });
    expect(byCategory.VISUAL).toEqual({ male: 1, female: 0 }); // Ben's primary only — Cyn's secondary VISUAL is NOT here
    expect(byCategory.PHYSICAL).toEqual({ male: 0, female: 1 }); // Cyn (PENDING or not) counts under her primary
  });

  it("NON-VACUOUS: a folding mutation (secondary → census) makes total > headcount and leaks the secondary cell", () => {
    // What a GOV10-55-style folding regression WOULD produce — proves the assertions above are discriminating.
    const foldedRows = roster.flatMap((s) => [s.primary, ...s.secondaries].map((category) => ({ category, sex: s.sex })));
    const folded = aggregateCensusSpecialNeeds(foldedRows);
    expect(folded.total).toBe(headcount + 3); // 3 students + 3 folded secondaries = 6
    expect(folded.total).toBeGreaterThan(headcount); // the `total === headcount` assertion would go RED
    expect(folded.byCategory.INTELLECTUAL).toEqual({ male: 0, female: 1 }); // the secondary WOULD leak into §5
  });
});

// ── GOV10-48 · the census reader still projects (primary category, sex) only; sole-content-path unchanged ─
describe("GOV10-48 · sen-data.ts reads the census DIMENSION only; secondary projection stays in the sole path", () => {
  it("the de-id census reader reads `category` (primary) and NEVER secondaryCategories / a detail column", () => {
    expect(senData).toMatch(/category:\s*senRegister\.category,\s*sex:\s*students\.sex/);
    expect(senData).not.toContain("secondaryCategories");
    expect(senData).not.toContain("secondary_categories");
    expect(senData).toMatch(/^import "server-only";/m);
  });
  it("the register view's census mapping folds NOTHING — one (primary category, sex) per student", () => {
    expect(reader).toMatch(/aggregateCensusSpecialNeeds\(\s*rows\.map\(\(r\) => \(\{ category: r\.category, sex: r\.sex \}\)\)/);
    expect(reader).not.toMatch(/flatMap\([^)]*secondaryCategories/);
  });
  it("secondaryCategories is projected ONLY inside lib/sen/register-data.ts — the sole-content-path set is unchanged", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(resolve(cwd(), dir), { withFileTypes: true })) {
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
          if (/senRegister\.secondaryCategories/.test(readFileSync(resolve(cwd(), p), "utf8"))) offenders.push(p);
        }
      }
    };
    walk("lib");
    expect(offenders).toEqual(["lib/sen/register-data.ts"]);
  });
});

// ── GOV10-51 · the grantee record carries the full category set AND stays diagnosis-free ─────────────
describe("GOV10-51 · the grantee accommodation record widens to the full category set, still diagnosis-free", () => {
  it("SenAccommodationRecord's type block names secondaryCategories but NO diagnosis/consent field", () => {
    const block = reader.slice(
      reader.indexOf("export type SenAccommodationRecord"),
      reader.indexOf("};", reader.indexOf("export type SenAccommodationRecord")),
    );
    expect(block).toContain("secondaryCategories");
    for (const tok of ["diagnosisSource", "diagnosingClinician", "diagnosingInstitution", "diagnosisYear", "consentOnFileAt", "consentState"]) {
      expect(block, `the grantee record must not carry ${tok}`).not.toContain(tok);
    }
  });
});

// ── GOV10-55 (DORMANT) · the incidence fallback is NOT built ─────────────────────────────────────────
describe("GOV10-55 · the incidence fallback is dormant — §5 has NOT been flipped to sum secondaries", () => {
  it("no census surface sums secondaries or presents an 'incidences by category' two-number split", () => {
    for (const [name, code] of [["sen-data.ts", senData], ["register-data.ts census", reader], ["generate.ts", generate]] as const) {
      expect(code.toLowerCase(), `${name} must not carry the dormant incidence labelling`).not.toContain("incidences by category");
    }
    // the aggregate over the census is still primary-only (a secondary flatMap into the census is the flip).
    expect(reader).not.toMatch(/aggregateCensusSpecialNeeds\([^)]*secondaryCategories/);
  });
});

// ══ RENDER tripwires (renderToStaticMarkup, node — no jsdom) ══════════════════════════════════════════
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/lib/actions/sen", () => ({
  withdrawSenConsent: async () => ({ ok: true }),
  editSenRecord: async () => ({ ok: true }),
  grantSenConsent: async () => ({ ok: true }),
  recordSupportNeed: async () => ({ ok: true }),
}));

const { SenRegisterTable } = await import("@/components/sen/sen-register-table");
const { SenGranteeView } = await import("@/components/sen/sen-grantee-view");

const mkRec = (over: Partial<SenRecord>): SenRecord => ({
  id: "r1",
  studentName: "Ada Test",
  className: "Form 2 Science",
  level: "Form 2",
  sex: "FEMALE",
  age: 15,
  category: "HEARING",
  secondaryCategories: [],
  severity: "MODERATE",
  supportNotes: null,
  accommodations: [],
  diagnosisSource: null,
  diagnosingClinician: null,
  diagnosingInstitution: null,
  diagnosisYear: null,
  consentOnFileAt: null,
  ...over,
});

// ── GOV10-52 + GOV10-50 · admin register table renders the full set, primary flagged, honest caption ──
describe("GOV10-52/50 · the admin register table shows all categories with the primary flagged + an honest caption", () => {
  const multi = mkRec({ id: "r1", category: "HEARING", secondaryCategories: ["INTELLECTUAL"] });
  const singleOnly = mkRec({ id: "r2", studentName: "Ben Test", category: "VISUAL", secondaryCategories: [] });

  it("GOV10-52 · a multi-category row renders BOTH categories, the primary flagged 'Primary (census) category'", () => {
    const html = renderToStaticMarkup(createElement(SenRegisterTable, { records: [multi] }));
    expect(html).toContain("Hearing"); // primary label
    expect(html).toContain("Intellectual"); // secondary label
    expect(html).toContain('title="Primary (census) category"');
    expect(html).toContain('title="Additional category"');
  });

  it("GOV10-50 · the incidence caption renders ONLY when a multi-category record exists, and is labelled distinctly from the headcount", () => {
    const withMulti = renderToStaticMarkup(createElement(SenRegisterTable, { records: [multi, singleOnly] }));
    expect(withMulti).toContain("appears under each category");
    expect(withMulti).toContain("more than the number of students"); // honest: an incidence tally, not the headcount

    const singleCatOnly = renderToStaticMarkup(createElement(SenRegisterTable, { records: [singleOnly] }));
    expect(singleCatOnly).not.toContain("appears under each category"); // no caption when nothing is multi-category
  });
});

// ── GOV10-51 · the grantee card renders the whole child's category set, no diagnosis ─────────────────
describe("GOV10-51 · the grantee card renders the whole child (primary + secondary), diagnosis-free", () => {
  const rec: SenAccommodationRecord = {
    studentName: "Ada Test",
    className: "Form 2 Science",
    level: "Form 2",
    category: "HEARING",
    secondaryCategories: ["INTELLECTUAL"],
    severity: "MODERATE",
    supportNotes: "Deaf + intellectual support",
    accommodations: ["FM hearing system"],
  };

  it("renders BOTH the primary and the secondary category labels for a multi-category student", () => {
    const html = renderToStaticMarkup(createElement(SenGranteeView, { records: [rec] }));
    expect(html).toContain("Hearing");
    expect(html).toContain("Intellectual");
    expect(html).toContain("FM hearing system"); // the per-student accommodation still shows
    expect(html).toContain("Moderate"); // the single per-student severity
    // the diagnosis cluster is structurally absent (proven by the type block + compile fence); as a render
    // tripwire, the admin-only "Clinician" label the grantee never renders must not appear.
    expect(html).not.toContain("Clinician");
  });

  it("a single-category grantee record renders exactly one category pill (grouping is a no-op)", () => {
    const html = renderToStaticMarkup(
      createElement(SenGranteeView, { records: [{ ...rec, secondaryCategories: [] }] }),
    );
    expect(html).toContain("Hearing");
    expect(html).not.toContain("Intellectual");
  });
});
