import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Tx } from "@/lib/db";

/**
 * #297 · State-1 console meeting-notify — BEHAVIOURAL proof of the convene → parent-SMS fence. The real
 * derivation (loadMeetingNotifyPhones) and the real SMS path (flushSms → the console provider) run against
 * a fake tx; ONLY the auth/db/audit/revalidate seams are mocked. This pins:
 *   • post-commit (#253): the invite SMS goes out ONLY after the convene tx resolves — a tx that rejects
 *     after collecting sends NOTHING (no false "meeting is on" after a rolled-back convene);
 *   • audience == the scope's PRIMARY-guardian roster, DEDUPED by phone, non-null only (no-phone skipped);
 *   • notifyParents=false → no intents, a NULL parents_notified_at stamp, and no notify audit row;
 *   • the notify audit carries the recipient COUNT + meeting id ONLY — never a phone or a message body.
 */

// ── seams (only these are mocked; the derivation + SMS path are the real modules) ────────────────────
const requireSchool = vi.fn(async () => ({
  school: { id: "s1", name: "Asankrangwa SHS" },
  user: { id: "u1", roles: ["ADMIN"] },
}));
const resolveActor = vi.fn(async () => ({ id: "u1", role: "ADMIN" }));
vi.mock("@/lib/auth/server", () => ({
  requireSchool: () => requireSchool(),
  resolveActor: () => resolveActor(),
}));

const recordAudit = vi.fn(async () => {});
vi.mock("@/lib/db/audit", () => ({ recordAudit: (...a: unknown[]) => recordAudit(...a) }));
vi.mock("@/lib/revalidate", () => ({ safeRevalidate: vi.fn() }));

// withSchool is driven per-test; isUniqueViolation is imported at module load (markAttendance) — stub it.
const withSchool = vi.fn();
vi.mock("@/lib/db/rls", () => ({
  withSchool: (...a: unknown[]) => withSchool(...a),
  isUniqueViolation: () => false,
}));

const { conveneMeeting } = await import("./pta-meeting");

// ── a queue-driven fake tx: each awaited query resolves the next queued rowset; insert values captured ─
interface Sink {
  values: Record<string, unknown>[];
}
function fakeTx(queue: unknown[][], sink: Sink): Tx {
  let i = 0;
  const t: Record<string, unknown> = {};
  for (const m of ["select", "from", "leftJoin", "innerJoin", "where", "orderBy", "groupBy", "limit", "insert", "returning", "update", "set", "delete"]) {
    t[m] = () => t;
  }
  t.values = (v: Record<string, unknown>) => {
    sink.values.push(v);
    return t;
  };
  // thenable — the whole builder chain is evaluated synchronously, then awaited once (one queue slot).
  (t as { then: (r: (v: unknown) => void) => void }).then = (resolve) => resolve(queue[i++] ?? []);
  return t as unknown as Tx;
}

// The scope roster the reader returns: a duplicate phone, a NULL phone, and a whitespace-padded phone —
// so a correct audience is exactly TWO distinct, trimmed, non-null numbers.
const GUARDIAN_ROWS = [
  { phone: "0244000001" },
  { phone: "0244000001" }, // duplicate → collapses
  { phone: null }, // no phone → skipped (no throw)
  { phone: " 0244000002 " }, // trimmed
];
const PTA_ROW = [
  {
    id: "pta1",
    tierType: "FORM",
    status: "ACTIVE",
    classId: "c1",
    houseId: null,
    className: "Form 2 Science",
    houseName: null,
    classTeacherUserId: null,
    hmUserId: null,
    tierSettings: {},
  },
];
const PERIOD_ROW = [{ periodId: "per1", startsOn: "2000-01-01", endsOn: "2999-12-31" }];
const INSERT_ROW = [{ id: "m1" }];
const OFFICER_ROWS: unknown[] = []; // no stored offices — ADMIN passes via break-glass

const validInput = (over: Record<string, unknown> = {}) => ({
  ptaId: "11111111-1111-1111-1111-111111111111",
  meetingType: "Regular PTA meeting",
  meetingDate: "2026-06-01",
  startTime: "10:00",
  endTime: "12:00",
  location: "Block C",
  ...over,
});

