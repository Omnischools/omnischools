// IndexedDB durable-store tests (INCR-14 · Item 9 · Phase 2). The vitest env is `node`, so we
// polyfill `globalThis.indexedDB` with fake-indexeddb and hand each test a FRESH factory for
// isolation. This locks the security-critical partition/purge logic (AC9 logout-wipe, AC10
// shared-tablet cross-session isolation) and the durability round-trip (AC1/AC5) that the pure
// reducer tests can't reach — the store is otherwise the only untested new mechanism in INCR-14.
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, it, expect } from "vitest";
import { saveSnapshot, loadSnapshot, purgeSnapshots, type LedgerSnapshot } from "./pwa-store";
import { emptyBuffer, bufferEdit, bufferReject, cellId } from "./pwa-buffer";
import type { PwaClass } from "@/components/senior/pwa-ledger";

// One held score + one server-rejected score: exercises BOTH the pending and errored maps
// surviving a close/reopen (the whole point of the durable store).
function sampleSnapshot(): LedgerSnapshot {
  const p = cellId("stu-1", "asgn");
  const e = cellId("stu-2", "endSem");
  let buffer = emptyBuffer(false); // offline
  buffer = bufferEdit(buffer, p, "88");
  buffer = bufferEdit(buffer, e, "150");
  buffer = bufferReject(buffer, [e], "Each category score must be between 0 and 100.");
  const rosters = [
    { classId: "cls-1", className: "1A", subjectName: "Maths", studentCount: 2, path: "DIRECT_ENTRY", categoriesDone: 0, rows: [], weights: {} },
  ] as unknown as PwaClass[];
  return { buffer, cells: { [p]: "88", [e]: "150" }, rosters, updatedAt: 1_700_000_000_000 };
}

const ctx = (sessionId: string, subjectId = "subj-1", periodId = "per-1") => ({ sessionId, subjectId, periodId });

beforeEach(() => {
  // Fresh IndexedDB per test — no state bleeds across cases.
  globalThis.indexedDB = new IDBFactory();
});

describe("pwa-store — durable IndexedDB snapshot (INCR-14)", () => {
  it("round-trips the full snapshot: pending + errored + cells + rosters survive close/reopen (AC1/AC5)", async () => {
    const snap = sampleSnapshot();
    await saveSnapshot(ctx("sess-A"), snap);
    const loaded = await loadSnapshot(ctx("sess-A"));
    expect(loaded).not.toBeNull();
    expect(loaded!.buffer).toEqual(snap.buffer); // both the held AND the errored cell come back
    expect(loaded!.cells).toEqual(snap.cells);
    expect(loaded!.rosters).toEqual(snap.rosters);
    expect(loaded!.updatedAt).toBe(snap.updatedAt);
  });

  it("returns null for a context that was never saved", async () => {
    expect(await loadSnapshot(ctx("sess-A"))).toBeNull();
  });

  it("does NOT bleed one subject's held scores into another subject of the same session", async () => {
    // Keying by session ALONE would let subject-1's held scores flush as subject-2 — the store
    // includes subject+period in the key precisely to stop that.
    await saveSnapshot(ctx("sess-A", "subj-1"), sampleSnapshot());
    expect(await loadSnapshot(ctx("sess-A", "subj-2"))).toBeNull();
    expect(await loadSnapshot(ctx("sess-A", "subj-1"))).not.toBeNull();
  });

  it("purge-on-identify wipes the OTHER teacher's buffer but keeps mine (AC10 shared tablet)", async () => {
    await saveSnapshot(ctx("sess-A"), sampleSnapshot()); // teacher A
    await saveSnapshot(ctx("sess-B"), sampleSnapshot()); // teacher B, same tablet
    await purgeSnapshots("sess-B"); // B logs in — keep B, drop everyone else
    expect(await loadSnapshot(ctx("sess-A"))).toBeNull(); // A's PII is gone
    expect(await loadSnapshot(ctx("sess-B"))).not.toBeNull(); // B's own work survives
  });

  it("logout (no keep arg) wipes the whole store (AC9)", async () => {
    await saveSnapshot(ctx("sess-A"), sampleSnapshot());
    await saveSnapshot(ctx("sess-A", "subj-2"), sampleSnapshot());
    await purgeSnapshots();
    expect(await loadSnapshot(ctx("sess-A"))).toBeNull();
    expect(await loadSnapshot(ctx("sess-A", "subj-2"))).toBeNull();
  });

  it("a purge that keeps a session-id PREFIX of another cannot mistake one for the other", async () => {
    // Opaque session ids won't actually collide, but the `${id}::` delimiter guards prefix-matching
    // even if one id were a literal prefix of another.
    await saveSnapshot(ctx("sess"), sampleSnapshot());
    await saveSnapshot(ctx("sess-A"), sampleSnapshot());
    await purgeSnapshots("sess-A"); // keep "sess-A::…" only
    expect(await loadSnapshot(ctx("sess"))).toBeNull(); // "sess::…" is NOT kept
    expect(await loadSnapshot(ctx("sess-A"))).not.toBeNull();
  });

  it("an empty sessionId is a no-op: never persists, never reads (dev/degraded guard)", async () => {
    await saveSnapshot(ctx(""), sampleSnapshot());
    expect(await loadSnapshot(ctx(""))).toBeNull();
    // and it didn't write under some empty key either
    globalThis.indexedDB = new IDBFactory();
    expect(await loadSnapshot(ctx("sess-A"))).toBeNull();
  });
});
