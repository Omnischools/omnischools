/**
 * Sickbay VITALS presentation — PURE, DB-free, unit-tested (vitals.test.ts). SHS module 4.4 / 22a.
 *
 * 🔴 R45 — ZERO DERIVED ALERTING. Everything in this file is PRESENTATION: a colour class, a pill
 * level, a trend string. Nothing here notifies, escalates, flags a cluster, or writes a row, and
 * nothing may be added that does. Anything that ACTS on a stored clinical value is surveillance and
 * belongs to INCR-27, behind its own owner decision. This file has no imports for that reason.
 *
 * R44 — units are FIXED (°C · mmHg · bpm · % · 0–10) and there is deliberately no `unit` column to
 * disagree with the number beside it. The plausibility BOUNDS live here too, as the single source
 * the zod schema in lib/actions/sickbay-visit.ts reads: they are TYPO GUARDS, not DB CHECKs — a
 * CHECK on a physiological range rejects the genuine extreme reading the record most needs, inside
 * the transaction that was documenting an emergency.
 */

// ============================================================================
// One reading, exactly as the row stores it
// ============================================================================

export interface VitalReading {
  takenAt: Date;
  /** °C — `numeric(3,1)` comes back as a string from pg; the reader parses it before it gets here. */
  tempC: number | null;
  systolic: number | null;
  diastolic: number | null;
  pulseBpm: number | null;
  spo2Pct: number | null;
  painScore: number | null;
  /** Free text: "on arrival", "post-meds", "21:00 round". `on arrival`/`current` are DERIVED. */
  context: string | null;
  /** `A. Bediako` — abbreviated at render, the FK is what is stored. */
  takenByName: string | null;
}

// ============================================================================
// R44 — the plausibility bounds (zod typo guards, NOT DB CHECKs)
// ============================================================================

export const VITAL_BOUNDS = {
  tempC: { min: 25.0, max: 45.0 },
  systolic: { min: 50, max: 260 },
  diastolic: { min: 30, max: 160 },
  pulseBpm: { min: 20, max: 250 },
  spo2Pct: { min: 50, max: 100 },
  painScore: { min: 0, max: 10 },
} as const;

// ============================================================================
// The severity ladder — one function reproduces every coloured cell (Lucy V1.5)
// ============================================================================

/** Maps 1:1 to the surface's `td.c` classes: `.normal` green · `.ok` navy-2 · `.warn` · `.elevated`. */
export type VitalSeverity = "normal" | "ok" | "warn" | "elevated";

export type LadderMetric = "tempC" | "pulseBpm" | "spo2Pct";

/**
 * The ladder, per metric. Temp and SpO₂ thresholds are the assessment's OWN escalation numbers
 * (>37.5 warn / ≥38.5 elevated; <94 warn / <90 elevated); the HR pair is AUTHORED — no surface value
 * exercises it. BP has NO ladder: the surface never colours a BP cell anything but ok/normal, and
 * inventing adolescent BP thresholds would be a clinical assertion the design never made.
 *
 * `isCurrent` is why `98%` is navy on row 1 and green on row 4: an in-range value renders `.normal`
 * (green) on the CURRENT row and `.ok` (navy-2) on every historical row. Out-of-range is out of
 * range on every row — the ladder never softens with age.
 */
export function vitalSeverity(
  metric: LadderMetric,
  value: number | null,
  isCurrent: boolean,
): VitalSeverity | null {
  if (value === null) return null; // an unrecorded reading renders NOTHING — never `—`, never `0`
  const inRange: VitalSeverity = isCurrent ? "normal" : "ok";
  switch (metric) {
    case "tempC":
      if (value >= 38.5) return "elevated";
      return value > 37.5 ? "warn" : inRange;
    case "pulseBpm":
      if (value >= 120) return "elevated";
      return value > 95 ? "warn" : inRange;
    case "spo2Pct":
      if (value < 90) return "elevated";
      return value < 94 ? "warn" : inRange;
  }
}

/** The `.pain-pill` ladder, from the four values the surface draws (6→mod, 5→low, 3→low, 2→min). */
export type PainLevel = "min" | "low" | "mod" | "high";

export function painLevel(score: number): PainLevel {
  if (score >= 8) return "high";
  if (score >= 6) return "mod";
  if (score >= 3) return "low";
  return "min";
}

// ============================================================================
// The trend strip — arithmetic over stored rows, nothing more (R45)
// ============================================================================

/** `improving` → green (the default) · `worsening` → terra `.up` · `flat` → navy-3 + `stable`. */
export type TrendTone = "improving" | "worsening" | "flat";

