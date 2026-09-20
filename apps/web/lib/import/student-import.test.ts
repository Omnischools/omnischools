import { describe, it, expect } from "vitest";
import { validateStudentRows, STUDENT_IMPORT_HEADERS } from "@/lib/import/student-import";

/**
 * Guardian-email column on the student CSV bulk-import (follow-up to the profile-page guardian email).
 * Appended as the LAST column so an older 9-column CSV stays valid (relationship keeps its index).
 */
describe("student CSV import · guardian email column", () => {
  const noClasses: Record<string, string> = {};
  // A clean, error-free base row (First,Last,Other,Gender,DOB,Class,GuardianName,GuardianPhone,Relationship).
  const base = ["Ama", "Boateng", "", "F", "", "", "Ama Boateng", "0241112222", "Mother"];

  it("appends 'Guardian email' as the last template column", () => {
    expect(STUDENT_IMPORT_HEADERS).toContain("Guardian email");
    expect(STUDENT_IMPORT_HEADERS[STUDENT_IMPORT_HEADERS.length - 1]).toBe("Guardian email");
  });

  it("accepts a valid guardian email and carries it onto the row", () => {
    const { rows } = validateStudentRows([[...base, "ama@example.com"]], noClasses);
    expect(rows[0].guardianEmail).toBe("ama@example.com");
    expect(rows[0].errors).toHaveLength(0);
  });

  it("flags an invalid guardian email as an error", () => {
    const { rows } = validateStudentRows([[...base, "not-an-email"]], noClasses);
    expect(rows[0].errors).toContain("Guardian email is invalid");
  });

  it("treats an absent (old 9-column CSV) or blank email as fine — optional, backward-compatible", () => {
    const legacy = validateStudentRows([base], noClasses); // no 10th column at all
    expect(legacy.rows[0].guardianEmail).toBe("");
    expect(legacy.rows[0].errors).toHaveLength(0);
    const blank = validateStudentRows([[...base, ""]], noClasses);
    expect(blank.rows[0].errors).toHaveLength(0);
  });
});
