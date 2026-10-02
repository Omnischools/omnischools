import type { JurisdictionLevel } from "@/lib/db/rls";

/**
 * The acting officer, as the audit writer and the RLS helpers need them.
 *
 * This lives in its own tiny module rather than beside the gate ON PURPOSE. `lib/auth` needs the
 * shape, every page needs `lib/auth`, and if the shape lived in
 * `lib/oversight/named-record-access.ts` then importing an officer type would pull the entire gated
 * path — and with it `lib/db/readback` — into the module graph of every aggregate page in the app.
 * Type imports are erased at build, so that would not have been a runtime leak; it would have been
 * something worse in the long run, which is an isolation boundary that only holds by accident.
 * tests/readback-isolation.test.ts checks the graph textually and caught exactly this.
 */

/**
 * ⚠ THE RESOLUTION BRAND (increment G).
 *
 * `OfficerSession` carries a property keyed on a module-private `unique symbol`. The symbol is not
 * exported and cannot be named from outside this file, so an `OfficerSession` CANNOT be written as
 * an object literal anywhere in the app — `{ officerId, officerRole, jurisdictionId: null, level:
 * "NATIONAL" }` does not typecheck, in a page, in a server action, or in a helper.
 *
 * Why that matters more here than type tidiness: this object is the sole input to
 * `scopeFor()` → `withJurisdiction()`, which writes `app.current_jurisdiction` / `app.current_level`
 * — the GUCs every RLS policy in db/sql/policies.sql reads. A hand-written session is therefore a
 * hand-written jurisdiction ceiling: one `level: "NATIONAL"` literal in a future page, and that page
 * reads every named record in Ghana and stamps an officer id of the author's choosing onto the audit
 * row. The brand makes "the session came from somewhere that actually resolved it" a compile-time
 * fact rather than a convention the next author has to know about.
 *
 * The ONLY way to obtain one is `sealOfficerSession()` below, and the only callers permitted to use
 * it are the real resolver and the dev shim — enforced by the allow-list in
 * tests/auth-boundaries.test.ts, which fails the suite if a new importer appears. The brand is
 * the compile-time half; that test is the review half. Neither is sufficient alone: TypeScript can
 * be defeated with `as unknown as OfficerSession`, which is exactly the kind of line a reviewer can
 * spot once the only legitimate construction site is a named, tested list of two files.
 */
declare const DB_RESOLVED: unique symbol;

export interface OfficerSession {
  readonly officerId: string;
  readonly officerRole: string;
  /** The officer's node in `dim_jurisdiction` — the RLS ceiling. Null only at NATIONAL. */
  readonly jurisdictionId: string | null;
  readonly level: JurisdictionLevel;
  /** Unforgeable marker: this session was produced by resolution, not by an author. */
  readonly [DB_RESOLVED]: true;
}

/** The session's actual facts, without the brand — what a resolver has to supply. */
export type ResolvedOfficerFields = Omit<OfficerSession, typeof DB_RESOLVED>;

/**
 * Mint a branded `OfficerSession`.
 *
 * ⚠ CALL SITES ARE AN ALLOW-LIST, NOT A JUDGEMENT CALL. Exactly two modules may call this:
 *   · `lib/auth/officer-directory.ts` — the `ov_resolve_officer(uid)` read (the real session)
 *   · `lib/auth/index.ts`             — the `AUTH_DEV_BYPASS` dev shim, which is hard-stopped in
 *                                       production at module load
 * …plus `tests/helpers.ts`, which is how the suite acts as a fixture officer. Adding a third caller
 * fails tests/auth-boundaries.test.ts. If you need a session somewhere, get it from
 * `getOfficerSession()`; if `getOfficerSession()` cannot give you one, the correct behaviour is to
 * refuse, not to build one.
 */
export function sealOfficerSession(fields: ResolvedOfficerFields): OfficerSession {
  return fields as OfficerSession;
}
