/**
 * Threshold-based attendance flags, computed from a term's records. Two rules
 * (matching the alerts surface): long absence (consecutive absent days) and
 * below-threshold (term attendance %). Each escalates Watching → Critical.
 * Pattern-shift / anomaly detection is deferred to MVP2.
 */
export type FlagSeverity = "WATCHING" | "CRITICAL";
export type FlagType = "LONG_ABSENCE" | "BELOW_THRESHOLD";

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
