/**
 * Attendance flags computed from a term's records, matching the alerts surface:
 * long absence (consecutive absent days), below-threshold (term attendance %),
 * and pattern shift (same-day-of-week absences, or a rolling-14-day drop).
 * Long-absence / below-threshold escalate Watching → Critical; pattern shift is
 * Watching only (per the surface).
 */
export type FlagSeverity = "WATCHING" | "CRITICAL";
export type FlagType = "LONG_ABSENCE" | "BELOW_THRESHOLD" | "PATTERN_SHIFT";

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export type AttendanceFlag = {
  type: FlagType;
  severity: FlagSeverity;
  label: string;
  detail: string;
};

export type StudentFlags = {
  studentId: string;
  termPct: number | null;
  attended: number;
  total: number;
  consecutiveAbsent: number;
  flags: AttendanceFlag[];
  worst: FlagSeverity | null; // most severe across this student's flags
};

export const FLAG_THRESHOLDS = {
  absWatch: 3,
  absCritical: 5,
  pctWatch: 70,
  pctCritical: 60,
  // pattern shift
  dropPct: 30, // ≥30-point fall, recent 14 days vs the prior 14
  dowWindow: 6, // look at the last 6 occurrences of a weekday…
  dowMiss: 4, // …and flag if ≥4 were absent
};

type Rec = { studentId: string; date: string; status: string };

/**
 * Group records by student and derive flags. `records` should cover the term of
 * interest; order doesn't matter (sorted internally by date).
 */
export function computeAttendanceFlags(
  records: Rec[],
  thresholds = FLAG_THRESHOLDS,
): Map<string, StudentFlags> {
  const byStudent = new Map<string, Rec[]>();
  for (const r of records) {
    const arr = byStudent.get(r.studentId) ?? [];
    arr.push(r);
    byStudent.set(r.studentId, arr);
  }

  const out = new Map<string, StudentFlags>();
  for (const [studentId, recs] of Array.from(byStudent)) {
    recs.sort((a, b) => a.date.localeCompare(b.date));
    const total = recs.length;
    const attended = recs.filter(
      (r) => r.status === "PRESENT" || r.status === "LATE",
    ).length;
    const termPct = total > 0 ? Math.round((attended / total) * 100) : null;

    let consecutiveAbsent = 0;
    for (let i = recs.length - 1; i >= 0; i--) {
      if (recs[i].status === "ABSENT") consecutiveAbsent++;
      else break;
    }

    const flags: AttendanceFlag[] = [];
    if (consecutiveAbsent >= thresholds.absWatch) {
      const critical = consecutiveAbsent >= thresholds.absCritical;
      flags.push({
        type: "LONG_ABSENCE",
        severity: critical ? "CRITICAL" : "WATCHING",
        label: "Long absence",
        detail: `${consecutiveAbsent} consecutive absent day${consecutiveAbsent === 1 ? "" : "s"}`,
      });
    }
    if (termPct !== null && termPct < thresholds.pctWatch) {
      const critical = termPct < thresholds.pctCritical;
      flags.push({
        type: "BELOW_THRESHOLD",
        severity: critical ? "CRITICAL" : "WATCHING",
        label: critical ? "Below 60%" : "Below 70%",
        detail: `term attendance ${termPct}%`,
      });
    }

    // Pattern shift — only worth checking with a few weeks of history.
    if (total >= 8) {
      // (a) same day-of-week: the last `dowWindow` occurrences of a weekday,
      // flagged when ≥`dowMiss` were absent (e.g. "Pattern · Fridays").
      const byDow = new Map<number, Rec[]>();
      for (const r of recs) {
        const dow = new Date(`${r.date}T00:00:00Z`).getUTCDay();
        const arr = byDow.get(dow) ?? [];
        arr.push(r);
        byDow.set(dow, arr);
      }
      let dowFlag: { day: number; missed: number } | null = null;
      for (const [day, list] of Array.from(byDow)) {
        const recent = list.slice(-thresholds.dowWindow);
        if (recent.length < thresholds.dowWindow) continue;
        const missed = recent.filter((r) => r.status === "ABSENT").length;
        if (missed >= thresholds.dowMiss && (!dowFlag || missed > dowFlag.missed)) {
          dowFlag = { day, missed };
        }
      }
      if (dowFlag) {
        flags.push({
          type: "PATTERN_SHIFT",
          severity: "WATCHING",
          label: `Pattern · ${WEEKDAYS[dowFlag.day]}s`,
          detail: `absent ${dowFlag.missed} of the last ${thresholds.dowWindow} ${WEEKDAYS[dowFlag.day]}s`,
        });
      } else {
        // (b) rolling drop: recent 14 days vs the prior 14.
        const recent = recs.slice(-14);
        const prior = recs.slice(-28, -14);
        if (prior.length >= 5 && recent.length >= 5) {
          const pct = (arr: Rec[]) =>
            Math.round(
              (arr.filter((r) => r.status === "PRESENT" || r.status === "LATE").length /
                arr.length) *
                100,
            );
          const recentPct = pct(recent);
          const priorPct = pct(prior);
          if (priorPct - recentPct >= thresholds.dropPct) {
            flags.push({
              type: "PATTERN_SHIFT",
              severity: "WATCHING",
              label: "Pattern shift",
              detail: `${priorPct}% → ${recentPct}% over 2 weeks`,
            });
          }
        }
      }
    }

    const worst: FlagSeverity | null = flags.some((f) => f.severity === "CRITICAL")
      ? "CRITICAL"
      : flags.length > 0
        ? "WATCHING"
        : null;

    out.set(studentId, {
      studentId,
      termPct,
      attended,
      total,
      consecutiveAbsent,
      flags,
      worst,
    });
  }
  return out;
}
