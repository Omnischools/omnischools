import { describe, it, expect, vi } from "vitest";
import { flushPending, type FlushClass, type FlushDeps, type SaveResult } from "./pwa-flush";
import {
  emptyBuffer,
  bufferEdit,
  bufferSetOnline,
  cellId,
  cellStatus,
  cellHeld,
  stripTone,
  hasPending,
  type PendingBuffer,
} from "./pwa-buffer";

const SID = "stu-1";
const PORT = cellId(SID, "portfolio");

/**
 * A node-side stand-in for PwaLedger's flush wiring: a real mutable buffer driven by the same
 * reducer the component uses, a plain cells object, and injected (mockable) save actions. Every
 * field on the returned deps is mutable so a test can swap in a specific action mock afterwards.
 */
function harness(path: FlushClass["path"], cells: Record<string, string>, online = true) {
  let buf: PendingBuffer = emptyBuffer(true);
  for (const [id, v] of Object.entries(cells)) buf = bufferEdit(buf, id, v); // seed as pending
  const cls: FlushClass = { classId: "C1", path };
  const deps: FlushDeps = {
    latch: { inFlight: false, rerun: false },
    getBuffer: () => buf,
    setBuffer: (fn) => {
      buf = fn(buf);
    },
    getCell: (sid, cat) => cells[cellId(sid, cat)] ?? "",
    classOf: () => cls,
    isOnline: () => online,
    saveDirect: async () => ({ ok: true, saved: 1 }),
    savePortfolio: async () => ({ ok: true, saved: 1 }),
    subjectId: "S1",
    periodId: "P1",
    now: () => 1000,
  };
  return { deps, getBuf: () => buf, cells };
}

