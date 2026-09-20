import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";

/**
 * WASSCE subject-teacher page · persona/CPD de-fabrication (follow-up to #268). The §01 block hardcoded a
 * fake teacher "Mr S. Asiedu" + NTC licence + PLC count + invented role chips, and §05 an invented CPD
 * record — all shown to every teacher as their own (R90). Kofi ruled: replace the name/initials with the
 * SESSION user (the only field with a real source); omit-not-fake everything else (NTC/PLC/CPD are
 * R404-deferred, "dropped not faked"). This locks that.
 */
const src = readFileSync(resolve(cwd(), "app/(app)/senior/wassce/subject/page.tsx"), "utf8");

describe("WASSCE persona/CPD de-fabrication", () => {
  it("the fabricated identity + NTC/PLC/CPD strings are gone (AC-PERSONA-1/4/5/6/8)", () => {
    for (const fake of [
      "Asiedu",
      "GA-TL-78423",
      "valid to 2028",
      "Form Master",
      "HOD Science",
      "12 sessions YTD",
      "142 lessons",
      "18 mock",
      "CPD record",
      "+15 CPD",
      "renewal eligible",
      "Slessor",
    ]) {
      expect(src, `fabricated string "${fake}" must be gone`).not.toContain(fake);
    }
  });

  it("the persona renders the REAL session user's name + initials (AC-PERSONA-1/2/3)", () => {
    expect(src).toMatch(/\{initialsOf\(user\.name\)\}/); // real avatar initials
    expect(src).toMatch(/\{user\.name \?\? "—"\}/); // real name, honest em-dash fallback (no invented person)
    expect(src).toMatch(/const initialsOf = /); // the helper exists
  });

  it("the honest derived fields survive (AC-PERSONA-7)", () => {
    expect(src).toMatch(/Subject<\/b> · \{subjectName\}/);
    expect(src).toMatch(/WASSCE \{data\.cohort\.examYear\}/); // derived cohort year, not a hardcoded form
    expect(src).toMatch(/\{s\.candidates\} candidates assigned/);
  });

  it("no cell claims a '(seeded)' source that feeds no value (AC-PERSONA-9)", () => {
    expect(src).not.toMatch(/\(seeded\)/);
  });

  it("the docblock no longer endorses the fabrication as SEEDED/STATIC (AC-PERSONA-10)", () => {
    expect(src).not.toMatch(/CPD\/NTC\/practical fields render SEEDED\/STATIC/);
    expect(src).toMatch(/persona is the SESSION user/);
  });

  it("the cohort form in the header is DERIVED (F3/F2 by frozen), not hardcoded", () => {
    expect(src).toMatch(/const cohortForm = data\.cohort\.frozen \? "F3" : "F2"/);
    expect(src).not.toContain("· F3 Science"); // the hardcoded breadcrumb stream is gone
    expect(src).not.toMatch(/text-gold">F3<\/em>/); // the hardcoded form label is gone
    expect(src).toMatch(/\{cohortForm\}/); // both header spots use the derived value
  });
});
