import { describe, it, expect } from "vitest";
import { hasAnyRole, SICKBAY_CLINICAL_READ_ROLES, SICKBAY_CLINICAL_WRITE_ROLES } from "@/lib/access";
import { readCode } from "@/lib/test-utils/source-shape";

/**
 * INCR-26 · Quinn — the structural guards on the write path + reads the Node suite cannot run (both
 * reach the DB driver). These RED in `pnpm test` the day the console boundary is crossed, a log row is
 * written for a non-SMS-outbound event, sickbay_notification is UPDATEd outside the one stamp, a cron
 * symbol appears, private_note leaks to a HEADMASTER, or the gate widens. Source-shape, comment-stripped.
 */
const ACTION = "lib/actions/sickbay-notify.ts";
const READS = "lib/sickbay/notify-reads.ts";
const PURE = "lib/sickbay/notify.ts";

// ============================================================================
// 🔴 NF1 — the console boundary is STRUCTURAL: no provider symbol, no HUBTEL, no secret
// ============================================================================
describe("🔴 NF1 · the notify write path never imports/calls a provider and reads no HUBTEL_* env", () => {
  it("no getSmsProvider / sendSms / HUBTEL / SmsProvider anywhere in the action or reads or pure", () => {
    for (const p of [ACTION, READS, PURE]) {
      const s = readCode(p);
      for (const forbidden of ["getSmsProvider", "sendSms", "HUBTEL", "SmsProvider", "@/lib/sms", "@/lib/env"]) {
        expect(s.includes(forbidden), `${p} must not reference "${forbidden}" (console boundary is structural)`).toBe(false);
      }
    }
  });

  it("🔴 NF2 · every notification_log write is QUEUED/console and nothing advances it to SENT/FAILED", () => {
    const s = readCode(ACTION);
    // Both log writes (live send + scheduled stamp) hardcode the terminal QUEUED/console pair.
    const statuses = [...s.matchAll(/status:\s*"([A-Z]+)"/g)].map((m) => m[1]);
    expect(statuses.length, "expected the two notification_log writes").toBeGreaterThanOrEqual(2);
    for (const st of statuses) expect(st, "a log write must be QUEUED").toBe("QUEUED");
    expect(s, "provider is console").toContain('provider: "console"');
    // No code path advances a log to SENT/FAILED (dispatch does not exist on a console build).
    expect(s.includes('"SENT"'), "the action must not write SENT").toBe(false);
    expect(s.includes('"FAILED"'), "the action must not write FAILED").toBe(false);
  });
});

// ============================================================================
// 🔴 NF9 — notification_log is written for SMS-OUTBOUND only; NF8 — inbound never links a log
// ============================================================================
describe("🔴 NF9/NF8 · the log link is SMS-OUTBOUND only", () => {
  it("insertNotification gates the log write on channel SMS + direction OUTBOUND + not scheduled", () => {
    const s = readCode(ACTION);
    expect(s).toMatch(/isLiveSms\s*=\s*args\.channel\s*===\s*"SMS"\s*&&\s*args\.direction\s*===\s*"OUTBOUND"\s*&&\s*!args\.scheduledFor/);
    // The log insert sits inside the isLiveSms branch.
    const branch = s.slice(s.indexOf("if (isLiveSms)"), s.indexOf(".insert(sickbayNotification)"));
    expect(branch, "the log write must be inside the isLiveSms branch").toContain(".insert(notificationLog)");
  });

  it("the inbound action sets direction INBOUND and writes no log link (log gate excludes it)", () => {
    const s = readCode(ACTION);
    const fn = s.slice(s.indexOf("export async function logInboundContact"), s.indexOf("export async function scheduleReminder"));
    expect(fn).toContain('direction: "INBOUND"');
    // The inbound path passes no phone and channel CALL/SMS but direction INBOUND ⇒ isLiveSms false.
    expect(fn.includes(".insert(notificationLog)"), "inbound must not write a log directly").toBe(false);
  });
});

// ============================================================================
// 🔴 NF5 — append-only: the ONLY sickbay_notification UPDATE is the scheduled-send stamp
// ============================================================================
describe("🔴 NF5/NF6 · append-only — one UPDATE, exactly { sentAt, notificationLogId }, no delete", () => {
  it("the action UPDATEs sickbay_notification exactly once, inside sendScheduledReminder", () => {
    const s = readCode(ACTION);
    const updates = [...s.matchAll(/\.update\(sickbayNotification\)/g)];
    expect(updates.length, "exactly one sickbay_notification UPDATE in the whole module").toBe(1);
    // It lives in sendScheduledReminder and sets only the two fulfillment fields.
    const fn = s.slice(s.indexOf("export async function sendScheduledReminder"));
    expect(fn).toContain(".update(sickbayNotification)");
    expect(fn).toMatch(/\.set\(\{\s*sentAt:\s*now,\s*notificationLogId:\s*log\.id\s*\}\)/);
  });

  it("no DELETE of sickbay_notification anywhere", () => {
    const s = readCode(ACTION);
    expect(s.includes(".delete(sickbayNotification)"), "the module must never delete a notification").toBe(false);
  });
});