const smsLogs = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls.map((c) => String(c[0])).filter((s) => s.includes("[sms:console]"));

let infoSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  recordAudit.mockClear();
  infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("#297 · convene notifies the parent roster AFTER commit (default notifyParents=true)", () => {
  it("SMSes exactly the deduped, non-null scope roster — post-commit, one message each", async () => {
    const sink: Sink = { values: [] };
    withSchool.mockImplementation(async (_id: string, cb: (tx: Tx) => Promise<unknown>) =>
      cb(fakeTx([PTA_ROW, OFFICER_ROWS, PERIOD_ROW, INSERT_ROW, GUARDIAN_ROWS], sink)),
    );

    const res = await conveneMeeting(validInput());
    expect(res.ok).toBe(true);

    // audience == roster deduped/non-null: 4 rows (1 dup, 1 null) → exactly 2 sends, one body each.
    const logs = smsLogs(infoSpy);
    expect(logs).toHaveLength(2);
    for (const line of logs) expect(line).toContain("Regular PTA meeting");

    // the stamp is the convene instant (a Date), not null.
    expect(sink.values[0]?.parentsNotifiedAt).toBeInstanceOf(Date);
  });

  it("writes ONE notify audit row — recipient COUNT + meeting id only, never a phone or a body", async () => {
    const sink: Sink = { values: [] };
    withSchool.mockImplementation(async (_id: string, cb: (tx: Tx) => Promise<unknown>) =>
      cb(fakeTx([PTA_ROW, OFFICER_ROWS, PERIOD_ROW, INSERT_ROW, GUARDIAN_ROWS], sink)),
    );

    await conveneMeeting(validInput());

    // convene audit + notify audit = 2 rows on pta_meeting.
    const notify = recordAudit.mock.calls.find((c) => /invite SMS queued/i.test(String((c[1] as { reason?: string })?.reason)));
    expect(notify).toBeDefined();
    const arg = notify![1] as { entityType: string; entityId: string; after: Record<string, unknown> };
    expect(arg.entityType).toBe("pta_meeting");
    expect(arg.entityId).toBe("m1");
    expect(arg.after).toEqual({ parentsNotified: 2 });

    // no audit row anywhere leaks a phone number or the SMS body.
    const serialized = JSON.stringify(recordAudit.mock.calls);
    expect(serialized).not.toContain("0244000001");
    expect(serialized).not.toContain("0244000002");
    expect(serialized).not.toContain("Please attend");
  });
});

describe("#297 · the post-commit fence — a rolled-back convene sends nothing", () => {
  it("withSchool rejects after the callback collected → flushSms never runs, no SMS goes out", async () => {
    const sink: Sink = { values: [] };
    withSchool.mockImplementation(async (_id: string, cb: (tx: Tx) => Promise<unknown>) => {
      await cb(fakeTx([PTA_ROW, OFFICER_ROWS, PERIOD_ROW, INSERT_ROW, GUARDIAN_ROWS], sink));
      throw new Error("tx rolled back");
    });

    const res = await conveneMeeting(validInput());
    expect(res.ok).toBe(false);
    expect(smsLogs(infoSpy)).toHaveLength(0); // nothing sent after a rolled-back convene
  });
});

describe("#297 · notifyParents=false — no intents, null stamp, no notify audit", () => {
  it("sends nothing, stamps parents_notified_at NULL, and writes no notify audit row", async () => {
    const sink: Sink = { values: [] };
    // No guardian rowset is queued — the notify block must not run (it would consume it and send).
    withSchool.mockImplementation(async (_id: string, cb: (tx: Tx) => Promise<unknown>) =>
      cb(fakeTx([PTA_ROW, OFFICER_ROWS, PERIOD_ROW, INSERT_ROW], sink)),
    );

    const res = await conveneMeeting(validInput({ notifyParents: false }));
    expect(res.ok).toBe(true);
    expect(smsLogs(infoSpy)).toHaveLength(0);
    expect(sink.values[0]?.parentsNotifiedAt).toBeNull();
    expect(recordAudit.mock.calls.some((c) => /invite SMS queued/i.test(String((c[1] as { reason?: string })?.reason)))).toBe(false);
  });
});
