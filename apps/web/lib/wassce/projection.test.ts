import { describe, it, expect } from "vitest";
import {
  projectAggregate,
  bandForAggregate,
  type ProjectionSubjectInput,
} from "./projection";
import { WASSCE_GRADES } from "./mock-grades";

/**
 * The INCR-17 crown-jewel test (Kofi AC1–AC8). The canonical fixture is Y. Aidoo: cores
 * IntSci A1 / Math B2 / Eng B3 / Social B3 → drop Social (tie with Eng at 3 pts; "English
 * Language" < "Social Studies" so English is kept); electives Bio A1 / Chem A1 / Phys B2 /
 * ElecMath C4 → drop ElecMath. Aggregate = 6 (cores) + 4 (electives) = 10.
 */

const AIDOO: ProjectionSubjectInput[] = [
  // cores
  { name: "English Language", type: "CORE", grade: "B3" }, // projected — held Mock-2 grade through the SC-12
  { name: "Mathematics (Core)", type: "CORE", grade: "B2" },
  { name: "Integrated Science", type: "CORE", grade: "A1" },
  { name: "Social Studies", type: "CORE", grade: "B3" },
  // electives
  { name: "Chemistry", type: "ELECTIVE", grade: "A1" },
  { name: "Biology", type: "ELECTIVE", grade: "A1" },
  { name: "Physics", type: "ELECTIVE", grade: "B2" },
  { name: "Elective Mathematics", type: "ELECTIVE", grade: "C4" },
];

const namesOf = (subjects: { name: string; counted: boolean }[], counted: boolean) =>
  subjects.filter((s) => s.counted === counted).map((s) => s.name).sort();

describe("projectAggregate — Y. Aidoo canonical fixture (AC1)", () => {
  const r = projectAggregate(AIDOO);
  if (!r.computable) throw new Error("Y. Aidoo must be computable");

  it("aggregates to 10", () => {
    expect(r.aggregate).toBe(10);
  });

  it("counts {Integrated Science, Mathematics (Core), English Language}; drops Social Studies (AC5 tie-break)", () => {
    expect(namesOf(r.cores, true)).toEqual([
      "English Language",
      "Integrated Science",
      "Mathematics (Core)",
    ]);
    expect(namesOf(r.cores, false)).toEqual(["Social Studies"]);
  });

  it("keeps English (projected) over Social despite both being B3 (3 pts) — English < Social", () => {
    const eng = r.cores.find((s) => s.name === "English Language");
    const social = r.cores.find((s) => s.name === "Social Studies");
    expect(eng?.points).toBe(3);
    expect(social?.points).toBe(3);
    expect(eng?.counted).toBe(true);
    expect(social?.counted).toBe(false);
  });

  it("counts {Biology, Chemistry, Physics}; drops Elective Mathematics", () => {
    expect(namesOf(r.electives, true)).toEqual(["Biology", "Chemistry", "Physics"]);
    expect(namesOf(r.electives, false)).toEqual(["Elective Mathematics"]);
  });

  it("keeps the dropped subject in the payload (never filtered — the greyed-but-visible mechanic)", () => {
    expect(r.subjects).toHaveLength(8);
    expect(r.subjects.some((s) => s.name === "Elective Mathematics" && !s.counted)).toBe(true);
    expect(r.subjects.some((s) => s.name === "Social Studies" && !s.counted)).toBe(true);
  });
});

describe("projectAggregate — boundary aggregates (AC2/AC3)", () => {
  const six = (type: "CORE" | "ELECTIVE", grade: (typeof WASSCE_GRADES)[number]) =>
    [0, 1, 2].map((i) => ({ name: `${type}-${i}`, type, grade }) as ProjectionSubjectInput);

  it("six A1 → aggregate 6 (the minimum)", () => {
    const r = projectAggregate([...six("CORE", "A1"), ...six("ELECTIVE", "A1")]);
    expect(r.computable && r.aggregate).toBe(6);
  });

  it("six F9 → aggregate 54 (the maximum); D7–F9 are summed, not filtered (AC3)", () => {
    const r = projectAggregate([...six("CORE", "F9"), ...six("ELECTIVE", "F9")]);
    expect(r.computable && r.aggregate).toBe(54);
  });
});

