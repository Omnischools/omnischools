# Provisioning `omnischools-analytics-prod`

The runbook for standing up the Oversight analytics database and pointing `apps/oversight` at it.
Derived from `md files/OVERSIGHT_ANALYTICS_SPEC.md` §10 and `md files/BUILD_STACK.md`
("two databases"). Do this ~3 months before the Oversight launch — not before (BUILD_STACK: don't
carry analytics complexity until you need it).

> **Why this isn't automated from a Claude Code web session:** provisioning touches the Supabase
> account and applies SQL to a live project. Run these steps yourself (or from an interactive
> `claude` session with the Supabase connector authorized). Everything the app needs — schema, RLS,
> config seed — is already code in this app, so applying it is `pnpm db:setup`, not a design job.

## 1 · Create the second Supabase project

1. New Supabase project **`omnischools-analytics-prod`**, region **EU (London / eu-west-2)** — the
   same region as `omnischools-prod` so the nightly ETL hop is intra-region.
2. **Settings → Database → Connection string:**
   - **Direct** (port 5432) → use for `db:migrate` / `db:policies` / `db:seed` below.
   - **Transaction pooler** (port 6543, `?pgbouncer=true`) → the app runtime `ANALYTICS_DATABASE_URL`.
3. Create a dedicated **read-scoped, non-owner** role for the app runtime. RLS only applies to
   non-owner roles, and the ETL loader is meant to bypass RLS to write — so:
   - the app connects as this read role (subject to every policy in `db/sql/policies.sql`);
   - the ETL loader connects as the owner / a `BYPASSRLS` role (writes freely).

   **Grant the app role exactly `SELECT` everywhere, plus `INSERT` on `audit_access_log` and
   `UPDATE` on `fact_anomaly` (triage) — and nothing else.** Do not hand it `UPDATE`/`DELETE` on
   `audit_access_log` "for symmetry". The append-only trigger only fires for a role that can *see*
   the row, so an over-granted app role hits RLS first and gets a silent `UPDATE 0` instead of an
   error: the row survives, but a tamper attempt reports success. With the grant withheld the same
   statement fails loudly with `permission denied for table audit_access_log`. Verified on a replay
   DB; see the note above the trigger in `db/sql/policies.sql`.

   > **This list is now an artifact, not an instruction:
   > `db/sql/prod-paste-0006-analytics-app-role.sql`** (§2a) creates the role and installs the posture
   > idempotently, transcribed from `tests/setup/global-setup.ts`. Two differences from the paragraph
   > above, both deliberate: **`UPDATE` on `fact_anomaly` is NOT granted yet** — anomaly triage is
   > increment J, and nothing writes that column, so the app credential stays read-only-plus-one-audit-
   > `INSERT` for as long as that is true (when J lands, add the grant to 0006 §3 *and* to
   > `global-setup.ts` in the same change) — and the role must be **non-owner, non-superuser and
   > non-`BYPASSRLS`**, all three, which 0006 asserts on every re-run.

## 2 · Apply the schema, policies and config seed

From `apps/oversight`, with `ANALYTICS_DATABASE_URL` pointed at the **Direct** connection string:

```bash
pnpm install
pnpm db:generate     # first time only — emit db/migrations/* from db/schema (commit the output)
pnpm db:setup        # drizzle-kit migrate  +  apply-policies (RLS)  +  seed config
```

`db:setup` creates all `dim_*`, `fact_*`, `ref_*`, `etl_run`, `audit_access_log`, and the officer-auth
pair (`ref_oversight_officer`, `audit_officer_provisioning`); enables jurisdiction RLS, the
append-only `audit_access_log` guard, and the officer-directory posture (§4b); and seeds the config
tables (`dim_stage`, `dim_subject`, `ref_anomaly_rule`).

Note that `db:setup` is for a **fresh** database. On a live prod project every migration *and* every
`prod-paste-*.sql` is applied by hand, in order — see §2a.

### 2a · After prod is live: the RLS hand-paste step (⚠ not automated)

Once `omnischools-analytics-prod` exists, adding a jurisdiction-scoped table is **three** steps, not
one. `db:policies` is a **local-dev** runner — it is not part of any prod deploy — so every table
added after go-live needs its RLS pasted by hand:

1. Apply the migration to prod (`pnpm db:migrate` against the **Direct** connection string).
2. Paste the matching `db/sql/prod-paste-XXXX-*.sql` into the Supabase SQL editor on the prod
   project, **after** the migration, and run the verification query at the foot of that file.
3. **Re-paste `db/sql/prod-paste-0006-analytics-app-role.sql`** if the migration created a **table,
   a sequence or a routine**.

> **Step 1 is manual too.** There is no deploy hook that runs `db:migrate` against the analytics
> project — *every* migration in `db/migrations/` reaches prod because a human ran it (or pasted its
> `.sql`). Step 2 exists only when a migration adds a table or changes a policy. A migration that
> only adds **columns to an existing table** needs step 1 and **no paste**: a policy declared without
> a column list already covers every column of the table, present and future.

> **Step 3 is the one that is easy to forget, because 0006 is not "the paste for this migration".**
> It is the only file in `db/sql/` that is not once-and-done: its grants and revokes are issued
> `… ON ALL TABLES IN SCHEMA public` (and `ALL SEQUENCES`, `ALL ROUTINES`), which is a point-in-time
> operation over the objects that exist at the moment it runs. An object created afterwards is
> covered by **neither** half:
>
> - it does not get the app role's `SELECT`, so every panel reading it raises
>   `permission denied for table …` — loud, an outage, the good direction; and
> - it does not get the **sweep**, so Supabase's auto-grant of `ALL` (DELETE and TRUNCATE included)
>   to `anon`/`authenticated`/`service_role` stands on it — silent, and the reason 0005's G5 check
>   existed. 0006 §4c neutralises the DEFAULT PRIVILEGES that cause this, so on a project where §4c
>   succeeded the second half is already closed; where §4c could only *advise* (a default privilege
>   whose grantor is `supabase_admin`, which `postgres` cannot alter — see V5 and §6), it is not.
>
> Same carve-out as step 2: a migration that only adds **columns to an existing table** needs
> neither step 2 nor step 3. 0006 is fully idempotent, so re-pasting it when you did not have to
> costs nothing but the time to read the report.

