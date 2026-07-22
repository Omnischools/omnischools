import { describe, it, expect } from "vitest";
import { civilDate, insertColumns, sickbayMarkDate, updateColumns } from "./mark-rules";
import {
  ATTENDANCE_REASONS,
  ATTENDANCE_REASON_CODES,
  SICKBAY_REASON_CODE,
  reasonLabel,
} from "@/lib/attendance-reasons";
import type { MarkEntry } from "./mark-rules";

const entry = (over: Partial<MarkEntry> = {}): MarkEntry => ({
  studentId: "s1",
  classId: "c1",
  status: "ABSENT",
  reasonCode: null,
  note: null,
  ...over,
});

// ============================================================================
// R48 — the PULL arm's coercion is INSERT-ONLY, which is what makes a correction final
// ============================================================================

describe("R48 · coercion happens on INSERT and NEVER on UPDATE", () => {
  it("a held student's FIRST row of the day is written MEDICAL/SICKBAY, whatever the teacher pressed", () => {
    expect(insertColumns(entry({ status: "ABSENT" }), true)).toEqual({
      status: "MEDICAL",
      reasonCode: "SICKBAY",
      note: null,
    });
    expect(insertColumns(entry({ status: "PRESENT" }), true).status).toBe("MEDICAL");
  });

  it("an unheld student is written exactly as marked — day 1 of nothing changes for anyone else", () => {
    expect(insertColumns(entry({ status: "ABSENT", reasonCode: "SICK", note: "flu" }), false)).toEqual({
      status: "ABSENT",
      reasonCode: "SICK",
      note: "flu",
    });
  });

  it("H14 · the UPDATE branch is never coerced, so an approved correction is not re-applied", () => {
    // updateColumns takes no hold argument AT ALL — the rule is structural, not a forgotten branch.
    expect(updateColumns(entry({ status: "PRESENT" }))).toEqual({
      status: "PRESENT",
      reasonCode: null,
      note: null,
    });
  });

  it("PRESENT clears the reason and the note on both branches", () => {
    const e = entry({ status: "PRESENT", reasonCode: "SICK", note: "left early" });
    expect(updateColumns(e)).toEqual({ status: "PRESENT", reasonCode: null, note: null });
    expect(insertColumns(e, false)).toEqual({ status: "PRESENT", reasonCode: null, note: null });
  });

  it("🔒 A7 · a coerced row's note is null — never a complaint, never an impression", () => {
    const leaky = entry({ status: "ABSENT", note: "abdominal pain · query appendicitis" });
    expect(insertColumns(leaky, true).note).toBeNull();
  });
});

// ============================================================================
// R47 — today only, civil date Africa/Accra
// ============================================================================

describe("R47 · the sickbay writes TODAY and only today", () => {
  const now = new Date("2026-05-14T23:40:00Z");

  it("accepts a disposition stamped earlier the same civil day", () => {
    expect(sickbayMarkDate(new Date("2026-05-14T06:05:00Z"), now)).toBe("2026-05-14");
  });

  it("H12 · refuses yesterday — the writer never reaches into a past register", () => {
    expect(sickbayMarkDate(new Date("2026-05-13T23:59:00Z"), now)).toBeNull();
  });

  it("refuses tomorrow — a future mark is a clock fault, not an exemption", () => {
    expect(sickbayMarkDate(new Date("2026-05-15T00:01:00Z"), now)).toBeNull();
  });

  it("civilDate is the UTC calendar date (Ghana keeps UTC+0 all year, no DST)", () => {
    expect(civilDate(new Date("2026-05-14T23:59:59Z"))).toBe("2026-05-14");
    expect(civilDate(new Date("2026-05-15T00:00:00Z"))).toBe("2026-05-15");
  });
});

// ============================================================================
// R50 — `SICKBAY` is a label, never a picker option
// ============================================================================

describe("R50 · reason_code SICKBAY is system-only", () => {
  it("it is NOT in the teacher's picker, so a teacher cannot forge a clinical assertion", () => {
    expect(ATTENDANCE_REASONS.map((r) => r.code)).not.toContain(SICKBAY_REASON_CODE);
  });

  it("it is NOT in ATTENDANCE_REASON_CODES — the zod enum guarding saveAttendance's input", () => {
    expect([...ATTENDANCE_REASON_CODES]).not.toContain(SICKBAY_REASON_CODE);
  });

  it("it IS in the label map, so a per-student view never prints the raw code", () => {
    expect(reasonLabel(SICKBAY_REASON_CODE)).toBe("In sickbay");
  });

  it("the label names a LOCATION, never a condition", () => {
    // "In sickbay" says WHERE the student is. A class teacher who does not know WHY stops chasing a
    // child who cannot come — and no condition travels out of the module on this string.
    const label = reasonLabel(SICKBAY_REASON_CODE)!.toLowerCase();
    for (const condition of ["ill", "crisis", "fever", "malaria", "sickle", "asthma", "pain", "injur"]) {
      expect(label.includes(condition), condition).toBe(false);
    }
  });

  it("the five shipped picker reasons are untouched", () => {
    expect(ATTENDANCE_REASONS.map((r) => r.code)).toEqual([
      "SICK",
      "MEDICAL",
      "FAMILY",
      "TRAVEL",
      "OTHER",
    ]);
    expect(reasonLabel("SICK")).toBe("Sick");
    expect(reasonLabel(null)).toBeNull();
    expect(reasonLabel("WHATEVER")).toBe("WHATEVER");
  });
});
