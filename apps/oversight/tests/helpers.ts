import { readFileSync } from "node:fs";
import postgres from "postgres";
import { TEST_DB_CONFIG_PATH, type TestDbConfig } from "./setup/paths";
import { JUR, OFFICER } from "./fixtures/ids";
import {
  sealOfficerSession,
  type OfficerSession,
  type ResolvedOfficerFields,
} from "@/lib/oversight/officer";
import { sealStepUpAssertion, type StepUpAssertion } from "@/lib/auth/step-up";

export const testDbConfig = JSON.parse(
  readFileSync(TEST_DB_CONFIG_PATH, "utf8"),
) as TestDbConfig;

/**
 * A SUPERUSER connection, used ONLY by assertions.
 *
 * Audit rows are read back as the owner (RLS-exempt) on purpose: a test that read them through the
 * app role would be asserting "the officer can see their own row", which is a different claim from
 * "the row exists". When the point is that a DENIAL was written, the assertion must be able to see
 * every row, including ones no officer is entitled to.
 */
export function adminAnalytics(): postgres.Sql {
  return postgres(testDbConfig.superuserAnalyticsUrl, { max: 1, prepare: false });
}

export function adminOperational(): postgres.Sql {
  return postgres(testDbConfig.superuserOperationalUrl, { max: 1, prepare: false });
}

/**
 * The increment-H ETL database (owner connection) — a THIRD analytics DB, built from the same
 * migrations but carrying no policies and no §6 fixtures. See `demoAnalyticsUrl` in
 * tests/setup/paths.ts for why the ETL cannot run against the shared fixture DB.
 *
 * Owner, not `ov_app`, on purpose and not for convenience: the ETL's real credential is the privileged
 * analytics owner/writer (scope §3), because the app role has no INSERT on any fact table at all. A
 * test that ran the loader as `ov_app` would be testing a credential the pipeline will never hold.
 */
export function adminDemoAnalytics(): postgres.Sql {
  // `onnotice` is silenced because the demo source schema is DROP-then-CREATEd, and "schema does not
  // exist, skipping" on the first run is expected, not information.
  return postgres(testDbConfig.demoAnalyticsUrl, {
    max: 1,
    prepare: false,
    onnotice: () => {},
  });
}

export interface AuditRow {
  access_id: string;
  officer_id: string;
  officer_role: string;
  jurisdiction_id: string | null;
  reason_code: string;
  case_reference: string | null;
  record_type: string;
  target_ref: string;
  fields_released: string[] | null;
  legal_basis: string;
  consent_ref: string | null;
  outcome: string;
  staff_category: string | null;
  roster_browsed: boolean;
  exported: boolean;
  export_format: string | null;
}

