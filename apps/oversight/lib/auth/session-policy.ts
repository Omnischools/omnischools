/**
 * SESSION POLICY — pure decisions (Kofi R5, Lucy G6/R3). No Supabase, no next/navigation, no env, so
 * the whole matrix is unit-testable without a live session. The wiring (read the claims, redirect)
 * lives in middleware.ts + lib/auth/index.ts; the TIMER VALUES live in lib/env.ts.
 *
 * Ported from `apps/web/lib/auth/session-age.ts`. Separate lockfiles, no shared import — see the
 * pointer note at the top of lib/supabase/server.ts. Two differences from that file, both
 * deliberate, both the Oversight posture:
 *
 *  1. NO OPT-IN. In apps/web the age limit is a per-school SETTING (`ref_school.session_hours`) and
 *     `limitHours == null` means "this school never opted in — nothing to enforce". Oversight has no
 *     such switch: there is one tenant (GES), the limits are always on, and the only configurable
 *     part is the number. A null/absent limit here is a MISCONFIGURATION, not an opt-out, and is
 *     treated as expired.
 *  2. NO NO-LOCKOUT ESCAPE HATCH — see `mfaRequirementSatisfied` below. This is the deliberate
 *     INVERSE of `apps/web/lib/auth/two-factor.ts`, and the reason is written out there.
 */

/**
 * The ORIGINAL login time (ms since epoch) of a decoded GoTrue access-token payload, or null.
 *
 * The earliest `amr` (authentication-methods-references) entry timestamp — the moment the session's
 * FIRST factor was verified. Unlike `iat`, an amr timestamp is NOT rewritten when the access token
 * is refreshed, so it measures the true absolute age of the session: a 30-minute-old token can
 * belong to an 8-hour-old session, and `iat` would happily report the former. Using `iat` would make
 * the absolute cap unenforceable while looking like it worked — the failure mode that matters here,
 * because nobody notices a security limit that silently never fires. amr timestamps are Unix SECONDS.
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

/** The amr methods that count as a completed SECOND factor for Oversight. */
export const MFA_AMR_METHODS = ["mfa", "totp"] as const;

export interface AmrEntry {
  method: string;
  timestampMs: number;
}

/**
 * Every authentication method named in the token, lower-cased.
 *
 * GoTrue emits `amr` in TWO shapes — the detailed `[{ method, timestamp }]` form and the RFC-8176
 * string form `["password","totp"]` (see `AMREntry` in @supabase/auth-js). The string form carries
 * NO timestamps, so it can answer "was a second factor used" but not "when". That split is why
 * method presence and the clocks are separate functions here: a project emitting the string form
 * still enforces mandatory MFA, while the absolute-age and step-up clocks fail closed for want of a
 * timestamp (which is the correct direction — an unmeasurable session is not a young one).
 */
export function amrMethods(claims: unknown): string[] {
  const amr = (claims as { amr?: unknown })?.amr;
  if (!Array.isArray(amr)) return [];
  return amr
    .map((e) => {
      if (typeof e === "string") return e.toLowerCase();
      if (e && typeof e === "object") {
        const m = (e as { method?: unknown }).method;
        return typeof m === "string" ? m.toLowerCase() : null;
      }
      return null;
    })
    .filter((m): m is string => m !== null);
}

/** The amr list as `{ method, timestampMs }`, newest last. Unreadable entries are dropped. */
export function amrEntries(claims: unknown): AmrEntry[] {
  const amr = (claims as { amr?: unknown })?.amr;
  if (!Array.isArray(amr)) return [];
  return amr
    .map((e) => {
      if (!e || typeof e !== "object") return null;
      const method = (e as { method?: unknown }).method;
      const ts = (e as { timestamp?: unknown }).timestamp;
      if (typeof method !== "string") return null;
      if (typeof ts !== "number" || !Number.isFinite(ts) || ts <= 0) return null;
      return { method: method.toLowerCase(), timestampMs: ts * 1000 };
    })
    .filter((e): e is AmrEntry => e !== null)
    .sort((a, b) => a.timestampMs - b.timestampMs);
}

/**
 * The time of the most recent MFA assertion in this session, or null if there has never been one.
 * This is what the §6 step-up window is measured against (`stepUpFresh`).
 */
export function lastMfaAtMs(claims: unknown): number | null {
  const mfa = amrEntries(claims).filter((e) =>
    (MFA_AMR_METHODS as readonly string[]).includes(e.method),
  );
  return mfa.length ? mfa[mfa.length - 1]!.timestampMs : null;
}

