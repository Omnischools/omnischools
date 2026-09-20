import { describe, it, expect } from "vitest";
import { readCode } from "@/lib/test-utils/source-shape";
import {
  transitionGuard,
  voidReferralGuard,
  isReferredOut,
  handoffKeyInPatch,
  HANDOFF_FIELDS,
  snapshotNhis,
  formatReferralRef,
  referralDayLabel,
  LEGAL_TRANSITIONS,
  type ReferralStatus,
} from "./referrals";

// R190 — the whole flow ships no diagnosis. The referral lifecycle module must not name one.
describe("🔴 R190 · no `diagnos` token anywhere in the referral lifecycle", () => {
  it("no exported key contains the string", () => {
    const keys = [...HANDOFF_FIELDS, ...Object.keys(LEGAL_TRANSITIONS)];
    for (const k of keys) expect(k.toLowerCase()).not.toContain("diagnos");
  });

  // RF7 — `diagnos` appears in no column/enum/type/zod-key/route this increment ships. Swept
  // comment-stripped across the 25b LIB (the pages render the surface's "Diagnosis" LABEL for the
  // live working_impression, which is legitimate copy, not an identifier — R190 permits it).
  it("no shipped 25b lib source carries `diagnos` in code", () => {
    for (const p of [
      "lib/sickbay/referrals.ts",
      "lib/sickbay/referral-reads.ts",
      "lib/actions/sickbay-referral.ts",
    ]) {
      expect(readCode(p).toLowerCase().includes("diagnos"), `${p} carries "diagnos" in code`).toBe(false);
    }
  });

  // 🔴 R184 — the NHIS snapshot is copied, never joined. The referral READ path must never re-read
  // student_nhis_card (it reads the FROZEN nhis_card_number/nhis_valid off the referral row); only
  // recordReferral touches the live card, ONCE, at creation.
  it("the referral read module never joins student_nhis_card (snapshot, not join)", () => {
    expect(readCode("lib/sickbay/referral-reads.ts").includes("studentNhisCard")).toBe(false);
  });
  it("recordReferral reads the live card exactly to snapshot it", () => {
    const action = readCode("lib/actions/sickbay-referral.ts");
    expect(action.includes("studentNhisCard")).toBe(true);
    expect(action.includes("snapshotNhis")).toBe(true);
  });
});

describe("R188 · legal transitions only", () => {
  const ALL: ReferralStatus[] = ["REFERRED", "INPATIENT", "RETURNING", "RETURNED"];
  const legal = new Set([
    "REFERRED>INPATIENT",
    "REFERRED>RETURNED",
    "INPATIENT>RETURNING",
    "INPATIENT>RETURNED",
    "RETURNING>RETURNED",
  ]);

  it("permits exactly the five legal edges and refuses every other jump", () => {
    for (const from of ALL) {
      for (const to of ALL) {
        const err = transitionGuard(from, to);
        if (legal.has(`${from}>${to}`)) expect(err, `${from}->${to}`).toBeNull();
        else expect(err, `${from}->${to} must be refused`).not.toBeNull();
      }
    }
  });

  it("refuses a no-op (double-click cannot re-audit an unchanged state)", () => {
    expect(transitionGuard("INPATIENT", "INPATIENT")).not.toBeNull();
  });

  it("nothing is legal out of RETURNED", () => {
    expect(LEGAL_TRANSITIONS.RETURNED).toHaveLength(0);
  });
});

describe("R188 · void is a retract while status ≠ RETURNED and not already voided", () => {
  it("allows a void of an open referral", () => {
    for (const status of ["REFERRED", "INPATIENT", "RETURNING"] as ReferralStatus[]) {
      expect(voidReferralGuard({ status, voidedAt: null })).toBeNull();
    }
  });
  it("refuses a void of a RETURNED referral", () => {
    expect(voidReferralGuard({ status: "RETURNED", voidedAt: null })).not.toBeNull();
  });
  it("refuses a re-void", () => {
    expect(voidReferralGuard({ status: "INPATIENT", voidedAt: new Date() })).not.toBeNull();
  });
});

