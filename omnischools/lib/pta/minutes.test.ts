import { describe, it, expect } from "vitest";
import {
  adoptedFenceError,
  isAdopted,
  resolutionQuorumError,
  resolutionOutcome,
  resolutionHasVotes,
  ownerXorError,
  computeChairAccess,
  validateMinutesForReview,
  parseResolutionSeq,
  nextResolutionSeqStart,
  slugToken,
  resolutionScopeToken,
  formatResolutionNo,
  type AgendaItemForValidation,
} from "./minutes";
import { CHAIR_OFFICE } from "./minutes";
import { PTA_MEETING_BREAKGLASS_ROLES } from "@/lib/access";

// ── 🔴 R451 immutability fence ───────────────────────────────────────────────────────────────────────
describe("adoptedFenceError (🔴 R451 — the total-immutable fence)", () => {
  it("REFUSES any mutation once ADOPTED", () => {
    expect(isAdopted("ADOPTED")).toBe(true);
    expect(adoptedFenceError("ADOPTED")).toMatch(/adopted/i);
  });
  it("permits DRAFT + CHAIR_REVIEW", () => {
    expect(adoptedFenceError("DRAFT")).toBeNull();
    expect(adoptedFenceError("CHAIR_REVIEW")).toBeNull();
    expect(isAdopted("DRAFT")).toBe(false);
  });
});

// ── R452 quorum → resolution gate ────────────────────────────────────────────────────────────────────
describe("resolutionQuorumError (R452 — strictly quorum_met === true)", () => {
  it("permits ONLY a confirmed quorum", () => {
    expect(resolutionQuorumError(true)).toBeNull();
  });
  it("refuses NULL (undecided) and false (not met)", () => {
    expect(resolutionQuorumError(null)).toMatch(/quorum/i);
    expect(resolutionQuorumError(false)).toMatch(/quorum/i);
  });
});

// ── R448 outcome + vote presence ─────────────────────────────────────────────────────────────────────
describe("resolutionOutcome (R448 — PASSED ⟺ for > against)", () => {
  it("passes on a strict for-majority; a tie is NOT passed", () => {
    expect(resolutionOutcome(16, 3)).toBe("PASSED");
    expect(resolutionOutcome(3, 3)).toBe("NOT_PASSED");
    expect(resolutionOutcome(2, 5)).toBe("NOT_PASSED");
  });
  it("abstentions never tip the outcome", () => {
    expect(resolutionOutcome(4, 3)).toBe("PASSED"); // 10 abstain irrelevant
  });
});

describe("resolutionHasVotes", () => {
  it("an all-zero tally is NOT a recorded vote", () => {
    expect(resolutionHasVotes(0, 0, 0)).toBe(false);
    expect(resolutionHasVotes(0, 0, 1)).toBe(true);
    expect(resolutionHasVotes(16, 3, 2)).toBe(true);
  });
});

// ── R447 owner XOR ───────────────────────────────────────────────────────────────────────────────────
describe("ownerXorError (R447 — exactly one owner)", () => {
  it("accepts a person XOR an external name", () => {
    expect(ownerXorError("u1", null)).toBeNull();
    expect(ownerXorError(null, "Mrs O. Sarpong")).toBeNull();
  });
  it("rejects neither and both", () => {
    expect(ownerXorError(null, null)).toMatch(/exactly one/i);
    expect(ownerXorError(null, "   ")).toMatch(/exactly one/i);
    expect(ownerXorError("u1", "Mrs O. Sarpong")).toMatch(/exactly one/i);
  });
});

// ── R450 Chair adopt-access (no bare role) ───────────────────────────────────────────────────────────
describe("computeChairAccess (R450 — Chair by identity ∥ break-glass)", () => {
  it("🔴 NO bare role satisfies the Chair arm", () => {
    for (const role of ["TEACHER", "FORM_MASTER", "VICE_HEADMASTER_ACADEMIC", "PARENT"]) {
      expect(computeChairAccess({ heldOffices: [], viewer: { userId: "u-x", roles: [role] } })).toBe(false);
    }
  });
  it("a stored Chair (heldOffices includes 'Chair') adopts — identity, even as a PARENT", () => {
    expect(computeChairAccess({ heldOffices: [CHAIR_OFFICE], viewer: { userId: "u-chair", roles: ["PARENT"] } })).toBe(true);
  });
  it("a stored Secretary/Treasurer is NOT the Chair → refused", () => {
    expect(computeChairAccess({ heldOffices: ["Secretary", "Treasurer"], viewer: { userId: "u-s", roles: ["PARENT"] } })).toBe(false);
  });
  it("break-glass ADMIN / HEADMASTER adopt regardless of office", () => {
    for (const role of PTA_MEETING_BREAKGLASS_ROLES) {
      expect(computeChairAccess({ heldOffices: [], viewer: { userId: "u-a", roles: [role] } })).toBe(true);
    }
  });
  it("an unauthenticated viewer is refused", () => {
    expect(computeChairAccess({ heldOffices: ["Chair"], viewer: { userId: null, roles: ["ADMIN"] } })).toBe(true); // break-glass still wins
    expect(computeChairAccess({ heldOffices: ["Chair"], viewer: { userId: null, roles: ["PARENT"] } })).toBe(false);
  });
});

