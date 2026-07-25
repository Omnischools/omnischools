import { describe, it, expect } from "vitest";
import { formatNhisHolderLine, nhisCardStatus, NHIS_EXPIRING_DAYS } from "./nhis";

// A fixed clock so the boundary maths is deterministic. `asOf` is 2026-05-14 (the demo referral date).
const ASOF = new Date("2026-05-14T09:30:00Z");
const plusDays = (n: number): string => {
  const d = new Date("2026-05-14T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// 🔴 R183 — status is DERIVED from valid_to, never stored. This pins the two money/eligibility-adjacent
// boundaries: the 30-day "Expiring" edge and the expiry edge. Move either and the test reds.
describe("R183 · nhisCardStatus — derived, and the two boundaries", () => {
  it("30 days out is EXPIRING; 31 days out is ACTIVE (the ≤30 boundary)", () => {
    expect(nhisCardStatus(plusDays(NHIS_EXPIRING_DAYS), ASOF)).toBe("EXPIRING"); // exactly 30
    expect(nhisCardStatus(plusDays(NHIS_EXPIRING_DAYS + 1), ASOF)).toBe("ACTIVE"); // 31
  });

  it("valid THROUGH today is EXPIRING; valid to yesterday is EXPIRED (the expiry boundary)", () => {
    expect(nhisCardStatus(plusDays(0), ASOF)).toBe("EXPIRING"); // expires today → still valid, expiring
    expect(nhisCardStatus(plusDays(-1), ASOF)).toBe("EXPIRED"); // expired yesterday
  });

  it("far in the future is ACTIVE; no expiry on file is UNKNOWN (never asserted expired)", () => {
    expect(nhisCardStatus("2026-12-31", ASOF)).toBe("ACTIVE");
    expect(nhisCardStatus(null, ASOF)).toBe("UNKNOWN");
    expect(nhisCardStatus("not-a-date", ASOF)).toBe("UNKNOWN");
  });
});

// 🔴 S2 — the card-holder ≠ student case, rendered faithfully. holder_name is the source of truth;
// card_number is verbatim (no reformat).
describe("S2 · formatNhisHolderLine — holder ≠ student", () => {
  it("a GUARDIAN card reads `{card} · {holder} · {student} (minor)`", () => {
    expect(
      formatNhisHolderLine(
        { cardNumber: "NHIS-9842-1276-5503", holderName: "A. Aidoo", holderKind: "GUARDIAN" },
        "Yaa Aidoo",
      ),
    ).toBe("NHIS-9842-1276-5503 · A. Aidoo · Yaa Aidoo (minor)");
  });

  it("a STUDENT card reads `{card} · {holder}` and never appends `(minor)`", () => {
    expect(
      formatNhisHolderLine(
        { cardNumber: "8005-4287-6611-09", holderName: "Yaa Aidoo", holderKind: "STUDENT" },
        "Yaa Aidoo",
      ),
    ).toBe("8005-4287-6611-09 · Yaa Aidoo");
  });

  it("falls back to the student name when a holder name was not entered", () => {
    expect(
      formatNhisHolderLine({ cardNumber: "X-1", holderName: null, holderKind: "STUDENT" }, "Yaa Aidoo"),
    ).toBe("X-1 · Yaa Aidoo");
    expect(
      formatNhisHolderLine({ cardNumber: "X-1", holderName: "  ", holderKind: "GUARDIAN" }, "Yaa Aidoo"),
    ).toBe("X-1 · Guardian · Yaa Aidoo (minor)");
  });
});
