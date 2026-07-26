import { describe, it, expect } from "vitest";
import { readCode } from "@/lib/test-utils/source-shape";

/**
 * 🔴 INCR-29 (R229/R230) — the parent-facing sickbay reader. It imports the DB driver (server-only), so
 * — like boarding-admissions.test.ts / medical-hold.test.ts — these are SOURCE-SHAPE assertions: the
 * disclosure boundary is a structural property of the projection + the query, not something a superuser
 * DB proves. Wells's verify-parent-sickbay-boundary.ts proves the RLS row-access; this proves the ONLY
 * thing left — that the reader projects the frozen key-set and joins nothing clinical. `readCode` strips
 * comments, so the deny-list tokens named in the docblock don't self-trip these greps.
 */
const SRC = "lib/parent/parent-sickbay-data.ts";
const PAGE = "app/(parent)/sickbay/page.tsx";
const src = () => readCode(SRC);

/** The keys of the `return { ... }` object inside parentSickbayStatusTx (no nested braces in it). */
const projectorKeys = (): string[] => {
  const s = src();
  const from = s.indexOf("export async function parentSickbayStatusTx");
  const rstart = s.indexOf("return {", from);
  const block = s.slice(rstart, s.indexOf("}", rstart));
  return [...block.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]).sort();
};

describe("🔴 PS7 · the FROZEN key-set (owner-confirmed R229, mutation-killable)", () => {
  it("PS7 · projects EXACTLY {onSiteCareOpen, admittedOnDate, referredOut, referredOnDate}", () => {
    expect(projectorKeys()).toEqual([
      "admittedOnDate",
      "onSiteCareOpen",
      "referredOnDate",
      "referredOut",
    ]);
  });

  it("returns NO studentId / id (studentId is an INPUT filter only, never in the shape)", () => {
    expect(projectorKeys()).not.toContain("studentId");
    expect(projectorKeys()).not.toContain("id");
  });
});

describe("🔴 PS5/PS3/PS4 · reads ONLY the two tables, open-only, never the visit", () => {
  it("PS5 · reads sickbay_admission + sickbay_referral and NOTHING else clinical", () => {
    const s = src();
    expect(s).toContain("sickbayAdmission");
    expect(s).toContain("sickbayReferral");
    // The visit drags working_impression/presenting_complaint into reach (R230/R235) — never read it.
    expect(s, "must NOT read sickbay_visit").not.toContain("sickbayVisit");
    for (const table of [
      "sickbayVitalReading",
      "sickbayDoctorConsult",
      "sickbayChronic",
      "sickbayNotification",
      "sickbayReferralUpdate",
      "sickbayReferralCostLine",
      "sickbayBed",
      "sickbayHospital",
      "studentNhisCard",
    ]) {
      expect(s, `must NOT read ${table}`).not.toContain(table);
    }
  });

  it("PS3/PS4 · open-only: discharged/returned/voided filters, never a history read", () => {
    const s = src();
    expect(s).toMatch(/isNull\(sickbayAdmission\.dischargedAt\)/);
    expect(s).toMatch(/isNull\(sickbayReferral\.returnedAt\)/);
    expect(s).toMatch(/isNull\(sickbayReferral\.voidedAt\)/);
    expect(s).toMatch(/isNotNull\(sickbayReferral\.departedAt\)/);
  });
});

describe("🔴 PS1/PS2/PS11/PS14 · no clinical / nhis / menses / expected-return token anywhere", () => {
  // The drizzle column identifiers that would appear IF a deny-list field leaked into a SELECT/join.
  const DENY = [
    "workingImpression",
    "presentingComplaint",
    "surveillanceCategory",
    "hydrationStatus",
    "redFlags",
    "escalationTriggers",
    "mensesNote",
    "reasonReferredOut",
    "preReferralCare",
    "handoffLabs",
    "lastMeal",
    "travelNote",
    "hospitalWard",
    "hospitalBed",
    "hospitalId",
    "attendingClinicianName",
    "isIsolation",
    "bedId",
    "expectedReturnAt",
    "expectedDischargeAt",
    "dischargeNote",
    "dischargeCriteria",
    "overnightPlan",
    "transportMode",
    "intakeReportedBy",
    "nhisCardNumber",
    "nhisValid",
    "diagnos",
  ] as const;

  it("PS1/PS2/PS14 · the reader carries no deny-list column", () => {
    const s = src();
    for (const token of DENY) expect(s, `${token} must not appear in the reader`).not.toContain(token);
  });

  it("PS11 · the served page markup carries no clinical token (Class-4 grep-clean)", () => {
    // Proxy for "grep the served HTML" — the page renders only allow-listed copy (fact + date + reassurance).
    const p = readCode(PAGE).toLowerCase();
    for (const token of [
      "diagnos",
      "impression",
      "complaint",
      "vital",
      "nhis",
      "menses",
      "hospital",
      "ward",
      "clinician",
      "isolation",
    ]) {
      expect(p, `served markup must not contain "${token}"`).not.toContain(token);
    }
  });
});

describe("🔴 PS12/PS13/PS15 · read-only, date-only, parent-scoped", () => {
  it("PS12 · NO write, NO notify path", () => {
    const s = src();
    expect(s).not.toMatch(/\.insert\(/);
    expect(s).not.toMatch(/\.update\(/);
    expect(s).not.toMatch(/\.delete\(/);
    expect(s).not.toContain("notification");
    expect(s).not.toContain("Notification");
  });

  it("PS13 · dates are DATE-ONLY (::date via to_char, no clock)", () => {
    const s = src();
    expect(s).toMatch(/to_char\([^)]*'YYYY-MM-DD'\)/);
    expect(s, "no HH:MM clock formatting").not.toMatch(/HH24|HH12|HH:|:MI|:SS/);
  });

  it("PS15 · runs under withParentScope, never withSchool/withoutTenantScope", () => {
    const s = src();
    expect(s).toContain("withParentScope");
    expect(s).not.toContain("withSchool");
    expect(s).not.toContain("withoutTenantScope");
    expect(s).toContain('import "server-only"');
  });
});
