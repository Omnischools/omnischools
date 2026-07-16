/**
 * Pure pending-buffer state machine for the Score Ledger PWA (INCR-4 · Phase 1).
 *
 * The buffer wraps the `saveDirectLedgerScores` / `savePortfolioScores` server actions
 * CLIENT-SIDE (React state + an `online`-event flush) — NOT a service-worker Background Sync
 * queue (RSC action POSTs don't replay cleanly through the SW). It is IN-MEMORY only (Kofi Q1):
 * it survives non-destructive in-tab transitions (Card↔Grid, class switch) but NOT a hard
 * reload/app-close — on reload the cells show their last SERVER-CONFIRMED value, never a false
 * "saved" (R4 / B5). No localStorage, no IndexedDB (IndexedDB is Item 9).
 *
 * The crux (R4) is distinguishing a TRANSPORT failure from a DOMAIN rejection:
 *   - transport failure  (fetch rejects / navigator offline) → HOLD the scores pending, keep the
 *     gold tint, retry on the next `online` event. The score is NOT lost and NOT falsely saved.
 *   - domain `{ ok:false }` (closed period, wrong path, out-of-range) → SURFACE as an error; the
 *     scores move OUT of "will sync" into an errored state so they are never parked silently as
 *     pending (B6). The teacher must fix the value.
 *
 * A pending score is device-local until the wrapped action returns `{ ok:true }` — never written
 * to `senior_score_ledger`, never visible on another device / desktop / VHM view / STPSHS sheet
 * until confirmed (Q7). Kept side-effect-free so the state machine is unit-tested directly.
 */

export type PwaCat = "asgn" | "midSem" | "endSem" | "project" | "portfolio";
export const PWA_CATS: readonly PwaCat[] = ["asgn", "midSem", "endSem", "project", "portfolio"];

/** A single addressable score cell: one student's one category. */
export function cellId(studentId: string, cat: PwaCat): string {
  return `${studentId}:${cat}`;
}
export function studentOfCell(id: string): string {
  return id.slice(0, id.lastIndexOf(":"));
}

export type CellStatus = "clean" | "pending" | "errored";
export type StripTone = "green" | "gold";

export interface PendingBuffer {
  /** cellId → the value the teacher entered, held until the server confirms it. */
  pending: Record<string, string>;
  /** cellId → the value the server rejected on a DOMAIN error (needs the teacher to fix). */
  errored: Record<string, string>;
  /** Our belief about connectivity: flipped false by a transport failure, true by `online`. */
  online: boolean;
  /**
   * Are we inside a CONNECTION-LOSS episode? True from the moment a drop is detected (offline /
   * transport failure) with scores held, until the buffer fully drains. It is the gold-tint
   * gate: a score typed while merely online-and-saving is NOT gold; a score held across a drop
   * IS gold — and STAYS gold through reconnect until the server confirms it (R4 / §3.4). Once
   * every held score is confirmed the episode ends and the strip goes green.
   */
  episode: boolean;
  /** The last domain-error message to surface (never a transport failure — those just hold). */
  lastError: string | null;
  /** Epoch-ms of the last confirmed sync — drives the green strip's "last N ago". */
  lastSyncedAt: number | null;
}

export function emptyBuffer(online = true): PendingBuffer {
  return {
    pending: {},
    errored: {},
    online,
    episode: false,
    lastError: null,
    lastSyncedAt: null,
  };
}

const without = (rec: Record<string, string>, ids: string[]): Record<string, string> => {
  const next = { ...rec };
  for (const id of ids) delete next[id];
  return next;
};

/** The teacher entered/changed a score → hold it pending; a re-edit clears any prior error. A
 *  score typed while offline (or mid-episode) joins the connection-loss episode → gold. */
export function bufferEdit(s: PendingBuffer, id: string, value: string): PendingBuffer {
  const errored = without(s.errored, [id]);
  return {
    ...s,
    pending: { ...s.pending, [id]: value },
    errored,
    episode: s.online ? s.episode : true,
    lastError: Object.keys(errored).length === 0 ? null : s.lastError,
  };
}

