import { describe, it, expect } from "vitest";
import {
  parseCensusHandFill,
  emptyCensusHandFill,
  CENSUS_HAND_FILL_VERSION,
} from "./hand-fill-schema";

/**
 * GOV-9 · the versioned hand-fill contract at the app boundary (AC GOV9-01/02). The DB column stays plain
 * jsonb (schema-free — no migration; the versioned Zod owns the shape). parseCensusHandFill:
 *   - null / undefined / a legacy empty {} → a FRESH versioned object {version:1} (every section a blank);
 *   - a populated, well-formed blob → validated and returned verbatim;
 *   - an unversioned / garbage / out-of-range blob → REJECTED (thrown).
 */

describe("GOV9-01/02 · schema-free versioning", () => {
  it("the hand-fill version is pinned at 1 (DB unchanged; the Zod owns the shape)", () => {
    expect(CENSUS_HAND_FILL_VERSION).toBe(1);
    expect(emptyCensusHandFill()).toEqual({ version: 1 });
  });
});

describe("GOV9-02 · null / empty → a fresh versioned object", () => {
  it("null → {version:1}", () => {
    expect(parseCensusHandFill(null)).toEqual({ version: 1 });
  });
  it("undefined → {version:1}", () => {
    expect(parseCensusHandFill(undefined)).toEqual({ version: 1 });
  });
  it("a legacy empty {} (a jsonb NULL that read back as {}) → {version:1}, not a validation error", () => {
    expect(parseCensusHandFill({})).toEqual({ version: 1 });
  });
});

describe("GOV9-02 · a populated blob validates and round-trips verbatim", () => {
  it("every non-SEN section + a COMPLETE 6-category §5 parses back to itself", () => {
    const blob = {
      version: 1,
      repetition: { male: 5, female: 3 },
      qualifications: { trainedMale: 8, trainedFemale: 0, untrainedMale: 0, untrainedFemale: 2 },
      movementExits: { withdrawals: 2, transfersIn: 1, transfersOut: 0 },
      feeding: { participates: true, pupilsFed: 120, caterer: "Ama Kitchen" },
      textbooks: { adequate: false, note: "Short on Integrated Science" },
      specialNeeds: {
        VISUAL: { male: 1, female: 0 },
        HEARING: { male: 0, female: 2 },
        PHYSICAL: { male: 0, female: 0 },
        INTELLECTUAL: { male: 0, female: 0 },
        SPEECH: { male: 0, female: 0 },
        OTHER: { male: 0, female: 0 },
      },
    };
    expect(parseCensusHandFill(blob)).toEqual(blob);
  });

  it("a captured all-zero repetition (a stated zero) is preserved, not dropped", () => {
    const blob = { version: 1, repetition: { male: 0, female: 0 } };
    expect(parseCensusHandFill(blob)).toEqual(blob);
  });
});

describe("GOV9-02 · a garbage / unversioned blob is REJECTED", () => {
  it("an UNVERSIONED blob (no `version`) throws", () => {
    expect(() => parseCensusHandFill({ repetition: { male: 1, female: 0 } })).toThrow();
  });
  it("a WRONG version literal (2) throws", () => {
    expect(() => parseCensusHandFill({ version: 2 })).toThrow();
  });
  it("a negative count is rejected (int().min(0))", () => {
    expect(() => parseCensusHandFill({ version: 1, repetition: { male: -1, female: 0 } })).toThrow();
  });
  it("a fractional count is rejected (int())", () => {
    expect(() => parseCensusHandFill({ version: 1, repetition: { male: 1.5, female: 0 } })).toThrow();
  });
  it("an unknown SEN category key is rejected", () => {
    expect(() =>
      parseCensusHandFill({ version: 1, specialNeeds: { MADE_UP: { male: 1, female: 0 } } }),
    ).toThrow();
  });
  it("a non-object scalar / array is rejected", () => {
    expect(() => parseCensusHandFill("nope")).toThrow();
    expect(() => parseCensusHandFill([1, 2, 3])).toThrow();
  });
});

/**
 * GOV9-08 · REGRESSION — the realistic not-adopted §5 case: a school with a single visually-impaired boy
 * enters ONE category. SPEC R423 / GOV9-08 requires "not-adopted → hand_fill.specialNeeds (plain de-id
 * counts) → grid". A subset of the 6 categories MUST be accepted and round-trip. (Currently RED: the schema
 * uses `z.record(z.enum(SEN_CATS), …)`, and Zod v4 requires ALL enum keys → a partial §5 hand-fill is
 * rejected, so saveCensusHandFill refuses the common single-category entry. See Quinn's MAJOR-1.)
 */
describe("GOV9-08 · a PARTIAL not-adopted §5 hand-fill (a subset of categories) must be accepted", () => {
  it("one category entered → accepted + round-trips (the realistic single-need case)", () => {
    const partial = { version: 1, specialNeeds: { VISUAL: { male: 1, female: 0 } } };
    expect(() => parseCensusHandFill(partial)).not.toThrow();
    expect(parseCensusHandFill(partial).specialNeeds).toEqual({ VISUAL: { male: 1, female: 0 } });
  });
});
