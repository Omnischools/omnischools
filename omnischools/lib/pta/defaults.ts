/**
 * PTA structure-setup frozen contract (SHS module 4.7 / INCR-50) — PURE, DB-free, unit-tested
 * (pta-defaults.test.ts). The VLC-40 / PLC-47 config-spine analogue. This file holds three things:
 *   • `coalescePtaTiers` — a missing pta_tiers_config row → the frozen per-tier R417 defaults +
 *     configured:false, never null/throw (mirrors coalescePlcProgramme). One tier per fixed type.
 *   • `PTA_TIER_TYPES` — the four fixed tiers (R410; a CHECK in the schema, not an enum).
 *   • `reconcilePtas` — the PURE generation reconcile (R411/R412): given the tier-active config, the
 *     live active classes/Houses and the existing `ptas`, it returns the idempotent op set (insert /
 *     close / reopen). NO DB access here — the server action applies the ops (lib/actions/pta.ts).
 *
 * The spine stores config + instances + dues-rate history ONLY: NO officers-as-roles, NO meetings, NO
 * invoices, NO parent path (R418 scope fence; those are INCR-51/52/54/55).
 */

export const PTA_TIER_TYPES = ["FORM", "HOUSE", "GENERAL", "EMERGENCY"] as const;
export type PtaTierType = (typeof PTA_TIER_TYPES)[number];

export type PtaDuesBasis = "PER_STUDENT" | "PER_FAMILY";
export type PtaDuesCadence = "PER_TERM" | "PER_YEAR" | "ONE_OFF";
export type PtaStatus = "ACTIVE" | "CLOSED";

/** A coalesced tier — the shape the reader/UI consume (defaults filled, `configured` derived). */
export interface PtaTier {
  tierType: PtaTierType;
  active: boolean;
  /** Free-text cadence label (e.g. "Once per term"). */
  frequencyNorm: string;
  /** Office-NAME strings — a data list, NOT permissions (OC3 boundary, R410). Emergency = []. */
  officerRoles: string[];
  quorumRule: string;
  duesEnabled: boolean;
  duesAmount: number | null;
  duesBasis: PtaDuesBasis | null;
  duesCadence: PtaDuesCadence | null;
  /** Heterogeneous per-tier scalars, round-tripped OPAQUE (NOT EAV — the spine never branches on it). */
  tierSettings: Record<string, string>;
  /** false when the school has never configured this tier (configured_at IS NULL) — NOT a freeze. */
  configured: boolean;
}

/** The columns the reader selects off pta_tiers_config. numeric() / jsonb come back untyped from pg. */
export interface PtaTierRow {
  tierType: string;
  active: boolean;
  frequencyNorm: string | null;
  officerRoles: unknown;
  quorumRule: string | null;
  duesEnabled: boolean;
  duesAmount: string | null;
  duesBasis: string | null;
  duesCadence: string | null;
  tierSettings: unknown;
  configuredAt: Date | null;
}

type TierDefault = Omit<PtaTier, "tierType" | "configured">;

/**
 * The frozen per-tier R417 defaults — what an UNCONFIGURED school renders (with configured:false). The
 * dues amounts (Form 50 / General 200) are the surface-illustrative pre-fills the admin accepts or
 * edits; NO `ptas` instances exist until Generate runs (R411/R417 — never a fabricated instance).
 */
const TIER_DEFAULTS: Record<PtaTierType, TierDefault> = {
  FORM: {
    active: true,
    frequencyNorm: "Once per term (3× per academic year)",
    officerRoles: ["Chair", "Vice", "Secretary", "Treasurer"],
    quorumRule: "50% of parents present + Form Master",
    duesEnabled: true,
    duesAmount: 50,
    duesBasis: "PER_STUDENT",
    duesCadence: "PER_TERM",
    tierSettings: {},
  },
  HOUSE: {
    active: true,
    frequencyNorm: "Once per term",
    officerRoles: ["Chair", "Vice", "Secretary", "Treasurer"],
    quorumRule: "40% of House parents + Housemaster",
    duesEnabled: false,
    duesAmount: null,
    duesBasis: null,
    duesCadence: null,
    tierSettings: {},
  },
  GENERAL: {
    active: true,
    frequencyNorm: "Once per term + AGM annually",
    officerRoles: [
      "Chair",
      "Vice",
      "Secretary",
      "Asst Secretary",
      "Treasurer",
      "Financial Secretary",
      "Organising Secretary",
    ],
    quorumRule: "One-third of registered parents",
    duesEnabled: true,
    duesAmount: 200,
    duesBasis: "PER_FAMILY",
    duesCadence: "PER_YEAR",
    tierSettings: {},
  },
  EMERGENCY: {
    active: true,
    frequencyNorm: "On-demand — convened when it can't wait",
    officerRoles: [], // R414 — no standing officers
    quorumRule: "",
    duesEnabled: false, // R414 — no standing dues
    duesAmount: null,
    duesBasis: null,
    duesCadence: null,
    tierSettings: {},
  },
};

function toStringArray(v: unknown, fallback: string[]): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string" && x.trim() !== "");
  return fallback;
}

function toStringRecord(v: unknown): Record<string, string> {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (val !== null && val !== undefined) out[k] = String(val);
    }
    return out;
  }
  return {};
}

