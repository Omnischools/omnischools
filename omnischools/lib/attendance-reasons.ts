/**
 * Structured absence/lateness reasons, mirroring the mobile register's reason
 * picker. Stored as `attendance_record.reason_code`; a free note adds detail.
 * Shared by the take-register UI and the per-student attendance view.
 */
export const ATTENDANCE_REASONS = [
  { code: "SICK", label: "Sick", detail: "Medical illness, doctor's note may follow" },
  {
    code: "MEDICAL",
    label: "Medical appointment",
    detail: "Hospital, dental, optometrist visit",
  },
  { code: "FAMILY", label: "Family event", detail: "Funeral, wedding, religious observance" },
  { code: "TRAVEL", label: "Travel", detail: "Out of town with family" },
  { code: "OTHER", label: "Other", detail: "Anything not listed above" },
] as const;

export type AttendanceReasonCode = (typeof ATTENDANCE_REASONS)[number]["code"];

export const ATTENDANCE_REASON_CODES = ATTENDANCE_REASONS.map((r) => r.code) as [
  AttendanceReasonCode,
  ...AttendanceReasonCode[],
];

const REASON_LABEL: Record<string, string> = Object.fromEntries(
  ATTENDANCE_REASONS.map((r) => [r.code, r.label]),
);

/** Human label for a stored reason code (falls back to the raw code). */
export function reasonLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return REASON_LABEL[code] ?? code;
}
