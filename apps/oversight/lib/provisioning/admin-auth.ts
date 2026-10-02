/*
 * NO `import "server-only"` HERE, deliberately.
 *
 * That marker package is resolvable only inside the Next bundler graph; this module is also imported
 * by the vitest suite (and, for the provisioning modules, by a tsx CLI script), where the import
 * fails outright. The server-side boundary is therefore enforced the way this codebase already
 * enforces the read-back boundary — by an import-graph test with an explicit allow-list
 * (tests/auth-boundaries.test.ts, tests/provisioning-admin-gate.test.ts) plus the ESLint
 * no-restricted-imports rules — which catches a client component importing this at review time
 * rather than at bundle time, and which a test cannot silently lose.
 */
import { adminUids, env, isSupabaseAuthConfigured } from "@/lib/env";
import { resolveOfficerByUid } from "@/lib/auth/officer-directory";

/**
 * THE ADMIN CONSOLE'S OWN ROLE GATE (Kofi R7 · Lucy G8/R10).
 *
 * The provisioning console is OMNISCHOOLS-OPERATED. It is not the top of the GES hierarchy and it is
 * not a surface a GES officer graduates into — it is the internal operations console that creates
 * and withdraws GES officer accounts. Two consequences, and the second is the one that is easy to
 * get wrong:
 *
 *  1. Access is an explicit allow-list of Omnischools staff uids (`OVERSIGHT_ADMIN_UIDS`). Unset ⇒
 *     EMPTY SET ⇒ nobody may provision. Fail closed, with no bootstrap backdoor: a first
 *     administrator is added by setting the variable, which is a deploy-time act with a reviewer,
 *     not a runtime one.
 *  2. A GES OFFICER SESSION OF ANY TIER IS REFUSED — including NATIONAL. This is checked
 *     POSITIVELY: if the uid resolves through `ov_resolve_officer()`, the request is refused even if
 *     that uid also appears in the admin allow-list. A national officer is the most senior person in
 *     the GES hierarchy and has no provisioning authority whatsoever; letting the two roles overlap
 *     would mean the most privileged READER could grant themselves, or anyone, a wider ceiling —
 *     collapsing the separation that the whole officer-directory design rests on (the app credential
 *     cannot write the directory; neither may the app's most powerful user).
 *
 * The refusal is deliberately one-directional in its message: an unauthorised visitor is told they
 * have no access to this console, never whether a given uid is an administrator.
 */

export class AdminAccessDeniedError extends Error {
  readonly code = "ADMIN_ACCESS_DENIED";
  constructor(
    message = "This console is operated by Omnischools and your account is not authorised to use it.",
  ) {
    super(message);
    this.name = "AdminAccessDeniedError";
  }
}

export interface AdminSession {
  /** The Omnischools staff member's Supabase auth uid — the `actor_id` on every audit row. */
  adminId: string;
  displayName: string;
}

/**
 * Resolve the admin session, or null.
 *
 * It verifies the identity exactly as the officer path does — `getUser()`, never `getSession()` —
 * and then applies the two rules above. There is no separate auth MECHANISM: the same Supabase
 * project issues both identities, and keeping one mechanism means there is one place where session
 * verification can be wrong. What differs is AUTHORISATION, which is the thing that should differ.
 *
 * ⚠ OWNER-RATIFY (Lucy R10). Lucy's map asks for confirmation that the console "sits behind its own
 * Omnischools-staff auth, distinct from the officer pool". Distinct POOL is implemented (the
 * allow-list, plus the positive refusal of officer uids); a wholly separate auth PROJECT is not,
 * because that is a provisioning decision with a cost (a second Supabase project, a second set of
 * MFA enrolments, a second place to offboard someone from) that the owner should weigh, not an
 * implementer. If the owner wants separation at the project level, this module is the only thing
 * that changes.
 */
export async function getAdminSession(): Promise<AdminSession | null> {
  const allowed = adminUids();
  if (allowed.size === 0) return null;

  // The dev bypass issues a NATIONAL OFFICER session, not an admin one. It deliberately does NOT
  // open this console: a local shim that could provision officers would be a local shim that can
  // grant national access, and the production hard stop is the only thing standing between that
  // behaviour and a mis-set deploy variable. Locally, add your own uid to OVERSIGHT_ADMIN_UIDS.
  if (!isSupabaseAuthConfigured()) return null;

  let uid: string;
  let name: string;
  try {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user?.id) return null;
    uid = data.user.id;
    const metadata = data.user.user_metadata as Record<string, unknown> | undefined;
    const fullName = typeof metadata?.full_name === "string" ? metadata.full_name : null;
    name = fullName ?? data.user.email ?? `Admin ${uid.slice(0, 8)}`;
  } catch {
    return null;
  }

  if (!allowed.has(uid.toLowerCase())) return null;

  // THE POSITIVE REFUSAL. An allow-listed uid that is ALSO a provisioned GES officer is refused.
  const officer = await resolveOfficerByUid(uid);
  if (officer) return null;

  return { adminId: uid, displayName: name };
}

export async function requireAdminSession(): Promise<AdminSession> {
  const session = await getAdminSession();
  if (!session) throw new AdminAccessDeniedError();
  return session;
}

/** For the console's own chrome: is this deployment configured to have administrators at all? */
export function adminConsoleConfigured(): boolean {
  return adminUids().size > 0 && Boolean(env.PROVISIONER_DATABASE_URL?.trim());
}