describe("projectAggregate — not-computable guards (AC6)", () => {
  it("<3 graded cores → INSUFFICIENT_CORES (never a partial 5-subject number)", () => {
    const r = projectAggregate([
      { name: "English Language", type: "CORE", grade: "A1" },
      { name: "Mathematics (Core)", type: "CORE", grade: "A1" },
      { name: "Chemistry", type: "ELECTIVE", grade: "A1" },
      { name: "Biology", type: "ELECTIVE", grade: "A1" },
      { name: "Physics", type: "ELECTIVE", grade: "A1" },
    ]);
    expect(r.computable).toBe(false);
    expect(!r.computable && r.reason).toBe("INSUFFICIENT_CORES");
  });

  it("<3 graded electives → INSUFFICIENT_ELECTIVES", () => {
    const r = projectAggregate([
      { name: "English Language", type: "CORE", grade: "A1" },
      { name: "Mathematics (Core)", type: "CORE", grade: "A1" },
      { name: "Integrated Science", type: "CORE", grade: "A1" },
      { name: "Chemistry", type: "ELECTIVE", grade: "A1" },
      { name: "Biology", type: "ELECTIVE", grade: "A1" },
    ]);
    expect(!r.computable && r.reason).toBe("INSUFFICIENT_ELECTIVES");
  });

  it("an ungraded subject (grade null) is excluded from its pool", () => {
    const r = projectAggregate([
      { name: "English Language", type: "CORE", grade: "A1" },
      { name: "Mathematics (Core)", type: "CORE", grade: "A1" },
      { name: "Integrated Science", type: "CORE", grade: null }, // no Mock-2 result yet
      { name: "Chemistry", type: "ELECTIVE", grade: "A1" },
      { name: "Biology", type: "ELECTIVE", grade: "A1" },
      { name: "Physics", type: "ELECTIVE", grade: "A1" },
    ]);
    expect(r.computable).toBe(false); // only 2 graded cores
  });
});

describe("projectAggregate — OPTIONAL pools with electives (AC4)", () => {
  it("an OPTIONAL 'Alt' subject competes for a best-3-elective slot", () => {
    const r = projectAggregate([
      { name: "English Language", type: "CORE", grade: "B2" },
      { name: "Mathematics (Core)", type: "CORE", grade: "B2" },
      { name: "Integrated Science", type: "CORE", grade: "B2" },
      { name: "Financial Accounting", type: "ELECTIVE", grade: "C4" },
      { name: "Economics", type: "ELECTIVE", grade: "C4" },
      { name: "Business Management", type: "ELECTIVE", grade: "C4" },
      { name: "Elective Mathematics", type: "OPTIONAL", grade: "A1" }, // best elective — must count
    ]);
    if (!r.computable) throw new Error("must be computable");
    const alt = r.electives.find((s) => s.name === "Elective Mathematics");
    expect(alt?.counted).toBe(true);
    // cores 6 (B2×3) + electives 1 (A1) + 4 + 4 = 15
    expect(r.aggregate).toBe(15);
  });
});

describe("projectAggregate — predictor-only / medical hold (AC7/AC8)", () => {
  it("uses effective (moderated-over-teacher) grade of the predictor mock", () => {
    // English teacher grade C4 but moderated to B3 → the projection must use B3 → aggregate 10.
    const moderated = AIDOO.map((s) =>
      s.name === "English Language"
        ? { ...s, grade: "C4" as const, moderatedGrade: "B3" as const }
        : s,
    );
    const r = projectAggregate(moderated);
    expect(r.computable && r.aggregate).toBe(10);
  });

  it("a missed/exempted live paper cannot change the number — there is no sittings input to read", () => {
    // The exact same predictor grades (English held at B3) yield 10 whether or not she sat the live
    // English papers. projectAggregate takes only subject grades; a sitting/exemption is structurally
    // invisible to it (Decision 11), so the medical hold needs no branch.
    const r = projectAggregate(AIDOO);
    expect(r.computable && r.aggregate).toBe(10);
    expect(Object.keys(AIDOO[0])).not.toContain("sitting");
  });
});

describe("bandForAggregate", () => {
  it("maps aggregates to their WAEC band label", () => {
    expect(bandForAggregate(6)).toBe("Top tier");
    expect(bandForAggregate(10)).toBe("Top tier");
    expect(bandForAggregate(12)).toBe("Top tier");
    expect(bandForAggregate(14)).toBe("Very good");
    expect(bandForAggregate(22)).toBe("Fair");
    expect(bandForAggregate(30)).toBe("Weak");
    expect(bandForAggregate(54)).toBe("No clear path");
  });
});
