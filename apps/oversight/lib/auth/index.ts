import { env, isSupabaseAuthConfigured, SupabaseAuthUnavailableError } from "@/lib/env";
import {
  sealOfficerSession,
  type OfficerSession as GateOfficer,
} from "@/lib/oversight/officer";
import { resolveOfficerByUid } from "@/lib/auth/officer-directory";
import { LAST_SEEN_COOKIE } from "@/lib/auth/last-seen";
import { getJurisdictionNode } from "@/lib/oversight/jurisdiction";
import { scopeFor } from "@/lib/db/rls";
import {
  institutionLabel,
  roleLabel,
  tierLabel,
  canOpenNamedRecord,
} from "@/lib/auth/roles";
import {
  lastMfaAtMs,
  loginAtMsFromClaims,
  mfaRequirementSatisfied,
  sessionExpiry,
  stepUpFresh,
  type ExpiryReason,
} from "@/lib/auth/session-policy";

/**
 * THE AUTH INTERFACE for Oversight.
 *
 * Feature code — routes, server actions, the gate — calls `getOfficerSession()` and nothing else.
 * It never touches `supabase.auth.*` directly. That indirection is what keeps the session shape
 * (officer id, role, jurisdiction, tier) a single well-known object that the RLS helpers and the
 * audit writer can both be given, instead of each caller assembling its own idea of "who is this"
 * from whatever the auth SDK happened to return.
 *
 * ── INCREMENT G: THE SESSION IS NOW REAL, AND THE INTERFACE DID NOT CHANGE ───────────────────────
 * `getOfficerSession()` used to return the dev shim or `null`. It now verifies a Supabase Auth
 * session on the ANALYTICS project and resolves the officer from the database. The signature, the
 * returned shape and the fail-closed contract are identical, which is the point of having had the
 * interface: not one gated surface changed to gain real authentication.
 *
 * FOUR RULES THIS FILE EXISTS TO ENFORCE:
 *
 *  1. VERIFY WITH `getUser()`, NEVER `getSession()`. `getSession()` returns whatever is in the
 *     cookie store without checking it against the auth server; it is documented as untrustworthy
 *     for exactly this use. `getUser()` (and `getClaims()`, which verifies the JWT signature) are
 *     the two calls that establish identity. A grep for `getSession` in this app should find nothing
 *     — tests/auth-boundaries.test.ts asserts that, and also pins the four modules allowed to touch
 *     `supabase.auth.*` at all (this one, lib/auth/mfa.ts, lib/provisioning/admin-auth.ts,
 *     middleware.ts).
 *  2. TAKE ONLY THE UID. The token contributes `sub` and the chrome's display name. It contributes
 *     NOTHING about scope: jurisdiction, tier and role all come from `ov_resolve_officer(uid)` on
 *     every request. A JWT carrying a custom `level: "NATIONAL"` claim widens nothing, because no
 *     code reads a scope out of a claim.
 *  3. NO ROW ⇒ NULL. No directory row, a deactivated officer, a SCHOOL node, any error: `null`.
 *     NEVER a synthesised `{ jurisdictionId: null, level: "NATIONAL" }` — that literal is a national
 *     ceiling, and it is now also impossible to write (the session is branded; see
 *     lib/oversight/officer.ts).
 *  4. `displayName` / `jurisdictionName` ARE CHROME. The name comes from the officer's own JWT (the
 *     resolver deliberately returns none), the jurisdiction label from an ordinary RLS-scoped
 *     `dim_jurisdiction` read. Neither is ever written to an audit row: that row carries
 *     `officer_role` verbatim from the directory, so the log cannot be reworded by a label change.
 */
export interface OfficerSession extends GateOfficer {
  /** Chrome only — the sidebar footer and the access strip. Never written to the audit row. */
  displayName: string;
  /**
   * The officer's own node label, or NULL when that chrome-only read could not be satisfied below the
   * national tier. See the assignment in `getAuthContext()` for why the absence is carried rather than
   * papered over with the institution label, and `components/oversight/tier-chrome.tsx` for the wording
   * each consumer chooses.
   */
  jurisdictionName: string | null;
}