> **Read a paste's RESULT SET, not its NOTICEs.** The Supabase SQL editor renders result sets and
> errors; it does **not** reliably render `RAISE NOTICE` / `RAISE WARNING`. So the last statement of
> `prod-paste-0006` is a plain `SELECT` — its §6 *residual report* — and **that result set is the
> authoritative output of the paste: zero rows means clean, and any row is a finding whose closing
> statement is in the last column.** Every soft finding in that file is emitted twice: once as a
> `RAISE` (which is what `psql` and the test harness see) and once as a §6 row (which is what the
> person pasting sees). Follow the same convention in any new `prod-paste-XXXX`, and put the `SELECT`
> last so nothing hides it — a control whose only output is an invisible `WARNING` is not a control.

Each paste file is idempotent and **fails closed**: skipping it leaves the new table with RLS
enabled and no policy, so the non-owner app role reads **zero rows** (an empty panel) — it never
leaks one jurisdiction's schools to another. An empty panel on a freshly shipped table is the
signature of a missed paste.

> **That fail-closed property comes from the migration, not from the paste.** A new
> jurisdiction-scoped table MUST carry `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` in its own
> migration. drizzle-kit cannot express RLS in the Drizzle schema, so append it by hand at the foot
> of the generated `.sql` (and re-append after any regeneration). Without it the table is created
> with RLS **off** and is fully readable by any `SELECT`-granted non-owner role — including Supabase
> `anon`/`authenticated` on `public` — for the whole window between `db:migrate` and the paste. Use
> `ENABLE`, never `FORCE`: the ETL loader connects as the owner and must keep writing.

Current files:

- `db/sql/prod-paste-0001-fact-domains.sql` — `fact_teacher_attendance`, `fact_infrastructure`,
  `fact_plc_participation` (migration `0001_opposite_mimic`).
- *(migration `0002_unusual_deathstrike` — the §6 drill-down columns on `audit_access_log`
  (`legal_basis`, `consent_ref`, `outcome`, `staff_category`) plus the `record_type` value `STAFF` —
  has **no paste**: additive columns on a table whose RLS is already enabled and policied. Apply the
  migration (step 1) and stop. **Precondition:** it adds two `NOT NULL` columns with no default, so
  run `select count(*) from audit_access_log;` first and expect `0`; see the header comment in that
  migration for why backfilling a lawful basis is the wrong fix if it is not.)*
- `db/sql/prod-paste-0002-rls-security-fix.sql` — **replaces the five shared RLS helper functions**
  (`ov_in_subtree`, `ov_current_jurisdiction`, `ov_current_officer`, `ov_is_national`,
  `ov_audit_append_only`). No migration; no table or policy is touched.

> **⚠ 0002 SUPERSEDES the helper definitions installed by the first application of
> `db/sql/policies.sql`, and MUST be applied to `omnischools-analytics-prod`.** It is the one paste
> in this list that does *not* fail closed into an empty panel — it fixes two coupled defects in the
> helpers themselves:
>
> 1. **Recursion.** `ov_in_subtree()` was not `security definer`, so for a **non-owner** role its
>    walk over `dim_jurisdiction` re-entered that table's own `jurisdiction_scope` policy →
>    `ERROR: stack depth limit exceeded`. Since the app runtime *is* a non-owner role (§1), every
>    tier below `NATIONAL` fails to read **any** jurisdiction-scoped table once the spine has rows.
>    It is an outage, not a leak — the boundary held — but it is total.
> 2. **`pg_temp` hijack.** The helpers pinned `search_path = public`; Postgres resolves relation
>    names against the temp schema *first* unless `pg_temp` is listed, so a planted
>    `create temp table dim_jurisdiction` could shadow the real spine. Harmless-ish alone; with
>    fix 1 applied it would be read with **owner** privileges — full RLS bypass. Now pinned
>    `search_path = public, pg_temp` (**pg_temp last**) on all five. **Never apply one fix without
>    the other.**
>
> **Apply it BEFORE the first ETL load** into the analytics project. Defect 1 is dormant while
> `dim_jurisdiction` is empty and becomes a hard read failure the moment the spine is populated. If
> rows are already loaded, apply it now. It is idempotent (`create or replace` only) and touches no
> data. After pasting, run verification blocks A, B and C at the foot of the file — **as the
> non-owner app role**, not as the owner, which is exempt from RLS and would show a false pass.
>
> Note that `create or replace` preserves the existing function owner, and `ov_in_subtree` now runs
> *as* that owner. Verification block A prints it: confirm it is the intended privileged schema
> owner before considering the paste done.

- `db/sql/prod-paste-0003-audit-insert-subtree.sql` — **replaces the `audit_insert` policy on
  `audit_access_log`** so its `WITH CHECK` is
  `officer_id = ov_current_officer() and ov_in_subtree(jurisdiction_id)`. No migration; no table,
  column or function is touched.

