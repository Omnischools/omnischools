/**
 * The idle-timer's last-activity cookie NAME, alone in its own module.
 *
 * Why a whole file for one constant: `middleware.ts` runs in the edge runtime and must not import
 * `lib/auth/index.ts` — that module reaches the analytics database (the officer resolver) and
 * `next/headers`, neither of which exists there, and pulling it in would either fail the build or
 * quietly bundle the Postgres client into middleware. The cookie name is the one thing the two
 * layers genuinely share: middleware WRITES the stamp (it is the only layer that sees every
 * request), `lib/auth` READS it. A duplicated string literal would work until one of them was
 * renamed, at which point the idle limit would stop firing with nothing failing.
 *
 * What the value is trusted for is deliberately narrow — see the note on `readLastSeenMs()` in
 * lib/auth/index.ts: tampering can only end a session early or reset the idle clock inside a session
 * whose absolute cap (signed `amr`, unforgeable) is checked first.
 */
export const LAST_SEEN_COOKIE = "ov_last_seen";
