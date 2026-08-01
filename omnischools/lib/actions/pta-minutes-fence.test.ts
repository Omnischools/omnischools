import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTableName } from "drizzle-orm";

/**
 * 🔴 INCR-53 (Quinn/Sarah) — ACTION-LEVEL proof that the R451 immutability fence + the R452 quorum→resolution
 * gate are wired into EVERY mutating action, not just the pure `lib/pta/minutes.ts` decision (which
 * minutes.test.ts proves). A fake tx returns a canned parent minute; each mutating action loads its status,
 * hits `adoptedFenceError`, and returns the refusal BEFORE any insert/update/delete — asserted by the write
 * spies staying at zero. Removing the fence from an action would flip a refusal into a write and RED these.
 *
 * The derived loaders (meeting-data / minutes-data) are mocked so the gate + fence are the only things under
 * test; the internal loadMinutesForWrite / loadAgendaItemForWrite still run against the fake tx.
 */

const h = vi.hoisted(() => ({
  minuteStatus: "ADOPTED" as string,
  classification: "ACTION" as string | null,
  quorumMet: true as boolean | null,
  meetingDate: "2020-01-01" as string, // past → ENDED + WRITE-LOCKED; a future date opens neither clock gate
  writes: { insert: 0, update: 0, delete: 0 },
}));

vi.mock("@/lib/auth/server", () => ({
  requireSchool: vi.fn(async () => ({ school: { id: "s1" }, user: { id: "u1", roles: ["ADMIN"] } })),
  resolveActor: vi.fn(async () => ({ id: "u1", role: "ADMIN" })),
}));
vi.mock("@/lib/db/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/revalidate", () => ({ safeRevalidate: vi.fn() }));

vi.mock("@/lib/pta/meeting-data", () => ({
  loadMeetingScope: vi.fn(async () => ({
    meetingId: "m1",
    ptaId: "pta1",
    tierType: "FORM",
    classId: "c1",
    houseId: null,
    meetingType: "Regular",
    meetingDate: h.meetingDate,
    startTime: "10:00",
    endTime: "12:00",
    location: null,
    agendaJson: { items: [] },
    invitedTeacherUserIds: [],
    quorumMet: h.quorumMet,
    academicPeriodId: "per1",
    className: "Form 2 GA A",
    classTeacherUserId: "u1",
    houseName: null,
    houseGender: null,
    hmUserId: null,
    tierSettings: {},
    quorumRule: "half",
  })),
  resolvePtaWriteAccess: vi.fn(async () => ({ canWrite: true, secretaryOffice: "Secretary" })),
  parsePtaAgenda: vi.fn(() => []),
}));
vi.mock("@/lib/pta/minutes-data", () => ({
  resolvePtaChairAccess: vi.fn(async () => true),
  loadResolutionSeqStart: vi.fn(async () => 1),
}));

vi.mock("@/lib/db/rls", () => {
  const builder = (rows: unknown[]) => {
    const b: Record<string, unknown> = {
      from: (t: unknown) => {
        const name = getTableName(t as never);
        const r =
          name === "pta_minutes"
            ? [{ status: h.minuteStatus, meetingId: "m1" }]
            : name === "pta_agenda_item"
              ? [{ minutesId: "min1", classification: h.classification, status: h.minuteStatus, meetingId: "m1" }]
              : [];
        return builder(r);
      },
      innerJoin: () => b,
      leftJoin: () => b,
      where: () => b,
      orderBy: () => b,
      limit: () => Promise.resolve(rows),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(rows).then(res, rej),
    };
    return b;
  };
  const tx = {
    select: () => builder([]),
    insert: () => {
      h.writes.insert++;
      return { values: () => ({ returning: () => Promise.resolve([{ id: "x" }]) }) };
    },
    update: () => {
      h.writes.update++;
      return { set: () => ({ where: () => Promise.resolve() }) };
    },
    delete: () => {
      h.writes.delete++;
      return { where: () => Promise.resolve() };
    },
  };
  return {
    isUniqueViolation: () => false,
    withSchool: async (_id: string, cb: (t: unknown) => Promise<unknown>) => cb(tx),
  };
});