/**
 * A fixed uuid, so dev audit rows are attributable to "the dev shim" rather than to a random
 * identity per restart (which would make the local audit log unreadable).
 */
export const DEV_OFFICER_ID = "00000000-0000-4000-8000-000000000001";

export class DevBypassInProductionError extends Error {
  readonly code = "AUTH_DEV_BYPASS_IN_PRODUCTION";
  constructor() {
    super(
      "AUTH_DEV_BYPASS=true with NODE_ENV=production. The dev shim issues a NATIONAL, unfiltered officer session with no authentication — in production that is unauthenticated national access to every named record in Ghana. Refusing to start. Set AUTH_DEV_BYPASS=false.",
    );
    this.name = "DevBypassInProductionError";
  }
}

/**
 * ⚠ PRODUCTION HARD-STOP, evaluated at MODULE LOAD.
 *
 * The dev shim below does not merely skip a login — it returns a **NATIONAL** officer, the tier with
 * no jurisdiction filter at all, so with `AUTH_DEV_BYPASS=true` in production every gated surface
 * would open to anyone who can reach the URL, and each access would be logged against a fabricated
 * officer id. `.env.example` ships the flag as `true` because that is right for local development,
 * which is exactly why a deployment that copies it must not merely misbehave.
 *
 * It throws rather than silently falling back to "no session" because a silent fallback is
 * indistinguishable from correct operation until someone notices nobody can log in — whereas a
 * process that refuses to boot is noticed immediately, by the deploy. Failing at module load rather
 * than per request means the bad configuration cannot serve even one page.
 */
function assertDevBypassNotInProduction(): void {
  if (env.AUTH_DEV_BYPASS && env.NODE_ENV === "production") {
    throw new DevBypassInProductionError();
  }
}

assertDevBypassNotInProduction();

/**
 * PRECEDENCE when both the bypass and real Supabase credentials are configured.
 *
 * THE BYPASS WINS — and only outside production, where it cannot be reached at all (the hard stop
 * above). The alternative (real auth wins when its vars happen to be set) was rejected because it
 * makes local behaviour depend on whether a developer's `.env.local` still has a stale Supabase
 * pair: the same command would sign you in as a NATIONAL shim on one machine and demand a GES
 * credential on another, and the shim is the one that gets debugged. One flag, one answer, and the
 * flag is inert in production.
 *
 * Returning `true` here is therefore also a statement that nothing downstream has to re-check: the
 * real path is not entered at all, so no half-shim/half-Supabase session can exist.
 */
function devBypassActive(): boolean {
  if (!env.AUTH_DEV_BYPASS) return false;
  // Re-checked per call as well as at load: the module-load guard is what fails the deploy, and
  // this is what holds if anything mutates the environment inside a running process.
  assertDevBypassNotInProduction();
  return true;
}

const DEV_SESSION: OfficerSession = {
  ...sealOfficerSession({
    officerId: DEV_OFFICER_ID,
    officerRole: "NATIONAL_OVERSIGHT",
    jurisdictionId: null,
    level: "NATIONAL",
  }),
  displayName: "Dev officer (AUTH_DEV_BYPASS)",
  jurisdictionName: "National · Ministry of Education",
};