describe("pwa flush — transport-fail vs domain-{ok:false} routing (the wiring MAJOR-1 slipped through)", () => {
  it("{ok:true} confirms + clears the cell and the strip goes green (synced)", async () => {
    const { deps, getBuf } = harness("AUTO_COMPILE", { [PORT]: "80" });
    const save = vi.fn(async (): Promise<SaveResult> => ({ ok: true, saved: 1 }));
    deps.savePortfolio = save;

    await flushPending(deps);

    expect(save).toHaveBeenCalledOnce();
    expect(getBuf().pending).toEqual({});
    expect(cellStatus(getBuf(), PORT)).toBe("clean");
    expect(stripTone(getBuf())).toBe("green");
    expect(getBuf().lastSyncedAt).toBe(1000);
  });

  it("{ok:false} out-of-range portfolio → errored/red, surfaced, NOT shown as saved (MAJOR-1)", async () => {
    // "-5" is what savePortfolioScores now rejects via parseCategoryCell (0–999.99). NB 150 is a
    // VALID bonus mark under that shared bound and genuinely saves — the silent-drop is gone either
    // way; only <0 / >999.99 / non-numeric surface an error.
    const { deps, getBuf } = harness("AUTO_COMPILE", { [PORT]: "-5" });
    const save = vi.fn(
      async (): Promise<SaveResult> => ({
        ok: false,
        error: "Portfolio score must be between 0 and 999.99.",
      }),
    );
    deps.savePortfolio = save;

    await flushPending(deps);

    // The regression guard: a rejected out-of-range value must NOT clear as a false save.
    expect(getBuf().pending).toEqual({}); // moved out of "will sync"…
    expect(cellStatus(getBuf(), PORT)).toBe("errored"); // …into errored/red, not clean
    expect(cellHeld(getBuf(), PORT)).toBe(false); // errored is never the gold "held" tint
    expect(getBuf().errored[PORT]).toBe("-5"); // the entered value is preserved for the fix
    expect(getBuf().lastError).toContain("999.99"); // the message is surfaced
    expect(getBuf().lastSyncedAt).toBeNull(); // nothing was saved → no sync stamp
  });

  it("a THROW (fetch rejected) holds the cell pending + gold, then retries on reconnect", async () => {
    const { deps, getBuf } = harness("AUTO_COMPILE", { [PORT]: "80" });
    let calls = 0;
    const save = vi.fn(async (): Promise<SaveResult> => {
      calls++;
      if (calls === 1) throw new Error("network down");
      return { ok: true, saved: 1 };
    });
    deps.savePortfolio = save;

    await flushPending(deps); // transport failure → hold
    expect(hasPending(getBuf())).toBe(true);
    expect(cellHeld(getBuf(), PORT)).toBe(true); // gold "held locally"
    expect(stripTone(getBuf())).toBe("gold");
    expect(getBuf().online).toBe(false);

    // The `online` event flips the buffer online and re-runs the flush; navigator stays online.
    deps.setBuffer((s) => bufferSetOnline(s, true));
    await flushPending(deps);

    expect(save).toHaveBeenCalledTimes(2);
    expect(hasPending(getBuf())).toBe(false);
    expect(stripTone(getBuf())).toBe("green");
  });

  it("navigator offline holds without ever calling the action (no false save)", async () => {
    const { deps, getBuf } = harness("AUTO_COMPILE", { [PORT]: "80" }, /* online */ false);
    const save = vi.fn(async (): Promise<SaveResult> => ({ ok: true, saved: 1 }));
    deps.savePortfolio = save;

    await flushPending(deps);

    expect(save).not.toHaveBeenCalled();
    expect(hasPending(getBuf())).toBe(true);
    expect(stripTone(getBuf())).toBe("gold"); // held → gold, never "synced"
  });

  it("routes a DIRECT_ENTRY class to saveDirect, a Path A/B class to savePortfolio", async () => {
    const direct = vi.fn(async (): Promise<SaveResult> => ({ ok: true, saved: 1 }));
    const portfolio = vi.fn(async (): Promise<SaveResult> => ({ ok: true, saved: 1 }));
    const { deps } = harness("DIRECT_ENTRY", {
      [cellId(SID, "asgn")]: "50",
      [PORT]: "80",
    });
    deps.saveDirect = direct;
    deps.savePortfolio = portfolio;

    await flushPending(deps);

    expect(direct).toHaveBeenCalledOnce();
    expect(portfolio).not.toHaveBeenCalled();
  });

  it("Trap-1: a submitted-but-unwritten (off-roster) cell goes RED; the written one greens (MAJOR-1)", async () => {
    const S1 = "stu-1";
    const S2 = "stu-2";
    const c1 = cellId(S1, "portfolio");
    const c2 = cellId(S2, "portfolio");
    const { deps, getBuf } = harness("DIRECT_ENTRY", { [c1]: "70", [c2]: "80" });
    // The Path-C action silently skipped S2 (no longer on the roster) and returns only S1 written.
    deps.saveDirect = async (): Promise<SaveResult> => ({ ok: true, saved: 1, writtenIds: [S1] });

    await flushPending(deps);

    expect(cellStatus(getBuf(), c1)).toBe("clean"); // written → confirmed green
    expect(cellStatus(getBuf(), c2)).toBe("errored"); // unwritten → RED, never a false "saved"
    expect(getBuf().errored[c2]).toBe("80"); // value preserved for the teacher
    expect(getBuf().lastError).toContain("no longer in this class");
  });

  it("snapshot compare + rerun latch: a cell re-edited mid-flight is resent, not falsely confirmed", async () => {
    const { deps, getBuf, cells } = harness("AUTO_COMPILE", { [PORT]: "80" });
    const seen: string[] = [];
    let first = true;
    deps.savePortfolio = async (input): Promise<SaveResult> => {
      seen.push(input.scores[0]!.value);
      if (first) {
        first = false;
        // Teacher edits the same cell mid-flight; the debounced flush fires concurrently.
        cells[PORT] = "90";
        deps.setBuffer((s) => bufferEdit(s, PORT, "90"));
        await flushPending(deps); // re-entrant while inFlight → sets the rerun latch
      }
      return { ok: true, saved: 1 };
    };

    await flushPending(deps);

    expect(seen).toEqual(["80", "90"]); // first send 80; the rerun resends the newer 90
    expect(hasPending(getBuf())).toBe(false); // finally drained, nothing stuck pending
    expect(stripTone(getBuf())).toBe("green");
  });
});
