import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
import { flushSms, type SmsIntent } from "@/lib/sms";
import { sendArrivalNotification } from "@/lib/boarding/resumption-notify";
import type { Tx } from "@/lib/db";

/**
 * #253 — SMS sends must never run INSIDE a DB transaction: a rolled-back tx would have already fired an
 * irreversible SMS, and holding the tx open across a slow external call blocks the real Hubtel provider.
 * The fix collects `SmsIntent`s in-tx and delivers them via `flushSms` AFTER commit.
 *
 * This suite locks BOTH halves: (1) a structural guard that no `sendSms(` call survives lexically inside
 * any tenant-tx wrapper across every SMS caller, and (2) a behavioural proof on a real site that the
 * intent is only sent post-commit and a rollback sends nothing.
 */

const src = (rel: string) => readFileSync(resolve(cwd(), rel), "utf8");
// Strip comments AND string/template-text so parens inside copy can't skew the brace scan.
const strip = (s: string): string =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""');

// Every module that calls sendSms (the whole SMS surface — not just the boarding sites this fix moved).
const SMS_CALLERS = [
  "lib/actions/attendance.ts",
  "lib/actions/billing.ts",
  "lib/actions/comms.ts",
  "lib/actions/admissions.ts",
  "lib/actions/fees.ts",
  "lib/actions/invites.ts",
  "lib/actions/onboarding.ts",
  "lib/actions/inbox.ts",
  "lib/actions/pta-meeting.ts",
  "lib/actions/staff.ts",
  "lib/actions/users.ts",
  "lib/actions/wassce-readiness.ts",
  "lib/boarding/discipline-core.ts",
  "lib/boarding/exeat-notify.ts",
  "lib/boarding/resumption-notify.ts",
  "lib/boarding/visiting-notify.ts",
];

const TX_WRAPPER = /\b(withSchool|withStaffScope|withParentScope|withoutTenantScope|transaction)\s*\(/g;
const REAL_SEND = /\bsendSms\s*\(\s*[^)\s]/; // a call with a real first arg (excludes bare `sendSms()` in prose)

/** True if any `sendSms(...)` call sits inside a tenant-tx wrapper's argument list (its callback body). */
function sendInsideTx(source: string): boolean {
  const s = strip(source);
  TX_WRAPPER.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TX_WRAPPER.exec(s))) {
    const open = m.index + m[0].length - 1; // index of the wrapper's '('
    let depth = 0;
    let i = open;
    for (; i < s.length; i++) {
      if (s[i] === "(") depth++;
      else if (s[i] === ")" && --depth === 0) break;
    }
    if (REAL_SEND.test(s.slice(open, i + 1))) return true;
  }
  return false;
}

describe("#253 structural lock — no sendSms inside a DB transaction", () => {
  it.each(SMS_CALLERS)("%s never calls sendSms inside a tenant-tx wrapper", (rel) => {
    expect(sendInsideTx(src(rel))).toBe(false);
  });

  it("the moved boarding sites deliver via flushSms after commit", () => {
    for (const rel of [
      "lib/boarding/exeat-notify.ts",
      "lib/boarding/resumption-notify.ts",
      "lib/boarding/visiting-notify.ts",
    ]) {
      expect(src(rel)).toMatch(/flushSms\(/);
    }
    // discipline-core hands its intent up to the caller — no real sendSms call survives in it.
    expect(strip(src("lib/boarding/discipline-core.ts"))).not.toMatch(REAL_SEND);
  });
});

// A minimal drizzle-tx double: each `.limit(1)` resolves the next queued result row-set.
function fakeTx(rowSets: unknown[][]): Tx {
  let i = 0;
  const chain: Record<string, unknown> = {};
  for (const key of ["select", "from", "where", "innerJoin"]) chain[key] = () => chain;
  chain.limit = () => Promise.resolve(rowSets[i++] ?? []);
  return chain as unknown as Tx;
}

describe("#253 behavioural — sendArrivalNotification collects in-tx, sends post-commit", () => {
  afterEach(() => vi.restoreAllMocks());

  const STUDENT = [{ firstName: "Ama", lastName: "Boakye" }];
  const GUARDIAN = [{ phone: "0244123456" }];
  const BODY = "A. Boakye safely arrived at Test School. Items checked. Welcome back.";

  it("happy path: nothing sends until flushSms runs after the tx commits", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const sms: SmsIntent[] = [];

    // Simulate the owner: run the in-tx work to completion (a "commit").
    await sendArrivalNotification(fakeTx([STUDENT, GUARDIAN]), "school-1", "stu-1", "RESUMPTION", "Test School", sms);

    // The intent is collected but NOT yet sent while "inside" the tx.
    expect(sms).toEqual([{ to: "0244123456", body: BODY }]);
    expect(info).not.toHaveBeenCalled();

    // Post-commit delivery sends exactly once, to the same recipient/message.
    await flushSms(sms);
    expect(info).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0]?.[0])).toContain(BODY);
  });

  it("rollback: the owner throws after collecting, so flushSms never runs and no SMS is sent", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const sms: SmsIntent[] = [];

    // The owner pattern is: `await withSchool(...work...); await flushSms(sms);`
    // A tx that throws rejects BEFORE the flush line is reached.
    const owner = async () => {
      await sendArrivalNotification(fakeTx([STUDENT, GUARDIAN]), "school-1", "stu-1", "RESUMPTION", "Test School", sms);
      throw new Error("tx rolled back");
      // unreachable: await flushSms(sms)
    };

    await expect(owner()).rejects.toThrow("tx rolled back");
    expect(info).not.toHaveBeenCalled(); // no false SMS followed the rolled-back tx
  });
});
