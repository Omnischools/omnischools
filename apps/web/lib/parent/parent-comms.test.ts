import { describe, it, expect } from "vitest";
import { readCode } from "@/lib/test-utils/source-shape";
import { buildParentComms, type CommsRow } from "./parent-comms-data";

/**
 * INCR-COMM · parent-portal Communications (2-way messages). This is the FIRST parent WRITE path, so the
 * write action's trust boundary is the centerpiece. Guards:
 *  1. the PURE read derivation (buildParentComms) — direction→sender mapping + honest counts.
 *  2. source-shape: the reader stays a safe key-set under withParentScope; the WRITE action server-forces
 *     direction=INBOUND + own sender, sends NO SMS, never touches read_at, and validates the body.
 */

const D = (iso: string) => new Date(iso);
const ROWS: CommsRow[] = [
  { direction: "OUTBOUND", body: "Fees reminder", createdAt: D("2026-05-01T09:00:00Z") },
  { direction: "INBOUND", body: "I'll pay Friday", createdAt: D("2026-05-01T10:00:00Z") },
  { direction: "OUTBOUND", body: "Noted, thank you", createdAt: D("2026-05-02T08:00:00Z") },
];

describe("buildParentComms · read derivation (AC-COMM-02/03)", () => {
  it("maps direction to sender side and counts the parent's own replies", () => {
    const c = buildParentComms(ROWS);
    expect(c.messages.map((m) => m.sender)).toEqual(["school", "you", "school"]);
    expect(c.total).toBe(3);
    expect(c.repliedByYou).toBe(1); // one INBOUND
    expect(c.lastMessageAt).toEqual(D("2026-05-02T08:00:00Z"));
    // never the raw admin vocabulary
    expect(c.messages.every((m) => m.sender === "school" || m.sender === "you")).toBe(true);
  });

  it("empty thread → honest zero (no fabricated messages)", () => {
    const c = buildParentComms([]);
    expect(c).toEqual({ messages: [], total: 0, repliedByYou: 0, lastMessageAt: null });
  });
});

describe("parent-comms-data · reader is a safe key-set under withParentScope (AC-COMM-01/05)", () => {
  const reader = () => readCode("lib/parent/parent-comms-data.ts");

  it("runs under withParentScope only — never withSchool / withoutTenantScope", () => {
    const s = reader();
    expect(s).toMatch(/withParentScope/);
    expect(s).not.toMatch(/withSchool|withoutTenantScope/);
  });

  it("selects only the parent-facing message columns; never staff/routing/read-state fields", () => {
    const s = reader();
    expect(s).toMatch(/inboxMessages\.direction/);
    expect(s).toMatch(/inboxMessages\.body/);
    // the deny-list — target actual Drizzle column access (comments name them as the deny-list).
    expect(s).not.toMatch(/inboxMessages\.sentByUserId/);
    expect(s).not.toMatch(/conversations\.assignedToUserId/);
    expect(s).not.toMatch(/conversations\.routedByRule/);
    expect(s).not.toMatch(/conversations\.topic/);
    expect(s).not.toMatch(/conversations\.readAt/);
    expect(s).not.toMatch(/conversations\.channel/);
    // scoped by the parent's OWN phone, not by student (co-guardian-thread leak guard)
    expect(s).toMatch(/eq\(conversations\.contactPhone, guardianPhone\)/);
  });
});

describe("parent-comms action · the write trust boundary (AC-COMM-05..11)", () => {
  const action = () => readCode("lib/actions/parent-comms.ts");

  it("is a parent-gated server action under withParentScope", () => {
    const s = action();
    expect(s).toMatch(/^"use server"/m);
    expect(s).toMatch(/requireParent\(\)/); // NOT requireSchool
    expect(s).not.toMatch(/requireSchool/);
    expect(s).toMatch(/withParentScope/);
    expect(s).not.toMatch(/\bwithSchool\b/);
  });

  it("SERVER-FORCES direction=INBOUND and the parent's own id as sender (anti-spoof)", () => {
    const s = action();
    expect(s).toMatch(/direction: "INBOUND"/);
    expect(s).toMatch(/sentByUserId: user\.id/);
    // direction/sender are never taken from client input — the Zod schema accepts ONLY body.
    expect(s).toMatch(/z\.object\(\{ body:/);
    expect(s).not.toMatch(/direction: input|direction: parsed/);
  });

  it("sends NO SMS and never touches read_at (leaves the thread unread for staff)", () => {
    const s = action();
    expect(s).not.toMatch(/sendSms|sendSMS/); // in-app only — SMS stays deferred
    expect(s).not.toMatch(/readAt/); // read_at is deliberately left untouched (comment uses snake_case)
  });

  it("bumps the thread via the scoped SECURITY DEFINER fn, not a denied direct UPDATE (AC-COMM-09)", () => {
    const s = action();
    // parent_no_update denies a direct parent UPDATE on conversation; the bump must go through the fn.
    expect(s).toMatch(/parent_bump_conversation/);
    expect(s).not.toMatch(/\.update\(conversations\)/);
  });

  it("validates the body and guards duplicate submits", () => {
    const s = action();
    expect(s).toMatch(/\.min\(1/);
    expect(s).toMatch(/\.max\(1000/);
    expect(s).toMatch(/DUP_WINDOW_MS/); // duplicate-submit guard
  });
});

describe("parent-chrome / page · Messages is the 6th live tab (AC-COMM-01)", () => {
  const nav = () => readCode("app/(parent)/parent-chrome.tsx");
  const page = () => readCode("app/(parent)/messages/page.tsx");

  // Count-robust (not the whole TABS literal) so the next tab can't red this — the calendar/attendance lesson.
  it("Messages is a live tab at /messages, still no inert span", () => {
    const s = nav();
    expect(s).toMatch(/"Messages"/); // present in TABS + the ParentTab union
    expect(s).toMatch(/Messages: "\/messages"/);
    expect(s).not.toMatch(/Partial<Record/);
    expect((s.match(/<span/g) ?? []).length).toBe(1);
  });

  it("the messages route is child-gated, renders its own active nav, and sends no SMS", () => {
    const s = page();
    expect(s).toMatch(/ParentNav active="Messages"/);
    expect(s).toMatch(/NoChild/); // per-child/per-parent surface → linked-child gate
    expect(s).not.toMatch(/sendSms/);
  });
});
