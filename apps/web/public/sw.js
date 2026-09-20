// Omnischools service worker — Score Ledger PWA Phase 1 (INCR-4).
//
// Hand-rolled Cache API only. NO next-pwa, NO Vercel edge/ISR/KV/Blob — the SW and manifest
// are standard web-platform primitives so the app stays host-agnostic (R2 / Dex gate).
//
// What it caches (Q2):
//   - the app shell (Next static chunks, fonts, icons, manifest) — non-sensitive, cache-first;
//   - the CURRENT score-ledger page (class×subject×semester the teacher actually opened) —
//     authenticated `force-dynamic` content, network-first, so signal-less reload still renders
//     the roster + last-saved scores. No historical/closed semesters (only visited URLs land in
//     the cache), no other authenticated pages.
//
// Security (R3 / Sarah gate — cached authenticated content must never leak across sessions):
//   - the ledger cache name is PARTITIONED per SESSION id (`<version>-ledger--<sessionId>`), not
//     the uid (INCR-14 · Item 9 — closes the Phase-1 shared-device ceiling). The session id is
//     stable across the hourly token refresh but rotates on logout / re-login, so a different login
//     on a shared tablet gets a fresh partition and the previous session's ledger cache is purged.
//   - network-first for the ledger means an ONLINE user always gets their own fresh server render;
//     the cache is only ever a signal-less fallback.
//   - on logout the page clears every `omnischools-*` cache before the sign-out redirect.
//
// Cache busting (R2): a SINGLE version constant. Bump it on a breaking change and `activate`
// deletes every cache that does not carry the current version. This `VERSION` is DELIBERATELY
// SEPARATE from the IndexedDB store's STORE_VERSION (lib/score-ledger/pwa-store): the SW cache is
// rebuildable from the network and safe to blind-wipe on a bump; the IndexedDB store may hold the
// ONLY copy of unsynced pending scores and must never be blind-wiped (Trap-3).

const VERSION = "omnischools-v1";
const SHELL_CACHE = `${VERSION}-shell`;
const LEDGER_PREFIX = `${VERSION}-ledger--`;
const LEDGER_PATH = "/senior/score-ledger";

// In-memory current session id (re-established by the page on every authenticated load). Used to
// name the ledger cache; falls back to the single existing ledger cache when the SW restarted.
let currentSessionId = null;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      // Bust every cache from an older version constant (deploy cache-bust).
      await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "omnischools-session" && typeof data.sessionId === "string" && data.sessionId) {
    currentSessionId = data.sessionId;
    event.waitUntil(purgeOtherLedgerCaches(data.sessionId));
  } else if (data.type === "omnischools-clear") {
    currentSessionId = null;
    event.waitUntil(clearAll());
  }
});

/** Delete every partitioned ledger cache that is not the current session's (new-login / R3 purge). */
async function purgeOtherLedgerCaches(sessionId) {
  const keep = LEDGER_PREFIX + sessionId;
  const keys = await caches.keys();
  await Promise.all(
    keys.filter((k) => k.startsWith(LEDGER_PREFIX) && k !== keep).map((k) => caches.delete(k)),
  );
}

/** Logout purge — drop the shell and every ledger partition. */
async function clearAll() {
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k.startsWith(VERSION)).map((k) => caches.delete(k)));
}

/** The name of the ledger cache to use: the current session's, else the sole existing partition. */
async function ledgerCacheName() {
  if (currentSessionId) return LEDGER_PREFIX + currentSessionId;
  const keys = await caches.keys();
  return keys.find((k) => k.startsWith(LEDGER_PREFIX)) || null;
}

function isShellAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/img/") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/favicon.ico"
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // server-action POSTs (the save path) pass straight through
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch cross-origin

  if (isShellAsset(url)) {
    event.respondWith(cacheFirst(req));
    return;
  }
  if (url.pathname === LEDGER_PATH) {
    event.respondWith(ledgerNetworkFirst(req));
    return;
  }
  // Everything else (other authenticated pages, APIs): straight to the network — keep the
  // cached-authenticated surface as small as the offline promise needs (R3 scope discipline).
});

/** Immutable, non-sensitive shell — serve from cache, fall back to network and backfill. */
async function cacheFirst(req) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return hit || Response.error();
  }
}

/** The authenticated ledger — network-first so an online user always gets their own fresh
 *  render; cache the success for the signal-less reload; on failure fall back to this user's
 *  cached copy, else an honest "needs a connection" page (never a false-empty roster — K2). */
async function ledgerNetworkFirst(req) {
  try {
    const res = await fetch(req);
    if (res.ok) {
      const name = await ledgerCacheName();
      if (name) {
        const cache = await caches.open(name);
        cache.put(req, res.clone());
      }
    }
    return res;
  } catch {
    const name = await ledgerCacheName();
    if (name) {
      const cache = await caches.open(name);
      const hit = await cache.match(req);
      if (hit) return hit;
    }
    return offlineLedgerFallback();
  }
}

/** Honest offline fallback — no false-empty roster, no "offline mode" claim (R1). */
function offlineLedgerFallback() {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Needs a connection · Omnischools</title>
<style>
  body{margin:0;font-family:system-ui,sans-serif;background:#FAF7F2;color:#1A2B47;
    display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
  .card{max-width:340px;text-align:center}
  h1{font-size:18px;margin:0 0 8px}
  p{font-size:13px;line-height:1.5;color:#5C6675;margin:0}
  .dot{width:9px;height:9px;border-radius:50%;background:#C8975B;display:inline-block;margin-right:6px}
</style></head><body><div class="card">
  <h1><span class="dot"></span>Can't load this class without a connection</h1>
  <p>This class ledger hasn't been opened on this device yet, so there's nothing saved to show
  offline. Reconnect and it will load — your held scores are safe and will sync when you're back.</p>
</div></body></html>`;
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
