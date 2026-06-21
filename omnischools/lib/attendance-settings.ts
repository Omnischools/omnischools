/**
 * Default attendance configuration — used to fill in a school that hasn't saved
 * its own `attendance_settings` row yet. Pure data; client/server safe.
 */
export type AttendanceSettings = {
  dayStart: string;
  lateThreshold: string;
  dayEnd: string;
  editWindowHours: number;
  absenceSms: boolean;
  absWatchDays: number;
  absCriticalDays: number;
  pctWatch: number;
  pctCritical: number;
};

export const ATTENDANCE_SETTINGS_DEFAULTS: AttendanceSettings = {
  dayStart: "08:00",
  lateThreshold: "08:15",
  dayEnd: "15:00",
  editWindowHours: 24,
  absenceSms: true,
  absWatchDays: 3,
  absCriticalDays: 5,
  pctWatch: 70,
  pctCritical: 60,
};
