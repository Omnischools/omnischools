import { describe, it, expect } from "vitest";
import { MAX_PERCENT } from "./compute";
import {
  LOW_CONF_FLAG,
  LOW_CONF_FLOOR,
  bandCell,
  scaleExtractedCell,
  diffCell,
  reasonRequiredForCommit,
  mapRosterRows,
  type BandedCell,
  type RosterStudent,
} from "./scan-diff";

const banded = (value: number | null, band: BandedCell["band"] = "ACCEPTED"): BandedCell => ({
  band,
  value,
});

// ---------------------------------------------------------------- A · denominator scaling
describe("scaleExtractedCell (A · denominator scaling)", () => {
  it("A1 portfolio /10, raw 8 → 80", () => {
    expect(scaleExtractedCell(8, 10)).toBe(80);
  });
  it("A2 assignment /100, raw 72 → 72", () => {
    expect(scaleExtractedCell(72, 100)).toBe(72);
  });
  it("A3 fallback /100 never inflates: raw 8 → 8", () => {
    expect(scaleExtractedCell(8, 100)).toBe(8);
  });
  it("A5 /10 raw 850 → capped at MAX_PERCENT, no overflow", () => {
    expect(scaleExtractedCell(850, 10)).toBe(MAX_PERCENT);
  });
  it("A6 raw blank → null, not 0", () => {
    expect(scaleExtractedCell(null, 10)).toBeNull();
  });
  it("A7 non-positive denominator → null (defence in depth behind the CHECK)", () => {
    expect(scaleExtractedCell(8, 0)).toBeNull();
    expect(scaleExtractedCell(8, -10)).toBeNull();
  });
});

// ---------------------------------------------------------------- C · confidence bands
describe("bandCell (C · confidence bands, Q2)", () => {
  it("C1 ≥0.85 → ACCEPTED, value kept", () => {
    expect(bandCell(80, 0.85)).toEqual({ band: "ACCEPTED", value: 80 });
    expect(bandCell(80, 0.99)).toEqual({ band: "ACCEPTED", value: 80 });
  });
  it("C2 [0.60,0.85) → LOW_CONF, value kept but must be reviewed", () => {
    expect(bandCell(80, 0.6)).toEqual({ band: "LOW_CONF", value: 80 });
    expect(bandCell(80, 0.84)).toEqual({ band: "LOW_CONF", value: 80 });
  });
  it("C3 <0.60 → BLANK, the sub-floor guess is dropped (never a possibly-wrong number)", () => {
    expect(bandCell(80, 0.59)).toEqual({ band: "BLANK", value: null });
    expect(bandCell(80, 0)).toEqual({ band: "BLANK", value: null });
  });
  it("a blank read is BLANK regardless of confidence", () => {
    expect(bandCell(null, 0.99)).toEqual({ band: "BLANK", value: null });
  });
  it("the band thresholds are the ruled constants", () => {
    expect(LOW_CONF_FLAG).toBe(0.85);
    expect(LOW_CONF_FLOOR).toBe(0.6);
  });
});

