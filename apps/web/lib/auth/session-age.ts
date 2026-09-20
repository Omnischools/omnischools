/**
 * INCR-254 — pure helpers for enforcing a school's "Session length" security setting (ref_school.
 * session_hours). Kept free of next/navigation + Supabase so the fail-closed decision matrix is
 * unit-testable without a live session. The wiring (read the JWT, redirect) lives in lib/auth.
 */

/**
 * The ORIGINAL login time (ms since epoch) of a decoded GoTrue access-token payload, or null.
 *
 * We read the earliest `amr` (authentication-methods-references) entry timestamp — the time the
 * session's first auth factor was verified. Unlike `iat`, an amr timestamp is NOT rewritten on the
 * hourly access-token refresh, so it measures the true absolute age of the session (a 30-minute-old
 * token can belong to an 8-hour-old session). amr timestamps are Unix SECONDS.
 */
export function loginAtMsFromClaims(claims: unknown): number | null {
  const amr = (claims as { amr?: unknown })?.amr;
  if (!Array.isArray(amr)) return null;
  const seconds = amr
    .map((e) =>
      e && typeof e === "object" ? (e as { timestamp?: unknown }).timestamp : undefined,
    )
    .filter((t): t is number => typeof t === "number" && Number.isFinite(t) && t > 0);
  return seconds.length ? Math.min(...seconds) * 1000 : null;
}

/**
 * FAIL-CLOSED session-age gate. `true` ⇒ the session is older than the configured limit (or its age
 * is unknowable while a limit is set) and the caller MUST force re-authentication.
 *
 *  - `limitHours` null/undefined  ⇒ false — the school never opted in, nothing to enforce.
 *  - `!isLive` (dev-bypass shim)  ⇒ false — no real session, no age concept.
 *  - live + limit + `loginAtMs` null ⇒ TRUE — a limit is set but we cannot read the session's age,
 *    so we deny (more security, not less) rather than silently letting an unbounded session through.
 *  - live + limit + a real login time ⇒ true once `now - loginAt` exceeds the limit.
 */
export function sessionAgeExceeded(a: {
  limitHours: number | null | undefined;
  isLive: boolean;
  loginAtMs: number | null;
  now?: number;
}): boolean {
  if (a.limitHours == null) return false;
  if (!a.isLive) return false;
  if (a.loginAtMs == null) return true; // fail closed: unreadable age under an active limit
  const now = a.now ?? Date.now();
  return now - a.loginAtMs > a.limitHours * 3_600_000;
}
