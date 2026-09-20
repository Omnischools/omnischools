import { describe, it, expect } from "vitest";
import {
  durationLabel,
  forbiddenNotificationPatchKey,
  housemasterNotificationBody,
  parentAdmissionConfirmBody,
  parentReferralConfirmBody,
  projectPrivateNote,
  recipientsForTier,
  relativeLabel,
  scheduledState,
  sendScheduledGuard,
  tierForEvent,
  tierGuard,
  NOTIFICATION_MUTABLE_FIELDS,
} from "./notify";

/**
 * INCR-26 · the PURE notify domain. The write path (lib/actions/sickbay-notify.ts) and the reads
 * (notify-reads.ts) reach the DB, so their invariants are pinned by the source-shape suite
 * (notify-projection.test.ts). THESE are the runnable proofs of every rule that decides a value.
 */

// ============================================================================
// 🔴 NF3 — tier = event severity, derived; a contradicting client tier is refused
// ============================================================================
describe("🔴 NF3 · tier is derived from the event severity, never client-picked", () => {
  it("visit→1, admission→2, referral/consult→3", () => {
    expect(tierForEvent("VISIT")).toBe(1);
    expect(tierForEvent("ADMISSION")).toBe(2);
    expect(tierForEvent("REFERRAL")).toBe(3);
    expect(tierForEvent("CONSULT")).toBe(3);
  });

  it("a client tier contradicting the event is refused; a matching one passes; null is a no-op", () => {
    expect(tierGuard("REFERRAL", 1)).toMatch(/contradicts/i); // a referral is tier 3, not 1
    expect(tierGuard("VISIT", 3)).toMatch(/contradicts/i);
    expect(tierGuard("ADMISSION", 2)).toBeNull();
    expect(tierGuard("REFERRAL", 3)).toBeNull();
    expect(tierGuard("REFERRAL", null)).toBeNull();
    expect(tierGuard("REFERRAL", undefined)).toBeNull();
  });
});

// ============================================================================
// 🔴 NF4 — the recipient fan-out; NEVER HEADMASTER / DISTRICT_HEALTH (INCR-27)
// ============================================================================
describe("🔴 NF4 · recipient fan-out per tier — no HEADMASTER/DISTRICT row, no escalate step", () => {
  it("tier 1 writes NO auto row; tier 2 → PARENT; tier 3 → PARENT + HOUSEMASTER", () => {
    expect(recipientsForTier(1)).toEqual([]);
    expect(recipientsForTier(2)).toEqual(["PARENT"]);
    expect(recipientsForTier(3)).toEqual(["PARENT", "HOUSEMASTER"]);
  });

  it("no tier ever fans out to HEADMASTER or DISTRICT_HEALTH", () => {
    for (const t of [1, 2, 3] as const) {
      expect(recipientsForTier(t)).not.toContain("HEADMASTER");
      expect(recipientsForTier(t)).not.toContain("DISTRICT_HEALTH");
    }
  });
});

// ============================================================================
// 🔴 NF13 — the HOUSEMASTER body is a FIXED medical-detail-light template
// ============================================================================
describe("🔴 NF13 · the HM body is the fixed template — never a diagnosis", () => {
  const CONDITIONS = ["malaria", "sickle", "SCD", "crisis", "fracture", "antimalarial", "pain"];
  it("names the student + location and the non-disclosure copy, never a condition", () => {
    const body = housemasterNotificationBody("A. Mensa", "Slessor");
    expect(body).toContain("A. Mensa");
    expect(body).toContain("Slessor House");
    expect(body).toContain("under sickbay care");
    expect(body).toContain("no medical detail to share");
    for (const c of CONDITIONS) {
      expect(body.toLowerCase(), `HM body leaks "${c}"`).not.toContain(c.toLowerCase());
    }
  });

  it("omits the location clause cleanly when the student has no House", () => {
    expect(housemasterNotificationBody("A. Mensa", null)).not.toContain("House");
  });
});

// ============================================================================
// 🔴 A9 — the auto-generated PARENT bodies are diagnosis-free
// ============================================================================
describe("🔴 A9 · auto-confirm parent bodies carry no diagnosis", () => {
  const CONDITIONS = ["malaria", "sickle", "SCD", "crisis", "fracture"];
  it("the referral + admission confirm name the school/hospital, never the condition", () => {
    const ref = parentReferralConfirmBody("Y. Aidoo", "Asankrangwa SHS", "Asankrangwa Govt Hospital");
    const adm = parentAdmissionConfirmBody("A. Mensa", "Asankrangwa SHS");
    for (const body of [ref, adm]) {
      for (const c of CONDITIONS) {
        expect(body.toLowerCase(), `parent body leaks "${c}"`).not.toContain(c.toLowerCase());
      }
      expect(body).toContain("Reply CALL");
    }
    expect(ref).toContain("Asankrangwa Govt Hospital");
  });
});