// ---------------------------------------------------------------- B · four diff cases
describe("diffCell (B · four diff cases, Q3)", () => {
  it("B1 committed blank + extracted ≥0.85 → SILENT_ACCEPT (gold, no reason)", () => {
    const d = diffCell(null, banded(64, "ACCEPTED"));
    expect(d.kind).toBe("SILENT_ACCEPT");
    expect(d.reasonRequired).toBe(false);
    expect(d.forcesReview).toBe(false);
    expect(d.severity).toBe("gold");
  });
  it("B2 committed == extracted → UNCHANGED, no flag", () => {
    expect(diffCell(70, banded(70)).kind).toBe("UNCHANGED");
    expect(diffCell(null, banded(null, "BLANK")).kind).toBe("UNCHANGED");
  });
  it("B3 76 → 73 → SCORE_DOWN, reason required, warn", () => {
    const d = diffCell(76, banded(73));
    expect(d.kind).toBe("SCORE_DOWN");
    expect(d.reasonRequired).toBe(true);
    expect(d.forcesReview).toBe(true);
    expect(d.severity).toBe("warn");
  });
  it("B4 71 → 74 @≥0.85 → REVIEW, NO reason", () => {
    const d = diffCell(71, banded(74, "ACCEPTED"));
    expect(d.kind).toBe("REVIEW");
    expect(d.reasonRequired).toBe(false);
    expect(d.forcesReview).toBe(true);
  });
  it("B5 82 → blank → GONE_MISSING, never auto-nulls (terra, forces review)", () => {
    const d = diffCell(82, banded(null, "BLANK"));
    expect(d.kind).toBe("GONE_MISSING");
    expect(d.forcesReview).toBe(true);
    expect(d.severity).toBe("terra");
  });
  it("B6 71 → 74 @0.60–0.85 → REVIEW (forced, not silent)", () => {
    const d = diffCell(71, banded(74, "LOW_CONF"));
    expect(d.kind).toBe("REVIEW");
    expect(d.forcesReview).toBe(true);
  });
  it("B7 blank → val @0.60–0.85 → REVIEW, not SILENT_ACCEPT (low-conf overrides)", () => {
    const d = diffCell(null, banded(64, "LOW_CONF"));
    expect(d.kind).toBe("REVIEW");
    expect(d.forcesReview).toBe(true);
    expect(d.severity).toBe("warn");
  });
});

describe("reasonRequiredForCommit (B8 · the authoritative server check, Q4)", () => {
  it("score-down needs a reason", () => {
    expect(reasonRequiredForCommit(76, 73)).toBe(true);
  });
  it("Case-D keep-blank (committed → blank) needs a reason", () => {
    expect(reasonRequiredForCommit(82, null)).toBe(true);
  });
  it("score-up needs NO reason", () => {
    expect(reasonRequiredForCommit(71, 74)).toBe(false);
  });
  it("blank → filled needs NO reason", () => {
    expect(reasonRequiredForCommit(null, 64)).toBe(false);
  });
  it("unchanged / keep-old needs NO reason", () => {
    expect(reasonRequiredForCommit(70, 70)).toBe(false);
    expect(reasonRequiredForCommit(null, null)).toBe(false);
  });
});

// ---------------------------------------------------------------- D · roster mapping
describe("mapRosterRows (D · roster mapping, Q5)", () => {
  const roster: RosterStudent[] = [
    { id: "akwasi", firstName: "Akwasi", lastName: "Boateng" },
    { id: "abena", firstName: "Abena", lastName: "Boateng" },
    { id: "ama", firstName: "Ama", lastName: "Asante" },
    { id: "daniel", firstName: "Daniel", lastName: "Owusu" },
  ];

  it("D1 'A. Boateng' with Akwasi + Abena → ambiguous, blocks, no auto-pick", () => {
    const res = mapRosterRows([{ readName: "A. Boateng", studentId: "akwasi" }], roster);
    expect(res.rows[0].status).toBe("ambiguous");
    expect(res.ok).toBe(false);
  });
  it("D2 a name matching no active student → unmapped, no commit until resolved", () => {
    const res = mapRosterRows([{ readName: "K. Mensah" }], roster);
    expect(res.rows[0].status).toBe("unmapped");
    expect(res.ok).toBe(false);
  });
  it("D4 two rows → the same student → duplicate, blocks", () => {
    const res = mapRosterRows(
      [{ readName: "Ama Asante" }, { readName: "Ama Asante" }],
      roster,
    );
    expect(res.duplicateStudentIds).toContain("ama");
    expect(res.ok).toBe(false);
  });
  it("D5 unambiguous full names → all mapped, commit proceeds", () => {
    const res = mapRosterRows(
      [
        { readName: "Akwasi Boateng" },
        { readName: "Ama Asante" },
        { readName: "D. Owusu" },
      ],
      roster,
    );
    expect(res.rows.map((r) => r.status)).toEqual(["mapped", "mapped", "mapped"]);
    expect(res.ok).toBe(true);
  });
});
