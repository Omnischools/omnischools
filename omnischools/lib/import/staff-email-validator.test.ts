import { describe, it, expect } from "vitest";
import { validateStaffRows, staffEmailSchema } from "@/lib/import/staff-import";

/**
 * #318 (same class as #308) — the STAFF CSV preview validator (client) once used a looser regex
 * than the server's Zod `.email()`, so the review table could mark a row "Ready" that the server
 * then rejected, failing the batch. Both sides now route through `staffEmailSchema` (the object
 * `lib/actions/staff.ts` imports for add/edit/import). This test proves it: for every case it runs
 * the REAL preview path (`validateStaffRows`) and the REAL server schema and asserts they
 * accept/reject identically. Staff email is OPTIONAL (blank stays valid) and uncapped — no
 * `.max(160)`, unlike the guardian schema.
 */
describe("staff email · preview validator agrees with server schema (#318)", () => {
  // Full name, Phone (login), Email, Role — clean base so email is the only possible error.
  const base = ["Ama Owusu", "0244000001", "", "Teacher"];

  // The preview accepts an email when the row has no email error.
  const previewAccepts = (email: string) => {
    const cells = [...base];
    cells[2] = email;
    const { rows } = validateStaffRows([cells]);
    return !rows[0].errors.includes("Email is invalid");
  };
  const serverAccepts = (email: string) => staffEmailSchema.safeParse(email).success;

  const cases: { email: string; valid: boolean }[] = [
    // valid
    { email: "a@b.co", valid: true },
    { email: "x.y+z@sub.example.com", valid: true },
    { email: "ama.owusu@example.com", valid: true },
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

  it("blank staff email is valid on both (optional field)", () => {
    expect(previewAccepts("")).toBe(true);
    expect(serverAccepts("")).toBe(true);
  });

  // #318 guard: staff email is UNCAPPED (unlike the guardian schema's .max(160)). A 200+ char
  // otherwise-valid email must be accepted by BOTH preview and server — proves no length cap was
  // silently borrowed from the guardian schema, which would re-open divergence for 161+ char emails.
  it("does not silently cap staff email length (no 160 regression)", () => {
    const long = "a".repeat(190) + "@example.com"; // 202 chars, well over 160
    expect(long.length).toBeGreaterThan(160);
    expect(previewAccepts(long)).toBe(true);
    expect(serverAccepts(long)).toBe(true);
  });
});
