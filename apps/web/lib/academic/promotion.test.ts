import { describe, it, expect } from "vitest";
import { comparePromotionRows } from "./promotion";

/**
 * #320 · promotion-preview rows must order on the Ghanaian ladder (KG<Primary<JHS<SHS, numeric
 * within tier), NOT lexically on the class label — the #305 mixed-ladder bug class. The old SQL
 * `asc(currentClassLabel)` put "JHS 1" before "Primary 2" and "Primary 10" before "Primary 2".
 */
type Row = { fromLevel: string | null; fromClass: string };

describe("comparePromotionRows · canonical ladder order", () => {
  it("orders a mixed-ladder set by tier then numeric year, streams grouped, nulls last", () => {
    // Deliberately in lexical order — the exact ordering the SQL bug produced.
    const input: Row[] = [
      { fromLevel: "JHS 1", fromClass: "JHS 1 A" },
      { fromLevel: "JHS 1", fromClass: "JHS 1 B" }, // two streams in one year-group
      { fromLevel: "KG 1", fromClass: "KG 1 A" },
      { fromLevel: "Primary 10", fromClass: "Primary 10 Red" }, // two-digit year
      { fromLevel: "Primary 2", fromClass: "Primary 2 Blue" },
      { fromLevel: "SHS 1", fromClass: "SHS 1 Science" }, // senior tier
      { fromLevel: null, fromClass: "—" }, // UNMATCHED / level-less → last
    ];

    const out = [...input].sort(comparePromotionRows).map((r) => r.fromClass);

    expect(out).toEqual([
      "KG 1 A",
      "Primary 2 Blue",
      "Primary 10 Red", // numeric, not lexical: 2 before 10
      "JHS 1 A",
      "JHS 1 B", // streams within JHS 1 stay grouped and ordered
      "SHS 1 Science", // SHS after JHS
      "—", // null level buckets last
    ]);
  });

  it("is stable within an identical level+class (keeps the SQL lastName order)", () => {
    const input: Row[] = [
      { fromLevel: "JHS 1", fromClass: "JHS 1 A" }, // Adjei
      { fromLevel: "JHS 1", fromClass: "JHS 1 A" }, // Boateng
    ];
    // Same key → comparator returns 0 → input order preserved.
    expect(input.slice().sort(comparePromotionRows)).toEqual(input);
    expect(comparePromotionRows(input[0], input[1])).toBe(0);
  });
});