function coalesceTier(tierType: PtaTierType, row: PtaTierRow | null): PtaTier {
  const d = TIER_DEFAULTS[tierType];
  if (!row) return { tierType, ...d, configured: false };
  return {
    tierType,
    active: row.active,
    frequencyNorm: row.frequencyNorm ?? d.frequencyNorm,
    // Emergency's officer_roles is DB-guaranteed '[]' (the CHECK); every other tier reads its list.
    officerRoles: toStringArray(row.officerRoles, d.officerRoles),
    quorumRule: row.quorumRule ?? d.quorumRule,
    duesEnabled: row.duesEnabled,
    duesAmount: row.duesAmount != null ? Number(row.duesAmount) : null,
    duesBasis: (row.duesBasis as PtaDuesBasis | null) ?? null,
    duesCadence: (row.duesCadence as PtaDuesCadence | null) ?? null,
    tierSettings: toStringRecord(row.tierSettings),
    configured: row.configuredAt != null,
  };
}

/** The frozen default for a single tier (configured:false) — used by the reader AND the dues action's
 * fresh-insert so a dues-first config row lands complete (officers/frequency/quorum), never empty. */
export function ptaTierDefault(tierType: PtaTierType): PtaTier {
  return { tierType, ...TIER_DEFAULTS[tierType], configured: false };
}

/**
 * A missing (or partial) config coalesces to the frozen R417 per-tier defaults + configured:false —
 * never null, never a throw, never a fabricated `ptas` instance. Always returns the four tiers in the
 * fixed PTA_TIER_TYPES order.
 */
export function coalescePtaTiers(rows: PtaTierRow[] | null | undefined): PtaTier[] {
  const byType = new Map<string, PtaTierRow>();
  for (const r of rows ?? []) byType.set(r.tierType, r);
  return PTA_TIER_TYPES.map((tt) => coalesceTier(tt, byType.get(tt) ?? null));
}

// ============================================================================
// The generation reconcile (R411/R412) — PURE, DB-free. lib/actions/pta.ts applies the ops.
// ============================================================================

export interface PtaTierActive {
  tierType: PtaTierType;
  active: boolean;
}
export interface PtaScope {
  id: string;
}
export interface ExistingPta {
  tierType: PtaTierType;
  classId: string | null;
  houseId: string | null;
  status: PtaStatus;
}
export type PtaOpAction = "insert" | "close" | "reopen";
export interface PtaOp {
  tierType: PtaTierType;
  classId: string | null;
  houseId: string | null;
  action: PtaOpAction;
}

function scopeKey(t: PtaTierType, classId: string | null, houseId: string | null): string {
  return `${t}|${classId ?? ""}|${houseId ?? ""}`;
}

/**
 * Reconcile the target PTA set against what exists, returning the idempotent op list (R411/R412):
 *   • FORM (if active): one ACTIVE PTA per active class.
 *   • HOUSE (if active): one ACTIVE PTA per active House.
 *   • GENERAL (if active): exactly ONE singleton (never two — the partial-unique crux, PTA50-8).
 *   • EMERGENCY: ZERO instances (convened on-demand at INCR-52, R414).
 * A PTA whose scope class/House is now inactive, or whose tier is toggled OFF, and is not in the
 * target set → CLOSED (soft, preserved). A previously-CLOSED PTA back in the target set → REOPEN (the
 * SAME identity). Running it against the resulting state yields the empty op list (idempotent).
 */
export function reconcilePtas(
  tiers: PtaTierActive[],
  activeClasses: PtaScope[],
  activeHouses: PtaScope[],
  existing: ExistingPta[],
): PtaOp[] {
  const isActive = (t: PtaTierType) => tiers.find((x) => x.tierType === t)?.active ?? false;

  // The target set = what SHOULD exist and be ACTIVE. Emergency contributes nothing (R414).
  const targets = new Map<string, PtaOp>();
  if (isActive("FORM")) {
    for (const c of activeClasses) {
      targets.set(scopeKey("FORM", c.id, null), {
        tierType: "FORM",
        classId: c.id,
        houseId: null,
        action: "insert",
      });
    }
  }
  if (isActive("HOUSE")) {
    for (const h of activeHouses) {
      targets.set(scopeKey("HOUSE", null, h.id), {
        tierType: "HOUSE",
        classId: null,
        houseId: h.id,
        action: "insert",
      });
    }
  }
  if (isActive("GENERAL")) {
    targets.set(scopeKey("GENERAL", null, null), {
      tierType: "GENERAL",
      classId: null,
      houseId: null,
      action: "insert",
    });
  }

  const existingByKey = new Map<string, ExistingPta>();
  for (const e of existing) existingByKey.set(scopeKey(e.tierType, e.classId, e.houseId), e);

  const ops: PtaOp[] = [];

  // Each target: insert if absent, reopen if CLOSED, no-op if already ACTIVE.
  for (const [k, op] of targets) {
    const cur = existingByKey.get(k);
    if (!cur) ops.push(op);
    else if (cur.status === "CLOSED") ops.push({ ...op, action: "reopen" });
  }

  // Each existing row NOT in the target set: close it if it is still ACTIVE.
  for (const e of existing) {
    const k = scopeKey(e.tierType, e.classId, e.houseId);
    if (!targets.has(k) && e.status === "ACTIVE") {
      ops.push({ tierType: e.tierType, classId: e.classId, houseId: e.houseId, action: "close" });
    }
  }

  return ops;
}