// ============================================================================
// 🔴 NF5/NF6 — append-only invariant + the one idempotent stamp
// ============================================================================
describe("🔴 NF5 · append-only — only sent_at / notification_log_id may be updated", () => {
  it("the mutable set is exactly the fulfillment fields", () => {
    expect([...NOTIFICATION_MUTABLE_FIELDS]).toEqual(["sentAt", "notificationLogId", "updatedAt"]);
  });

  it("a patch touching body/private_note/tier/recipient is a forbidden key", () => {
    expect(forbiddenNotificationPatchKey({ sentAt: new Date(), notificationLogId: "x" })).toBeNull();
    expect(forbiddenNotificationPatchKey({ body: "edited" })).toBe("body");
    expect(forbiddenNotificationPatchKey({ privateNote: "x" })).toBe("privateNote");
    expect(forbiddenNotificationPatchKey({ tier: 2 })).toBe("tier");
    expect(forbiddenNotificationPatchKey({ recipient: "HEADMASTER" })).toBe("recipient");
  });
});

describe("🔴 NF6 · sendScheduledGuard — a plan row, sent once, re-click is a no-op", () => {
  it("refuses a non-plan row and an already-sent row; allows a pending plan", () => {
    const at = new Date("2026-05-14T17:00:00Z");
    expect(sendScheduledGuard({ scheduledFor: null, sentAt: null })).toMatch(/not a scheduled/i);
    expect(sendScheduledGuard({ scheduledFor: at, sentAt: new Date() })).toMatch(/already/i);
    expect(sendScheduledGuard({ scheduledFor: at, sentAt: null })).toBeNull();
  });
});

// ============================================================================
// 🔴 NF10 — the scheduled state is derived ON-READ from an injected now (no cron)
// ============================================================================
describe("🔴 NF10 · scheduledState — DUE the instant scheduled_for <= now, no ticking clock", () => {
  const at = new Date("2026-05-14T17:00:00Z");
  it("SENT once sent_at is set, regardless of the schedule", () => {
    expect(scheduledState({ scheduledFor: at, sentAt: new Date() }, new Date("2026-05-14T10:00:00Z"))).toBe("SENT");
  });
  it("PENDING before the window, DUE at/after it", () => {
    expect(scheduledState({ scheduledFor: at, sentAt: null }, new Date("2026-05-14T15:30:00Z"))).toBe("PENDING");
    expect(scheduledState({ scheduledFor: at, sentAt: null }, new Date("2026-05-14T17:00:00Z"))).toBe("DUE");
    expect(scheduledState({ scheduledFor: at, sentAt: null }, new Date("2026-05-14T18:00:00Z"))).toBe("DUE");
  });
  it("NONE for a non-scheduled, not-yet-sent row", () => {
    expect(scheduledState({ scheduledFor: null, sentAt: null }, at)).toBe("NONE");
  });
});

// ============================================================================
// 🔴 NF11 — private_note is trimmed to null for a non-MATRON reader
// ============================================================================
describe("🔴 NF11 · projectPrivateNote — MATRON keeps it, HEADMASTER gets null", () => {
  it("returns the note only when the reader may read it", () => {
    expect(projectPrivateNote("mother sounded shaken", true)).toBe("mother sounded shaken");
    expect(projectPrivateNote("mother sounded shaken", false)).toBeNull();
    expect(projectPrivateNote(null, true)).toBeNull();
  });
});

// ============================================================================
// Pure formatters
// ============================================================================
describe("formatters", () => {
  it("durationLabel — m/s, sub-minute, null for no duration", () => {
    expect(durationLabel(252)).toBe("4m 12s");
    expect(durationLabel(47)).toBe("47s");
    expect(durationLabel(null)).toBeNull();
  });
  it("relativeLabel — past 'ago', future 'in'", () => {
    const now = new Date("2026-05-14T15:30:00Z");
    expect(relativeLabel(new Date("2026-05-14T06:50:00Z"), now)).toBe("8h 40m ago");
    expect(relativeLabel(new Date("2026-05-14T15:25:00Z"), now)).toBe("5m ago");
    expect(relativeLabel(new Date("2026-05-14T17:00:00Z"), now)).toBe("in 1h 30m");
  });
});
