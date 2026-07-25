import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
import { formatNhisHolderLine, maskNhisCard, nhisCardStatus, NHIS_EXPIRING_DAYS } from "./nhis";

// A fixed clock so the boundary maths is deterministic. `asOf` is 2026-05-14 (the demo referral date).
const ASOF = new Date("2026-05-14T09:30:00Z");
const plusDays = (n: number): string => {
  const d = new Date("2026-05-14T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// 🔴 Sarah/INCR-25a — the audit feed is ADMIN-readable; the raw NHIS number must never reach it. This
// reds if the mask ever returns the full number (a refactor that logs the card verbatim).
describe("maskNhisCard · the audit trail carries a last-4 fingerprint, never the full number", () => {
  it("keeps only the last 4 characters, and never the full number", () => {
    expect(maskNhisCard("NHIS-9842-1276-5503")).toBe("…5503");
    expect(maskNhisCard("8005-4287-6611-09")).toBe("…1-09");
    expect(maskNhisCard(null)).toBe(null);
  });
  it("fully masks a number too short to hide 4 (never a real NHIS number)", () => {
    expect(maskNhisCard("77")).toBe("…");
    expect(maskNhisCard("1234")).toBe("…"); // exactly 4 → reveal nothing
  });
});

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

// 🔴 R182 — the STPSHS `1,108/1,200 · 92.3%` card-health matrix is FORBIDDEN (never build, incl. INCR-27).
// A school-wide roll-up would be an aggregate over the card table at the reader; doc comments alone don't
// red a regression. This greps the two shipped NHIS source modules for any `count(`-style aggregate call —
// a future `select({ n: count() })` in nhis-reads, or a set→number roll-up in the pure module, reds here.
// Anchored word-initial (ADV-3, assert the aggregate CALL, not the "No COUNT/rate" doc prose, which has no
// paren). The rendered tile can't exist downstream: the console is fed ONE student's NhisCardView, no cohort.
describe("R182 · NO school-wide NHIS roll-up in the shipped NHIS modules", () => {
  const read = (rel: string) => readFileSync(resolve(cwd(), rel), "utf8");
  const SOURCES = [read("lib/sickbay/nhis.ts"), read("lib/sickbay/nhis-reads.ts")];

  it("no `count(`-style aggregate over student_nhis_card exists in either module", () => {
    for (const src of SOURCES) {
      expect(/\bcount\w*\s*\(/i.test(src), "an aggregate call crept into an NHIS module").toBe(false);
    }
  });
});
