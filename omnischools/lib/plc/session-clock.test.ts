import { describe, it, expect } from "vitest";
import { coalescePlcProgramme } from "./defaults";
import {
  cadenceDateForWeek,
  derivePlcSessionClock,
  isPlcReflectionWindowOpen,
  isPlcSessionWriteLocked,
  plcSessionInstant,
} from "./session-clock";

// The frozen Friday-15:30-60min-48h defaults (a missing plc_programme row coalesces to these).
const P = coalescePlcProgramme(null);
const DATE = "2026-05-15"; // a Friday
const close = () => plcSessionInstant(DATE, "16:30"); // 15:30 + 60m

describe("PLC session clock (R381/R390) — everything derives, nothing stored", () => {
  it("cadenceDateForWeek resolves the ISO-weekday date in the week containing `now` (UTC)", () => {
    // 2026-05-13 is a Wednesday; Friday (5) that week is 2026-05-15.
    expect(cadenceDateForWeek(5, new Date("2026-05-13T09:00:00Z"))).toBe("2026-05-15");
    // Asking on the Friday itself returns the Friday.
    expect(cadenceDateForWeek(5, new Date("2026-05-15T18:00:00Z"))).toBe("2026-05-15");
    // Sunday (7) of the same Mon–Sun week.
    expect(cadenceDateForWeek(7, new Date("2026-05-13T09:00:00Z"))).toBe("2026-05-17");
  });

  it("HELD while live: state=held, Live pill active, register NOT locked, reflection window not yet open", () => {
    const now = new Date("2026-05-15T16:00:00Z"); // mid-session (15:30–16:30)
    const c = derivePlcSessionClock(P, DATE, true, now);
    expect(c.state).toBe("held");
    expect(c.writeLocked).toBe(false);
    expect(c.reflectionWindowOpen).toBe(false);
    expect(c.elapsedMin).toBe(30);
    expect(c.pills.find((p) => p.label.startsWith("Live"))?.state).toBe("active");
  });

  it("reflection window opens AT close and lasts 48h; the register stays editable through it", () => {
    const during = new Date("2026-05-16T12:00:00Z"); // Saturday, within 48h of Friday 16:30
    expect(isPlcReflectionWindowOpen(P, DATE, during)).toBe(true);
    expect(isPlcSessionWriteLocked(P, DATE, during)).toBe(false);
    const c = derivePlcSessionClock(P, DATE, true, during);
    expect(c.reflectionWindowOpen).toBe(true);
    // window close = Friday 16:30 + 48h = Sunday 16:30.
    expect(c.reflectionWindowCloseMs).toBe(close().getTime() + 48 * 3_600_000);
  });

  it("after the 48h window: register write-locked, submit window shut, CPD pill done", () => {
    const after = new Date("2026-05-18T00:00:00Z"); // Monday, past Sunday 16:30
    expect(isPlcSessionWriteLocked(P, DATE, after)).toBe(true);
    expect(isPlcReflectionWindowOpen(P, DATE, after)).toBe(false);
    const c = derivePlcSessionClock(P, DATE, true, after);
    expect(c.writeLocked).toBe(true);
    expect(c.pills.find((p) => p.label.startsWith("CPD"))?.state).toBe("done");
  });

  it("NOT held + past cadence date → MISSED; NOT held + future → SCHEDULED", () => {
    const afterClose = new Date("2026-05-15T20:00:00Z");
    expect(derivePlcSessionClock(P, DATE, false, afterClose).state).toBe("missed");
    const beforeStart = new Date("2026-05-15T08:00:00Z");
    expect(derivePlcSessionClock(P, DATE, false, beforeStart).state).toBe("scheduled");
  });
});
