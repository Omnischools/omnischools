// Omnischools service worker (placeholder).
// Phase 0 reserves the PWA surface; offline caching for the SHS score-ledger PWA
// (SHS_SCORE_LEDGER_SPEC §PWA) is added in a later phase. Network-first pass-through for now.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {
  // Intentionally no caching yet — let the network handle every request.
});
