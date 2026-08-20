import { describe, it, expect } from "vitest";
import { summariseMarks, type EffectiveMark } from "./mark-rules";
import { SICKBAY_REASON_CODE } from "@/lib/attendance-reasons";
import { readCode } from "@/lib/test-utils/source-shape";

/**
 * #265 — owner OC-MED-NOTIFY = NO. A teacher-marked Medical must NOT trigger a parent notification;
 * this is audit-EXPLICITNESS only, no new SMS. Kofi's discriminator: a Medical row is sickbay-owned
 * iff `status === "MEDICAL" && reasonCode === SICKBAY_REASON_CODE`; teacher-marked iff MEDICAL with
 * any other/absent reason code.
 */

const row = (over: Partial<EffectiveMark>): EffectiveMark => ({
  studentId: "s?",
  status: "ABSENT",
  reasonCode: null,
  ...over,
});

// ============================================================================
// AC-265-1 / AC-265-5 — the suppression is correct AND the split is derivable (behavioural)
// ============================================================================

describe("AC-265-1/5 · summariseMarks splits the effective rows the DB stored (R49b)", () => {
  const marked: EffectiveMark[] = [
    row({ studentId: "a", status: "ABSENT" }),
    row({ studentId: "b", status: "ABSENT", reasonCode: "TRAVEL" }),
    row({ studentId: "c", status: "MEDICAL", reasonCode: "MEDICAL" }), // teacher: medical appointment
    row({ studentId: "d", status: "MEDICAL", reasonCode: "SICK" }), //    teacher: illness
    row({ studentId: "e", status: "MEDICAL", reasonCode: null }), //       teacher: no reason
    row({ studentId: "f", status: "MEDICAL", reasonCode: SICKBAY_REASON_CODE }), // sickbay-owned (R48 coerced)
    row({ studentId: "g", status: "PRESENT" }),
    row({ studentId: "h", status: "LATE" }),
    row({ studentId: "i", status: "EXCUSED" }),
  ];
  const s = summariseMarks(marked);

  it("a MEDICAL row is NEVER in absentStudentIds — no 'marked absent' SMS can reach it (AC-265-1)", () => {
    expect(s.absentStudentIds).toEqual(["a", "b"]);
    for (const id of ["c", "d", "e", "f"]) {
      expect(s.absentStudentIds, `medical ${id} must not be absent`).not.toContain(id);
    }
  });

  it("teacher-marked Medical (any non-sickbay reason) is counted as suppressed, not deferred", () => {
    expect(s.medicalTeacherMarked).toBe(3); // c, d, e
  });

  it("sickbay-owned Medical (reasonCode SICKBAY) is counted as deferred to #280 (AC-265-5)", () => {
    expect(s.medicalSickbayDeferred).toBe(1); // f
  });

  it("🔒 A7 · the summary carries COUNTS only — no reasonCode/note/clinical string leaks out", () => {
    // studentIds are the absent list (already messaged by design); the medical arms are pure tallies.
    expect(Object.keys(s).sort()).toEqual([
      "absentStudentIds",
      "medicalSickbayDeferred",
      "medicalTeacherMarked",
    ]);
    expect(typeof s.medicalTeacherMarked).toBe("number");
    expect(typeof s.medicalSickbayDeferred).toBe("number");
  });

  it("an all-present / empty register produces no absent and no medical", () => {
    expect(summariseMarks([])).toEqual({
      absentStudentIds: [],
      medicalTeacherMarked: 0,
      medicalSickbayDeferred: 0,
    });
  });
});

// ============================================================================
// AC-265-2 — the audit `after` payload records the split (source-shape mutation lock)
// ============================================================================

describe("AC-265-2 · saveAttendance's audit payload carries the MEDICAL split", () => {
  const src = () => readCode("lib/actions/attendance.ts");

  /** The body of the `actionType: "marked"` recordAudit call, up to its reason. */
  const markedAudit = (s: string): string => {
    const at = s.indexOf('actionType: "marked"');
    expect(at, "the register-save audit exists").toBeGreaterThan(-1);
    const end = s.indexOf('reason: "Attendance taken"', at);
    return s.slice(at, end === -1 ? undefined : end);
  };

  it("the absent list is derived from summariseMarks(res.marked) — the EFFECTIVE rows, not d.entries", () => {
    // This is what makes the SMS suppression structural: the guardian loop only ever iterates the
    // absent list, and a MEDICAL row can never be in it (proven behaviourally above).
    expect(src()).toContain("summariseMarks(res.marked)");
  });

  it("records medicalTeacherMarked — removing it from the payload reds this test (mutation-check)", () => {
    expect(markedAudit(src())).toContain("medicalTeacherMarked");
  });

  it("records medicalSickbayDeferred — removing it from the payload reds this test (mutation-check)", () => {
    expect(markedAudit(src())).toContain("medicalSickbayDeferred");
  });
});

// ============================================================================
// AC-265-7 — no leakage: the sickbay mark writer sends NO attendance SMS (grep guard)
// ============================================================================

describe("AC-265-7 · lib/attendance/mark.ts never touches the SMS path — that stays #280's job", () => {
  const src = readCode("lib/attendance/mark.ts");

  it("does not import @/lib/sms", () => {
    expect(src).not.toContain("@/lib/sms");
  });

  it("does not call sendSms", () => {
    expect(src).not.toMatch(/\bsendSms\b/);
  });
});
