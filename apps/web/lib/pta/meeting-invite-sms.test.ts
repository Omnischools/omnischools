import { describe, it, expect } from "vitest";
import { ptaMeetingInviteSms, type PtaMeetingInviteInput } from "./meeting-invite-sms";
import { smsSegments } from "@/lib/sms";

/**
 * #297 · the PURE PTA meeting-invite SMS body. Meeting-details-only, GSM-7, ≤2 segments — proven here so
 * the console notify path can never smuggle a payment link / dues figure / RSVP instruction into the body.
 */

const base: PtaMeetingInviteInput = {
  schoolName: "Asankrangwa SHS",
  ptaLabel: "Form 2 Science PTA",
  meetingType: "Regular PTA meeting",
  dateLabel: "Thu 14 May 2026",
  startTime: "10:00",
  endTime: "12:00",
  location: "Block C, room 4",
};

const isGsm7 = (s: string) => [...s].every((c) => c.charCodeAt(0) < 128);

describe("#297 · ptaMeetingInviteSms — meeting details only", () => {
  it("carries the school, PTA, type, date, time and location", () => {
    const body = ptaMeetingInviteSms(base);
    expect(body).toContain("Asankrangwa SHS");
    expect(body).toContain("Form 2 Science PTA");
    expect(body).toContain("Regular PTA meeting");
    expect(body).toContain("Thu 14 May 2026");
    expect(body).toContain("10:00-12:00");
    expect(body).toContain("Block C, room 4");
  });

  it("omits the location clause when there is no location", () => {
    const body = ptaMeetingInviteSms({ ...base, location: null });
    expect(body).not.toContain(" at ");
    expect(body).toContain("Please attend.");
  });

  it("is GSM-7 (plain ASCII — no em-dash / smart quotes)", () => {
    expect(isGsm7(ptaMeetingInviteSms(base))).toBe(true);
    expect(ptaMeetingInviteSms(base)).not.toMatch(/[—“”‘’]/);
  });

  it("is at most TWO GSM-7 segments (bounded cost)", () => {
    expect(smsSegments(ptaMeetingInviteSms(base))).toBeLessThanOrEqual(2);
    expect(smsSegments(ptaMeetingInviteSms({ ...base, location: null }))).toBeLessThanOrEqual(2);
  });

  it("stays ≤2 segments even with a maximal type + location (drops location, then hard-caps)", () => {
    const body = ptaMeetingInviteSms({
      ...base,
      schoolName: "A".repeat(120),
      meetingType: "T".repeat(120),
      location: "L".repeat(200),
    });
    expect(smsSegments(body)).toBeLessThanOrEqual(2);
    expect(body.length).toBeLessThanOrEqual(306);
  });

  it("carries NO payment link, dues figure or RSVP instruction (scope fence)", () => {
    const body = ptaMeetingInviteSms(base);
    for (const banned of [/GHS/i, /https?:\/\//, /\bRSVP\b/i, /\breply\b/i, /\bdues\b/i, /\bpay\b/i]) {
      expect(body, `must not contain ${banned}`).not.toMatch(banned);
    }
  });
});