/**
 * Why the request has no officer session. The UI needs this to pick the right COPY — Lucy G4 (never
 * provisioned), G5 (withdrawn), G6 (timed out) and the sign-in redirect all look identical to a
 * caller that only has `null`.
 *
 * ⚠ `"unprovisioned"` COVERS WITHDRAWN TOO, AND THAT IS A DELIBERATE DEVIATION FROM LUCY G5.
 * `ov_resolve_officer()` returns zero rows for an unprovisioned uid AND for a deactivated officer,
 * on purpose: policies.sql's resolver is explicitly "not an account-state oracle". Distinguishing
 * the two in the UI would require a second read that CAN tell them apart — i.e. an app-reachable
 * query that confirms the existence of a directory row for a uid, which is the enumeration surface
 * the directory's whole design withholds. So the app shows the G4 copy, which is true in both cases
 * ("your access isn't set up"), and the withdrawn officer learns the rest from the administrator
 * their only onward action points at. Flagged for the owner: if G5's distinct wording is required,
 * it needs a schema/posture decision from Wells, not an app-side guess.
 */
export type NoSessionReason =
  | "anonymous"
  | "mfa-required"
  | "expired-absolute"
  | "expired-idle"
  | "unprovisioned"
  | "auth-unavailable";

export interface AuthContext {
  /** The resolved officer, or null. The ONLY thing feature code should branch on. */
  officer: OfficerSession | null;
  /** Why not, when null. */
  reason: NoSessionReason | null;
  /** Chrome for the degraded strip (Lucy G4): the authenticated name, with no scope attached. */
  authenticatedName: string | null;
  /** True when a verified Supabase user exists, whatever the directory said. */
  authenticated: boolean;
  /** A fresh MFA assertion is within the §6 reuse window (Kofi R6). */
  stepUpFresh: boolean;
  /** Milliseconds since the last MFA assertion, or null — for the step-up copy only. */
  lastMfaAtMs: number | null;
}

const ANONYMOUS: AuthContext = {
  officer: null,
  reason: "anonymous",
  authenticatedName: null,
  authenticated: false,
  stepUpFresh: false,
  lastMfaAtMs: null,
};

/**
 * The display name, from the officer's OWN verified token.
 *
 * Order: `user_metadata.full_name` (what the provisioner sets), then the email local part, then the
 * uid's first segment. Never the directory's `full_name` — that column is unreachable by the app
 * credential by design, and a name sourced from it would be a name the officer cannot see or
 * correct. Never request input of any kind.
 */