describe("🔴 R192 · referredOut predicate excludes RETURNED and voided", () => {
  it("open + not voided ⇒ off-campus; RETURNED or voided ⇒ not", () => {
    expect(isReferredOut("REFERRED", null)).toBe(true);
    expect(isReferredOut("INPATIENT", null)).toBe(true);
    expect(isReferredOut("RETURNING", null)).toBe(true);
    expect(isReferredOut("RETURNED", null)).toBe(false);
    expect(isReferredOut("INPATIENT", new Date())).toBe(false);
  });
});

describe("🔴 R187 · frozen write-once handoff — a status patch can never carry a handoff key", () => {
  it("detects a handoff key smuggled into an update patch", () => {
    expect(handoffKeyInPatch({ status: "INPATIENT", hospitalWard: "B" })).toBeNull();
    expect(handoffKeyInPatch({ status: "RETURNED", reasonReferredOut: "x" })).toBe("reasonReferredOut");
    expect(handoffKeyInPatch({ mensesNote: "x" })).toBe("mensesNote");
  });
});

describe("🔴 R184 · NHIS is SNAPSHOT, not joined", () => {
  const now = new Date("2026-05-14T06:45:00Z");
  it("copies the card number and freezes validity from the live card", () => {
    expect(snapshotNhis({ cardNumber: "NHIS-9842-1276-5503", validTo: "2026-12-31" }, now)).toEqual({
      nhisCardNumber: "NHIS-9842-1276-5503",
      nhisValid: true,
    });
  });
  it("an expired card snapshots nhisValid=false", () => {
    expect(snapshotNhis({ cardNumber: "X", validTo: "2026-05-01" }, now).nhisValid).toBe(false);
  });
  it("no card ⇒ both null (never fabricated)", () => {
    expect(snapshotNhis(null, now)).toEqual({ nhisCardNumber: null, nhisValid: null });
  });
  it("a card on file with no recorded expiry snapshots as usable", () => {
    expect(snapshotNhis({ cardNumber: "X", validTo: null }, now).nhisValid).toBe(true);
  });
});

describe("R187 · pure reference formatter (no stored referral_ref)", () => {
  it("builds R-YYYY-MM-DD-#### from the departure date + student-code tail", () => {
    expect(
      formatReferralRef(new Date("2026-05-14T06:45:00Z"), "SHS-2023-0817", new Date("2026-05-14T06:00:00Z")),
    ).toBe("R-2026-05-14-0817");
  });
  it("falls back to created_at when the referral has not departed", () => {
    expect(formatReferralRef(null, "SHS-2024-1133", new Date("2026-05-20T09:00:00Z"))).toBe(
      "R-2026-05-20-1133",
    );
  });
});

describe("R188 · derived day pill", () => {
  const now = new Date("2026-05-14T15:30:00Z");
  it("open inpatient reads Day N · since HH:MM (day 1 = departure day)", () => {
    expect(
      referralDayLabel({ status: "INPATIENT", departedAt: new Date("2026-05-14T06:45:00Z"), returnedAt: null }, now),
    ).toBe("Day 1 · since 06:45");
  });
  it("day 2 on the next civil day", () => {
    expect(
      referralDayLabel({ status: "INPATIENT", departedAt: new Date("2026-05-13T20:00:00Z"), returnedAt: null }, now),
    ).toBe("Day 2 · since 20:00");
  });
  it("returning reads Returning", () => {
    expect(referralDayLabel({ status: "RETURNING", departedAt: new Date("2026-05-14T06:45:00Z"), returnedAt: null }, now)).toBe(
      "Returning",
    );
  });
  it("same-day return reads Outpatient · returned same day", () => {
    expect(
      referralDayLabel(
        { status: "RETURNED", departedAt: new Date("2026-05-14T09:00:00Z"), returnedAt: new Date("2026-05-14T15:00:00Z") },
        now,
      ),
    ).toBe("Outpatient · returned same day");
  });
  it("a later return names the return date", () => {
    expect(
      referralDayLabel(
        { status: "RETURNED", departedAt: new Date("2026-05-12T09:00:00Z"), returnedAt: new Date("2026-05-15T11:00:00Z") },
        now,
      ),
    ).toBe("Returned Fri 15 May");
  });
});
