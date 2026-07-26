import { describe, it, expect } from "vitest";
import { readCode } from "@/lib/test-utils/source-shape";
import { nhisCardStatus } from "@/lib/sickbay/nhis";

/**
 * 🔴 INCR-32 (R246–R255) — the parent-facing NHIS reader. Like parent-sickbay-data.test.ts, these are
 * SOURCE-SHAPE assertions: the disclosure boundary is a structural property of the projection, not a
 * thing a superuser DB proves. Wells's verify-parent-sickbay-boundary.ts proves the RLS row-access +
 * the MEDIUM-3 card_number reachability; this proves the ONLY thing left — the reader projects
 * `{ status, validTo }` and never touches the number. `readCode` strips comments so the deny tokens
 * named in the docblock don't self-trip the greps.
 */
const SRC = "lib/parent/parent-nhis-data.ts";
const PAGE = "app/(parent)/sickbay/page.tsx";
const src = () => readCode(SRC);

/** The keys of the object `return { ... }` inside parentNhisStatusTx (the multi-line object return). */
const projectorKeys = (): string[] => {
  const s = src();
  const from = s.indexOf("export async function parentNhisStatusTx");
  const rstart = s.indexOf("return {", from);
  const block = s.slice(rstart, s.indexOf("}", rstart));
  return [...block.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]).sort();
};

describe("🔴 NH1 · the FROZEN key-set (owner call: status + expiry only, mutation-killable)", () => {
  it("NH1 · projects EXACTLY {status, validTo}", () => {
    expect(projectorKeys()).toEqual(["status", "validTo"]);
  });

  it("NH1 · returns NO card_number / holder / id (studentId is an INPUT filter only)", () => {
    const keys = projectorKeys();
    for (const k of ["cardNumber", "holderName", "holderKind", "validFrom", "studentGuardianId", "id", "studentId"]) {
      expect(keys).not.toContain(k);
    }
  });
});

describe("🔴 NH2 · projection column-guard — the number never enters a SELECT", () => {
  it("NH2 · the reader carries validTo + studentNhisCard but NO card-identity column", () => {
    const s = src();
    expect(s).toContain("studentNhisCard");
    expect(s).toContain("validTo");
    for (const token of [
      "cardNumber",
      "holderName",
      "holderKind",
      "validFrom",
      "studentGuardianId",
      "card_number",
      "holder_name",
      "holder_kind",
      "valid_from",
    ]) {
      expect(s, `${token} must not appear in the reader`).not.toContain(token);
    }
  });
});

describe("🔴 NH3 · REUSE the shared derivation, never reinvent, never via nhis-reads", () => {
  it("NH3 · calls nhisCardStatus from @/lib/sickbay/nhis; no getNhisCardContext / nhis-reads / inline day-diff", () => {
    const s = src();
    expect(s).toContain("nhisCardStatus");
    expect(s).toMatch(/from "@\/lib\/sickbay\/nhis"/);
    expect(s, "must NOT import the number-carrying reader").not.toContain("getNhisCardContext");
    expect(s, "must NOT import nhis-reads").not.toContain("nhis-reads");
    // No hand-rolled day math (that would be the R10 reinvented-derivation smell).
    expect(s).not.toContain("86_400_000");
    expect(s).not.toContain("86400000");
    expect(s).not.toContain("Date.parse");
  });
});

describe("🔴 NH4 · the parent status is the shared helper's output, verbatim (boundary re-pinned)", () => {
  // The day-math itself is owned by lib/sickbay/nhis.test.ts. This documents the parent-facing
  // expectation at the owner-relevant boundaries and reds if the helper's contract ever drifts.
  const asOf = new Date("2026-07-26T09:00:00Z");
  const day = (n: number) => {
    const d = new Date(Date.UTC(2026, 6, 26) + n * 86_400_000);
    return d.toISOString().slice(0, 10);
  };
  it.each([
    [day(0), "EXPIRING"], // valid_to == today → still valid today
    [day(-1), "EXPIRED"], // yesterday
    [day(30), "EXPIRING"], // exactly the 30-day edge
    [day(31), "ACTIVE"], // one past the edge
    [null, "UNKNOWN"], // no expiry on file
  ] as const)("valid_to=%s → %s", (validTo, expected) => {
    expect(nhisCardStatus(validTo, asOf)).toBe(expected);
  });
});

describe("🔴 NH8/NH9 · read-only, parent-scoped, server-only", () => {
  it("NH8 · NO write, NO notify path", () => {
    const s = src();
    expect(s).not.toMatch(/\.insert\(/);
    expect(s).not.toMatch(/\.update\(/);
    expect(s).not.toMatch(/\.delete\(/);
    expect(s).not.toContain("notification");
    expect(s).not.toContain("Notification");
  });

  it("NH9 · runs under withParentScope, never withSchool/withoutTenantScope", () => {
    const s = src();
    expect(s).toContain('import "server-only"');
    expect(s).toContain("withParentScope");
    expect(s).not.toContain("withSchool");
    expect(s).not.toContain("withoutTenantScope");
  });
});

describe("🔴 NH5/NH6/NH7/NH10/NH14 · the served NHIS panel discloses status+expiry only", () => {
  const page = () => readCode(PAGE);

  it("NH7 · the four status labels are present and mapped", () => {
    const p = page();
    for (const label of ["Active", "Active · renew soon", "Expired", "On file · expiry not recorded"]) {
      expect(p, `label "${label}" must be rendered`).toContain(label);
    }
  });

  it("NH5/NH6 · not-registered and unknown are DISTINCT honest states", () => {
    const p = page();
    expect(p, "not-registered empty (R250)").toContain("No NHIS card is on file");
    expect(p, "unknown-expiry distinct copy (R251)").toContain("On file · expiry not recorded");
  });

  it("NH10 · the served markup carries NO card number / holder, and no full NHIS-number run", () => {
    const p = page();
    for (const token of ["cardNumber", "holderName", "holderKind", "card_number", "holder_name"]) {
      expect(p, `page must not render ${token}`).not.toContain(token);
    }
    // No verbatim membership number: neither an "NHIS-####" pattern nor an 8+ digit run.
    expect(p, "no NHIS-number pattern").not.toMatch(/NHIS-\d/);
    expect(p, "no 8+ digit run (a membership number)").not.toMatch(/\d{8,}/);
  });

  it("NH10 · clinical tokens stay absent from the sickbay page (NHIS section adds none)", () => {
    const p = page().toLowerCase();
    for (const token of ["diagnos", "impression", "complaint", "vital", "menses", "ward", "clinician", "isolation"]) {
      expect(p, `served markup must not contain "${token}"`).not.toContain(token);
    }
  });

  it("NH14 · expiry uses parentLongDate (full civil date) — no month-year formatter, no clock", () => {
    const p = page();
    expect(p).toContain("parentLongDate");
    expect(p, "no clock token on the NHIS path").not.toMatch(/HH24|HH12|HH:|:MI|:SS/);
    expect(p, "no to_char month-year formatter on the page").not.toContain("to_char");
  });
});
