import { describe, it, expect } from "vitest";
import {
  VITAL_BOUNDS,
  isEmptyReading,
  painLevel,
  painTrend,
  vitalSeverity,
  vitalTrend,
  type VitalReading,
} from "./vitals";

const blank: VitalReading = {
  takenAt: new Date("2026-05-14T09:14:00Z"),
  tempC: null,
  systolic: null,
  diastolic: null,
  pulseBpm: null,
  spo2Pct: null,
  painScore: null,
  context: null,
  takenByName: null,
};
const reading = (at: string, over: Partial<VitalReading>): VitalReading => ({
  ...blank,
  takenAt: new Date(at),
  ...over,
});

/** The four rows the surface draws, in taken_at order — the fixture every trend test reads. */
const SURFACE_ROWS: VitalReading[] = [
  reading("2026-05-14T09:14:00Z", {
    tempC: 37.8,
    systolic: 110,
    diastolic: 72,
    pulseBpm: 96,
    spo2Pct: 98,
    painScore: 6,
    takenByName: "A. Bediako",
  }),
  reading("2026-05-14T11:00:00Z", {
    tempC: 37.6,
    systolic: 109,
    diastolic: 70,
    pulseBpm: 92,
    spo2Pct: 98,
    painScore: 5,
    context: "2h obs",
    takenByName: "A. Bediako",
  }),
  reading("2026-05-14T13:30:00Z", {
    tempC: 37.4,
    systolic: 108,
    diastolic: 70,
    pulseBpm: 88,
    spo2Pct: 98,
    painScore: 3,
    context: "post-meds",
    takenByName: "G. Antwi",
  }),
  reading("2026-05-14T14:30:00Z", {
    tempC: 37.2,
    systolic: 108,
    diastolic: 68,
    pulseBpm: 84,
    spo2Pct: 98,
    painScore: 2,
    takenByName: "A. Bediako",
  }),
];

// ============================================================================
// T1 — the severity ladder reproduces every coloured cell the surface draws
// ============================================================================

describe("vitalSeverity (T1 — presentation only, ZERO alerting)", () => {
  it("reproduces the surface's 16 laddered cells (temp · HR · SpO₂ across 4 rows)", () => {
    const grid = SURFACE_ROWS.map((r, i) => {
      const current = i === SURFACE_ROWS.length - 1;
      return [
        vitalSeverity("tempC", r.tempC, current),
        vitalSeverity("pulseBpm", r.pulseBpm, current),
        vitalSeverity("spo2Pct", r.spo2Pct, current),
      ];
    });
    expect(grid).toEqual([
      ["warn", "warn", "ok"], // 37.8 warn · 96 warn · 98% ok
      ["warn", "ok", "ok"], // 37.6 warn · 92 ok · 98% ok
      ["ok", "ok", "ok"], // 37.4 ok · 88 ok · 98% ok
      ["normal", "normal", "normal"], // the current row turns in-range values green
    ]);
  });

  it("T2 the in-range value is `.normal` on the CURRENT row and `.ok` on historical rows", () => {
    expect(vitalSeverity("spo2Pct", 98, true)).toBe("normal");
    expect(vitalSeverity("spo2Pct", 98, false)).toBe("ok");
  });

  it("T3 the thresholds are the assessment's own numbers; the HR pair is authored", () => {
    expect(vitalSeverity("tempC", 37.5, true)).toBe("normal"); // > 37.5, not >=
    expect(vitalSeverity("tempC", 37.6, true)).toBe("warn");
    expect(vitalSeverity("tempC", 38.5, true)).toBe("elevated");
    expect(vitalSeverity("pulseBpm", 95, true)).toBe("normal");
    expect(vitalSeverity("pulseBpm", 96, false)).toBe("warn");
    expect(vitalSeverity("pulseBpm", 120, true)).toBe("elevated");
    expect(vitalSeverity("spo2Pct", 94, true)).toBe("normal");
    expect(vitalSeverity("spo2Pct", 93, true)).toBe("warn");
    expect(vitalSeverity("spo2Pct", 89, false)).toBe("elevated");
  });

  it("T4 an unrecorded reading renders NOTHING — never `—`, never `0`, never a colour", () => {
    expect(vitalSeverity("tempC", null, true)).toBeNull();
    expect(vitalSeverity("spo2Pct", null, false)).toBeNull();
  });

  it("the pain pill ladder matches the four drawn values", () => {
    expect([6, 5, 3, 2].map(painLevel)).toEqual(["mod", "low", "low", "min"]);
    expect([0, 2, 3, 5, 6, 7, 8, 10].map(painLevel)).toEqual([
      "min",
      "min",
      "low",
      "low",
      "mod",
      "mod",
      "high",
      "high",
    ]);
  });
});

// ============================================================================
// T5 — the trend strip is arithmetic over stored rows and nothing else
// ============================================================================

