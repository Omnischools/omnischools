import { describe, it, expect } from "vitest";
import { readCode } from "@/lib/test-utils/source-shape";

/**
 * INCR-BOARD · parent-portal Boarding tab (lean v1). The reader is mostly an IO projection over the
 * placement RPC + school-wide grants, so source-shape is the guard: placement via the SECURITY DEFINER fn
 * (boarding tables stay parent_deny), visiting constrained to VISITING (no exeat), the visiting-policy
 * column guard, residency-gated, and the nav gated to boarding schools. RLS behaviour lives in db:rls-test.
 */

describe("parent-boarding-data · safe reads under withParentScope (AC-BOARD-*)", () => {
  const reader = () => readCode("lib/parent/parent-boarding-data.ts");

  it("runs under withParentScope only — never withSchool / withoutTenantScope", () => {
    const s = reader();
    expect(s).toMatch(/withParentScope/);
    expect(s).not.toMatch(/withSchool|withoutTenantScope/);
  });

  it("placement goes through the SECURITY DEFINER projection — boarding tables are never read directly", () => {
    const s = reader();
    expect(s).toMatch(/parent_boarding_placement/); // the guard (house/dorm/prefect; no bunk number)
    // the parent_deny boarding tables are never imported/selected (the fn is the only reach):
    expect(s).not.toMatch(/boardingBunk/);
    expect(s).not.toMatch(/boardingDormitory/);
    expect(s).not.toMatch(/boardingApprovedVisitor/);
    expect(s).not.toMatch(/boardingExeat/);
    expect(s).not.toMatch(/\binspections\b/);
    expect(s).not.toMatch(/prepAttendance/);
  });

  it("visiting is constrained to VISITING (exeat windows excluded) and the policy column-guard holds", () => {
    const s = reader();
    expect(s).toMatch(/eq\(boardingCalendarEvent\.eventType, "VISITING"\)/); // no EXEAT_WINDOW
    // boarding_settings: visiting fields only — never the ops/exeat/inspection columns on the same row.
    expect(s).not.toMatch(/boardingSettings\.visitingBookOwner/);
    expect(s).not.toMatch(/boardingSettings\.exeat/);
    expect(s).not.toMatch(/boardingSettings\.inspection/);
  });

  it("resumption/vacation includes SENIOR_F3 (Form 3 early vacation), unlike the calendar reader", () => {
    const s = reader();
    expect(s).toMatch(/ne\(academicPeriod\.productLine, "BASIC"\)/); // SENIOR + SENIOR_F3, not just SENIOR
    expect(s).not.toMatch(/ne\(academicPeriod\.productLine, "SENIOR_F3"\)/); // must NOT exclude F3
  });

  it("gates on residency = BOARDER (day/deboardinized collapse to not-a-boarder)", () => {
    const s = reader();
    expect(s).toMatch(/residency === "BOARDER"/);
  });
});

describe("parent-chrome · Boarding is a boarding-school-only 8th tab", () => {
  const nav = () => readCode("app/(parent)/parent-chrome.tsx");
  const page = () => readCode("app/(parent)/boarding/page.tsx");

  it("Boarding is in the tab set at /boarding, gated on schoolType, and self-gating via requireParent", () => {
    const s = nav();
    expect(s).toMatch(/"Boarding"/);
    expect(s).toMatch(/Boarding: "\/boarding"/);
    expect(s).toMatch(/async function ParentNav/); // async so it can gate
    expect(s).toMatch(/schoolType !== "BASIC"/); // boarding schools only
    expect(s).toMatch(/t !== "Boarding" \|\| boardingSchool/); // filtered out for BASIC schools
    expect(s).not.toMatch(/Partial<Record/);
    expect((s.match(/<span/g) ?? []).length).toBe(1);
  });

  it("the boarding route is read-only, active-nav, and never reveals a removal or exeat", () => {
    const s = page();
    expect(s).toMatch(/ParentNav active="Boarding"/);
    expect(s).toMatch(/NoChild/);
    expect(s).toMatch(/NotABoarder/); // day/deboardinized collapse
    expect(s).not.toMatch(/^"use client"/m); // read-only server component
    expect(s).not.toMatch(/Pay now|sendSms|gateway/i); // no write/gateway
    expect(s).not.toMatch(/deboardiniz|expelled|removed from board/i); // the removal is never shown
    expect(s).not.toMatch(/\bexeat\b/i); // exeat is phase 2
  });
});
