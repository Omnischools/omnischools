/**
 * VLC curriculum-library change request — PURE, DB-free core (SHS module 4.5 / issue #296).
 * Unit-tested in vlc-change-request-actions.test.ts (no DB driver imported here). Holds the three
 * payload schemas, the reorder-payload validator, the ATOMIC-renumber planner, and the human-readable
 * preview formatter. The server actions (lib/actions/vlc-change-request.ts) and the pending reader
 * (lib/vlc/change-request-data.ts) consume these; keeping them pure is what lets the collision-free
 * renumber be proven by a unit test rather than only a live-DB round-trip.
 *
 * NOT server-only and imports NO DB driver, so it is safe to unit-test directly (the defaults.ts idiom).
 * It is NEVER imported by a client component — the client dispatches the server actions and the server
 * validates the payload; the client receives only the pre-formatted preview strings.
 */
import { z } from "zod";

export const VLC_CHANGE_OPS = ["ADD", "REORDER", "REMOVE"] as const;
export type VlcChangeOp = (typeof VLC_CHANGE_OPS)[number];

export const VLC_CHANGE_STATES = ["PROPOSED", "APPROVED", "REJECTED"] as const;
export type VlcChangeState = (typeof VLC_CHANGE_STATES)[number];

// ── Payload schemas (the Zod caps mirror the existing rename/prompt actions verbatim) ───────────────

/** One session template inside an ADD payload — the existing TemplateSchema caps (title ≤120, prompt ≤240). */
const AddSessionSchema = z.object({
  title: z.string().trim().min(1, "Each session needs a title.").max(120),
  prompt: z.string().trim().max(240).nullish(),
});

/**
 * ADD — the new value's fields + its two session templates. Caps reuse the rename/prompt actions'
 * (nameEn/nameTwi ≤80, descriptor ≤120, termGroup 1..3). The at-most-one-capstone-per-school guard is
 * a CROSS-ROW rule, so it is enforced in the action (at propose AND re-checked at apply), not here.
 */
export const AddValuePayloadSchema = z.object({
  nameEn: z.string().trim().min(1, "The value needs an English name.").max(80),
  nameTwi: z.string().trim().max(80).nullish(),
  descriptor: z.string().trim().max(120).nullish(),
  termGroup: z.coerce.number().int().min(1).max(3),
  capstone: z.coerce.boolean(),
  sessionA: AddSessionSchema,
  sessionB: AddSessionSchema,
});
export type AddValuePayload = z.infer<typeof AddValuePayloadSchema>;

/** REORDER — the FULL ordered list of value ids. Set-equality with the current active set is a cross-row
 * rule checked at propose + apply (validateReorderOrder), so here we only shape it. */
export const ReorderPayloadSchema = z.object({
  order: z.array(z.string().uuid()).min(1, "Reorder needs the full value order."),
});
export type ReorderPayload = z.infer<typeof ReorderPayloadSchema>;

/** REMOVE — the target value id (soft-archive on apply; never a delete). */
export const RemovePayloadSchema = z.object({
  valueId: z.string().uuid(),
});
export type RemovePayload = z.infer<typeof RemovePayloadSchema>;

// ── Reorder validation + the atomic renumber planner ────────────────────────────────────────────────

/**
 * A REORDER payload is legal iff `order` is a PERMUTATION of the current active value ids — same length,
 * same set, no duplicates. Re-run at APPLY time (not just propose): between propose and approve another
 * approved change may have added/removed a value, and a stale order that drops or invents an id must be
 * refused rather than silently mis-renumbered. Returns an error message, or null when valid.
 */
export function validateReorderOrder(
  order: readonly string[],
  activeIds: readonly string[],
): string | null {
  if (new Set(order).size !== order.length) return "The proposed order has a duplicate value.";
  if (order.length !== activeIds.length) {
    return "The proposed order no longer matches the current values — re-open and try again.";
  }
  const active = new Set(activeIds);
  for (const id of order) {
    if (!active.has(id)) {
      return "The proposed order references a value that no longer exists — re-open and try again.";
    }
  }
  return null;
}

export interface RenumberPlan {
  /** The blanket constant added to EVERY school value's ordinal to evacuate them clear of the final range. */
  shift: number;
  /** The final ordinal for every row: `order` at 1..n, then archived compacted at n+1.. — all distinct. */
  placements: { id: string; ordinal: number }[];
}

