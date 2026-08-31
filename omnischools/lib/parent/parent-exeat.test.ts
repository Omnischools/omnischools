import { describe, it, expect } from "vitest";
import { readCode } from "@/lib/test-utils/source-shape";
import { exeatStatusLabel, exeatDetail } from "./parent-exeat-data";

/**
 * EXEAT PHASE 2 · parent-initiated SPECIAL exeat + own-child status. The reader is mostly an IO projection
 * over the SECURITY DEFINER fns, so the guards are (1) the PURE parent-facing copy — friendly status labels
 * (Kofi C2) + the DETAIL rule (echo the parent's OWN words only, relabel FEE_COLLECTION so no amount leaks),
 * and (2) source-shape: reader/action stay inside withParentScope, the write is a thin fn caller that
 * server-forces nothing itself and sends no SMS. RLS/fn behaviour lives in db:rls-test.
 */

describe("exeatStatusLabel · friendly status copy (Kofi C2)", () => {
  it("maps every lifecycle status to its parent-facing sentence", () => {
    expect(exeatStatusLabel("REQUESTED")).toBe("Submitted — awaiting the school's approval");
    expect(exeatStatusLabel("HM_APPROVED")).toBe("Approved by the House — awaiting final sign-off");
    expect(exeatStatusLabel("SR_HM_SIGNED")).toBe("Approved and signed off");
    expect(exeatStatusLabel("DEPARTED")).toBe("Signed out — currently at home");
    expect(exeatStatusLabel("RETURNED")).toBe("Returned to school");
    expect(exeatStatusLabel("DECLINED")).toBe("Not approved — please contact the House");
  });

  it("never leaks the raw operational vocabulary and falls back neutrally", () => {
    for (const s of ["REQUESTED", "HM_APPROVED", "SR_HM_SIGNED", "DEPARTED", "RETURNED", "DECLINED"]) {
      expect(exeatStatusLabel(s)).not.toBe(s);
    }
    expect(exeatStatusLabel("WEIRD_UNKNOWN")).toBe("In progress");
  });
});

describe("exeatDetail · reason-echo gate + FEE_COLLECTION relabel", () => {
  it("echoes the parent's OWN words only when THEY initiated the request", () => {
    expect(
      exeatDetail({ exeatType: "SPECIAL", parentInitiated: true, reason: "  Grandmother's funeral  " }),
    ).toBe("Grandmother's funeral"); // trimmed, verbatim
  });

  it("shows a friendly TYPE label — never the staff reason — for a non-parent-initiated row", () => {
    expect(exeatDetail({ exeatType: "SPECIAL", parentInitiated: false, reason: "internal note" })).toBe(
      "Special leave",
    );
    expect(exeatDetail({ exeatType: "SCHEDULED", parentInitiated: false, reason: "routine" })).toBe(
      "Scheduled leave",
    );
    // parent-initiated but empty reason → still the friendly type label (no blank detail)
    expect(exeatDetail({ exeatType: "SPECIAL", parentInitiated: true, reason: "   " })).toBe("Special leave");
  });

  it("relabels FEE_COLLECTION to a bare 'Fee collection' — the amount-bearing reason is NEVER echoed", () => {
    expect(
      exeatDetail({ exeatType: "FEE_COLLECTION", parentInitiated: true, reason: "Collect GHS 340.00 outstanding" }),
    ).toBe("Fee collection");
    expect(
      exeatDetail({ exeatType: "FEE_COLLECTION", parentInitiated: false, reason: "GHS 215.00 owed" }),
    ).toBe("Fee collection");
  });
});

describe("parent-exeat-data · reader stays inside the parent boundary (source-shape)", () => {
  const reader = () => readCode("lib/parent/parent-exeat-data.ts");

  it("runs under withParentScope only — never withSchool / withoutTenantScope", () => {
    const s = reader();
    expect(s).toMatch(/withParentScope/);
    expect(s).not.toMatch(/withSchool|withoutTenantScope/);
  });

  it("reads boarding_exeat ONLY through the SECURITY DEFINER projection (the table stays parent_deny)", () => {
    const s = reader();
    expect(s).toMatch(/parent_exeat_list/);
    expect(s).not.toMatch(/boardingExeat/); // never a direct Drizzle read of the denied table
    expect(s).not.toMatch(/fee_owing_snapshot|feeOwingSnapshot/); // amount never reaches the parent wire
  });
});

describe("parent-exeat action · the write trust boundary", () => {
  const action = () => readCode("lib/actions/parent-exeat.ts");

  it("is a parent-gated server action under withParentScope (not requireSchool)", () => {
    const s = action();
    expect(s).toMatch(/^"use server"/m);
    expect(s).toMatch(/requireParent\(\)/);
    expect(s).not.toMatch(/requireSchool/);
    expect(s).toMatch(/withParentScope/);
    expect(s).not.toMatch(/\bwithSchool\b/);
  });

  it("delegates to the SECURITY DEFINER write fn and never forges lifecycle fields itself", () => {
    const s = action();
    expect(s).toMatch(/parent_request_exeat/);
    // the fn server-forces type/status/parent_initiated — the action must not set them (no direct insert).
    expect(s).not.toMatch(/insert\(boardingExeat\)|\.values\(/);
    expect(s).not.toMatch(/"SPECIAL"|"REQUESTED"/); // no type/status literal written from app code
  });

  it("validates the inputs and sends NO SMS", () => {
    const s = action();
    expect(s).toMatch(/z\.object\(/);
    expect(s).toMatch(/\.min\(4/);
    expect(s).toMatch(/\.max\(500/);
    expect(s).toMatch(/departDate < today/); // not-in-the-past belt
    expect(s).toMatch(/returnDate < departDate/); // ordering belt
    expect(s).not.toMatch(/sendSms|sendSMS/);
  });
});

describe("boarding page · the exeat form is a client component; no server-only leak", () => {
  const form = () => readCode("app/(parent)/boarding/exeat-request.tsx");
  const page = () => readCode("app/(parent)/boarding/page.tsx");

  it("the request form is a client component calling the action only (never a server-only reader)", () => {
    const s = form();
    expect(s).toMatch(/^"use client"/m);
    expect(s).toMatch(/requestParentExeat/);
    expect(s).not.toMatch(/parent-exeat-data|loadParentExeats/); // the client never imports the db reader
    expect(s).toMatch(/type="date"/); // native date input (no picker lib)
  });

  it("the page loads exeats server-side and passes pre-formatted rows to the client list", () => {
    const s = page();
    expect(s).toMatch(/loadParentExeats/);
    expect(s).toMatch(/No leave requests yet\./); // empty state
    expect(s).toMatch(/ParentNav active="Boarding"/); // still one tab, unchanged
  });
});
