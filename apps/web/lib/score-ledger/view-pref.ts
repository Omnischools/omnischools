/**
 * Card/Grid view preference (INCR-4 · Q5). Persisted in `localStorage`, keyed per
 * (teacher × subject × class × semester) — no schema, per-device. Card is the first-use
 * default; once the teacher chooses Grid for a context, that choice sticks across sessions.
 * The resolver is pure (no DOM) so it is unit-tested; read/write guard `window` for SSR.
 */
export type LedgerView = "card" | "grid";

export interface ViewPrefContext {
  teacherId: string;
  subjectId: string;
  classId: string;
  periodId: string;
}

/** Stable, per-context key. Teacher-scoped so a shared device doesn't cross wires. */
export function viewPrefKey(ctx: ViewPrefContext): string {
  return `omnischools:ledger-view:${ctx.teacherId}:${ctx.subjectId}:${ctx.classId}:${ctx.periodId}`;
}

/** Card is the default first-use and the safe fallback: only an explicit "grid" flips it (V3/V5). */
export function resolveView(stored: string | null | undefined): LedgerView {
  return stored === "grid" ? "grid" : "card";
}

export function readViewPref(ctx: ViewPrefContext): LedgerView {
  if (typeof window === "undefined") return "card";
  try {
    return resolveView(window.localStorage.getItem(viewPrefKey(ctx)));
  } catch {
    return "card"; // storage blocked/full → default, never throw (V5)
  }
}

export function writeViewPref(ctx: ViewPrefContext, view: LedgerView): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(viewPrefKey(ctx), view);
  } catch {
    // storage unavailable — preference is best-effort, non-fatal
  }
}