// ── R455 submit validation ───────────────────────────────────────────────────────────────────────────
const item = (over: Partial<AgendaItemForValidation> = {}): AgendaItemForValidation => ({
  classification: "DISCUSSION",
  action: null,
  resolution: null,
  ...over,
});

describe("validateMinutesForReview (R455)", () => {
  it("blocks an UNCLASSIFIED item", () => {
    const v = validateMinutesForReview([item(), item({ classification: null })], true);
    expect(v.canSubmit).toBe(false);
    expect(v.blocker).toMatch(/classified/i);
    expect(v.classifiedCount).toBe(1);
  });

  it("blocks an ownerless ACTION", () => {
    const v = validateMinutesForReview(
      [item({ classification: "ACTION", action: { hasOwner: false, hasDeadline: false } })],
      true,
    );
    expect(v.canSubmit).toBe(false);
    expect(v.blocker).toMatch(/owner/i);
  });

  it("blocks a vote-less RESOLUTION", () => {
    const v = validateMinutesForReview(
      [item({ classification: "RESOLUTION", resolution: { hasVotes: false } })],
      true,
    );
    expect(v.canSubmit).toBe(false);
    expect(v.blocker).toMatch(/vote/i);
  });

  it("blocks resolutions when quorum is NOT confirmed", () => {
    const v = validateMinutesForReview(
      [item({ classification: "RESOLUTION", resolution: { hasVotes: true } })],
      null,
    );
    expect(v.canSubmit).toBe(false);
    expect(v.blocker).toMatch(/quorum/i);
  });

  it("the deadline is ADVISORY — an Ongoing (no-deadline) action still submits", () => {
    const v = validateMinutesForReview(
      [item({ classification: "ACTION", action: { hasOwner: true, hasDeadline: false } })],
      true,
    );
    expect(v.canSubmit).toBe(true);
    expect(v.actionsWithDeadline).toBe(0);
    expect(v.blocker).toBeNull();
  });

  it("passes a fully-classified, owned, voted, quorate minute", () => {
    const v = validateMinutesForReview(
      [
        item({ classification: "DISCUSSION" }),
        item({ classification: "ACTION", action: { hasOwner: true, hasDeadline: true } }),
        item({ classification: "RESOLUTION", resolution: { hasVotes: true } }),
      ],
      true,
    );
    expect(v.canSubmit).toBe(true);
    expect(v.everyActionOwned && v.everyResolutionVoted && v.allClassified).toBe(true);
  });
});

// ── R453 resolution numbering ────────────────────────────────────────────────────────────────────────
describe("resolution numbering (R453 — assigned at adoption, MAX+1 per pta × period)", () => {
  it("parses the trailing NNN", () => {
    expect(parseResolutionSeq("FORM-2-GA-A-TERM-2-003")).toBe(3);
    expect(parseResolutionSeq(null)).toBeNull();
    expect(parseResolutionSeq("no-number-here")).toBeNull();
  });

  it("starts at 1 with no prior numbers, else MAX+1 (NULL drafts ignored)", () => {
    expect(nextResolutionSeqStart([])).toBe(1);
    expect(nextResolutionSeqStart([null, null])).toBe(1);
    expect(nextResolutionSeqStart(["X-T2-001", null, "X-T2-004", "X-T2-002"])).toBe(5);
  });

  it("scope token: FORM=class, HOUSE=house, GENERAL singleton, EMERGENCY pta-suffixed (collision-free)", () => {
    expect(resolutionScopeToken("FORM", "Form 2 General Arts A", null, "p1")).toBe("FORM-2-GENERAL-ARTS-A");
    expect(resolutionScopeToken("HOUSE", null, "Unity House", "p1")).toBe("UNITY-HOUSE");
    expect(resolutionScopeToken("GENERAL", null, null, "p1")).toBe("GENERAL");
    const a = resolutionScopeToken("EMERGENCY", null, null, "aaaaaaaa-1111");
    const b = resolutionScopeToken("EMERGENCY", null, null, "bbbbbbbb-2222");
    expect(a).not.toBe(b); // two Emergencies never collide at the school-level UNIQUE
  });

  it("formats {scope}-{period}-{NNN} zero-padded", () => {
    expect(formatResolutionNo("GENERAL", "2026-T2", 1)).toBe("GENERAL-2026-T2-001");
    expect(formatResolutionNo("FORM-2-GA-A", slugToken("Term 2"), 12)).toBe("FORM-2-GA-A-TERM-2-012");
  });
});
