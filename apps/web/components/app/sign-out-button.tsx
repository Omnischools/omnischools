"use client";
import { useRef } from "react";
import { signOutAction } from "@/lib/actions/auth";
import { purgeSnapshots } from "@/lib/score-ledger/pwa-store";

/**
 * Sign-out that PURGES the PWA cache AND the durable IndexedDB buffer before the redirect
 * (INCR-4 · R3 / K4 · INCR-14 · R3 — Sarah gate). The Score-Ledger SW caches authenticated
 * `force-dynamic` content and (Phase 2) the IndexedDB store now holds durable pending SCORES (PII);
 * on logout every `omnischools-*` cache is cleared and the whole snapshot store is wiped so the
 * next person on a shared tablet inherits ZERO of the previous teacher's data. Still a real
 * `<form action>` so sign-out works with JS off (no JS ⇒ no SW / no IndexedDB write ⇒ nothing to
 * leak, so the bare server action is correct there).
 */
async function purgePwaCaches(): Promise<void> {
  // Wipe the durable pending-score buffer (all sessions) — never blocks sign-out on a failure.
  await purgeSnapshots();
  try {
    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      // CONTRACT: the "omnischools-" prefix must match public/sw.js `VERSION` — renaming the SW
      // cache prefix here or there silently breaks the logout purge → shared-device cache leak,
      // with no compile error.
      await Promise.all(
        keys.filter((k) => k.startsWith("omnischools-")).map((k) => caches.delete(k)),
      );
    }
    if (typeof navigator !== "undefined" && navigator.serviceWorker?.controller) {
      // CONTRACT: "omnischools-clear" is the SW message protocol in public/sw.js — keep in sync.
      navigator.serviceWorker.controller.postMessage({ type: "omnischools-clear" });
    }
  } catch {
    // best-effort — never block sign-out on a cache API hiccup
  }
}

export function SignOutButton() {
  // Guards the re-entrant submit: first submit purges then re-submits; the second pass falls
  // through to the server action (which clears the session cookie and redirects).
  const purged = useRef(false);
  return (
    <form
      action={signOutAction}
      onSubmit={(e) => {
        if (purged.current) return;
        e.preventDefault();
        const form = e.currentTarget;
        void purgePwaCaches().finally(() => {
          purged.current = true;
          form.requestSubmit();
        });
      }}
    >
      <button
        type="submit"
        className="rounded-md px-3 py-1.5 text-xs font-semibold text-navy-2 transition-colors hover:bg-bg"
      >
        Sign out
      </button>
    </form>
  );
}