/**
 * MANDATORY MFA (Kofi R5 · Lucy G1.b/G1.c). `true` ⇒ this session has completed a second factor and
 * may use the app.
 *
 * 🔴 NO ESCAPE HATCH, AND THAT IS THE DIFFERENCE FROM apps/web. `twoFactorStepUpRequired()` there
 * fails SAFE: if OTP cannot actually be delivered it does not block, because the worst case is a
 * school's only admins locked out of their own live system with no recovery path — a bricked school.
 * Oversight's worst case is the opposite. There is a PROVISIONING DESK (docs/PROVISIONING.md §4b,
 * Lucy G8): every officer account is created, and can be reset, by an Omnischools administrator, so a
 * locked-out officer has a human recovery route that a school admin did not. Availability therefore
 * does NOT win here: an unverified session simply does not get in. An absent/unreadable amr blocks
 * for the same reason — the officer can complete the very factor they are redirected to.
 *
 * `aal` is checked too where GoTrue supplies it, so a session Supabase itself considers aal1 is
 * refused even if an amr entry claims otherwise. Both signals come from the SERVER-VERIFIED token
 * (`getUser()`), never from a cookie this app parsed itself.
 */
export function mfaRequirementSatisfied(claims: unknown): boolean {
  const aal = (claims as { aal?: unknown })?.aal;
  if (typeof aal === "string" && aal.toLowerCase() !== "aal2") return false;
  return amrMethods(claims).some((m) =>
    (MFA_AMR_METHODS as readonly string[]).includes(m),
  );
}

export type ExpiryReason = "absolute" | "idle";

/**
 * FAIL-CLOSED absolute-age gate. `true` ⇒ the session is older than the configured maximum (or its
 * age is unknowable) and the caller MUST force re-authentication.
 *
 * `loginAtMs == null` ⇒ TRUE. A limit is always set here (see the no-opt-in note above), so an
 * unreadable age means we cannot prove the session is young enough. Denying costs the officer one
 * re-login; admitting costs an unbounded session on a surface that opens named records.
 */
export function absoluteAgeExceeded(a: {
  maxHours: number | null | undefined;
  loginAtMs: number | null;
  now?: number;
}): boolean {
  if (a.maxHours == null || !Number.isFinite(a.maxHours) || a.maxHours <= 0) return true;
  if (a.loginAtMs == null) return true;
  const now = a.now ?? Date.now();
  return now - a.loginAtMs > a.maxHours * 3_600_000;
}

/**
 * IDLE gate. `true` ⇒ no activity for longer than the configured idle window.
 *
 * `lastSeenMs == null` ⇒ FALSE, and this is the one place the policy is not pessimistic. The
 * last-seen stamp is written by middleware on the first protected request of a session; a brand-new
 * session legitimately has none, and failing closed on absence would mean nobody could ever get past
 * their first page load. The absolute cap above still bounds such a session, and the idle clock
 * starts the moment the first stamp is written. An absent stamp is therefore "not idle YET", not
 * "unknowable".
 */
export function idleExceeded(a: {
  idleMinutes: number | null | undefined;
  lastSeenMs: number | null;
  now?: number;
}): boolean {
  if (a.idleMinutes == null || !Number.isFinite(a.idleMinutes) || a.idleMinutes <= 0) {
    return false;
  }
  if (a.lastSeenMs == null) return false;
  const now = a.now ?? Date.now();
  return now - a.lastSeenMs > a.idleMinutes * 60_000;
}

/** Which limit (if either) ended this session. Absolute wins — it is the one that cannot be reset. */
export function sessionExpiry(a: {
  maxHours: number | null | undefined;
  idleMinutes: number | null | undefined;
  loginAtMs: number | null;
  lastSeenMs: number | null;
  now?: number;
}): ExpiryReason | null {
  if (absoluteAgeExceeded(a)) return "absolute";
  if (idleExceeded(a)) return "idle";
  return null;
}

/**
 * THE §6 STEP-UP WINDOW (Kofi R6 · Lucy G7). `true` ⇒ an MFA assertion made inside the reuse window
 * still counts, so the gate submit proceeds without a fresh challenge.
 *
 * Measured from the LAST MFA amr timestamp, which is a server-verified claim: completing a step-up
 * challenge adds a new amr entry, so "the officer re-asserted 90 seconds ago" is a fact in the
 * token rather than a flag this app stored somewhere. That is why there is no step-up cookie and no
 * server-side step-up table to keep in sync, and why a stolen cookie cannot extend the window.
 *
 * The clock is INDEPENDENT of the G6 session timers: a session well inside its 8h/30m life still
 * needs a fresh step-up once the 5-minute window lapses.
 */
export function stepUpFresh(a: {
  lastMfaAtMs: number | null;
  windowMinutes: number | null | undefined;
  now?: number;
}): boolean {
  if (a.lastMfaAtMs == null) return false;
  if (
    a.windowMinutes == null ||
    !Number.isFinite(a.windowMinutes) ||
    a.windowMinutes <= 0
  ) {
    return false;
  }
  const now = a.now ?? Date.now();
  const age = now - a.lastMfaAtMs;
  // A negative age means the assertion is stamped in the future — a clock skew or a doctored claim.
  // Refuse rather than treat it as maximally fresh.
  if (age < 0) return false;
  return age <= a.windowMinutes * 60_000;
}
