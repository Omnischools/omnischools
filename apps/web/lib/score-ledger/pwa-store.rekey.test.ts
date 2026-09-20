// INCR-39 — self-change-scoped offline-buffer re-key. When a teacher changes THEIR OWN password,
// the R264 re-auth rotates the Supabase session_id (our partition-key prefix), so their pending
// offline scores must migrate old→new BEFORE the next PwaSession purge-on-identify deletes them.
// Behavioral test (fake-indexeddb is a dev dep; same node-env polyfill as pwa-store.test.ts): the
// load-bearing property is the CROSS-TEACHER safety — a different session prefix is never touched.
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, it, expect } from "vitest";
import { saveSnapshot, loadSnapshot, rekeySnapshots, type LedgerSnapshot } from "./pwa-store";
import { emptyBuffer, bufferEdit, cellId } from "./pwa-buffer";
import type { PwaClass } from "@/components/senior/pwa-ledger";

function sampleSnapshot(mark: string): LedgerSnapshot {
  const p = cellId("stu-1", "asgn");
  let buffer = emptyBuffer(false);
  buffer = bufferEdit(buffer, p, mark);
  const rosters = [
    { classId: "cls-1", className: "1A", subjectName: "Maths", studentCount: 1, path: "DIRECT_ENTRY", categoriesDone: 0, rows: [], weights: {} },
  ] as unknown as PwaClass[];
  return { buffer, cells: { [p]: mark }, rosters, updatedAt: 1_700_000_000_000 };
}

const ctx = (sessionId: string, subjectId = "sub", periodId = "per") => ({ sessionId, subjectId, periodId });

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe("pwa-store — rekeySnapshots (INCR-39 self password-change)", () => {
  it("moves the changer's own record A→C with its snapshot intact, and NEVER touches teacher B", async () => {
    const snapA = sampleSnapshot("88");
    const snapB = sampleSnapshot("42");
    await saveSnapshot(ctx("A"), snapA); // the teacher changing their password
    await saveSnapshot(ctx("B"), snapB); // a different teacher on the same shared tablet

    await rekeySnapshots("A", "C"); // A's session rotated to C after the R264 re-auth

    // A's own pending scores now live under the NEW session, byte-for-byte.
    expect(await loadSnapshot(ctx("A"))).toBeNull();
    const moved = await loadSnapshot(ctx("C"));
    expect(moved).not.toBeNull();
    expect(moved!.buffer).toEqual(snapA.buffer);
    expect(moved!.cells).toEqual(snapA.cells);
    expect(moved!.rosters).toEqual(snapA.rosters);
    expect(moved!.updatedAt).toBe(snapA.updatedAt);

    // The cross-teacher safety: B sat under a different session prefix, so it is UNTOUCHED.
    const other = await loadSnapshot(ctx("B"));
    expect(other).not.toBeNull();
    expect(other!.buffer).toEqual(snapB.buffer);
    expect(other!.cells).toEqual(snapB.cells);
  });

  it("preserves the ::subject::period suffix when re-keying multiple contexts of one session", async () => {
    await saveSnapshot(ctx("A", "math"), sampleSnapshot("11"));
    await saveSnapshot(ctx("A", "eng"), sampleSnapshot("22"));
    await rekeySnapshots("A", "C");
    expect(await loadSnapshot(ctx("C", "math"))).not.toBeNull();
    expect(await loadSnapshot(ctx("C", "eng"))).not.toBeNull();
    expect(await loadSnapshot(ctx("A", "math"))).toBeNull();
    expect(await loadSnapshot(ctx("A", "eng"))).toBeNull();
  });

  it("is a no-op when the session is unchanged or either id is empty", async () => {
    await saveSnapshot(ctx("A"), sampleSnapshot("88"));
    await rekeySnapshots("A", "A"); // unchanged
    await rekeySnapshots("", "C"); // no old
    await rekeySnapshots("A", ""); // no new
    expect(await loadSnapshot(ctx("A"))).not.toBeNull();
  });
});
