"use client";
import { useEffect } from "react";
import { purgeSnapshots } from "@/lib/score-ledger/pwa-store";

/**
 * Tells the Score-Ledger service worker + IndexedDB store WHICH session is current, so both the
 * network cache and the durable pending-score buffer are PARTITIONED per auth session and a prior
 * session's data is purged the moment a different teacher loads the app (INCR-14 · R3 — the
 * shared-tablet defence, alongside the logout purge).
 *
 * The partition key is the stable Supabase SESSION id (lib/auth getSessionId), NOT the uid: it
 * survives the hourly access-token refresh but rotates on logout / re-login, so teacher B on a
 * shared tablet never inherits teacher A's cached scores or durable pending buffer. No-op wherever
 * there is no service worker (dev, unsupported browsers); the IndexedDB purge still runs.
 */
export function PwaSession({ sessionId }: { sessionId: string }) {
  useEffect(() => {
    if (!sessionId) return;
    // Defence-in-depth: drop every OTHER session's durable snapshot on identify (a new teacher on a
    // shared tablet where A never logged out). Best-effort; keeps only this session's records.
    void purgeSnapshots(sessionId);
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    let cancelled = false;
    navigator.serviceWorker.ready
      .then((reg) => {
        if (cancelled) return;
        // CONTRACT: "omnischools-session" is the SW message protocol in public/sw.js — keep in sync.
        (reg.active ?? navigator.serviceWorker.controller)?.postMessage({
          type: "omnischools-session",
          sessionId,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sessionId]);
  return null;
}
