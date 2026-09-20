/**
 * Canonical attendance-status presentation, mapped to the register surface's
 * design tokens (`Surfaces/schoolup-attendance-desktop.html`). The surface uses
 * four statuses — Present (green) / Late (gold) / Excused (warn) / Absent (terra)
 * — and treats "medical" as an Excused *reason*. This build keeps a fifth
 * first-class status, MEDICAL, by deliberate product choice; it is rendered in
 * navy-2 so it never collides with Late (gold) or Excused (warn).
 *
 * `rowTint` matches the surface's barely-there row backgrounds (rgba …,0.04–0.05);
 * the tokens are raw `var(--…)` hexes with no alpha channel, so the tint is an
 * inline-style rgba rather than a Tailwind opacity utility.
 */
export type AttendanceStatus = "PRESENT" | "LATE" | "EXCUSED" | "MEDICAL" | "ABSENT";

export type StatusMeta = {
  letter: string;
  label: string;
  /** Selected segmented-control fill (surface `.status-tile-desk.selected.*`). */
  seg: string;
  /** Stat-tile number colour (surface `.stat-tile.* .num`). */
  num: string;
  /** Stat-tile coloured left border (surface `.stat-tile.*`). */
  borderL: string;
  /** Subtle row tint, exact rgba from the surface (`""` = no tint). */
  rowTint: string;
};

export const ATTENDANCE_STATUS_META: Record<AttendanceStatus, StatusMeta> = {
  PRESENT: {
    letter: "P",
    label: "Present",
    seg: "bg-green text-white",
    num: "text-green",
    borderL: "border-l-green",
    rowTint: "",
  },
  LATE: {
    letter: "L",
    label: "Late",
    seg: "bg-gold text-navy",
    num: "text-gold",
    borderL: "border-l-gold",
    rowTint: "rgba(200,151,91,0.05)",
  },
  EXCUSED: {
    letter: "E",
    label: "Excused",
    seg: "bg-warn text-white",
    num: "text-warn",
    borderL: "border-l-warn",
    rowTint: "rgba(197,138,46,0.05)",
  },
  MEDICAL: {
    letter: "M",
    label: "Medical",
    seg: "bg-navy-2 text-white",
    num: "text-navy-2",
    borderL: "border-l-navy-2",
    rowTint: "rgba(45,63,92,0.04)",
  },
  ABSENT: {
    letter: "A",
    label: "Absent",
    seg: "bg-terra text-white",
    num: "text-terra",
    borderL: "border-l-terra",
    rowTint: "rgba(184,74,57,0.05)",
  },
};

/** The five statuses in the order the segmented control / stat strip show them. */
export const ATTENDANCE_STATUS_ORDER: AttendanceStatus[] = [
  "PRESENT",
  "LATE",
  "EXCUSED",
  "MEDICAL",
  "ABSENT",
];

/** Map a single keypress to a status (keyboard marking workflow). */
export const STATUS_HOTKEYS: Record<string, AttendanceStatus> = {
  p: "PRESENT",
  l: "LATE",
  e: "EXCUSED",
  m: "MEDICAL",
  a: "ABSENT",
};
