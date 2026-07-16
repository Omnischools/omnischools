"use client";
import { useEffect } from "react";

/**
 * Tells the Score-Ledger service worker who the current user is, so it can PARTITION the
 * authenticated ledger cache per user and purge a previous user's cache the moment a different
 * teacher loads the app (INCR-4 · R3 defense-in-depth alongside the logout purge). The user id
 * is the person's own id (not a secret); it names the cache partition, it is not an auth token.
 * No-op wherever there is no service worker (dev, unsupported browsers).
 */
export function PwaSession({ uid }: { uid: string }) {
  useEffect(() => {
    if (!uid || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    let cancelled = false;
    navigator.serviceWorker.ready
      .then((reg) => {
        if (cancelled) return;
        (reg.active ?? navigator.serviceWorker.controller)?.postMessage({
          type: "omnischools-session",
          uid,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [uid]);
  return null;
}
