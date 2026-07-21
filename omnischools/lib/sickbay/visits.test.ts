import { describe, it, expect } from "vitest";
import {
  DISPOSITION_LABEL,
  civilDate,
  dispositionGuard,
  formatElapsed,
  isolationGuard,
  isOpen,
  isQueued,
  referralOnlyGuard,
  visitState,
  voidGuard,
  waitMs,
  type SickbayDisposition,
  type VisitTimeline,
} from "./visits";
import {
  hasAnyRole,
  SICKBAY_CLINICAL_READ_ROLES,
  SICKBAY_CLINICAL_WRITE_ROLES,
  SICKBAY_ROLES,
} from "@/lib/access";

const at = (iso: string) => new Date(iso);
const PRESENTED = at("2026-05-14T09:11:00Z");

/** A visit exactly as the row reads at each stage — no status column exists to consult (R32). */
function visit(over: Partial<VisitTimeline> = {}): VisitTimeline {
  return {
    presentedAt: PRESENTED,
    startedAt: null,
    disposition: null,
    dispositionAt: null,
    voidedAt: null,
    ...over,
  };
}
const closed = (d: SickbayDisposition): VisitTimeline =>
  visit({ startedAt: at("2026-05-14T09:14:00Z"), disposition: d, dispositionAt: at("2026-05-14T09:40:00Z") });

// ============================================================================
// V1–V4 · R32 — the state is derived from the timestamps, and from nothing else
// ============================================================================

describe("visitState (R32 — seven states from four timestamps + the admission)", () => {
  it("V1 no started_at → QUEUED; started_at → IN_PROGRESS", () => {
    expect(visitState(visit())).toBe("QUEUED");
    expect(visitState(visit({ startedAt: at("2026-05-14T09:14:00Z") }))).toBe("IN_PROGRESS");
  });

  it("V2 each disposition closes the visit into its own state", () => {
    expect(visitState(closed("DISCHARGE"))).toBe("DISCHARGED");
    expect(visitState(closed("REFER"))).toBe("REFERRED");
    expect(visitState(closed("ADMIT"), { dischargedAt: null })).toBe("ADMITTED");
  });

  it("V3 ADMIT + the admission's discharged_at → ON_WARD_DISCHARGED, disposition UNCHANGED", () => {
    const v = closed("ADMIT");
    expect(visitState(v, { dischargedAt: at("2026-05-14T16:02:00Z") })).toBe("ON_WARD_DISCHARGED");
    // R36 — the visit's OUTCOME was an admission; ward discharge does not rewrite it.
    expect(v.disposition).toBe("ADMIT");
  });

  it("V4 voided_at wins over every other timestamp", () => {
    expect(visitState(visit({ voidedAt: at("2026-05-14T09:20:00Z") }))).toBe("VOIDED");
    expect(
      visitState(visit({ startedAt: at("2026-05-14T09:14:00Z"), voidedAt: at("2026-05-14T09:20:00Z") })),
    ).toBe("VOIDED");
  });

  it("a missing admission row does not turn an ADMIT into a discharge", () => {
    expect(visitState(closed("ADMIT"))).toBe("ADMITTED");
    expect(visitState(closed("ADMIT"), null)).toBe("ADMITTED");
  });

  it("isOpen is disposition IS NULL AND voided_at IS NULL — the partial-unique predicate", () => {
    expect(isOpen(visit())).toBe(true);
    expect(isOpen(closed("DISCHARGE"))).toBe(false);
    expect(isOpen(visit({ voidedAt: PRESENTED }))).toBe(false);
  });
});

// ============================================================================
// V5–V6 · R33 — the queue predicate and the wait clock
// ============================================================================

describe("queue (R33)", () => {
  const now = at("2026-05-14T14:45:00Z");

  it("V5 queued = not voided, not started, no disposition, presented TODAY", () => {
    expect(isQueued(visit(), now)).toBe(true);
    expect(isQueued(visit({ startedAt: at("2026-05-14T09:14:00Z") }), now)).toBe(false);
    expect(isQueued(closed("DISCHARGE"), now)).toBe(false);
    expect(isQueued(visit({ voidedAt: now }), now)).toBe(false);
    // yesterday's forgotten open visit is still OPEN, but it is not "waiting now"
    expect(isQueued(visit({ presentedAt: at("2026-05-13T09:11:00Z") }), now)).toBe(false);
  });

  it("V6 the wait clock STOPS at Begin visit, not at assessment", () => {
    expect(waitMs(visit(), now)).toBe(334 * 60_000); // 09:11 → 14:45
    const begun = visit({ startedAt: at("2026-05-14T09:14:00Z") });
    expect(waitMs(begun, now)).toBe(3 * 60_000); // frozen at 09:14, not still counting
    expect(waitMs(begun, at("2026-05-14T23:00:00Z"))).toBe(3 * 60_000);
  });

  it("civilDate is the Accra date (UTC+0, no DST) and formatElapsed zero-pads the hours", () => {
    expect(civilDate(at("2026-05-14T23:59:00Z"))).toBe("2026-05-14");
    expect(formatElapsed(waitMs(visit(), at("2026-05-14T14:45:00Z")))).toBe("05h 34m");
    expect(formatElapsed(0)).toBe("00h 00m");
  });
});

