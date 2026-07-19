/**
 * IndexedDB persistence for the Score Ledger PWA buffer (INCR-14 · Item 9 · Phase 2).
 *
 * The pure reducer (pwa-buffer.ts) stays the source of truth; this is a durable snapshot BENEATH
 * it so a full offline session — the typed `cells`, the `pending`/`errored` buffer, and the
 * pre-cached rosters — survives a real app close/reopen, not just an in-tab network drop (Phase 1).
 * Plain `indexedDB`, no idb/Dexie/next-pwa/@vercel/* (BUILD_STACK portability — web standards only).
 *
 * SECURITY partition (Sarah / R3): each record's key is prefixed with the Supabase SESSION id
 * (lib/auth getSessionId) — stable across the hourly token refresh, rotated on logout/re-login — so
 * a shared tablet never surfaces the prior teacher's durable pending SCORES (PII). Logout wipes the
 * whole store; a new session purges the others (purge-on-identify). The rest of the key is the
 * ledger context (subject×period): a teacher teaches several subjects, and the buffer/cells are
 * subject-specific, so keying by session ALONE would let one subject's held scores flush as another.
 *
 * STORE_VERSION is the SNAPSHOT-schema version and is DELIBERATELY separate from sw.js's cache
 * VERSION (Trap-3): the SW cache is rebuildable from the network and safe to blind-wipe on a bump;
 * this store may hold the ONLY copy of unsynced pending/errored work, so a version bump must
 * migrate-forward or flush-then-clear — NEVER blind-wipe. On read we accept newer/unknown schemas
 * and hydrate the fields we recognise (buffer/cells/rosters are additive) rather than dropping work.
 */
import type { PendingBuffer } from "./pwa-buffer";
// Type-only import (erased at build → no runtime cycle with the component that imports this store).
import type { PwaClass } from "@/components/senior/pwa-ledger";

const DB_NAME = "omnischools-ledger";
const DB_VERSION = 1; // IndexedDB STRUCTURAL version (object stores) — bump only to add/alter a store.
const STORE = "snapshots";
/** SNAPSHOT-schema version — SEPARATE from sw.js's cache `VERSION` (Trap-3). */
export const STORE_VERSION = 1;

export interface LedgerContext {
  sessionId: string;
  subjectId: string;
  periodId: string;
}

export interface LedgerSnapshot {
  buffer: PendingBuffer;
  cells: Record<string, string>;
  rosters: PwaClass[];
  updatedAt: number;
}

interface StoredRecord extends LedgerSnapshot {
  key: string;
  sessionId: string;
  storeVersion: number;
}

const recordKey = (ctx: LedgerContext): string =>
  `${ctx.sessionId}::${ctx.subjectId}::${ctx.periodId}`;

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      return resolve(null);
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

/**
 * Persist the snapshot for this ledger context. Called IMMEDIATELY on every edit/confirm/reject
 * (only the network flush is debounced), so no edit is lost in the close window. Best-effort:
 * never throws — a quota/`indexedDB` failure warns-and-keeps (AC8) rather than blocking the UI.
 */
export async function saveSnapshot(ctx: LedgerContext, snap: LedgerSnapshot): Promise<void> {
  if (!ctx.sessionId) return;
  const db = await openDb();
  if (!db) return;
  const record: StoredRecord = {
    ...snap,
    key: recordKey(ctx),
    sessionId: ctx.sessionId,
    storeVersion: STORE_VERSION,
  };
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => {
        console.warn("[pwa-store] snapshot persist failed (kept in memory)", tx.error);
        resolve();
      };
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
  db.close();
}

/** Load the durable snapshot for this ledger context, or null if none / IndexedDB unavailable. */
export async function loadSnapshot(ctx: LedgerContext): Promise<LedgerSnapshot | null> {
  if (!ctx.sessionId) return null;
  const db = await openDb();
  if (!db) return null;
  const rec = await new Promise<StoredRecord | undefined>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(recordKey(ctx));
      req.onsuccess = () => resolve(req.result as StoredRecord | undefined);
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
  db.close();
  if (!rec) return null;
  // Trap-3: never drop unsynced work on a version delta. A newer/unknown storeVersion still hydrates
  // the additive fields we recognise; add an explicit forward migration here if a future bump
  // changes a field's SHAPE (not just adds one).
  return {
    buffer: rec.buffer,
    cells: rec.cells ?? {},
    rosters: rec.rosters ?? [],
    updatedAt: rec.updatedAt ?? 0,
  };
}

/**
 * Delete every snapshot NOT belonging to `keepSessionId` (purge-on-identify — a new teacher on a
 * shared tablet). With no argument, wipe the whole store (logout). Best-effort; never throws.
 */
export async function purgeSnapshots(keepSessionId?: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  const keepPrefix = keepSessionId ? `${keepSessionId}::` : null;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const req = store.getAllKeys();
      req.onsuccess = () => {
        for (const key of req.result) {
          if (keepPrefix && typeof key === "string" && key.startsWith(keepPrefix)) continue;
          store.delete(key);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
  db.close();
}