/** Every audit row written under one case reference, oldest first. */
export async function auditRowsFor(caseReference: string): Promise<AuditRow[]> {
  const sql = adminAnalytics();
  try {
    return (await sql`
      select access_id::text, officer_id::text, officer_role, jurisdiction_id::text,
             reason_code, case_reference, record_type::text, target_ref, fields_released,
             legal_basis::text, consent_ref::text, outcome::text, staff_category,
             roster_browsed, exported, export_format
      from audit_access_log
      where case_reference = ${caseReference}
      order by occurred_at asc, access_id asc
    `) as unknown as AuditRow[];
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function auditRowCount(): Promise<number> {
  const sql = adminAnalytics();
  try {
    const rows =
      (await sql`select count(*)::int as n from audit_access_log`) as unknown as {
        n: number;
      }[];
    return rows[0]!.n;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * THE FIXTURE OFFICER MINT.
 *
 * `OfficerSession` carries a resolution brand (lib/oversight/officer.ts), so it cannot be written as
 * an object literal — including here. That is deliberate: the suite is one of exactly three places
 * allowed to mint a session, and tests/officer-session-mint.test.ts asserts the list. A test that
 * needs a differently-scoped officer derives it from one of these (`{ ...districtOfficer,
 * jurisdictionId: JUR.otherDistrict }` keeps the brand) rather than inventing a shape.
 *
 * ⚠ `OFFICER.role` is still the legacy `DISTRICT_DIRECTOR` string, while a REAL session now carries
 * the DIRECTORY's `officer_role` — `DISTRICT_OVERSIGHT` (Wells's expected cosmetic drift). The
 * fixture keeps the old value on purpose so the pre-existing §6 audit-row assertions keep asserting
 * what they were written to assert; the live value is covered by tests/officer-resolver-rls.test.ts,
 * which reads it from the database rather than from this file.
 */
export function officerFixture(fields: ResolvedOfficerFields): OfficerSession {
  return sealOfficerSession(fields);
}

/** A district director scoped to Wassa Amenfi West — the ordinary officer in the fixtures. */
export const districtOfficer: OfficerSession = officerFixture({
  officerId: OFFICER.districtId,
  officerRole: OFFICER.role,
  jurisdictionId: JUR.district,
  level: "DISTRICT",
});

export const nationalOfficer: OfficerSession = officerFixture({
  officerId: OFFICER.nationalId,
  officerRole: OFFICER.nationalRole,
  jurisdictionId: null,
  level: "NATIONAL",
});

/**
 * THE FIXTURE STEP-UP MINT (Dex B1).
 *
 * `StepUpAssertion` is branded, so `{ fresh: true }` no longer typechecks anywhere — including in
 * the suite. This is the sanctioned test mint, and `tests/auth-boundaries.test.ts` asserts that this
 * file is its ONLY importer: `resolveStepUpAssertion()` is the production constructor, and it needs
 * a live Supabase session that the suite does not have.
 *
 * A STALE assertion is the interesting fixture, and the only way to make it: it is what proves a
 * refused step-up writes no audit row and fetches nothing (tests/gate-step-up.test.ts). Production
 * never constructs one — the server action returns the interstitial instead — so this is also the
 * only place that can keep the choke point's own `fresh` check from going untested.
 */
export function stepUpFixture(fresh: boolean): StepUpAssertion {
  return sealStepUpAssertion({ fresh });
}

/**
 * ══ THE STORED-`ptr` SOURCE GUARD, IN ONE PLACE ══════════════════════════════════════════════════
 *
 * The house rule (STAFFING-PTR-DOMAIN-RULING §2, restated in lib/oversight/ptr.ts and
 * lib/oversight/breakdown.ts): a tier roll-up is Σenrolment ÷ Σteachers, and the stored per-school
 * `fact_staffing.ptr` column is NEVER selected. Four guard sites across four test files had each
 * grown their own regex for it — `/\b(fs|st|fact_staffing)\.ptr\b/`, `/\b(fs|fact_staffing)\.ptr\b/`,
 * `/\bfs\.ptr\b/`: three different answers to one question, and every one of them an ALIAS
 * ALLOW-LIST, so `select s.ptr` after a re-alias walked straight through all of them.
 *
 * The naive fix — `/\w+\.ptr\b/` over the whole module — false-positives immediately: `r.ptr` in
 * lib/oversight/comparison.ts and the `ptr` FIELD on the breakdown row are legitimate TypeScript
 * property access on an ALREADY RE-DERIVED ratio, not a column selection. So the guard splits in
 * two: first narrow the text to what is actually SQL, then be alias-blind within it.
 */

/**
 * The EXECUTABLE text inside every `` sql`…` `` tagged template in `source`, concatenated. This is
 * the module's SQL and nothing else: TS expressions and field names outside a query are excluded by
 * construction rather than by a stripping heuristic.
 *
 * NESTED TEMPLATES ARE PART OF THE SQL (Dex D1). A conditional fragment —
 * `` ${periodId ? sql`and fi.period_id = ${periodId}::uuid` : sql``} `` (the live case,
 * lib/oversight/infrastructure.ts) — is a query the module really runs, so its body is collected too.
 * This is why the extraction is a forward SCAN and not a non-greedy regex: `` /sql`([\s\S]*?)`/ ``
 * ended the OUTER chunk at the inner template's opening backtick and then re-synchronised on the
 * wrong backticks, leaving everything after the first nested fragment INVISIBLE to the guard (it saw
 * 2,566 of infrastructure.ts's 9,472 characters). The scan tracks `${`/`}` depth instead: a backtick
 * at depth 0 closes the chunk; a backtick at depth > 0 opens a nested template whose body is scanned
 * and kept in its own right.
 *
 * `${…}` interpolations themselves are DROPPED (replaced by a space, so they cannot glue two tokens
 * together): a bind is a parameter value, never a column name, so nothing the guard looks for can hide
 * in one.
 *
 * SQL `--` line comments ARE stripped: these queries carry long in-query prose that REASONS about the
 * columns the query refuses to read (breakdown.ts's "never avg(stored ptr)" note is the live case), and
 * stating a prohibition is not committing it. ONLY `--` comments: a C-style block comment inside SQL is
 * NOT stripped here (all four call sites pass source whose TS/block comments are already removed).
 */
export function sqlTextOf(source: string): string {
  const chunks: string[] = [];
  for (let i = 0; i < source.length; i += 1) {
    if (source.startsWith("sql`", i)) i = scanTemplate(source, i + 4, chunks);
  }
  return chunks
    .join("\n")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

/**
 * Scans one template body starting just AFTER its opening backtick; returns the index of the backtick
 * that closed it (or the end of input on an unterminated template). Appends that body — and, via
 * recursion, the body of every template nested inside one of its interpolations — to `chunks`.
 */
function scanTemplate(source: string, start: number, chunks: string[]): number {
  let body = "";
  let depth = 0; // `${` … `}` nesting, counted so a backtick can be told from a closing one
  let i = start;
  while (i < source.length) {
    const c = source[i]!;
    if (c === "\\") {
      if (depth === 0) body += source.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (c === "$" && source[i + 1] === "{") {
      if (depth === 0) body += " "; // a bind is a value; keep the token break it stood for
      depth += 1;
      i += 2;
      continue;
    }
    if (c === "}" && depth > 0) {
      depth -= 1;
      i += 1;
      continue;
    }
    if (c === "`") {
      if (depth === 0) {
        chunks.push(body);
        return i;
      }
      i = scanTemplate(source, i + 1, chunks) + 1;
      continue;
    }
    if (depth === 0) body += c;
    i += 1;
  }
  chunks.push(body);
  return i;
}

/**
 * Does `source`'s SQL select the stored per-school `ptr` rate — under ANY alias, or bare? The two
 * shapes a selection can take are `<anything>.ptr` and a bare `ptr` at the start of a line or after
 * a separator (`select ptr`, `, ptr`, `sum(ptr`). Deliberately ALIAS-BLIND: the point is that
 * re-aliasing `fact_staffing` cannot evade it.
 *
 * WHAT IS BANNED IS THE STORED COLUMN, NOT THE NAME (Dex N1). The ruling bans SELECTING
 * `fact_staffing.ptr`; it expressly blesses RE-DERIVING the ratio, and a re-derived column may be
 * aliased `ptr` (`sum(enrolment_total)::numeric / sum(teachers_on_roll) as ptr`) — that is the Σ÷Σ
 * form the rule demands, so `as ptr` is excluded from the bare arm. The qualified arm is untouched by
 * that exclusion, so the stored column under a new alias (`select fs.ptr as x`) still fires.
 */
export function selectsStoredPtr(source: string): boolean {
  const sqlText = sqlTextOf(source);
  // A derived ratio's own alias is not a selection of the stored column — dropped before the bare arm
  // runs, and only from the bare arm's copy.
  const bare = sqlText.replace(/\bas\s+ptr\b/gi, " ");
  return /\b\w+\.ptr\b/.test(sqlText) || /(^|[\s,(])ptr\b/m.test(bare);
}

/** Unique per test, so `auditRowsFor` isolates one test's rows from an append-only shared table. */
export function caseRef(label: string): string {
  return `CASE-${label}-${Math.random().toString(36).slice(2, 10)}`;
}