function displayNameFrom(claims: Record<string, unknown>, uid: string): string {
  const meta = claims.user_metadata;
  if (meta && typeof meta === "object") {
    for (const key of ["full_name", "name", "display_name"]) {
      const v = (meta as Record<string, unknown>)[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  const email = claims.email;
  if (typeof email === "string" && email.includes("@")) return email.split("@")[0]!;
  return `Officer ${uid.slice(0, 8)}`;
}

/**
 * Resolve the full auth context for this request.
 *
 * THE ORDER OF CHECKS IS THE SECURITY MODEL, so it is written out:
 *   1. configured?            — otherwise nobody can be verified; refuse loudly, do not guess.
 *   2. `getUser()`            — the authoritative identity round trip. No user ⇒ anonymous.
 *   3. `getClaims()`          — the VERIFIED token, for amr/aal/name. Not `getSession()`.
 *   4. session lifetime       — absolute cap then idle (Kofi R5), measured off `amr`, not `iat`.
 *   5. mandatory MFA          — no escape hatch (lib/auth/session-policy.ts explains the inverse).
 *   6. `ov_resolve_officer()` — the DATABASE decides the jurisdiction, tier and role.
 * Only a request that passes all six has an `officer`. Steps 4 and 5 come BEFORE step 6 so an
 * unverified session never causes a directory lookup, and step 6 is last because it is the only one
 * that can widen anything.
 */
export async function getAuthContext(): Promise<AuthContext> {
  if (devBypassActive()) {
    return {
      officer: DEV_SESSION,
      reason: null,
      authenticatedName: DEV_SESSION.displayName,
      authenticated: true,
      // The shim has no MFA assertion and never will. Treating it as fresh would make the §6
      // step-up untestable locally AND unexercised; treating it as stale makes the local gate
      // demand a TOTP code that cannot exist. The shim is a non-production convenience, so it
      // declares the step-up satisfied — and the production hard stop above is what makes that
      // safe to say in writing.
      stepUpFresh: true,
      lastMfaAtMs: Date.now(),
    };
  }

  if (!isSupabaseAuthConfigured()) {
    return { ...ANONYMOUS, reason: "auth-unavailable" };
  }

  let uid: string;
  let claims: Record<string, unknown>;
  try {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();

    // ── 2. the authoritative identity ──────────────────────────────────────────────────────────
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user?.id) return ANONYMOUS;
    uid = userData.user.id;

    // ── 3. the verified token, for amr / aal / display name ────────────────────────────────────
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
    if (claimsError || !claimsData?.claims) {
      // We have an identity but cannot read its assurance level or age. Fail closed: a session we
      // cannot measure is not a session we may admit to a named-record surface.
      return { ...ANONYMOUS, authenticated: true, reason: "mfa-required" };
    }
    claims = claimsData.claims as unknown as Record<string, unknown>;

    // The token's own subject must be the user the auth server named. They cannot normally differ;
    // if they ever do, something is substituting tokens and the only safe answer is no session.
    const sub = claims.sub;
    if (typeof sub !== "string" || sub !== uid) return ANONYMOUS;
  } catch (err) {
    if (err instanceof SupabaseAuthUnavailableError) {
      return { ...ANONYMOUS, reason: "auth-unavailable" };
    }
    // A network failure to the auth server, a malformed cookie, a JWKS fetch error: no verified
    // identity, so no session. Never a partial one.
    return ANONYMOUS;
  }

  const authenticatedName = displayNameFrom(claims, uid);
  const loginAt = loginAtMsFromClaims(claims);
  const mfaAt = lastMfaAtMs(claims);
  const freshStepUp = stepUpFresh({
    lastMfaAtMs: mfaAt,
    windowMinutes: env.OVERSIGHT_STEP_UP_WINDOW_MINUTES,
  });

  const base: AuthContext = {
    officer: null,
    reason: null,
    authenticatedName,
    authenticated: true,
    stepUpFresh: freshStepUp,
    lastMfaAtMs: mfaAt,
  };

  // ── 4. session lifetime ──────────────────────────────────────────────────────────────────────
  // The IDLE half needs a last-activity stamp, which middleware maintains (it is the only layer
  // that runs on every request, including ones this function is never called from). `null` here
  // means "no stamp yet", which `idleExceeded` treats as not-idle — see its note.
  const expiry: ExpiryReason | null = sessionExpiry({
    maxHours: env.OVERSIGHT_SESSION_MAX_HOURS,
    idleMinutes: env.OVERSIGHT_SESSION_IDLE_MINUTES,
    loginAtMs: loginAt,
    lastSeenMs: await readLastSeenMs(),
  });
  if (expiry) {
    return {
      ...base,
      reason: expiry === "absolute" ? "expired-absolute" : "expired-idle",
    };
  }

  // ── 5. mandatory MFA ─────────────────────────────────────────────────────────────────────────
  if (!mfaRequirementSatisfied(claims)) {
    return { ...base, reason: "mfa-required" };
  }

  // ── 6. the DATABASE decides the scope ────────────────────────────────────────────────────────
  const resolved = await resolveOfficerByUid(uid);
  if (!resolved) {
    return { ...base, reason: "unprovisioned" };
  }

  // Chrome: the label for the officer's own node. Null-safe — losing it degrades the sidebar, not
  // the boundary (lib/oversight/jurisdiction.ts).
  const node = await getJurisdictionNode(scopeFor(resolved), resolved.jurisdictionId);

  return {
    ...base,
    officer: {
      ...resolved,
      displayName: authenticatedName,
      /**
       * ⚠ NULL BELOW NATIONAL WHEN THE NODE READ FAILED — fixed in increment I slice 3 (Dex L2a).
       *
       * This used to be `node?.name ?? institutionLabel(resolved.level)`, which for a sub-national
       * officer substituted the string "Ghana Education Service" for a PLACE NAME. That label then
       * flowed into the dashboard crumb, the h1 and — the reason it is a defect rather than a blemish —
       * the provenance Scope line, producing "Ghana Education Service · sibling regions not visible
       * here": the wrong subject on the one line that is a security claim about what the officer cannot
       * see. A missing label is a small degradation; a label naming the wrong thing is actionable.
       *
       * Null makes the absence un-ignorable at the type level, so each consumer picks its OWN degraded
       * wording: `tierChrome()`/`breakdownChrome()` say "this region" and drop the crumb's middle
       * segment, and `officerChrome()` tells the sidebar chip the name is unavailable.
       *
       * NATIONAL KEEPS ITS LABEL, and the asymmetry is deliberate: at national the institution label is
       * "Ministry of Education", which is not a claim about a place (there is no sibling national node
       * to confuse it with), the dashboard's headline ignores this field entirely in favour of the
       * literal "Ghana", and the dev shim ships the same string. So there is nothing to mislead and
       * nothing to gain from dropping it.
       */
      jurisdictionName:
        node?.name ??
        (resolved.level === "NATIONAL" ? institutionLabel(resolved.level) : null),
    },
  };
}

/**
 * The last-activity stamp, read from the cookie middleware writes (name: lib/auth/last-seen.ts).
 *
 * A COOKIE, NOT A DATABASE ROW, and the reason is portability plus honesty about what it protects:
 * the idle timer is a convenience limit on top of the absolute cap, and a per-request write to
 * Postgres (or to a Vercel KV, which this app is forbidden from using) to maintain it would add a
 * write to every page load of a read-only analytics app. The value is not trusted for anything else:
 * tampering with it can only make a session appear MORE idle (ending it early) or reset the idle
 * clock within a session whose absolute 8h cap — measured from the signed token's own `amr` — is
 * unforgeable and is checked first.
 */
async function readLastSeenMs(): Promise<number | null> {
  try {
    const { cookies } = await import("next/headers");
    const store = await cookies();
    const raw = store.get(LAST_SEEN_COOKIE)?.value;
    if (!raw) return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * THE one call feature code makes. Null ⇒ refuse, whatever the reason; `getAuthContext()` is for
 * the surfaces that must also choose the right words.
 */
export async function getOfficerSession(): Promise<OfficerSession | null> {
  const context = await getAuthContext();
  return context.officer;
}

/** For server actions that must not proceed without an identity to log the access against. */
export async function requireOfficerSession(): Promise<OfficerSession> {
  const session = await getOfficerSession();
  if (!session) {
    throw new Error(
      "No GES officer session. Named-record access requires an authenticated officer to log the access against.",
    );
  }
  return session;
}

/**
 * The §6 gate's tier reachability (Kofi R1 / Lucy G7): DISTRICT and wider, never SCHOOL. Exposed
 * here so the gate's server action asks `lib/auth` rather than inspecting `officer.level` itself.
 */
export function officerMayOpenNamedRecord(session: OfficerSession): boolean {
  return canOpenNamedRecord(session.level);
}

/** Chrome labels, so no surface re-implements the mapping. */
export function officerChrome(session: OfficerSession): {
  name: string;
  role: string;
  tier: string;
  institution: string;
  jurisdiction: string;
} {
  return {
    name: session.displayName,
    role: roleLabel(session.officerRole),
    tier: tierLabel(session.level),
    institution: institutionLabel(session.level),
    /**
     * The sidebar's "Your jurisdiction" chip picks its OWN degraded wording (slice 3, Dex L2a): the
     * TIER is known and unaffected — it came from the database resolver, not from the failed label read
     * — so the chip states the tier and says the name is missing, rather than printing an institution
     * where a place should be. The ceiling the chip describes is unchanged either way.
     */
    jurisdiction:
      session.jurisdictionName ?? `${tierLabel(session.level)} · name unavailable`,
  };
}
