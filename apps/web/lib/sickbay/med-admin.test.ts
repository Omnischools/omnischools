import { describe, it, expect } from "vitest";
import {
  arrangeAmendments,
  medAdminWitnessError,
  roundStatusOf,
  sourcePointerMismatch,
  type MarRowView,
} from "./med-admin";

// 🔴 R174/D5.3 — the controlled-GIVEN witness rule, the accountability that justifies the whole
// controlled layer. The ONE behavioural tripwire (Quinn builds the rest of the 24b AC suite): a
// `&& false` on the require-clause must red HERE, the 24a MINOR-2 lesson applied to the MAR.
describe("R174/D5.3 · medAdminWitnessError — the controlled-GIVEN witness/override decision", () => {
  const base = { witnessId: null, overrideReason: null, actorId: "actor" };

  it("controlled GIVEN with NO witness and NO override → MISSING_WITNESS_OR_OVERRIDE (the mutation target)", () => {
    expect(
      medAdminWitnessError({ ...base, isControlled: true, status: "GIVEN" }),
    ).toBe("MISSING_WITNESS_OR_OVERRIDE");
  });

  it("controlled GIVEN with a witness → null (the happy path; N&MC/tenancy is the action's DB check)", () => {
    expect(
      medAdminWitnessError({ ...base, isControlled: true, status: "GIVEN", witnessId: "w" }),
    ).toBeNull();
  });

  it("controlled GIVEN with a documented override → null (R156 single-signature override)", () => {
    expect(
      medAdminWitnessError({ ...base, isControlled: true, status: "GIVEN", overrideReason: "cabinet alone at night" }),
    ).toBeNull();
  });

  it("a controlled NON-GIVEN dose needs no witness (the CHECK bites only on controlled GIVEN)", () => {
    for (const status of ["REFUSED", "HELD", "OMITTED"] as const) {
      expect(medAdminWitnessError({ ...base, isControlled: true, status })).toBeNull();
    }
  });

  it("a non-controlled dose needs no witness, whatever the status", () => {
    expect(medAdminWitnessError({ ...base, isControlled: false, status: "GIVEN" })).toBeNull();
  });

  it("self-witness is refused for ANY row (no one witnesses themselves)", () => {
    expect(
      medAdminWitnessError({ isControlled: true, status: "GIVEN", witnessId: "x", overrideReason: null, actorId: "x" }),
    ).toBe("SELF_WITNESS");
    expect(
      medAdminWitnessError({ isControlled: false, status: "REFUSED", witnessId: "x", overrideReason: null, actorId: "x" }),
    ).toBe("SELF_WITNESS");
  });
});

describe("R171 · sourcePointerMismatch — mirrors the DB med_admin_source_pointer_match CHECK", () => {
  const none = { chronicMedId: null, standingOrderId: null, consultId: null };
  it("CHRONIC: chronic_med_id OPTIONAL (R163 own-bottle); the other two forbidden", () => {
    expect(sourcePointerMismatch("CHRONIC", none)).toBe(false); // own-bottle: no pointer, legal
    expect(sourcePointerMismatch("CHRONIC", { ...none, chronicMedId: "c" })).toBe(false);
    expect(sourcePointerMismatch("CHRONIC", { ...none, standingOrderId: "s" })).toBe(true);
  });
  it("STANDING_ORDER requires standing_order_id and forbids the others", () => {
    expect(sourcePointerMismatch("STANDING_ORDER", none)).toBe(true);
    expect(sourcePointerMismatch("STANDING_ORDER", { ...none, standingOrderId: "s" })).toBe(false);
    expect(sourcePointerMismatch("STANDING_ORDER", { chronicMedId: "c", standingOrderId: "s", consultId: null })).toBe(true);
  });
  it("DOCTOR_ORDERED requires consult_id; AD_HOC forbids all three", () => {
    expect(sourcePointerMismatch("DOCTOR_ORDERED", { ...none, consultId: "d" })).toBe(false);
    expect(sourcePointerMismatch("DOCTOR_ORDERED", none)).toBe(true);
    expect(sourcePointerMismatch("AD_HOC", none)).toBe(false);
    expect(sourcePointerMismatch("AD_HOC", { ...none, consultId: "d" })).toBe(true);
  });
});

describe("R175 · roundStatusOf — overdue derived at read, nothing auto-writes OMITTED", () => {
  it("nothing scheduled → NONE_DUE (a legitimate state)", () => {
    expect(roundStatusOf({ hasAnyDue: false, openCount: 0, nowPastStart: true })).toBe("NONE_DUE");
  });
  it("all doses terminal → DONE", () => {
    expect(roundStatusOf({ hasAnyDue: true, openCount: 0, nowPastStart: true })).toBe("DONE");
  });
  it("open doses, window passed → OVERDUE (derived, not auto-OMITTED)", () => {
    expect(roundStatusOf({ hasAnyDue: true, openCount: 2, nowPastStart: true })).toBe("OVERDUE");
  });
  it("open doses, window not yet passed → OPEN_FUTURE (the reader picks DUE vs PENDING)", () => {
    expect(roundStatusOf({ hasAnyDue: true, openCount: 2, nowPastStart: false })).toBe("OPEN_FUTURE");
  });
});

describe("R176 · arrangeAmendments — a correction renders after its byte-unchanged original", () => {
  const row = (id: string, at: string, correctsAdminId: string | null = null): MarRowView => ({
    id,
    administeredAtISO: at,
    administeredAtHHMM: at.slice(11, 16),
    drugName: "Paracetamol",
    doseLabel: "1000mg",
    route: "oral",
    source: "AD_HOC",
    standingComplaint: null,
    consultId: null,
    status: "GIVEN",
    isControlled: false,
    administeredByName: "A. Bediako",
    witnessName: null,
    witnessOverrideReason: null,
    notes: null,
    correctsAdminId,
    amendmentNote: correctsAdminId ? "wrong dose entered" : null,
    amended: false,
  });

  it("places the corrector right after its original and flags the original `amended`", () => {
    // A later correction of the FIRST row must not sort to the end by time — it follows its target.
    const out = arrangeAmendments([
      row("a", "2026-05-14T09:20:00Z"),
      row("b", "2026-05-14T09:25:00Z"),
      row("c", "2026-05-14T09:40:00Z", "a"),
    ]);
    expect(out.map((r) => r.id)).toEqual(["a", "c", "b"]);
    expect(out.find((r) => r.id === "a")!.amended).toBe(true);
    expect(out.find((r) => r.id === "c")!.amended).toBe(false);
  });

  it("renders a chain (an amendment of an amendment) in order", () => {
    const out = arrangeAmendments([
      row("a", "2026-05-14T09:20:00Z"),
      row("c", "2026-05-14T09:40:00Z", "a"),
      row("d", "2026-05-14T10:00:00Z", "c"),
    ]);
    expect(out.map((r) => r.id)).toEqual(["a", "c", "d"]);
    expect(out.find((r) => r.id === "a")!.amended).toBe(true);
    expect(out.find((r) => r.id === "c")!.amended).toBe(true);
  });
});