/** Server confirmed these cells (`{ ok:true }`) — drop them from pending; stamp the sync time.
 *  When the buffer fully drains the episode ends (strip → green). */
export function bufferConfirm(s: PendingBuffer, ids: string[], now: number): PendingBuffer {
  const pending = without(s.pending, ids);
  return {
    ...s,
    pending,
    errored: without(s.errored, ids),
    online: true,
    episode: Object.keys(pending).length === 0 ? false : s.episode,
    lastSyncedAt: now,
  };
}

/** Transport failure (offline / fetch rejected) — keep the cells pending, mark us offline and
 *  open a connection-loss episode so the held scores tint gold. */
export function bufferHold(s: PendingBuffer): PendingBuffer {
  return { ...s, online: false, episode: hasPending(s) ? true : s.episode };
}

/** Domain rejection (`{ ok:false }`) — move the cells OUT of "will sync" into an errored state
 *  and surface the message. We reached the server, so we are online. Never parked as pending. */
export function bufferReject(s: PendingBuffer, ids: string[], error: string): PendingBuffer {
  const movedErrored = { ...s.errored };
  for (const id of ids) if (id in s.pending) movedErrored[id] = s.pending[id];
  const pending = without(s.pending, ids);
  return {
    ...s,
    pending,
    errored: movedErrored,
    online: true,
    episode: Object.keys(pending).length === 0 ? false : s.episode,
    lastError: error,
  };
}

/** Track connectivity. Going offline WITH held scores opens the episode; going online does NOT
 *  close it (held scores stay gold until each is confirmed — R4). */
export function bufferSetOnline(s: PendingBuffer, online: boolean): PendingBuffer {
  if (s.online === online) return s;
  return { ...s, online, episode: !online && hasPending(s) ? true : s.episode };
}

export const pendingCount = (s: PendingBuffer): number => Object.keys(s.pending).length;
export const hasPending = (s: PendingBuffer): boolean => pendingCount(s) > 0;
export const hasErrors = (s: PendingBuffer): boolean => Object.keys(s.errored).length > 0;

export function cellStatus(s: PendingBuffer, id: string): CellStatus {
  if (id in s.errored) return "errored";
  if (id in s.pending) return "pending";
  return "clean";
}

/** Is this cell HELD by a connection-loss episode (→ gold "not saved yet" tint)? A pending cell
 *  that is merely saving normally online is not held. Errored cells are never held. */
export function cellHeld(s: PendingBuffer, id: string): boolean {
  return s.episode && id in s.pending;
}

/** The distinct student ids referenced by the current pending cells — the flush payload scope. */
export function pendingStudentIds(s: PendingBuffer): string[] {
  const set = new Set<string>();
  for (const id of Object.keys(s.pending)) set.add(studentOfCell(id));
  return Array.from(set);
}

/** Gold for the whole connection-loss episode (drop → held → reconnect → until drained); green
 *  when there is no episode (online + synced, or online + merely saving a fresh edit). */
export function stripTone(s: PendingBuffer): StripTone {
  return s.episode ? "gold" : "green";
}

/** Live count of held scores — what the gold strip / card badge report during an episode. */
export function heldCount(s: PendingBuffer): number {
  return s.episode ? pendingCount(s) : 0;
}

// --- Copy builders (R1 · BINDING) -------------------------------------------------------------
// Honest strings only: "held locally / will sync / will save when connection returns". NEVER
// "works offline" / "offline mode". A pending score is never rendered as "saved".
const plural = (n: number) => (n === 1 ? "" : "s");

/** The gold sync-strip line (§3.1, verbatim shape) — N is the live pending count. */
export function heldStripText(n: number): string {
  return `Connection lost · ${n} score${plural(n)} held locally, will sync when reconnected`;
}

/** The card-level "held locally" badge (§3.3, verbatim shape). */
export function heldBadgeText(n: number): string {
  return `${n} score${plural(n)} on this card ${
    n === 1 ? "is" : "are"
  } held locally · will save when connection returns`;
}