// ============================================================================
// 🔴 NF10 — no cron / scheduled-job symbol; the due state is on-read only
// ============================================================================
describe("🔴 NF10 · no cron/queue/scheduler symbol — the matron sends at the window", () => {
  it("the action + reads carry no cron/worker/setInterval symbol", () => {
    for (const p of [ACTION, READS]) {
      const s = readCode(p);
      for (const sym of ["cron", "setInterval", "setTimeout", "queueWorker", "Vercel Cron", "pg_cron"]) {
        expect(s.toLowerCase().includes(sym.toLowerCase()), `${p} must not reference "${sym}"`).toBe(false);
      }
    }
  });
});

// ============================================================================
// 🔴 NF12 — the gate: WRITE=[MATRON]; the write path authorizes first
// ============================================================================
describe("🔴 NF12 · gate matrix — WRITE is MATRON only, authorized as the first statement", () => {
  it("clinical write is exactly [MATRON]; ADMIN/BURSAR/HOUSEMASTER/HEADMASTER cannot write", () => {
    expect([...SICKBAY_CLINICAL_WRITE_ROLES]).toEqual(["MATRON"]);
    for (const r of ["ADMIN", "BURSAR", "HOUSEMASTER", "HEADMASTER", "TEACHER", "PARENT", "STUDENT"]) {
      expect(hasAnyRole([r], SICKBAY_CLINICAL_WRITE_ROLES), `${r} must not write`).toBe(false);
    }
  });

  it("full-thread read is [HEADMASTER, MATRON] only", () => {
    expect([...SICKBAY_CLINICAL_READ_ROLES]).toEqual(["HEADMASTER", "MATRON"]);
    for (const r of ["ADMIN", "BURSAR", "HOUSEMASTER"]) {
      expect(hasAnyRole([r], SICKBAY_CLINICAL_READ_ROLES), `${r} must not read the thread`).toBe(false);
    }
  });

  it("every exported action calls authorizeClinicalWrite before touching the DB", () => {
    const s = readCode(ACTION);
    const actions = [...s.matchAll(/export async function (\w+)\(/g)].map((m) => m[1]);
    expect(actions.length, "expected the notify actions").toBeGreaterThanOrEqual(5);
    for (const fn of actions) {
      const start = s.indexOf(`export async function ${fn}(`);
      const next = s.indexOf("export async function ", start + 1);
      const body = s.slice(start, next === -1 ? undefined : next);
      const auth = body.indexOf("authorizeClinicalWrite()");
      const write = body.search(/withSchool\(/);
      expect(auth, `${fn} must authorize`).toBeGreaterThan(-1);
      if (write > -1) expect(auth, `${fn}: authorize must precede withSchool`).toBeLessThan(write);
    }
  });
});

// ============================================================================
// 🔴 NF11 — private_note is MATRON-only in the reads projection
// ============================================================================
describe("🔴 NF11 · the thread reader trims private_note for a non-MATRON via the canReadPrivateNote flag", () => {
  it("getReferralThread gates privateNote through projectPrivateNote(canReadPrivateNote)", () => {
    const s = readCode(READS);
    expect(s).toMatch(/getReferralThread\([\s\S]*?canReadPrivateNote:\s*boolean/);
    expect(s, "the thread must project the note through the trim").toMatch(
      /projectPrivateNote\(r\.privateNote,\s*canReadPrivateNote\)/,
    );
  });

  it("the §03 timeline + §05 log never select private_note (only the thread renders it)", () => {
    const s = readCode(READS);
    const timeline = s.slice(s.indexOf("getTodayNotifications"), s.indexOf("getVisitCommsLog"));
    const log = s.slice(s.indexOf("getVisitCommsLog"));
    expect(timeline.includes("privateNote"), "the timeline must not read private_note").toBe(false);
    expect(log.includes("privateNote"), "the visit log must not read private_note").toBe(false);
  });
});

// ============================================================================
// 🔴 NF-audit — the audit feed carries event metadata only (no body/private_note/clinical text)
// ============================================================================
describe("🔴 audit before/after carries no body, no private_note, no clinical text", () => {
  it("every audit payload omits body/privateNote", () => {
    const s = readCode(ACTION);
    const blocks = [...s.matchAll(/(?:before|after):\s*\{[^{}]*\}/g)].map((m) => m[0]);
    expect(blocks.length, "audit payloads must be extractable").toBeGreaterThan(3);
    const joined = blocks.join("\n");
    expect(joined.includes("body"), "an audit payload leaks body").toBe(false);
    expect(joined.includes("privateNote"), "an audit payload leaks privateNote").toBe(false);
  });
});

// ============================================================================
// 🔴 NF4 — no "escalate" affordance in the write path
// ============================================================================
describe("🔴 NF4 · no escalate control, no HEADMASTER/DISTRICT row written", () => {
  it("the action never writes recipient HEADMASTER or DISTRICT_HEALTH and has no escalate export", () => {
    const s = readCode(ACTION);
    expect(s.includes('recipient: "HEADMASTER"'), "no HEADMASTER row is written at INCR-26").toBe(false);
    expect(s.includes('recipient: "DISTRICT_HEALTH"'), "no DISTRICT row is written at INCR-26").toBe(false);
    expect(/escalate/i.test(s), "no escalate affordance").toBe(false);
  });
});
