/**
 * PURE §04 shaping (SHS module 4.4 / INCR-25a) — the referral-hospital view types and the
 * at-most-one-primary DECISION. No DB import, so it is unit-tested without a database and shared
 * safely by the server reader (hospitals-reads.ts) and the client console (hospitals-console.tsx):
 * the client imports these TYPES and formatters, never a `*-reads` module (repo memory
 * `reports-data-is-server-only` — only `pnpm build` catches the leak).
 *
 * 🔴 Nothing here carries a student or any PII. A hospital is config: name · distance · services ·
 * `accepts_nhis` · `is_primary` · tags · active (R186). `accepts_nhis`/`distance_km` are config facts.
 */

export interface HospitalView {
  id: string;
  name: string;
  /** numeric, nullable — pg round-trips numeric as a string; the reader does the one Number() cast. */
  distanceKm: number | null;
  services: string | null;
  notes: string | null;
  isPrimary: boolean;
  acceptsNhis: boolean;
  /** jsonb string array; null on the row coalesces to [] at the reader. */
  tags: string[];
  active: boolean;
}

/**
 * 🔴 R186 — the at-most-one-primary rule is APP-LAYER, NOT a stored exclusive / partial-unique /
 * trigger. This is the pure DECISION a unit test can pin and a mutation must red: given the school's
 * hospitals and the id being set primary, return the OTHER currently-primary ids that must be cleared
 * in the SAME transaction. Empty when the target is not becoming primary, or nothing else is primary.
 *
 * On CREATE the target has no id yet — pass a sentinel (e.g. "") that is not in the set, and every
 * currently-primary hospital is returned to clear.
 */
export function primariesToClear(
  hospitals: readonly { id: string; isPrimary: boolean }[],
  targetId: string,
  targetWillBePrimary: boolean,
): string[] {
  if (!targetWillBePrimary) return [];
  return hospitals.filter((h) => h.id !== targetId && h.isPrimary).map((h) => h.id);
}

/** `4.2 km` — the surface's distance chip. Verbatim number, null when unset (renders nothing). */
export function formatDistanceKm(distanceKm: number | null): string | null {
  return distanceKm == null ? null : `${distanceKm} km`;
}