> **Apply 0003 AFTER 0002** — it calls `ov_in_subtree`, and the pre-check block at the head of the
> file confirms that function exists and is `SECURITY DEFINER` before you paste.
>
> **What it closes.** The original predicate enforced only "you cannot write a row in another
> officer's name". It said nothing about *which school* the row was about, so a district director
> could log — and therefore, since the gate writes the audit row **before** it fetches (§6 step 2),
> **perform** — a named-record access against a school in another region. The application now
> refuses this itself (`lib/oversight/named-record-access.ts` resolves the target school under the
> officer's own RLS and throws `OUT_OF_JURISDICTION`); this paste is the independent database
> backstop behind that check, and it is the one that holds when a future caller forgets to make it.
>
> **It does not block in-subtree denials.** A no-consent / stale-establishment / flag-off refusal
> carries the *target school's* `jurisdiction_id`, which is inside the officer's subtree, so those
> rows still insert. That is required: denials are the rows that evidence the gate holding. The
> file's verification block checks exactly this, and the dev/test harness boots from
> `db/sql/policies.sql`, which carries the same predicate.

- `db/sql/prod-paste-0005-officer-directory.sql` — **officer auth** (increment G): the RLS posture,
  the five functions and the GRANT/REVOKE posture for `ref_oversight_officer` and
  `audit_officer_provisioning`. Pairs with migration **`0004_white_eternity`** (purely additive: one
  new enum type `ov_officer_role`, two new tables, two FKs, three indexes, and a hand-appended
  `ENABLE ROW LEVEL SECURITY` on both tables).

> **Apply 0004 then 0005, in that order, and do not stop after the migration.** 0005 needs the two
> role names edited at the marked block before it will run (the app role behind
> `ANALYTICS_DATABASE_URL`, and a **separate** `oversight_provisioner` role — create it first if it
> does not exist). The block raises rather than installing half a posture.
>
> **This paste does NOT fail closed into an empty panel — it fails closed into "nobody can sign
> in".** The migration creates both tables RLS-enabled with no policy, so nothing leaks in the
> window; but the officer directory's *only* read path is `ov_resolve_officer(uuid)`, which 0005
> creates. Skip it and every sign-in raises `function ov_resolve_officer(uuid) does not exist`. That
> is a total, immediately visible outage, which is the right direction of failure — and it is a
> different signature from the empty panel described above, so recognise it for what it is.
>
> **⚠ If sign-in is broken, do NOT "fix" it with `create policy … using (true)` on
> `ref_oversight_officer`.** That one statement turns the app credential into a GES-officer roster
> enumeration primitive — name, work email, tier and node for every oversight officer in Ghana —
> behind whatever leaks a connection string. 0005 re-drops any such policy every time it is run.
>
> **What the design rests on, so a future change does not quietly remove it:**
>
> 1. **The bootstrap read is a `SECURITY DEFINER` function, not a policy.** Resolving the officer is
>    the one read that runs with **no** `app.current_jurisdiction` set — it is the read that produces
>    it. A policy-based alternative (`app.current_auth_user` GUC + `using (auth_user_id = …)`) was
>    rejected because it cannot derive the officer's **tier**: tier comes from a join to
>    `dim_jurisdiction`, which is itself scoped by `ov_in_subtree()`, which needs the GUC that does
>    not exist yet. The only escapes would be storing `level` on the directory (a second writable
>    source of truth for how much of Ghana someone can read) or widening the spine's own policy. A
>    definer body is RLS-exempt and does both jobs in one statement no caller can decompose. It
>    pins `search_path = public, pg_temp` with **pg_temp last**, for the CVE-2018-1058 reason in
>    `db/sql/policies.sql`'s header — here it is sharper still: a planted temp
>    `ref_oversight_officer` read with owner privileges would be *authority forgery*.
> 2. **Self-promotion is prevented by an absent GRANT, not by a policy.** The app role holds
>    `SELECT` on the directory and nothing else — no `INSERT`, no `UPDATE`, no `DELETE`, ever. Same
>    argument as `audit_access_log` in §1: a policy can be mis-edited into permitting an update, a
>    privilege that was never issued cannot. Verification block D in the paste proves it raises
>    `permission denied`.
> 3. **The officer's tier is DERIVED, never stored.** There is no `level` column on the directory;
>    the paste's pre-check *refuses to install* if one appears.
> 4. **No school-tier oversight officer.** A trigger (not a `CHECK` — the disqualifying fact lives in
>    `dim_jurisdiction`) refuses a SCHOOL node, and refuses an `officer_role` that contradicts the
>    node's tier. `SCHOOL` remains a perfectly valid `jurisdiction_level` everywhere else.
> 5. **The two-person rule is a CHECK plus a trigger.** `ck_officer_provisioning_two_person` requires
>    an approver (distinct from the actor) for REGION/NATIONAL grants, and
>    `ov_officer_provisioning_tier_guard()` refuses a `target_tier` that disagrees with the node —
>    without which the rule would be dodgeable by recording a national grant as a district one.
> 6. **`audit_officer_provisioning` is append-only and invisible to GES officers.** Its only SELECT
>    policy is `TO` the provisioner role; the app role is explicitly `REVOKE`d. An officer who could
>    read it would hold the roster the directory withholds.

- `db/sql/prod-paste-0006-analytics-app-role.sql` — **the non-owner app role and the Supabase
  built-in role sweep.** No migration; no table, column, policy or function is touched — it issues
  only `GRANT`/`REVOKE`/`ALTER DEFAULT PRIVILEGES` and read-only assertions. Apply it **after**
  0001–0005.

> **⚠ Why it is not optional.** The app was connecting to analytics as `postgres`, the table
> **owner**, which is RLS-exempt — so every policy in `db/sql/policies.sql` and every posture
> installed by 0001–0005 was *inert* in production. 0006 installs the posture for the non-owner
> `oversight_app` role behind `ANALYTICS_DATABASE_URL`, transcribed from `tests/setup/global-setup.ts`
> so that prod runs the posture CI proves (`tests/prod-paste-0006-app-role.test.ts` compares the two,
> table by table, and fails if they drift).
>
> **It also fixes what 0005's G5 caught.** Supabase auto-grants `ALL` — DELETE and TRUNCATE
> included — on every `public` table to the built-in `anon`, `authenticated` and `service_role`,
> which is why G5 failed on first application and was unblocked by hand on two tables. 0006 revokes
> them across every table, sequence and routine in `public`, and neutralises the **DEFAULT
> PRIVILEGES** that would otherwise re-grant them on the next migration's first `create table`. The
> Oversight app reaches analytics only over direct Postgres, never over PostgREST, so those three
> roles need nothing here.
>
> **Re-run it after any migration that adds a table, sequence or routine** — `… ON ALL TABLES IN
> SCHEMA public` is point-in-time, so a new object is covered by neither the grant nor the sweep.
> That is **step 3** of §2a above, and it is the step with no paste of its own to remind you of it.
> It is fully idempotent. It does **not** set a password: the `oversight_app` credential is set out
> of band and never written into a file in this repository.
>
> **Nothing in 0006 is meant to be edited before pasting** — unlike 0005, which has a marked role-name
> block. The app role name is fixed at `oversight_app` throughout the file (thirteen occurrences, seven
> of them SQL literals in §6 that no plpgsql variable can reach), and a partial rename makes §6's report
> return zero rows — a *false* clean. If a site's analytics app role is called something else, rename
> the role to `oversight_app` rather than editing the file.
>
> **Its last statement is a `SELECT`: read the result set.** Zero rows means clean; any row is a
> finding with its remediation statement in the last column. See the note at the foot of §2a.
>
> **On a project where 0005 has not been applied yet, run 0006 FIRST** — the sweep is what makes
> 0005's G5 pass, and 0006's checks for 0005's objects are deliberately `WARNING`s so that ordering
> is possible. Then re-run 0006 so the app role picks up `EXECUTE` on 0005's functions.

- *(migration `0006_dashing_bloodstorm` — two nullable columns on `fact_plc_participation`,
  `plc_earned_points_total` numeric(7,2) and `plc_earned_teacher_count` integer: the observed
  PLC-earned points kept separable from the NTC category split, **and their own denominator** (the
  all-category `cpd_points_teacher_count` is the wrong one — it would spread PLC points over
  teachers who earned none) — has **no paste**, and needs **no 0006 re-run**. Same
  carve-out as `0002_unusual_deathstrike`: `fact_plc_participation` already carries RLS **enabled**
  with the `jurisdiction_scope` policy from `prod-paste-0001`, that policy has **no column list** so
  it covers both new columns from the moment they exist, and `ADD COLUMN` creates no table, sequence
  or routine for 0006's point-in-time grants and sweep to miss. Apply the migration (step 1) and
  stop. **No precondition:** both columns are nullable with no default, so it is a catalogue-only
  change on a table with data.)*

  > **⚠ Apply it immediately BEFORE a PLC ETL run.** Both columns land **NULL on every pre-existing
  > row** and are only filled by the next run, which deletes and re-inserts each computed school's
  > whole period. In the gap, the two CPD figures that read them — "of which PLC-earned" and "N of Y
  > schools met their own PLC target" — render as **ABSENT** on every panel. That is the correct
  > fail-honest behaviour and not a defect (an unmeasured column must not be reported as a figure),
  > but it is a visibly empty pair of statements on a live dashboard, so do not leave the gap open
  > across a reporting day: sequence the migration and the ETL run together.

## 3 · Load the reference data (GES / GSS / WAEC agreements)

These are **external data-agreement** loads, not part of the seed. Load with each source's own
`as_of_date`:

- `ref_emis_school_register` — the EMIS extract (the **Y** in every "X of Y schools" coverage).
- `ref_gss_population` — GSS 2021 Census district age tables, bucketed by `dim_stage` bands.
- `ref_waec_results_extract` — the GES–WAEC school-level extract (if/when supplied).
- `ref_ges_teacher_establishment` — GES payroll/HR authorised posts + staff IDs.

There is **no data-sharing-agreement / consent load**. GES and the MoE are statutory regulators
with mandatory oversight, so every EMIS-registered school is in scope by law. The ETL inclusion set
is simply the registered schools live on Omnischools (`ref_emis_school_register.on_schoolup` /
`dim_jurisdiction.is_reporting`); coverage stays register-based (`on_schoolup ÷ register`).

## 4 · Wire the app

Set on the Vercel `omnischools-oversight` project (see repo root, and `apps/oversight/.env.example`):

- `ANALYTICS_DATABASE_URL` → the pooler connection for the read-scoped role (secret).
- `NEXT_PUBLIC_SITE_URL` → `https://oversight.omnischools.gh`.
- `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` → the **analytics project's own**
  Supabase Auth (the GES-staff pool), not `omnischools-prod`'s. **Required at runtime** whenever
  `AUTH_DEV_BYPASS=false` — see §4b.
- `PROVISIONER_DATABASE_URL`, `OVERSIGHT_ADMIN_UIDS`, `PROVISIONING_APPROVAL_SECRET` → the
  provisioning console (§4b). All three unset = no provisioning, which is the fail-closed default.
- `OVERSIGHT_SESSION_MAX_HOURS` (8), `OVERSIGHT_SESSION_IDLE_MINUTES` (30),
  `OVERSIGHT_STEP_UP_WINDOW_MINUTES` (5) → session policy. Defaults are the recommended values;
  **owner + DPO ratify** (Kofi R5, Lucy R3).
- `AUTH_DEV_BYPASS=false` in production. `lib/auth/index.ts` throws at module load if this is `true`
  with `NODE_ENV=production` — the dev shim issues an unauthenticated **NATIONAL** session.
- ⚠ **`SUPABASE_SERVICE_ROLE_KEY` is NOT set, and must not be.** It is not read anywhere in the
  runtime (`lib/env.ts` has no entry for it; `tests/auth-boundaries.test.ts` fails if any source file
  mentions it). It bypasses RLS and every auth check in the project, i.e. it is a credential that can
  read every named record and mint any officer. The only privileged credential this app holds is the
  narrow provisioner Postgres role below.

### 4b · GES-staff auth: the officer directory (increment G) — **BUILT**

Authentication is **Supabase Auth on the analytics project**; authorisation is the
`ref_oversight_officer` table in the analytics DB. Nothing about who may see what is carried in a
JWT claim, a cookie, or app config — it is a row, and that row's node is the RLS ceiling.

**The identity is ONE uid.** `ref_oversight_officer.officer_id` **is** the Supabase auth uid. The
same value becomes `OfficerSession.officerId`, is written to `app.current_officer` by
`withJurisdiction()` (`lib/db/rls.ts`), and is stored on `audit_access_log.officer_id`. There is
deliberately no second surrogate key: with two candidate ids, some future writer stamps the wrong one
onto an audit row and attribution silently stops working.

**Sign-in resolves in one call:**

```sql
select * from ov_resolve_officer(<auth uid>);
-- → 0 or 1 row: (officer_id, jurisdiction_id, level, officer_role)
```

- **0 rows ⇒ no session.** Fail closed. An authenticated Supabase user with no directory row is not
  an officer; neither is a deactivated one (the function filters `is_active`), and the two are
  deliberately indistinguishable — it is not an account-state oracle. The app therefore shows ONE
  "your access isn't set up yet" screen for both, and **not** a distinct "withdrawn" wording:
  telling them apart would need an app-reachable read that confirms a directory row exists for a
  uid, which is the enumeration surface this design withholds. (Flagged for the owner: Lucy G5 asks
  for the distinct copy. It needs a posture decision, not an app-side guess.)
- **`level` is DERIVED** from the joined `dim_jurisdiction.level` on every call. It is not stored,
  and no code path may set it independently.
- The function returns **no name and no email**. The session's display name comes from the Supabase
  JWT — the officer's own identity, which they already hold. `full_name` / `work_email` exist on the
  table for the provisioner and are reachable only by the owner/provisioner connection.

#### What the runtime now does (the half that was "still to wire")

| Property | Where it lives |
|---|---|
| Verify the session | `supabase.auth.getUser()` + `getClaims()` — **never `getSession()`**, which returns an unverified cookie. Asserted textually by `tests/auth-boundaries.test.ts`. |
| Take ONLY the uid from the token | `lib/auth/index.ts` passes `sub` and nothing else to the resolver. A JWT carrying `level: "NATIONAL"` widens nothing (`tests/officer-session-forgery.test.ts`). |
| Resolve the scope per request | `lib/auth/officer-directory.ts` — the single unscoped read in the app, quarantined in one file. |
| Unforgeable session → GUC | `OfficerSession` carries a resolution brand; `JurisdictionScope` can only be built by `scopeFor(session)`. `withJurisdiction({ level: "NATIONAL" }, …)` does not compile. |
| Route protection | `middleware.ts` (deny-by-default over everything but a pinned pre-auth allow-list) + `app/(oversight)/layout.tsx` (provisioning + tier). A newly added page is protected without its author doing anything. |
| MFA | **Mandatory TOTP, every session, no escape hatch and no self-service recovery** (`lib/auth/mfa.ts`). Recovery is this desk: re-enrol the officer's factor in Supabase Auth. |
| Session limits | Absolute ~8h measured from the earliest `amr` timestamp (never `iat`), idle ~30m. Unmeasurable age fails CLOSED. |
| §6 step-up | A fresh AAL2 assertion before the `audit_access_log` INSERT and before any read-back, with a 5-minute reuse window (`lib/oversight/gate-step-up.ts`). A refused step-up writes NO row and fetches nothing. |

**⚠ OWNER-RATIFY — the primary factor (Lucy R1).** The onboarding mock signs an officer in with a
**phone OTP** ("the phone number on your GES appointment record"); increment G fixed only the SECOND
factor (mandatory TOTP). What is built is **GES work email + password** as the primary factor,
because it needs no SMS provider and because phone-OTP followed by a mandatory TOTP would be two
one-time-code steps in a row. If the owner ratifies phone-OTP primary, exactly one function changes
(`signInWithCredentials` in `lib/auth/mfa.ts`) — the MFA half, the session policy, the resolver and
the step-up are all independent of it.

**Provisioning is a privileged, two-person, logged operation — never a self-service one.**

- Writes go through a **separate `oversight_provisioner` / `ov_provisioner` role**, not the app role.
  The app role has no `INSERT`/`UPDATE`/`DELETE` on the directory at all, which is what makes
  self-promotion impossible (see §2a, point 2 — and `tests/officer-resolver-rls.test.ts`, which
  asserts that `update ref_oversight_officer set officer_role = 'NATIONAL_OVERSIGHT'` fails with
  `permission denied` as the app role).
- That role needs **both** its grants *and* the role-targeted write policies paste 0005 installs.
  RLS gates writes as well as reads: a non-owner `INSERT` into an RLS-enabled table with no
  applicable policy fails with `new row violates row-level security policy`. If provisioning writes
  start failing that way, the paste was not applied — do **not** reach for the owner credential
  instead.
- The write guards work for a non-owner provisioner because `ov_officer_node_tier()` is
  `SECURITY DEFINER`. The provisioner's own *reads* of the spine (the node picker, the officer list)
  do need `app.current_level = 'NATIONAL'`, which `withNationalRead()` in
  `lib/provisioning/officers.ts` sets — a read convenience that **nothing security-critical depends
  on**: every tier used by a guard is derived through the definer function, which ignores GUCs.
- Every provision / role change / deactivation appends a row to `audit_officer_provisioning`
  **in the same transaction as the directory write** (`provisionOfficer()` /
  `deactivateOfficer()`). A directory row with no audit row is unattributable authority; an audit row
  with no directory row is a claim about a grant that never happened. Both are permanent, because the
  log is append-only.
- A **REGION or NATIONAL** grant requires a named `approver_id`, distinct from `actor_id` — enforced
  by a CHECK, with a trigger making the recorded tier unforgeable, and by the console before the
  write.
- **Offboarding is `is_active = false`, never `DELETE`** — on both the directory row and the Supabase
  auth user. Deleting the row would orphan every audit entry attributed to that uid.
- There is **no school-tier officer** (Kofi R1), refused in three places: the picker's SQL, the app
  check in `resolveNodeTier()`, and `ov_officer_node_tier()` in the database.

#### Two ways to provision

**1 · `pnpm db:load-officers <file.json>`** — a GES posting list, loaded over
`PROVISIONER_DATABASE_URL`. The file supplies the auth uid, the node, a reason and (for
region/national) an approver; it **cannot** name a tier, a level or a role — such a field is a hard
rejection, because the tier is derived from the node on every load. One transaction per officer, so
a bad row 12 does not roll back eleven correct, individually-reasoned grants (the error names the row
and how many committed).

**2 · The admin console, `/admin/officers`** — Omnischools-operated, with its **own** role gate:
an `OVERSIGHT_ADMIN_UIDS` allow-list, **and a positive refusal of any GES officer session at any
tier, including national**. Unset list = nobody. Officer list + provision + withdraw + the
append-only provisioning history, in chrome deliberately distinct from the GES app.

**⚠ WHAT IS NOT BUILT, AND WHY (escalation, not a gap to discover later).** Lucy G8.d describes an
**asynchronous** two-person flow: a proposal sits in an "Awaiting approval" queue until a second
administrator opens it. That needs a PERSISTED PROPOSAL, and the schema has nowhere to put one — the
directory's only "not yet effective" state is `is_active = false`, which already means *withdrawn*,
and `audit_officer_provisioning` records completed actions (its `PROVISION` rows are CHECK-constrained
to `active_after = true`). Overloading either would make a pending grant indistinguishable from a
revoked one, or put intentions in a log of facts.

What ships instead is the **synchronous** form of the same rule, and it is a real two-person control:
the approving administrator, signed in under their own identity, chooses **which action** they are
approving and mints a short-lived HMAC approval code bound to that `(action, officer uid, node)`
triple; the proposer submits it; the server verifies the signature, the action, the pair, the expiry
**and that the two administrators differ**, then writes the directory row and the audit row naming
both. **Two distinct, independently-authenticated administrators are required for every
region/national grant and withdrawal.** The gap is the queue: a proposal cannot be left waiting, so
the hand-off is out of band. Closing it needs a `provisioning_proposal` table — a schema decision
for Wells, not something to improvise here.

**The code names its ACTION, and a withdrawal is bound to the officer's ACTUAL node.** Both were
security findings against the first cut of this console, and both are now properties of the code
rather than of the call site:

- `PROVISION` and `DEACTIVATE` are **signed fields**, and each server action verifies against the
  verb it is about to perform. An approval of a grant does not also approve the withdrawal of the
  same officer at the same node, or the reverse. There is **no default action**: a mint form (or a
  caller) that does not name one of the two literals mints nothing, and verification refuses.
- The withdrawal path takes the node and tier from the officer's **own directory row**
  (`resolveOfficerNode()`, through the RLS-exempt `ov_officer_node_tier()`), not from the submitted
  form field. The form's `jurisdictionId` is a claim about state that already exists, so it decides
  neither whether the two-person rule applies nor what the approver's signature is checked against —
  otherwise an approval given "at node M" could cause a withdrawal performed and recorded at node N.
  On the **provision** path the submitted node is still what decides, correctly: there the node *is*
  the grant being created, and `ov_officer_node_tier()` refuses on the write any row whose recorded
  tier disagrees with it.

> **⚠ ACCEPTED RESIDUAL — the 15-minute reuse window.** An approval code is a signed string with a
> TTL (`APPROVAL_CODE_TTL_MS`, 15 minutes) and **no single-use store**, so within its window it can
> be submitted more than once — but only for the *exact same* `(action, officer, node)` and only by a
> proposer who is not the approver. It cannot be moved to another officer, another node, the opposite
> action, or back to the approver themselves. What a replay can therefore do is re-apply one approved
> decision at the same node: a second provision of the same officer at the same node (logged as
> `ROLE_CHANGE` / `REACTIVATE` with the same derived role — no widening of the *node* reach), or a
> second withdrawal of an already-withdrawn officer (`is_active` is already `false`).
>
> **This is NOT limited to repeating the current state — a replay can REVERSE an interleaved action.**
> Concretely: an approver mints a `PROVISION` code for (officer, node M) at 09:58; the officer is
> withdrawn at M at 10:00 under a proper two-person withdrawal; at 10:05 a single admin replays the
> still-valid 09:58 code against the provision path — it verifies (right action, officer, node,
> unexpired, proposer ≠ approver), `on conflict do update` sets `is_active = true`, logged as
> `REACTIVATE`. So **a withdrawal can be undone for up to the TTL by one admin holding a code minted
> before it**, using an approval whose signer never consented to reversing anything. Access is
> restored, not merely repeated. (Severity LOW: both the withdrawal and the reactivation are logged
> with named administrators, so it is auditable rather than silent, and it takes an admin-level
> proposer holding a live code — but the owner is accepting *this*, not only a no-op repeat, and it is
> the strongest argument for a TTL shorter than fifteen minutes in the interim.)
>
> Every submission writes its own `audit_officer_provisioning` row naming both administrators, so a
> replay is visible in the log rather than silent. **Operational note:** with no proposal queue the
> code is a bearer token in whatever channel the two administrators use to pass it — pasted into a
> shared channel, "two distinct administrators" degrades toward "anyone with access to that channel."
> Do not post approval codes in shared channels.
>
> This is accepted rather than fixed because making a code single-use means **storing** it (a
> consumed-codes table, or a row per proposal), which is the same schema decision as the approval
> queue above — `provisioning_proposal` is where both belong, and that is Wells's call. Shortening
> the TTL narrows the window but does not close it. Note the direction of the trade: the code is not
> stored, so it cannot be stolen from storage, and the window is short enough that it expires inside
> one hand-off.

**Two-person on WITHDRAWAL is applied** (Lucy R11, flagged as unconfirmed): withdrawing a
region/national officer takes a second administrator too. The asymmetric alternative would mean the
control protecting the broadest access can be removed by one person acting alone.

**The withdrawal re-validates the approved node under the row lock.** The server resolves the
officer's node (`resolveOfficerNode`), verifies the approval code against it, then hands that node to
`deactivateOfficer` as `expectedJurisdictionId`; inside the `select … for update` transaction the
locked row's `jurisdiction_id` must still match or the withdrawal rolls back with nothing written.
This closes the narrow window (flagged by Dex, severity-ruled by Sarah) in which a concurrent
re-provisioning could move the officer between the pre-lock read the approval was taken against and
the locked write — the lock, not the earlier read, is the single decision point. The check runs
**before** the two-person assertion deliberately: a region→district move inside the window would
otherwise make the withdrawal single-signature and wave through an approval taken for a node the
officer no longer holds. The S1 coupling guard independently forces the audit row to name the node
actually acted on, so attribution held even before this; the re-validation makes the *consent* precise
as well.

## 4a · The read-back role behind `OPERATIONAL_READBACK_URL` (§6 individual drill-down)

`OPERATIONAL_READBACK_URL` is the **only** thread from Oversight back to operational data. It is a
second connection string, pointed at the **operational** project (`omnischools-prod`), used solely
by the gated named-record path — never by any aggregate surface. The analytics DB holds no
individuals by design (§9), so every privacy property of this product reduces to how narrow this one
role is. Provision it as follows; this section is the required posture, not a suggestion.

**Create a dedicated role — do not reuse the app's.** In the operational project:

```sql
create role oversight_readback login password '…' noinherit;
revoke all on schema public from oversight_readback;
grant usage on schema public to oversight_readback;
-- SELECT only, table by table. NO `grant select on all tables` — a future table must be
-- deliberately added, not inherited.
grant select on staff_profile, ref_role, role_assignment,
                facilities_snapshot, school_staff_oversight_consent
  to oversight_readback;
alter role oversight_readback set statement_timeout = '5s';
alter role oversight_readback set idle_in_transaction_session_timeout = '10s';
alter role oversight_readback set default_transaction_read_only = on;
```

**Required properties:**

1. **Read-only.** `SELECT` and nothing else. No `INSERT`/`UPDATE`/`DELETE`, no `TRUNCATE`, no DDL,
   no `CREATE` on any schema, not a member of any role that has them, and `NOINHERIT` so it cannot
   pick privileges up later. Oversight never writes to operational data — not even to the consent
   table, which it only reads (`apps/web/Todo.md`). `default_transaction_read_only` makes that
   structural rather than merely ungranted.
2. **Explicit table allow-list.** Grant per table, and only these:
   - `staff_profile` — the individual record itself;
   - `ref_role` + `role_assignment` — to derive the subject's `staff_category`
     (`GES_TEACHER` | `OTHER_STAFF`), which decides whether the basis is STATUTORY or CONSENT;
   - `facilities_snapshot` — the school-context fields some reason codes unlock;
   - `school_staff_oversight_consent` — the consent check, read **live inside the read-back
     transaction**, never cached.
   Grant nothing else. In particular **`staff_compensation` is deliberately absent**: salary is not
   oversight data, and the only durable way to say so is for the role to be unable to read it.
   Field-scoping by reason code is enforced in the app *on top of* this list; the grant is the floor
   the app cannot argue its way below.
3. **`statement_timeout`.** A few seconds. This connection exists to fetch one record; any query
   that runs long is a scan, not a lookup, and should die rather than quietly export a roster. Pair
   it with `idle_in_transaction_session_timeout` so a wedged read-back cannot hold locks on the
   operational DB that serves live schools.
4. **Fail closed when unset.** If `OPERATIONAL_READBACK_URL` is empty or missing, Oversight must
   **refuse the individual-record surface** — show the aggregate view and an explicit "individual
   drill-down unavailable" state. It must never fall back to `ANALYTICS_DATABASE_URL`, and it must
   never degrade to a partial record. A missing capability presents as a closed door, not as a
   quieter one.
5. **Tenant scope.** The operational DB's own tenant RLS keys on `app.current_school`. The read-back
   sets it to the school being drilled into, so the role reads one school at a time and the
   operational boundary holds even against a bug in Oversight's own scoping.
6. **Rotate + audit separately.** Store as a Vercel secret on the `omnischools-oversight` project
   only. Because every use is preceded by an `audit_access_log` INSERT (§6 step 2), the row count of
   that table and the query count on this role should track each other; a divergence means someone
   used the credential outside the gate.

> **⚠ THREE ADDITIONS THE BUILT §6 PATH REQUIRES (added 2026-09; `ref_school` signed off, the other
> two revised after security review — provision exactly as written below).** The grant list above
> predates the implementation and is one table short on each side of the record.
>
> - **`ref_school`** — *(signed off)* the school's `name` (the `assigned_school` field) and
>   `ges_code`, which is how the gate PROVES that the operational tenant uuid arriving with the
>   request belongs to the EMIS school the officer actually picked. Its own tenant RLS keys on
>   `id = app.current_school`, so the grant can CONFIRM a claimed school and can never enumerate
>   others. That shape — confirm, not enumerate — is the template for the other two.
> - **`ref_user`** — the identity spine's `full_name` (and `phone`, which only
>   `SAFEGUARDING_MISCONDUCT` unlocks) is NOT on `staff_profile`: operational identity is global, and
>   `staff_profile` hangs off `ref_user`. **A table-wide grant here would be a platform-wide PII
>   enumeration primitive** — `ref_user` has no tenant key, so `select full_name, phone from ref_user`
>   as this role would return every user on the platform, behind the one credential whose purpose is
>   to fetch a single record. Two things are therefore required and neither is optional:
>   **(a) column-level grant, excluding `email`** — no reason code releases an email address
>   (`lib/oversight/field-scope.ts` has no entry for it), and the grant is the only place that can
>   make that structural rather than a property of the queries we happen to write today;
>   **(b) a confirm-not-enumerate RLS policy for the role.**
> - **`ref_role`** — the current post label. Same shape, same reasoning: a role catalogue is global,
>   so it gets the same policy keyed through `role_assignment`.
>
> ```sql
> grant select on ref_school to oversight_readback;
> grant select (id, full_name, phone) on ref_user to oversight_readback;  -- NOT email
> grant select on ref_role to oversight_readback;
>
> -- Both tables are already RLS-ENABLED WITH NO POLICY on prod (apps/web prod-paste-0033), i.e.
> -- deny-all. Do NOT simply grant: add the narrow policy the role needs, and nothing wider.
> create policy oversight_readback_confirm on ref_user
>   for select to oversight_readback
>   using (exists (
>     select 1 from staff_profile sp
>     where sp.user_id = ref_user.id
>       and sp.school_id = nullif(current_setting('app.current_school', true), '')::uuid
>   ));
>
> create policy oversight_readback_confirm on ref_role
>   for select to oversight_readback
>   using (exists (
>     select 1 from role_assignment ra
>     where ra.role_id = ref_role.id
>       and ra.school_id = nullif(current_setting('app.current_school', true), '')::uuid
>   ));
> ```
>
> **⚠ GRANTING WITHOUT THE POLICY IS NOT THE SAFE HALF-STEP IT LOOKS LIKE.** Because those tables
> are deny-all today, a bare grant returns **zero rows**, the identity spine's INNER join to
> `ref_user` yields nothing, and the gate — which writes its audit row BEFORE it fetches (§6 step 2)
> — leaves a GRANTED entry followed by an empty projection. The append-only log then permanently
> overstates a disclosure that never happened. Grant and policy land together or not at all.
>
> **VERIFY, as `oversight_readback` (not as the owner — an owner is exempt from RLS):**
>
> ```sql
> -- 1. no GUC ⇒ nothing at all
> select count(*) from ref_user;   -- expect 0
> select count(*) from ref_role;   -- expect 0
>
> -- 2. scoped ⇒ exactly this school's people, never the platform total
> select set_config('app.current_school', '<a school uuid>', false);
> select count(*) from ref_user;   -- expect = that school's staff_profile count
> select count(*) from ref_role;   -- expect = that school's distinct assigned roles
>
> -- 3. email is unreachable at the GRANT, not merely unselected
> select email from ref_user limit 1;   -- expect: ERROR permission denied for column email
> ```
>
> The dev/test harness models all three states (`tests/fixtures/operational-schema.sql` +
> `tests/readback-identity-rls.test.ts`), so a regression fails the suite rather than waiting for a
> prod audit.
>
> **Still not granted, and not requested:** `staff_compensation`, `ref_district`, `ref_region`,
> `attendance_records`, anything student-side.