describe("vitalTrend (T5 — deltas are arithmetic; one reading renders NO delta)", () => {
  it("reproduces the surface's five tiles (BP's `stable` replaced by the arrival value)", () => {
    expect(vitalTrend(SURFACE_ROWS)).toEqual([
      { key: "temp", label: "Temp", value: "37.2", unit: "°C", delta: "−0.6 from arrival", tone: "improving", emphasised: false },
      { key: "bp", label: "BP", value: "108", unit: "/68", delta: "from 110/72", tone: "flat", emphasised: false },
      { key: "pulse", label: "Heart rate", value: "84", unit: "bpm", delta: "−12 from arrival", tone: "improving", emphasised: false },
      { key: "spo2", label: "SpO₂", value: "98", unit: "%", delta: "stable", tone: "flat", emphasised: false },
      { key: "pain", label: "Pain (0-10)", value: "2", unit: "", delta: "−4 from arrival", tone: "improving", emphasised: true },
    ]);
  });

  it("T5a with ONE reading there is no delta — not `0`, not `stable`", () => {
    const tiles = vitalTrend([SURFACE_ROWS[0]]);
    expect(tiles.map((t) => t.delta)).toEqual([null, null, null, null, null]);
    expect(tiles.map((t) => t.value)).toEqual(["37.8", "110", "96", "98", "6"]);
  });

  it("T5b two EQUAL readings is a genuine zero delta → `stable`", () => {
    const tiles = vitalTrend([
      reading("2026-05-14T09:00:00Z", { spo2Pct: 98 }),
      reading("2026-05-14T11:00:00Z", { spo2Pct: 98 }),
    ]);
    expect(tiles).toEqual([
      { key: "spo2", label: "SpO₂", value: "98", unit: "%", delta: "stable", tone: "flat", emphasised: false },
    ]);
  });

  it("T5c direction of improvement is PER METRIC — SpO₂ up is better, temp up is worse", () => {
    // Everything moves the wrong way: temp up, HR up, SpO₂ DOWN, pain up → all worsening.
    const worse = vitalTrend([
      reading("2026-05-14T09:00:00Z", { tempC: 37.0, spo2Pct: 97, painScore: 2, pulseBpm: 80 }),
      reading("2026-05-14T11:00:00Z", { tempC: 38.6, spo2Pct: 92, painScore: 7, pulseBpm: 110 }),
    ]);
    expect(worse.map((t) => [t.key, t.tone])).toEqual([
      ["temp", "worsening"],
      ["pulse", "worsening"],
      ["spo2", "worsening"], // 92 < 97, and higher SpO₂ is better → worsening
      ["pain", "worsening"],
    ]);
    // Now the opposite direction: SpO₂ rising IS an improvement, temp falling IS an improvement.
    const better = vitalTrend([
      reading("2026-05-14T09:00:00Z", { tempC: 38.6, spo2Pct: 92 }),
      reading("2026-05-14T11:00:00Z", { tempC: 37.0, spo2Pct: 97 }),
    ]);
    expect(better.map((t) => [t.key, t.tone])).toEqual([
      ["temp", "improving"],
      ["spo2", "improving"],
    ]);
  });

  it("a metric nobody measured produces NO tile at all", () => {
    const tiles = vitalTrend([reading("2026-05-14T09:00:00Z", { tempC: 38.2 })]);
    expect(tiles.map((t) => t.key)).toEqual(["temp"]);
  });

  it("each metric takes its OWN first/last row — a temp-only reading does not blank the pain trend", () => {
    const tiles = vitalTrend([
      reading("2026-05-14T09:00:00Z", { tempC: 38.0, painScore: 7 }),
      reading("2026-05-14T11:00:00Z", { tempC: 37.4 }), // temperature only
      reading("2026-05-14T13:00:00Z", { painScore: 3 }), // pain only
    ]);
    expect(tiles.find((t) => t.key === "pain")).toMatchObject({ value: "3", delta: "−4 from arrival" });
    expect(tiles.find((t) => t.key === "temp")).toMatchObject({ value: "37.4", delta: "−0.6 from arrival" });
  });

  it("BP is both-or-neither: a half reading contributes no BP tile", () => {
    expect(vitalTrend([reading("2026-05-14T09:00:00Z", { systolic: 110 })])).toEqual([]);
  });
});

describe("painTrend (the `Pain · current` status tile)", () => {
  it("renders the arrow and the arrival value, and omits both when nothing changed", () => {
    expect(painTrend(SURFACE_ROWS)).toEqual({ current: 2, arrow: "↓", first: 6 });
    expect(painTrend([SURFACE_ROWS[0]])).toEqual({ current: 6, arrow: null, first: null });
    expect(painTrend([])).toBeNull();
    const worse = [
      reading("2026-05-14T09:00:00Z", { painScore: 2 }),
      reading("2026-05-14T11:00:00Z", { painScore: 8 }),
    ];
    expect(painTrend(worse)).toEqual({ current: 8, arrow: "↑", first: 2 });
  });
});

// ============================================================================
// T6 — the bounds are typo guards, and a row of nothing is not a reading
// ============================================================================

describe("R44 bounds + the ≥1-measure rule", () => {
  it("T6 the plausibility bounds are exactly the ruled ones", () => {
    expect(VITAL_BOUNDS).toEqual({
      tempC: { min: 25.0, max: 45.0 },
      systolic: { min: 50, max: 260 },
      diastolic: { min: 30, max: 160 },
      pulseBpm: { min: 20, max: 250 },
      spo2Pct: { min: 50, max: 100 },
      painScore: { min: 0, max: 10 },
    });
  });

  it("a row with every field empty is empty; pain 0 is a RECORDED value, not an absence", () => {
    expect(isEmptyReading(blank)).toBe(true);
    expect(isEmptyReading({ ...blank, painScore: 0 })).toBe(false);
    expect(isEmptyReading({ ...blank, tempC: 37.0 })).toBe(false);
  });
});
