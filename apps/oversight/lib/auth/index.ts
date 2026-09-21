import { env } from "@/lib/env";
import type { OfficerSession as GateOfficer } from "@/lib/oversight/officer";

/**
 * THE AUTH INTERFACE for Oversight.
 *
 * Feature code — routes, server actions, the gate — calls `getOfficerSession()` and nothing else.
 * It never touches `supabase.auth.*` directly. That indirection is what keeps the session shape
 * (officer id, role, jurisdiction, tier) a single well-known object that the RLS helpers and the
 * audit writer can both be given, instead of each caller assembling its own idea of "who is this"
 * from whatever the auth SDK happened to return.
 *
 * ⚠ REAL GES-STAFF AUTH IS NOT BUILT YET (PROVISIONING §4: "Supabase auth vars for the GES-staff
 * auth ... when built"). With `AUTH_DEV_BYPASS=false` — the production setting — this returns NULL,
 * and every gated surface therefore refuses. That is the correct failure: an unauthenticated
 * request must not be able to open a named record, and a shim that quietly invented an officer
 * identity would put a fabricated name on an audit row, which is worse than no access at all.
 */
export interface OfficerSession extends GateOfficer {
  /** Chrome only — the sidebar footer and the access strip. Never written to the audit row. */
  displayName: string;
  jurisdictionName: string;
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

export async function getOfficerSession(): Promise<OfficerSession | null> {
  if (env.AUTH_DEV_BYPASS) {
    // Re-checked per call as well as at load: the module-load guard is what fails the deploy, and
    // this is what holds if anything mutates the environment inside a running process.
    assertDevBypassNotInProduction();
    return {
      officerId: DEV_OFFICER_ID,
      officerRole: "NATIONAL_OVERSIGHT",
      jurisdictionId: null,
      level: "NATIONAL",
      displayName: "Dev officer (AUTH_DEV_BYPASS)",
      jurisdictionName: "National · Ministry of Education",
    };
  }
  // Real GES-staff auth (the analytics Supabase project) is separate, unbuilt work. FAIL CLOSED.
  return null;
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