// ============================================================================
// V7–V10 · W1–W4 · R34/R36/R55 — the disposition guard
// ============================================================================

describe("dispositionGuard (R34 preconditions · R36 immutability · R55 mode)", () => {
  const ctx = { attendingIsMatron: true, admissionsAllowed: true };
  const ready = {
    ...visit({ startedAt: at("2026-05-14T09:14:00Z") }),
    presentingComplaint: "Joint pain — knees, lower back, both wrists.",
    workingImpression: null as string | null,
  };

  it("V7 all four preconditions must hold", () => {
    expect(dispositionGuard({ ...ready, startedAt: null }, "DISCHARGE", ctx)).toMatch(/Begin the visit/);
    expect(dispositionGuard({ ...ready, presentingComplaint: "   " }, "DISCHARGE", ctx)).toMatch(
      /presenting complaint/,
    );
    expect(
      dispositionGuard({ ...ready }, "DISCHARGE", { ...ctx, attendingIsMatron: false }),
    ).toMatch(/Matron role in this school/);
    expect(dispositionGuard(ready, "DISCHARGE", ctx)).toBeNull();
  });

  it("W1–W3 working_impression is required for ADMIT and REFER, NOT for DISCHARGE", () => {
    expect(dispositionGuard(ready, "DISCHARGE", ctx)).toBeNull();
    expect(dispositionGuard(ready, "ADMIT", ctx)).toMatch(/working impression before you admit/);
    expect(dispositionGuard(ready, "REFER", ctx)).toMatch(/working impression before you refer/);
    const assessed = { ...ready, workingImpression: "Mild vaso-occlusive pain crisis" };
    expect(dispositionGuard(assessed, "ADMIT", ctx)).toBeNull();
    expect(dispositionGuard(assessed, "REFER", ctx)).toBeNull();
    // whitespace is not an impression
    expect(dispositionGuard({ ...ready, workingImpression: "  " }, "REFER", ctx)).not.toBeNull();
  });

  it("W4 the ceiling is a REQUIREMENT, never a vocabulary — no code list, no `diagnos*`", () => {
    const all = [
      dispositionGuard(ready, "ADMIT", ctx),
      dispositionGuard(ready, "REFER", ctx),
      dispositionGuard(ready, "DISCHARGE", { ...ctx, attendingIsMatron: false }),
      dispositionGuard(ready, "ADMIT", { ...ctx, admissionsAllowed: false }),
      voidGuard(visit(), ""),
      referralOnlyGuard([3]),
      isolationGuard(true, false),
    ].join(" ");
    expect(all.toLowerCase()).not.toMatch(/diagnos/);
  });

  it("V8 R36 — a disposition is immutable once set, for every pair", () => {
    for (const set of ["DISCHARGE", "ADMIT", "REFER"] as const) {
      for (const next of ["DISCHARGE", "ADMIT", "REFER"] as const) {
        const err = dispositionGuard(
          { ...ready, disposition: set, dispositionAt: at("2026-05-14T09:40:00Z") },
          next,
          ctx,
        );
        expect(err).toBe(
          `This visit is already closed as ${DISPOSITION_LABEL[set]} and cannot be changed.`,
        );
      }
    }
  });

  it("M1 R55 — Mode C refuses ADMIT with a NAMED reason, and still allows DISCHARGE and REFER", () => {
    const modeC = { attendingIsMatron: true, admissionsAllowed: false };
    const assessed = { ...ready, workingImpression: "Suspected malaria" };
    expect(dispositionGuard(assessed, "ADMIT", modeC)).toBe(
      "This school is referral-only — it has no on-site beds, so a patient cannot be admitted. Discharge or refer instead.",
    );
    expect(dispositionGuard(assessed, "REFER", modeC)).toBeNull();
    expect(dispositionGuard(assessed, "DISCHARGE", modeC)).toBeNull();
  });

  it("V9 a voided visit can never be given a disposition", () => {
    expect(dispositionGuard({ ...ready, voidedAt: at("2026-05-14T09:20:00Z") }, "DISCHARGE", ctx)).toMatch(
      /voided/,
    );
  });
});