export interface TrendTile {
  key: "temp" | "bp" | "pulse" | "spo2" | "pain";
  /** `Temp` · `BP` · `Heart rate` · `SpO₂` · `Pain (0-10)` — the visit record's vocabulary, which
   *  wins over today's `Pulse`/`Pain score` (Lucy §5.3: one vocabulary, one formatter). */
  label: string;
  value: string;
  /** The `.u` span: `°C` · `/68` · `bpm` · `%` · `` (pain has no unit). */
  unit: string;
  /** null with a single reading — render NO delta line, never `0` and never `stable` (Lucy V1.5). */
  delta: string | null;
  tone: TrendTone;
  /** Pain is the headline metric: its value carries the gold italic `<em>`. */
  emphasised: boolean;
}

const MINUS = "−"; // U+2212 MINUS SIGN — the surface's `−0.6`, not a hyphen

/** The non-null values of one metric, in `taken_at` order. Its LENGTH is what decides "is there a
 *  delta at all": ONE recorded value means no delta (never `0`, never `stable`); two equal values
 *  mean a genuine zero delta, which IS `stable`. Conflating the two is the false-zero trap. */
type Series = number[];
const seriesOf = (rows: readonly VitalReading[], k: keyof VitalReading): Series =>
  rows.map((r) => r[k]).filter((v): v is number => typeof v === "number");

/** Direction of improvement is PER METRIC: temp down, HR down, pain down, SpO₂ **up**. */
function push(
  tiles: TrendTile[],
  key: TrendTile["key"],
  label: string,
  unit: string,
  s: Series,
  dp: number,
  betterWhen: "down" | "up",
  emphasised = false,
) {
  if (s.length === 0) return; // never a `—` and never a `0` for a value nobody measured
  const first = s[0];
  const latest = s[s.length - 1];
  const value = latest.toFixed(dp);
  if (s.length === 1) {
    tiles.push({ key, label, value, unit, delta: null, tone: "flat", emphasised });
    return;
  }
  const d = Number((latest - first).toFixed(dp));
  if (d === 0) {
    tiles.push({ key, label, value, unit, delta: "stable", tone: "flat", emphasised });
    return;
  }
  const improving = (betterWhen === "down") === d < 0;
  tiles.push({
    key,
    label,
    value,
    unit,
    delta: `${d < 0 ? MINUS : "+"}${Math.abs(d).toFixed(dp)} from arrival`,
    tone: improving ? "improving" : "worsening",
    emphasised,
  });
}

/**
 * The five trend tiles, ordered as the surface prints them. Readings must arrive in `taken_at`
 * order (the reader sorts them); each metric takes its OWN first/last non-null row, so a matron who
 * recorded only a temperature at 11:00 does not blank the pain trend.
 *
 * BP gets NO scalar delta — there isn't one for a composite reading. It renders `from 110/72` (the
 * arrival value), which is AUTHORED (Lucy §5.6) and replaces the surface's unearned `stable`.
 */
export function vitalTrend(readings: readonly VitalReading[]): TrendTile[] {
  const tiles: TrendTile[] = [];
  push(tiles, "temp", "Temp", "°C", seriesOf(readings, "tempC"), 1, "down");

  // BP is a pair: only rows carrying BOTH halves count (the form is both-or-neither).
  const bp = readings.filter((r) => r.systolic !== null && r.diastolic !== null);
  if (bp.length > 0) {
    const last = bp[bp.length - 1];
    const first = bp[0];
    tiles.push({
      key: "bp",
      label: "BP",
      value: String(last.systolic),
      unit: `/${last.diastolic}`,
      delta: bp.length > 1 ? `from ${first.systolic}/${first.diastolic}` : null,
      tone: "flat",
      emphasised: false,
    });
  }

  push(tiles, "pulse", "Heart rate", "bpm", seriesOf(readings, "pulseBpm"), 0, "down");
  push(tiles, "spo2", "SpO₂", "%", seriesOf(readings, "spo2Pct"), 0, "up");
  push(tiles, "pain", "Pain (0-10)", "", seriesOf(readings, "painScore"), 0, "down", true);
  return tiles;
}

/**
 * The `Pain · current` status tile (Lucy V1.3 tile 3): `2/10` + `↓` + `was 6/10 on arrival`.
 * Arrow omitted when equal — never a `→`, never a `0`.
 */
export function painTrend(
  readings: readonly VitalReading[],
): { current: number; arrow: "↓" | "↑" | null; first: number | null } | null {
  const s = seriesOf(readings, "painScore");
  if (s.length === 0) return null;
  const first = s[0];
  const current = s[s.length - 1];
  if (s.length === 1 || first === current) return { current, arrow: null, first: null };
  return { current, arrow: current < first ? "↓" : "↑", first };
}

/** True when a reading row carries no measure at all — the zod "at least one" check, made testable. */
export function isEmptyReading(
  r: Pick<VitalReading, "tempC" | "systolic" | "diastolic" | "pulseBpm" | "spo2Pct" | "painScore">,
): boolean {
  return (
    r.tempC === null &&
    r.systolic === null &&
    r.diastolic === null &&
    r.pulseBpm === null &&
    r.spo2Pct === null &&
    r.painScore === null
  );
}