const actions = await import("./pta-minutes");
const UUID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  h.writes.insert = 0;
  h.writes.update = 0;
  h.writes.delete = 0;
  h.minuteStatus = "ADOPTED";
  h.classification = "ACTION";
  h.quorumMet = true;
  h.meetingDate = "2020-01-01";
});

describe("🔴 R451 — an ADOPTED minute + its subtree admit ZERO mutation (mutation-proven at the action)", () => {
  it("saveAgendaItem is refused and writes nothing", async () => {
    const res = await actions.saveAgendaItem({ agendaItemId: UUID, classification: "DISCUSSION", narrative: "x" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/adopted/i);
    expect(h.writes).toEqual({ insert: 0, update: 0, delete: 0 });
  });

  it("upsertActionItem is refused and writes nothing", async () => {
    const res = await actions.upsertActionItem({ agendaItemId: UUID, description: "chase it", externalName: "Mrs Sarpong" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/adopted/i);
    expect(h.writes).toEqual({ insert: 0, update: 0, delete: 0 });
  });

  it("upsertResolution is refused and writes nothing", async () => {
    h.classification = "RESOLUTION";
    const res = await actions.upsertResolution({ agendaItemId: UUID, resolutionText: "RESOLVED", votesFor: 9, votesAgainst: 1, votesAbstain: 0 });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/adopted/i);
    expect(h.writes).toEqual({ insert: 0, update: 0, delete: 0 });
  });

  it("submitForReview is refused and writes nothing", async () => {
    const res = await actions.submitForReview({ minutesId: UUID });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/adopted/i);
    expect(h.writes).toEqual({ insert: 0, update: 0, delete: 0 });
  });

  it("returnToDraft is refused and writes nothing", async () => {
    const res = await actions.returnToDraft({ minutesId: UUID });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/adopted/i);
    expect(h.writes).toEqual({ insert: 0, update: 0, delete: 0 });
  });

  it("adoptMinutes on an already-ADOPTED minute is refused and writes nothing", async () => {
    const res = await actions.adoptMinutes({ minutesId: UUID });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/already adopted/i);
    expect(h.writes).toEqual({ insert: 0, update: 0, delete: 0 });
  });
});

describe("R452 — the quorum→resolution gate is enforced in the action", () => {
  it("upsertResolution below quorum (quorum_met=false) is refused, no write", async () => {
    h.minuteStatus = "DRAFT"; // fence passes; the quorum gate must still refuse
    h.classification = "RESOLUTION";
    h.quorumMet = false;
    const res = await actions.upsertResolution({ agendaItemId: UUID, resolutionText: "RESOLVED", votesFor: 9, votesAgainst: 1, votesAbstain: 0 });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/quorum/i);
    expect(h.writes).toEqual({ insert: 0, update: 0, delete: 0 });
  });
});

describe("R450 clock gates — draft needs the meeting ENDED, adopt needs it WRITE-LOCKED (action-level)", () => {
  it("createDraftMinutes on a not-yet-ended (future) meeting is refused, no write", async () => {
    h.meetingDate = "2999-01-01"; // future → isPtaMeetingEnded false
    const res = await actions.createDraftMinutes({ meetingId: UUID });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/ended/i);
    expect(h.writes).toEqual({ insert: 0, update: 0, delete: 0 });
  });

  it("adoptMinutes on a CHAIR_REVIEW but not-yet-write-locked (future) meeting is refused, no write", async () => {
    h.minuteStatus = "CHAIR_REVIEW"; // past the fence + status checks; the write-lock must still refuse
    h.meetingDate = "2999-01-01"; // future → isPtaMeetingWriteLocked false
    const res = await actions.adoptMinutes({ minutesId: UUID });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/lock/i);
    expect(h.writes).toEqual({ insert: 0, update: 0, delete: 0 });
  });
});

describe("control — a DRAFT minute DOES mutate (the fence permits, so these are not vacuous)", () => {
  it("saveAgendaItem on a DRAFT reaches the write path", async () => {
    h.minuteStatus = "DRAFT";
    h.classification = "DISCUSSION";
    const res = await actions.saveAgendaItem({ agendaItemId: UUID, classification: "DISCUSSION" });
    expect(res.ok).toBe(true);
    expect(h.writes.update).toBeGreaterThan(0);
  });
});
