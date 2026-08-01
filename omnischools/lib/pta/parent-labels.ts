/**
 * Parent-facing PTA label derivations (SHS module 4.7 / INCR-58 · Kofi R483/R484/R485) — PURE, DB-free,
 * unit-tested (lib/parent/parent-pta.test.ts). The reader lib/parent/parent-pta-data.ts is server-only (it
 * imports the db driver), so these label rules live HERE — the officers.ts / meeting-clock.ts pure-helper
 * discipline — so the House-name relabel and the action-owner office caption are provable WITHOUT a database.
 *
 * Nothing here touches the DB. The reader loads the tenant-scoped maps — own-children class labels, own
 * children's house NAMES via the SECURITY DEFINER `parent_house_names(id → name)`, and the current officer
 * holders — and calls these functions. House PII (housemaster / colour / capacity / gender) NEVER reaches
 * this module: it takes only a house_id → house_name map, so a mutation can't spread a confidential column.
 */

/** Canonical office order (the surface's badge-num 1..7, ex-officio last); unknown offices sort between. */
const OFFICE_RANK: Record<string, number> = {
  Chair: 0,
  "Vice-Chair": 1,
  Secretary: 2,
  "Assistant Secretary": 3,
  Treasurer: 4,
  "Financial Secretary": 5,
  "Organising Secretary": 6,
};
export const officeRank = (office: string): number =>
  /ex-officio/i.test(office) ? 100 : (OFFICE_RANK[office] ?? 50);

/**
 * The PTA display name, derived from parent-reachable data ONLY (R483/R484):
 *   • GENERAL → "General PTA".
 *   • FORM    → the child's class label → "{class} PTA" (else the honest generic "Class PTA").
 *   • HOUSE   → the child's House NAME (from `parent_house_names`) → "{house} PTA"; a null/unresolved
 *               house_id — or a since-CLOSED House PTA not in the active set — → the honest generic "House PTA".
 */
export function ptaNameFor(
  tier: "FORM" | "HOUSE" | "GENERAL",
  classId: string | null,
  houseId: string | null,
  classLabelById: Map<string, string>,
  houseNameById: Map<string, string>,
): string {
  if (tier === "GENERAL") return "General PTA";
  if (tier === "FORM") {
    const label = classId ? classLabelById.get(classId) : null;
    return label ? `${label} PTA` : "Class PTA";
  }
  const house = houseId ? houseNameById.get(houseId) : null;
  return house ? `${house} PTA` : "House PTA";
}

/**
 * The best CURRENT office per (pta, person) from the loaded current-holder officer rows (R485). Keyed
 * `${ptaId}::${personUserId}`; a multi-hat person's HIGHEST office wins (lowest officeRank — PP58-16).
 * External holders (no personUserId) are skipped — an office caption needs a stable identity.
 */
export function bestOfficeByHolder(
  rows: { ptaId: string; personUserId: string | null; office: string }[],
): Map<string, string> {
  const best = new Map<string, string>();
  for (const r of rows) {
    if (!r.personUserId) continue;
    const key = `${r.ptaId}::${r.personUserId}`;
    const cur = best.get(key);
    if (cur == null || officeRank(r.office) < officeRank(cur)) best.set(key, r.office);
  }
  return best;
}

/**
 * An action-item owner display string with the owner's CURRENT office in THAT PTA appended (R485):
 * "{owner} · {office}". Name-only (NO caption) when the owner has no user id (external_name / "—" —
 * PP58-12/17), or holds no current office in that PTA — a different-PTA office (PP58-14) or an ended office
 * (PP58-15) is not in the map, and a holder with no office at all (PP58-13) misses too.
 */
export function ownerWithOffice(
  ownerName: string,
  ptaId: string,
  personUserId: string | null,
  officeByHolder: Map<string, string>,
): string {
  if (!personUserId) return ownerName;
  const office = officeByHolder.get(`${ptaId}::${personUserId}`);
  return office ? `${ownerName} · ${office}` : ownerName;
}
