import { describe, it, expect } from "vitest";
import {
  aggregateCensusSpecialNeeds,
  emptySenByCategory,
  SEN_CATEGORIES,
  type CensusSpecialNeeds,
  type SenCategory,
} from "./sen-data";

/**
 * GOV-10 · the DE-IDENTIFIED SEN census aggregate — AC GOV10-01/02/07/11/12. The pure category×sex reducer
 * (no DB) is unit-tested directly, and the `CensusSpecialNeeds` return type is asserted to be de-identified
 * BY CONSTRUCTION (a severity/diagnosis/student-id projection is a compile error, not a runtime check).
 *
 * The consent split (GRANTED counted in the DETAIL table, PENDING counted in the census only) is a property
 * of the READER's SQL (no consentState filter) — proven live + as a rolled-back DB round-trip in
 * scripts/verify-sen-register.ts. Here we pin the arithmetic and the de-id contract.
 */

const CATS = SEN_CATEGORIES;

describe("GOV10-01/07 · the taxonomy is the 6-bucket, 12-cell (6×2) grid — no severity dimension", () => {
  it("SEN_CATEGORIES is exactly the six census buckets incl. the OTHER residual", () => {
    expect([...CATS]).toEqual(["VISUAL", "HEARING", "PHYSICAL", "INTELLECTUAL", "SPEECH", "OTHER"]);
  });
  it("byCategory is 6 keys × {male,female} = 12 cells, and carries NO severity/detail key", () => {
    const empty = emptySenByCategory();
    expect(Object.keys(empty).sort()).toEqual([...CATS].sort());
    for (const c of CATS) {
      expect(Object.keys(empty[c]).sort()).toEqual(["female", "male"]);
    }
  });
});

describe("GOV10-01/11/12 · aggregateCensusSpecialNeeds — 6×2 buckets, sex-source, total == Σ 12 cells", () => {
  // One row per student (R415); GRANTED and PENDING alike reach here (the reader applies no consent filter).
  const rows: { category: SenCategory; sex: string }[] = [
    { category: "VISUAL", sex: "MALE" },
    { category: "VISUAL", sex: "MALE" },
    { category: "VISUAL", sex: "FEMALE" },
    { category: "HEARING", sex: "MALE" },
    { category: "PHYSICAL", sex: "FEMALE" },
    { category: "INTELLECTUAL", sex: "MALE" },
    { category: "SPEECH", sex: "FEMALE" },
    { category: "OTHER", sex: "MALE" },
    { category: "OTHER", sex: "FEMALE" },
    { category: "HEARING", sex: "UNKNOWN" }, // GOV10-11: a non-M/F sex is SKIPPED, never a fabricated cell
    { category: "VISUAL", sex: "" }, //         (guard for a widened sex domain)
  ];

  it("buckets each (category × sex) into the right cell", () => {
    const { byCategory } = aggregateCensusSpecialNeeds(rows);
    expect(byCategory.VISUAL).toEqual({ male: 2, female: 1 });
    expect(byCategory.HEARING).toEqual({ male: 1, female: 0 }); // the UNKNOWN-sex hearing row was skipped
    expect(byCategory.PHYSICAL).toEqual({ male: 0, female: 1 });
    expect(byCategory.INTELLECTUAL).toEqual({ male: 1, female: 0 });
    expect(byCategory.SPEECH).toEqual({ male: 0, female: 1 });
    expect(byCategory.OTHER).toEqual({ male: 1, female: 1 });
  });

  it("total == Σ the 12 cells == distinct M/F rows (the 2 unknown-sex rows are excluded from BOTH)", () => {
    const { byCategory, total } = aggregateCensusSpecialNeeds(rows);
    const cellSum = CATS.reduce((s, c) => s + byCategory[c].male + byCategory[c].female, 0);
    expect(total).toBe(cellSum);
    expect(total).toBe(9); // 11 rows − 2 non-M/F
  });

  it("an unknown category value is ignored defensively (never crashes, never a phantom bucket)", () => {
    const { byCategory, total } = aggregateCensusSpecialNeeds([
      { category: "GIFTED" as SenCategory, sex: "MALE" },
      { category: "VISUAL", sex: "MALE" },
    ]);
    expect(total).toBe(1);
    expect(byCategory.VISUAL).toEqual({ male: 1, female: 0 });
    expect((byCategory as Record<string, unknown>).GIFTED).toBeUndefined();
  });

  it("empty input → a captured zero: all 12 cells 0, still six buckets present", () => {
    const { byCategory, total } = aggregateCensusSpecialNeeds([]);
    expect(total).toBe(0);
    expect(Object.keys(byCategory).sort()).toEqual([...CATS].sort());
    for (const c of CATS) expect(byCategory[c]).toEqual({ male: 0, female: 0 });
  });
});

describe("GOV10-02/07 · the de-id compile-fence — CensusSpecialNeeds structurally cannot carry PII", () => {
  it("the payload is exactly {adopted, byCategory, total}; a PII projection is a TYPE error", () => {
    const sn: CensusSpecialNeeds = { adopted: true, byCategory: emptySenByCategory(), total: 0 };
    expect(Object.keys(sn).sort()).toEqual(["adopted", "byCategory", "total"]);

    // Each of these is UNREPRESENTABLE — tsc --noEmit fails if the @ts-expect-error is ever unused (i.e.
    // if the de-id type were ever widened to admit a confidential field). This IS the fence.
    // @ts-expect-error — no `severity` on the de-identified census payload (R408/R412)
    void sn.severity;
    // @ts-expect-error — no `diagnosisSource` on the de-identified census payload
    void sn.diagnosisSource;
    // @ts-expect-error — no `studentId` on the de-identified census payload
    void sn.studentId;
    // @ts-expect-error — no `studentName` on the de-identified census payload
    void sn.studentName;
    // @ts-expect-error — an excess PII field is rejected by the object-literal contract
    const bad: CensusSpecialNeeds = { adopted: true, byCategory: emptySenByCategory(), total: 0, severity: "SEVERE" };
    void bad;
  });
});
