/**
 * Pure assembly of a House roster from already-tenant-scoped, pre-formatted rows (INCR-7 ·
 * surface 02). No DB, no I/O. The grid is built data-driven N dorms × M bunks — never a
 * hard-coded 8×15 (AC B1/J5) — with the four bunk states and the confirmed precedence
 * flagged > prefect > moved > occupied > vacant (AC B3). Counts are derived here, never
 * hard-coded (the mock's occupancy numbers deliberately don't reconcile).
 */
import type { Sex } from "./reassign-decision";

export type PrefectRole = "HEAD" | "DINING" | "SANITATION" | "PREP" | "SICKBAY";
export type BunkState = "prefect" | "flagged" | "moved" | "occupied" | "vacant";

/** The 5 designations, in the surface's display order (AC B5). */
export const PREFECT_ORDER: readonly PrefectRole[] = [
  "HEAD",
  "DINING",
  "SANITATION",
  "PREP",
  "SICKBAY",
];
export const PREFECT_LABEL: Record<PrefectRole, string> = {
  HEAD: "Head of House",
  DINING: "Dining Hall",
  SANITATION: "Sanitation",
  PREP: "Prep / Study",
  SICKBAY: "Sick Bay",
};

/** A boarder in a bunk — the data layer formats names/dates before they reach this pure code. */
export interface RosterOccupant {
  studentId: string;
  studentCode: string;
  name: string; // short display e.g. "J. Manu"
  fullName: string;
  sex: Sex;
  formLabel: string | null;
  flagged: boolean;
  movedThisSem: boolean;
  allocatedAtLabel: string | null;
  allocationReason: string | null;
}

export interface RawDorm {
  id: string;
  name: string;
  sectionLabel: string | null;
}
export interface RawBunk {
  id: string;
  dormId: string;
  position: number;
  prefectRole: PrefectRole | null;
}

export interface RosterBunk {
  id: string;
  position: number;
  posLabel: string; // "03"
  addressShort: string; // "A-03"
  address: string; // "Dorm A bunk 03"
  prefectRole: PrefectRole | null;
  state: BunkState;
  occupant: RosterOccupant | null;
}
export interface RosterDorm {
  id: string;
  name: string;
  sectionLabel: string | null;
  bunks: RosterBunk[];
  filled: number;
  total: number;
}
export interface PrefectSlot {
  role: PrefectRole;
  addressShort: string | null;
  occupant: RosterOccupant | null;
}
export interface RosterSummary {
  totalBunks: number;
  filled: number;
  vacant: number;
  boarderCount: number;
  unallocatedCount: number;
  prefectCount: number;
  flaggedCount: number;
  movedThisSemCount: number;
}

export const pad2 = (n: number): string => String(n).padStart(2, "0");

/**
 * Is a user-supplied House hex light enough to need dark text (and a border guard)? House colour
 * is USER DATA rendered via inline style — a white House (#FFFFFF, Slessor) would otherwise show
 * cream text on white with no edge. Returns true for near-white / bright colours so the strip
 * flips to dark text + a border. Unknown/blank → treated as dark (cream text, no border).
 */
export function isLightColour(hex: string | null | undefined): boolean {
  if (!hex) return false;
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.7;
}

/** flagged > prefect > moved > occupied > vacant (AC B3, precedence confirmed by Lucy). */
export function bunkState(
  prefectRole: PrefectRole | null,
  occupant: RosterOccupant | null,
): BunkState {
  if (!occupant) return "vacant";
  if (occupant.flagged) return "flagged";
  if (prefectRole) return "prefect";
  if (occupant.movedThisSem) return "moved";
  return "occupied";
}

export function assembleDorms(
  dorms: RawDorm[],
  bunks: RawBunk[],
  occupantByBunkId: Map<string, RosterOccupant>,
): RosterDorm[] {
  const byDorm = new Map<string, RawBunk[]>();
  for (const b of bunks) {
    const list = byDorm.get(b.dormId) ?? [];
    list.push(b);
    byDorm.set(b.dormId, list);
  }
  return [...dorms]
    .sort((a, b) => a.name.localeCompare(b.name)) // dormitory-major A→H (AC A5)
    .map((d) => {
      const rows = (byDorm.get(d.id) ?? [])
        .sort((a, b) => a.position - b.position) // bunk 1→15 by position, not alphabetical (AC A5)
        .map((b): RosterBunk => {
          const occupant = occupantByBunkId.get(b.id) ?? null;
          return {
            id: b.id,
            position: b.position,
            posLabel: pad2(b.position),
            addressShort: `${d.name}-${pad2(b.position)}`,
            address: `Dorm ${d.name} bunk ${pad2(b.position)}`,
            prefectRole: b.prefectRole,
            state: bunkState(b.prefectRole, occupant),
            occupant,
          };
        });
      return {
        id: d.id,
        name: d.name,
        sectionLabel: d.sectionLabel,
        bunks: rows,
        filled: rows.filter((r) => r.occupant).length,
        total: rows.length,
      };
    });
}

/** The ≤5 prefect slots, in canonical order. A tagged-but-empty or missing role → occupant null
 *  (renders as an empty slot, AC B5). First tagged bunk per role wins. */
export function buildPrefectStrip(dorms: RosterDorm[]): PrefectSlot[] {
  const byRole = new Map<PrefectRole, RosterBunk>();
  for (const d of dorms) {
    for (const b of d.bunks) {
      if (b.prefectRole && !byRole.has(b.prefectRole)) byRole.set(b.prefectRole, b);
    }
  }
  return PREFECT_ORDER.map((role) => {
    const bunk = byRole.get(role) ?? null;
    return {
      role,
      addressShort: bunk?.addressShort ?? null,
      occupant: bunk?.occupant ?? null,
    };
  });
}

export function summarize(
  dorms: RosterDorm[],
  boarderCount: number,
  unallocatedCount: number,
): RosterSummary {
  const bunks = dorms.flatMap((d) => d.bunks);
  const filled = bunks.filter((b) => b.occupant).length;
  return {
    totalBunks: bunks.length,
    filled,
    vacant: bunks.length - filled,
    boarderCount,
    unallocatedCount,
    prefectCount: bunks.filter((b) => b.state === "prefect").length,
    flaggedCount: bunks.filter((b) => b.occupant?.flagged).length,
    movedThisSemCount: bunks.filter((b) => b.occupant?.movedThisSem).length,
  };
}
