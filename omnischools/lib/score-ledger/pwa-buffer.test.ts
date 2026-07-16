import { describe, it, expect } from "vitest";
import {
  emptyBuffer,
  bufferEdit,
  bufferConfirm,
  bufferHold,
  bufferReject,
  bufferSetOnline,
  cellId,
  studentOfCell,
  pendingCount,
  hasPending,
  hasErrors,
  cellStatus,
  pendingStudentIds,
  stripTone,
  cellHeld,
  heldCount,
  heldStripText,
  heldBadgeText,
} from "./pwa-buffer";

const a = cellId("stu-1", "asgn");
const b = cellId("stu-1", "midSem");
const c = cellId("stu-2", "endSem");

describe("pwa buffer — the R4 correctness state machine", () => {
  it("edit holds a score pending, uncounted until confirmed", () => {
    const s = bufferEdit(emptyBuffer(), a, "88");
    expect(cellStatus(s, a)).toBe("pending");
    expect(pendingCount(s)).toBe(1);
    expect(hasPending(s)).toBe(true);
    expect(stripTone(s)).toBe("green"); // still online → synced/saving, not "connection lost"
  });

  it("hold → offline with held scores turns the strip gold and counts them live", () => {
    let s = bufferEdit(emptyBuffer(), a, "88");
    s = bufferEdit(s, b, "85");
    s = bufferEdit(s, c, "89");
    s = bufferHold(s); // transport failure / signal drop
    expect(s.online).toBe(false);
    expect(pendingCount(s)).toBe(3);
    expect(stripTone(s)).toBe("gold");
    expect(heldStripText(pendingCount(s))).toBe(
      "Connection lost · 3 scores held locally, will sync when reconnected",
    );
  });

  it("retry → on reconnect a confirm clears the tint, stamps the sync time, goes green", () => {
    let s = bufferHold(bufferEdit(emptyBuffer(), a, "88"));
    expect(stripTone(s)).toBe("gold");
    s = bufferSetOnline(s, true); // `online` event fired
    s = bufferConfirm(s, [a], 1_700_000_000_000); // wrapped action returned { ok:true }
    expect(cellStatus(s, a)).toBe("clean");
    expect(hasPending(s)).toBe(false);
    expect(stripTone(s)).toBe("green");
    expect(s.lastSyncedAt).toBe(1_700_000_000_000);
  });

  it("domain error → { ok:false } surfaces an error, never parked silently as pending (B6)", () => {
    let s = bufferEdit(emptyBuffer(), a, "150"); // out of range
    s = bufferReject(s, [a], "Each category score must be between 0 and 100.");
    expect(cellStatus(s, a)).toBe("errored");
    expect(hasPending(s)).toBe(false); // NOT counted as "will sync"
    expect(hasErrors(s)).toBe(true);
    expect(s.lastError).toBe("Each category score must be between 0 and 100.");
    expect(s.online).toBe(true); // we reached the server — this is not a connection problem
  });

  it("re-editing an errored cell clears the error and re-holds it", () => {
    let s = bufferReject(bufferEdit(emptyBuffer(), a, "150"), [a], "out of range");
    s = bufferEdit(s, a, "90");
    expect(cellStatus(s, a)).toBe("pending");
    expect(hasErrors(s)).toBe(false);
    expect(s.lastError).toBeNull();
  });

  it("a transport failure never loses a held score and never fabricates 'saved'", () => {
    let s = bufferEdit(emptyBuffer(), a, "88");
    s = bufferHold(s); // failed to reach server
    // still pending, still uncounted as saved, no sync timestamp invented
    expect(cellStatus(s, a)).toBe("pending");
    expect(s.lastSyncedAt).toBeNull();
  });

  it("reload-drop: a fresh buffer holds nothing — cells fall back to server-confirmed (B5)", () => {
    const s = emptyBuffer();
    expect(hasPending(s)).toBe(false);
    expect(Object.keys(s.pending)).toHaveLength(0);
  });

  it("pendingStudentIds dedupes to the flush payload scope", () => {
    let s = bufferEdit(emptyBuffer(), a, "1");
    s = bufferEdit(s, b, "2"); // same student, different category
    s = bufferEdit(s, c, "3");
    expect(pendingStudentIds(s).sort()).toEqual(["stu-1", "stu-2"]);
  });

  it("cellId / studentOfCell round-trip (uuids contain no ':')", () => {
    const id = cellId("11111111-2222-3333-4444-555555555555", "portfolio");
    expect(studentOfCell(id)).toBe("11111111-2222-3333-4444-555555555555");
  });

  it("no-pending + online → green, no gold UI (B8)", () => {
    expect(stripTone(emptyBuffer(true))).toBe("green");
  });

  it("a fresh online edit is NOT gold — no gold flash while merely saving (B1)", () => {
    const s = bufferEdit(emptyBuffer(true), a, "72");
    expect(cellHeld(s, a)).toBe(false); // not held — just saving normally
    expect(stripTone(s)).toBe("green");
    expect(heldCount(s)).toBe(0);
  });

  it("held scores stay gold THROUGH reconnect until each is server-confirmed (R4 / §3.4)", () => {
    let s = bufferEdit(emptyBuffer(true), a, "88");
    s = bufferEdit(s, b, "85");
    s = bufferHold(s); // drop
    expect(cellHeld(s, a)).toBe(true);
    expect(heldCount(s)).toBe(2);
    s = bufferSetOnline(s, true); // reconnected — but NOT yet confirmed
    expect(stripTone(s)).toBe("gold"); // still gold: pending-until-confirmed
    expect(cellHeld(s, a)).toBe(true);
    s = bufferConfirm(s, [a], 1); // first write confirmed
    expect(cellHeld(s, a)).toBe(false);
    expect(cellHeld(s, b)).toBe(true); // b still held
    expect(stripTone(s)).toBe("gold");
    s = bufferConfirm(s, [b], 2); // buffer drains → episode ends
    expect(stripTone(s)).toBe("green");
    expect(heldCount(s)).toBe(0);
  });

  it("held-strip / badge copy is honest and pluralises (R1)", () => {
    expect(heldStripText(1)).toBe(
      "Connection lost · 1 score held locally, will sync when reconnected",
    );
    expect(heldBadgeText(1)).toBe(
      "1 score on this card is held locally · will save when connection returns",
    );
    expect(heldBadgeText(3)).toBe(
      "3 scores on this card are held locally · will save when connection returns",
    );
    // R1: never the banned words
    for (const text of [heldStripText(2), heldBadgeText(2)]) {
      expect(text.toLowerCase()).not.toContain("offline");
      expect(text.toLowerCase()).not.toContain("saved");
    }
  });
});