> **✅ SUPERSEDED (establishment ETL — NTC pivot). The two notes below are HISTORICAL.** The
> statutory basis is no longer bound via `staff_profile.ges_staff_id` (added #372, since DROPPED) —
> it is the teacher's `ntc_licence_number` read off the fetched row and checked for membership
> against `ref_ges_teacher_establishment.establishment_teachers` inside the read-back tx.
> `bindEstablishmentId` is retired; the officer supplies nothing bindable. The `ges_code` cross-check
> is likewise dropped — the operational uuid is register-sourced via
> `ref_emis_school_register.operational_school_id`. (`staff_category` is derived from register
> membership, not role — correcting the stale §4a line above too.)

> **⚠ THIS GAP NOW COSTS REACH, NOT JUST CONVENIENCE (revised after security review).** The GES
> establishment number and the operational staff uuid arrive separately in a gate request, and an
> establishment number is not a secret — so without a column binding them, "this number is on the
> register" says nothing about the row being fetched. Deriving the STATUTORY basis from the number
> alone let any caller who knew one real staff number claim it for anyone, skipping both the consent
> read and the private/mission flag. **The gate therefore routes every direct record fetch to the
> CONSENT branch until `staff_profile.ges_staff_id` exists**, and the verification path is written
> and feature-detected, waiting for the column (`bindEstablishmentId` in
> `lib/oversight/staff-projection.ts`).
>
> The intended consequence, stated plainly: **a GES-establishment teacher is reachable only where the
> school has recorded DPO consent.** That is a real loss of statutory reach and the honest
> fail-closed state — the alternative is a statutory basis anyone can assert. Adding the column is
> what restores it.

> **Open schema gap (escalated, not worked around):** operational `staff_profile` carries **no GES
> establishment staff id** — no column in `apps/web/db/schema/*.ts` holds one. So (a) a staff record
> cannot be looked up directly by GES staff ID, and (b) the staff-list browse cannot show Lucy's
> "GES establishment / Not on register" column, because there is no key to join the analytics
> register on. The built path handles this by requiring the operational `staff_profile.id` with every
> request (the GES id is an additional key used only for classification) and by routing every
> browse-picked subject to the CONSENT branch — the fail-closed direction. Adding `ges_staff_id` to
> `staff_profile` in `apps/web` would restore the direct lookup and the register-status signal.

> **Not covered by this role:** `ref_ges_teacher_establishment` — the GES establishment register
> that the STATUTORY basis is checked against — lives in the **analytics** DB
> (`db/schema/ref.ts`), loaded per §3, and is read over `ANALYTICS_DATABASE_URL` under the normal
> jurisdiction RLS. It is listed here only to be explicitly ruled *out* of the operational grant. If
> an operational mirror of the register is ever introduced, add it to the allow-list then, not now.

## 5 · Before launch

- Stand up the ETL cron in `apps/web` (02:00 GMT) writing into this DB (deferred — separate work).
- Run it nightly against a **staging** analytics DB; verify roll-ups equal hand-computed sums and
  coverage equals register-minus-onboarded (`OVERSIGHT_ANALYTICS_SPEC.md` §10.3).
- Provision the first GES officers national → regional → district, per §4b: a Supabase auth user,
  then a `ref_oversight_officer` row keyed by that uid, then the `audit_officer_provisioning` row —
  with an approver for the national and regional ones. Both writes happen in one transaction, by
  `pnpm db:load-officers` or the `/admin/officers` console; do not hand-write them. The directory is
  **deny-by-default**: an authenticated user with no row has no session, so there is no window in
  which a new officer sees more than intended.
- Set `OVERSIGHT_ADMIN_UIDS` to the Omnischools staff who may use the provisioning console, and
  `PROVISIONING_APPROVAL_SECRET` to a fresh ≥32-character secret. Until both are set the console
  refuses for everybody, which is the correct resting state for a deployment that is not
  provisioning anyone today.
- **Enrol an authenticator for every officer before they are told they have access.** MFA is
  mandatory and has no self-service recovery: an officer who loses their device comes back to this
  desk, which is exactly why the app can afford to be strict (contrast `apps/web`, whose 2FA gate
  fails SAFE to avoid bricking a school with no recovery path).
- Verify, as the APP role on the live analytics DB, that `select * from ref_oversight_officer`
  returns zero rows and `select count(*) from audit_officer_provisioning` is `permission denied`.
  Both are absences, and absences are what a deploy quietly loses. `pnpm db:rls-test` asserts them
  against a replay database; this is the five-minute version against the real one.

## Deferred in this scaffold

- **The ETL job** (`OVERSIGHT_ANALYTICS_SPEC.md` §7) — explicitly skipped for now.
- **The 13 Oversight surfaces** — built on `withJurisdiction()` reads next.
- **GES-staff auth:** the database half is BUILT (migration `0004_white_eternity` +
  `db/sql/prod-paste-0005-officer-directory.sql`, §4b). Outstanding: `getOfficerSession()` against
  Supabase Auth + `ov_resolve_officer()`, and the provisioning write path.
