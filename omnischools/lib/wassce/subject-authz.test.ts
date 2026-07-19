import { describe, it, expect } from "vitest";
import { matchWassceSubjectIds } from "./subject-authz";

// The R5 seam under test: a teacher's F3 assignment names (score-ledger `subject`) vs the school's
// wassce_subjects (name only). Only NAME-matching wassce_subjects authorise — no cross-subject leak.
const WASSCE_SUBJECTS = [
  { id: "chem", name: "Chemistry" },
  { id: "phys", name: "Physics" },
  { id: "bio-sci", name: "Biology" },
  { id: "bio-he", name: "Biology" }, // Biology repeats across programmes (Science + Home Ec)
];

describe("matchWassceSubjectIds — R5 subject correspondence (AC4)", () => {
  it("authorises Mr Asiedu (Chemistry) for the Chemistry wassce_subject only — Physics denied", () => {
    const ids = matchWassceSubjectIds(["Chemistry"], WASSCE_SUBJECTS);
    expect(ids).toEqual(["chem"]);
    expect(ids).not.toContain("phys");
  });
  it("a teacher with no F3 assignment authorises nothing (403 / 0 rows)", () => {
    expect(matchWassceSubjectIds([], WASSCE_SUBJECTS)).toEqual([]);
  });
  it("matches every wassce_subject sharing the assigned name (Biology across two programmes)", () => {
    expect(matchWassceSubjectIds(["Biology"], WASSCE_SUBJECTS).sort()).toEqual(["bio-he", "bio-sci"]);
  });
  it("is insensitive to case / surrounding whitespace drift between the two vocabularies", () => {
    expect(matchWassceSubjectIds([" chemistry "], WASSCE_SUBJECTS)).toEqual(["chem"]);
  });
});
