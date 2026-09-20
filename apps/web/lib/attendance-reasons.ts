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

/**
 * SYSTEM-ONLY reason code, written by the sickbay's attendance hook (SHS module 4.4 / INCR-22b, R50).
 *
 * 🔴 It is deliberately NOT a member of `ATTENDANCE_REASONS` and therefore not of
 * `ATTENDANCE_REASON_CODES` — which is both the teacher's reason picker AND the zod enum guarding
 * `saveAttendance`'s input. A teacher who could *select* `Sickbay` could forge a clinical assertion
 * about a student who was never seen, and that row would then be protected from every later save by
 * the downgrade guard. The label below is the ONLY thing that joins: without it a per-student
 * attendance view prints the raw string `SICKBAY`.
 *
 * It names a LOCATION, never a condition — a class teacher who does not know why stops chasing a
 * child who cannot come.
 */
export const SICKBAY_REASON_CODE = "SICKBAY";

const REASON_LABEL: Record<string, string> = {
  ...Object.fromEntries(ATTENDANCE_REASONS.map((r) => [r.code, r.label])),
  [SICKBAY_REASON_CODE]: "In sickbay",
};

/** Human label for a stored reason code (falls back to the raw code). */
export function reasonLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return REASON_LABEL[code] ?? code;
}
