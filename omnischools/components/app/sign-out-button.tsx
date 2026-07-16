"use client";
import { useRef } from "react";
import { signOutAction } from "@/lib/actions/auth";

/**
 * Sign-out that PURGES the PWA cache before the redirect (INCR-4 · R3 / K4 — Sarah gate).
 * The Score-Ledger SW caches authenticated `force-dynamic` content; on logout every
 * `omnischools-*` cache is cleared so the next person on a shared device never inherits the
 * previous teacher's cached scores. Still a real `<form action>` so sign-out works with JS off
 * (no JS ⇒ no service worker ⇒ no cache to leak, so the bare server action is correct there).
 */
async function purgePwaCaches(): Promise<void> {
  try {
    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith("omnischools-")).map((k) => caches.delete(k)),
      );
    }
    if (typeof navigator !== "undefined" && navigator.serviceWorker?.controller) {
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
