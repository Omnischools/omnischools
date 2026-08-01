import { describe, it, expect } from "vitest";
import {
  coalesceGraceHours,
  derivePtaMeetingClock,
  deriveParentStatus,
  deriveTeacherStatus,
  isPtaMeetingWriteLocked,
  isPtaMeetingEnded,
  DEFAULT_REGISTER_LOCK_GRACE_HOURS,
} from "./meeting-clock";

// A Saturday 10:00–12:00 meeting (Ghana = UTC+0, so the "HH:MM" composes UTC-directly).
const DATE = "2026-05-30";
const START = "10:00";
const END = "12:00";
const at = (iso: string) => new Date(iso);

describe("coalesceGraceHours (R432)", () => {
  it("defaults to 24h when tier_settings has no override", () => {
    expect(coalesceGraceHours(null)).toBe(DEFAULT_REGISTER_LOCK_GRACE_HOURS);
    expect(coalesceGraceHours({})).toBe(24);
  });
  it("reads a numeric override off the opaque string bag", () => {
    expect(coalesceGraceHours({ register_lock_grace_hours: "6" })).toBe(6);
    expect(coalesceGraceHours({ register_lock_grace_hours: "0" })).toBe(0);
  });
  it("falls back on a blank / non-numeric / negative value (never throws)", () => {
    expect(coalesceGraceHours({ register_lock_grace_hours: "" })).toBe(24);
    expect(coalesceGraceHours({ register_lock_grace_hours: "soon" })).toBe(24);
    expect(coalesceGraceHours({ register_lock_grace_hours: "-3" })).toBe(24);
  });
});

describe("derivePtaMeetingClock (R432 lifecycle)", () => {
  it("before start → scheduled, not write-locked, parents NOT finalised", () => {
    const c = derivePtaMeetingClock(DATE, START, END, 24, at("2026-05-30T09:00:00Z"));
    expect(c.state).toBe("scheduled");
    expect(c.writeLocked).toBe(false);
    expect(c.parentsFinalised).toBe(false);
    expect(c.totalMin).toBe(120);
    expect(c.windowLabel).toBe("10:00 — 12:00 PM");
    expect(c.startLabel).toBe("10:00 AM");
  });

  it("during the meeting → held, editable, parents still awaiting", () => {
    const c = derivePtaMeetingClock(DATE, START, END, 24, at("2026-05-30T10:23:00Z"));
    expect(c.state).toBe("held");
    expect(c.writeLocked).toBe(false);
    expect(c.parentsFinalised).toBe(false);
    expect(c.elapsedMin).toBe(23);
  });

  it("after end but within the grace window → still HELD + editable (the finalise tail)", () => {
    // 12:00 end + 24h grace ⇒ locks 2026-05-31T12:00Z. 3pm same day is well inside the grace window.
    const c = derivePtaMeetingClock(DATE, START, END, 24, at("2026-05-30T15:00:00Z"));
    expect(c.state).toBe("held");
    expect(c.writeLocked).toBe(false);
    expect(c.parentsFinalised).toBe(false);
    expect(c.remainingMin).toBe(0);
  });

  it("after end + grace → closed, write-locked, parents finalised (the R435 flip)", () => {
    const c = derivePtaMeetingClock(DATE, START, END, 24, at("2026-06-01T09:00:00Z"));
    expect(c.state).toBe("closed");
    expect(c.writeLocked).toBe(true);
    expect(c.parentsFinalised).toBe(true);
  });

  it("a 0h grace locks exactly at end_time", () => {
    const justBefore = derivePtaMeetingClock(DATE, START, END, 0, at("2026-05-30T11:59:00Z"));
    const atEnd = derivePtaMeetingClock(DATE, START, END, 0, at("2026-05-30T12:00:00Z"));
    expect(justBefore.writeLocked).toBe(false);
    expect(atEnd.writeLocked).toBe(true);
    expect(atEnd.state).toBe("closed");
  });

  it("emits the 4 lifecycle pills, step 1 always done", () => {
    const c = derivePtaMeetingClock(DATE, START, END, 24, at("2026-05-30T10:23:00Z"));
    expect(c.pills).toHaveLength(4);
    expect(c.pills[0].state).toBe("done"); // convened
    expect(c.pills[1].state).toBe("active"); // live
    expect(c.pills[3].state).toBe("pending"); // closed
  });
});

// R435 — the per-register default polarity (the honesty crux).
describe("deriveTeacherStatus (R435 — present-by-default)", () => {
  it("no row ⇒ present (PLC-verbatim)", () => {
    expect(deriveTeacherStatus(undefined)).toBe("present");
    expect(deriveTeacherStatus(null)).toBe("present");
  });
  it("a stray PRESENT row still reads present; LATE ⇒ late; ABSENT/E/M ⇒ absent", () => {
    expect(deriveTeacherStatus("PRESENT")).toBe("present");
    expect(deriveTeacherStatus("LATE")).toBe("late");
    expect(deriveTeacherStatus("ABSENT")).toBe("absent");
    expect(deriveTeacherStatus("EXCUSED")).toBe("absent");
    expect(deriveTeacherStatus("MEDICAL")).toBe("absent");
  });
  it("a teacher is NEVER 'awaiting' (that is the parent-only state)", () => {
    expect(deriveTeacherStatus(undefined)).not.toBe("awaiting");
  });
});

describe("deriveParentStatus (R435 — absent-by-default, the flip)", () => {
  it("no row while the register is OPEN ⇒ awaiting (never a fabricated absent row)", () => {
    expect(deriveParentStatus(undefined, false)).toBe("awaiting");
    expect(deriveParentStatus(null, false)).toBe("awaiting");
  });
  it("no row once FINALISED ⇒ absent (a pure read-time flip)", () => {
    expect(deriveParentStatus(undefined, true)).toBe("absent");
  });
  it("a row is an arrival — PRESENT/LATE regardless of finalisation", () => {
    expect(deriveParentStatus("PRESENT", false)).toBe("present");
    expect(deriveParentStatus("PRESENT", true)).toBe("present");
    expect(deriveParentStatus("LATE", false)).toBe("late");
    expect(deriveParentStatus("LATE", true)).toBe("late");
  });
});

describe("isPtaMeetingWriteLocked (R432 refuse-after-close · the INCR-53 ADOPT gate)", () => {
  it("mirrors the clock's write-lock boundary (end + grace)", () => {
    expect(isPtaMeetingWriteLocked(DATE, END, 24, at("2026-05-30T15:00:00Z"))).toBe(false);
    expect(isPtaMeetingWriteLocked(DATE, END, 24, at("2026-06-01T09:00:00Z"))).toBe(true);
  });
});

describe("isPtaMeetingEnded (R450 — the INCR-53 DRAFT-create gate: now ≥ end, grace-independent)", () => {
  it("is false before the end bell", () => {
    expect(isPtaMeetingEnded(DATE, END, at("2026-05-30T11:59:00Z"))).toBe(false);
  });
  it("flips true AT end and stays true through the grace window (unlike the write-lock)", () => {
    expect(isPtaMeetingEnded(DATE, END, at("2026-05-30T12:00:00Z"))).toBe(true);
    // 3pm same day: ended (drafting allowed) but NOT yet write-locked (adoption still blocked).
    expect(isPtaMeetingEnded(DATE, END, at("2026-05-30T15:00:00Z"))).toBe(true);
    expect(isPtaMeetingWriteLocked(DATE, END, 24, at("2026-05-30T15:00:00Z"))).toBe(false);
  });
});
