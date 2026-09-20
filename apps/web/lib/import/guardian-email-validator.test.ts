import { describe, it, expect } from "vitest";
import { validateStudentRows, guardianEmailSchema } from "@/lib/import/student-import";

/**
 * #308 — the CSV preview validator (client) once used a looser regex than the server's Zod
 * `.email()`, so the review table could mark a row "Ready" that the server then rejected.
 * Both sides now route through `guardianEmailSchema`. This test proves it: for every case it
 * runs the REAL preview path (`validateStudentRows`) and the REAL server schema object (the
 * one `lib/actions/students.ts` imports) and asserts they accept/reject identically.
 */
describe("guardian email · preview validator agrees with server schema (#308)", () => {
  // First,Last,Other,Gender,DOB,Class,GuardianName,GuardianPhone,Relationship — clean base.
  const base = ["Ama", "Boateng", "", "F", "", "", "Ama Boateng", "0241112222", "Mother"];

  // The preview accepts an email when the row has no email-related error.
  const previewAccepts = (email: string) => {
    const { rows } = validateStudentRows([[...base, email]], {});
    return !rows[0].errors.includes("Guardian email is invalid");
  };
  const serverAccepts = (email: string) => guardianEmailSchema.safeParse(email).success;

  const cases: { email: string; valid: boolean }[] = [
    // valid
    { email: "a@b.co", valid: true },
    { email: "x.y+z@sub.example.com", valid: true },
    { email: "ama@example.com", valid: true },
    { email: "", valid: true }, // optional — blank stays valid on both
    // invalid
    { email: "no-at", valid: false },
    { email: "a@b", valid: false }, // no TLD
    { email: "a@ b.c", valid: false }, // space
    { email: "a@b.c", valid: false }, // 1-char TLD — the old regex accepted this, server didn't
    { email: "a@b.123", valid: false }, // numeric TLD
    { email: ".a@b.co", valid: false }, // leading dot
    { email: "a@b..com", valid: false }, // consecutive dots
  ];

  it.each(cases)("preview and server agree on $email", ({ email, valid }) => {
    const p = previewAccepts(email);
    const s = serverAccepts(email);
    expect(p).toBe(s); // no divergence
    expect(p).toBe(valid); // and both match the expected verdict
  });

  it("blank guardian email is valid on both (optional field)", () => {
    expect(previewAccepts("")).toBe(true);
    expect(serverAccepts("")).toBe(true);
  });
});
