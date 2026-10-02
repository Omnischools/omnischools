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

Once `omnischools-analytics-prod` exists, adding a jurisdiction-scoped table is **two** steps, not
one. `db:policies` is a **local-dev** runner — it is not part of any prod deploy — so every table
added after go-live needs its RLS pasted by hand:

1. Apply the migration to prod (`pnpm db:migrate` against the **Direct** connection string).
2. Paste the matching `db/sql/prod-paste-XXXX-*.sql` into the Supabase SQL editor on the prod
   project, **after** the migration, and run the verification query at the foot of that file.

> **Step 1 is manual too.** There is no deploy hook that runs `db:migrate` against the analytics
> project — *every* migration in `db/migrations/` reaches prod because a human ran it (or pasted its
> `.sql`). Step 2 exists only when a migration adds a table or changes a policy. A migration that
> only adds **columns to an existing table** needs step 1 and **no paste**: a policy declared without
> a column list already covers every column of the table, present and future.

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
- Supabase auth vars for the **GES-staff** auth — the analytics project's **own** Supabase Auth, not
  `omnischools-prod`'s. See §4b: the database half is built (migration 0004 + paste 0005); the
  runtime half (`getOfficerSession()`) is in progress.
- `AUTH_DEV_BYPASS=false` in production. `lib/auth/index.ts` throws at module load if this is `true`
  with `NODE_ENV=production` — the dev shim issues an unauthenticated **NATIONAL** session.

### 4b · GES-staff auth: the officer directory (increment G)

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
  deliberately indistinguishable — it is not an account-state oracle.
- **`level` is DERIVED** from the joined `dim_jurisdiction.level` on every call. It is not stored,
  and no code path may set it independently.
- The function returns **no name and no email**. The session's display name comes from the Supabase
  JWT — the officer's own identity, which they already hold. `full_name` / `work_email` exist on the
  table for the provisioner (reconciling against a GES HR list, answering "who is this uid" in an
  audit) and are reachable only by the owner/provisioner connection.

**Provisioning is a privileged, two-person, logged operation — never a self-service one.**

- Writes go through a **separate `oversight_provisioner` role**, not the app role. The app role has
  no `INSERT`/`UPDATE`/`DELETE` on the directory at all, which is what makes self-promotion
  impossible (see §2a, point 2).
- That role needs **both** its grants *and* the role-targeted write policies paste 0005 installs.
  RLS gates writes as well as reads: a non-owner `INSERT` into an RLS-enabled table with no
  applicable policy fails with `new row violates row-level security policy`. If provisioning writes
  start failing that way, the paste was not applied — do **not** reach for the owner credential
  instead. Because every policy on these two tables carries a `TO oversight_provisioner` clause,
  none of them is ever considered for the app role, so they widen nothing.
- The write guards work for a non-owner provisioner because `ov_officer_node_tier()` is
  `SECURITY DEFINER`: a non-owner's lookup of `dim_jurisdiction` would otherwise be filtered by
  jurisdiction RLS (needing a GUC that means nothing during provisioning) and the guard would refuse
  every legitimate write. The provisioner's own *reads* of the spine do need
  `app.current_level = 'NATIONAL'` — a convenience for its UI, which nothing security-critical
  depends on.
- Every provision / role change / deactivation / approval appends a row to
  `audit_officer_provisioning` (append-only; a correction is a new row). A **REGION or NATIONAL**
  grant requires a named `approver_id`, distinct from `actor_id` — enforced by a CHECK, with a
  trigger making the recorded tier unforgeable.
- **Offboarding is `is_active = false`, never `DELETE`** — on both the directory row and the Supabase
  auth user. Deleting the row would orphan every audit entry attributed to that uid.
- There is **no school-tier officer**. A head teacher is an operational user of `apps/web`; one
  credential must not both run a school and oversee it.

**Still to wire (the runtime half — not provisioned by this section):**

- `getOfficerSession()` in `lib/auth/index.ts` currently returns the dev shim or `null`. It needs to
  read the Supabase session, call `ov_resolve_officer(uid)`, and return `null` on zero rows.
  `jurisdictionName` (chrome only) is a separate `dim_jurisdiction` read.
- A provisioning surface (or runbook) for the provisioner role, writing the directory row and the
  `audit_officer_provisioning` row **in one transaction**.
- The ordering of an `APPROVE` row relative to the `PROVISION` it authorises is deliberately not
  constrained by the schema — decide it when the provisioning path is built.

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
  with an approver for the national and regional ones. The directory is **deny-by-default**: an
  authenticated user with no row has no session, so there is no window in which a new officer sees
  more than intended.

## Deferred in this scaffold

- **The ETL job** (`OVERSIGHT_ANALYTICS_SPEC.md` §7) — explicitly skipped for now.
- **The 13 Oversight surfaces** — built on `withJurisdiction()` reads next.
- **GES-staff auth:** the database half is BUILT (migration `0004_white_eternity` +
  `db/sql/prod-paste-0005-officer-directory.sql`, §4b). Outstanding: `getOfficerSession()` against
  Supabase Auth + `ov_resolve_officer()`, and the provisioning write path.