/**
 * THE ATOMIC RENUMBER (the #296 hazard Wells flagged). `UNIQUE(school_id, ordinal)` is NOT deferrable,
 * so a single in-place swap `SET ordinal = CASE …` trips the unique mid-statement (Postgres checks each
 * row immediately, unlike MySQL). The fix is a TWO-STEP temporary-offset renumber:
 *
 *   1. EVACUATE — one blanket `UPDATE vlc_value SET ordinal = ordinal + shift WHERE school_id = X`.
 *      `shift = maxOrdinal + 1`, so every new ordinal (≥ minOrdinal+shift > maxOrdinal) is strictly above
 *      the whole final range 1..(n+a) AND above every un-moved old value → the single statement never
 *      collides at any point (constant shift is a bijection; source and target ranges are disjoint).
 *   2. PLACE — set each row to its FINAL ordinal one row at a time: the `order` list at 1..n (payload
 *      sequence) and the archived ids compacted at n+1..(n+a). Every target is free (all rows are up in
 *      the temp range) and every target is distinct → no collision, and ordinals compact back to
 *      1..(n+a) each reorder (bounded — no unbounded climb).
 *
 * PURE: given the current ids + maxOrdinal it returns the shift and the placement list; the action just
 * executes them. `order` is assumed already validated (validateReorderOrder) to equal the active set.
 * `maxOrdinal` is the MAX over ALL rows (active + archived) so the temp range clears archived rows too.
 *
 * ponytail: ordinal is smallint; `maxOrdinal + shift` peaks near 2·maxOrdinal transiently. Because step 2
 * recompacts to 1..(n+a) every reorder, maxOrdinal stays ≈ value count (a few dozen), so the smallint
 * ceiling (32767) is never approached. Upgrade path if a school ever churns thousands of values: make the
 * UNIQUE DEFERRABLE and swap in place under SET CONSTRAINTS DEFERRED.
 */
export function planReorder(
  order: readonly string[],
  archivedIds: readonly string[],
  maxOrdinal: number,
): RenumberPlan {
  const shift = maxOrdinal + 1;
  const placements: { id: string; ordinal: number }[] = [];
  order.forEach((id, i) => placements.push({ id, ordinal: i + 1 }));
  archivedIds.forEach((id, j) => placements.push({ id, ordinal: order.length + 1 + j }));
  return { shift, placements };
}

// ── Human-readable preview (server-only reader → client panel gets these strings, never the raw payload) ─

export interface VlcChangePreview {
  op: VlcChangeOp;
  /** e.g. "Add value: Gratitude" · "Reorder 11 values" · "Remove value: Patriotism". */
  title: string;
  /** the one-line detail line under the title (nullable). */
  detail: string | null;
}

/**
 * Turn a stored change request into the two display strings the pending panel renders. Defensive: a
 * schema-free jsonb payload may be malformed (hand-crafted / older shape), so every field access is
 * guarded and falls back to a neutral label rather than throwing in a server render.
 */
export function previewChange(
  op: string,
  payload: unknown,
  nameById: ReadonlyMap<string, string>,
): VlcChangePreview {
  const p = (payload ?? {}) as Record<string, unknown>;
  if (op === "ADD") {
    const nameEn = typeof p.nameEn === "string" ? p.nameEn : "new value";
    const parts: string[] = [];
    if (typeof p.nameTwi === "string" && p.nameTwi) parts.push(p.nameTwi);
    if (typeof p.descriptor === "string" && p.descriptor) parts.push(p.descriptor);
    if (p.capstone === true) parts.push("capstone");
    return { op: "ADD", title: `Add value: ${nameEn}`, detail: parts.length ? parts.join(" · ") : null };
  }
  if (op === "REORDER") {
    const order = Array.isArray(p.order) ? (p.order as unknown[]) : [];
    const names = order.map((id) => (typeof id === "string" ? nameById.get(id) ?? "?" : "?"));
    return {
      op: "REORDER",
      title: `Reorder ${order.length} values`,
      detail: names.length ? names.join(" → ") : null,
    };
  }
  if (op === "REMOVE") {
    const valueId = typeof p.valueId === "string" ? p.valueId : null;
    const name = valueId ? nameById.get(valueId) ?? "a value" : "a value";
    return { op: "REMOVE", title: `Remove value: ${name}`, detail: "Archived — session history is preserved." };
  }
  return { op: op as VlcChangeOp, title: `Change: ${op}`, detail: null };
}