// ============================================================================
// V10–V11 · R37 — void is legal ONLY while open, and needs a reason
// ============================================================================

describe("voidGuard (R37)", () => {
  it("V10 an OPEN visit voids with a reason; a blank reason is refused", () => {
    expect(voidGuard(visit(), "Recorded against the wrong student")).toBeNull();
    expect(voidGuard(visit(), "   ")).toBe("Give a reason for voiding this visit.");
  });

  it("V11 a CLOSED visit is the record and cannot be voided — for every disposition", () => {
    for (const d of ["DISCHARGE", "ADMIT", "REFER"] as const) {
      expect(voidGuard(closed(d), "wrong student")).toMatch(/closed .* cannot be voided/);
    }
    expect(voidGuard(visit({ voidedAt: PRESENTED }), "again")).toMatch(/already been voided/);
  });
});

// ============================================================================
// M2 · R57 — isolation is a property of the CASE, so neither pool overflows
// ============================================================================

describe("isolationGuard (R57)", () => {
  it("M2 rejects BOTH mismatch directions and accepts both matches", () => {
    expect(isolationGuard(false, false)).toBeNull();
    expect(isolationGuard(true, true)).toBeNull();
    expect(isolationGuard(true, false)).toMatch(/isolation bed can only take an isolation admission/);
    expect(isolationGuard(false, true)).toMatch(/isolation admission needs an isolation bed/);
  });
});

// ============================================================================
// M3 · R56 — the mode guard INCR-21 recorded and could not test
// ============================================================================

describe("referralOnlyGuard (R56)", () => {
  it("M3 no open admission → no block; open visits are irrelevant, only beds-in-use block", () => {
    expect(referralOnlyGuard([])).toBeNull();
  });

  it("M4 names the COUNT and the BEDS, sorted, and says nothing was saved (the R11 grammar)", () => {
    expect(referralOnlyGuard([3])).toBe(
      "Cannot switch to referral-only — 1 patient is still admitted (bed 3). Discharge that patient first. Nothing was saved.",
    );
    expect(referralOnlyGuard([7, 3])).toBe(
      "Cannot switch to referral-only — 2 patients are still admitted (bed 3, 7). Discharge those patients first. Nothing was saved.",
    );
  });
});

// ============================================================================
// Z1–Z3 · R39/R40 — the two clinical gates
// ============================================================================

describe("clinical authz groups (R39/R40 · owner D2 · Lucy Q2)", () => {
  it("Z1 clinical WRITE is MATRON only — not ADMIN, not HEADMASTER, not HOUSEMASTER", () => {
    expect([...SICKBAY_CLINICAL_WRITE_ROLES]).toEqual(["MATRON"]);
    expect(hasAnyRole(["MATRON"], SICKBAY_CLINICAL_WRITE_ROLES)).toBe(true);
    for (const r of ["ADMIN", "HEADMASTER", "HOUSEMASTER", "TEACHER", "PARENT", "STUDENT"]) {
      expect(hasAnyRole([r], SICKBAY_CLINICAL_WRITE_ROLES)).toBe(false);
    }
  });

  it("Z2 clinical READ is HEADMASTER + MATRON — ADMIN is NOT a member (D2)", () => {
    expect([...SICKBAY_CLINICAL_READ_ROLES]).toEqual(["HEADMASTER", "MATRON"]);
    expect(hasAnyRole(["ADMIN"], SICKBAY_CLINICAL_READ_ROLES)).toBe(false);
    expect(hasAnyRole(["HOUSEMASTER"], SICKBAY_CLINICAL_READ_ROLES)).toBe(false);
  });

  it("Z3 the shipped module gate still admits ADMIN — the clinical gate is a SEPARATE, tighter set", () => {
    // Reusing SICKBAY_ROLES as the clinical read gate would hand the proprietor/IT account every
    // impression, vital and complaint. This assertion is the regression guard for that mistake.
    expect(hasAnyRole(["ADMIN"], SICKBAY_ROLES)).toBe(true);
    expect(SICKBAY_ROLES.some((r) => !SICKBAY_CLINICAL_READ_ROLES.includes(r as never))).toBe(true);
  });
});
