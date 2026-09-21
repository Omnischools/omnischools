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

`db:setup` creates all `dim_*`, `fact_*`, `ref_*`, `etl_run`, `audit_access_log`; enables
jurisdiction RLS and the append-only `audit_access_log` guard; and seeds the config tables
(`dim_stage`, `dim_subject`, `ref_anomaly_rule`).

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
- Supabase auth vars for the **GES-staff** auth (the analytics project's own auth), when built.
- `AUTH_DEV_BYPASS=false` in production.

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

> **⚠ TWO ADDITIONS THE BUILT §6 PATH REQUIRES (added 2026-09, awaiting security sign-off before the
> role is provisioned).** The grant list above predates the implementation and is one table short on
> each side of the record. Both additions are narrow, and neither moves toward compensation:
>
> - **`ref_user`** — the identity spine's `full_name` (and `phone`, which only
>   `SAFEGUARDING_MISCONDUCT` unlocks) is NOT on `staff_profile`. Operational identity is global:
>   `staff_profile` hangs off `ref_user`, which carries the name. Without SELECT here the gate can
>   return a licence number and an appointment date for a person it cannot name, which is both
>   useless to the officer and worse for the subject than the alternative.
> - **`ref_school`** — needed for two things: the school's `name` (the `assigned_school` field), and
>   `ges_code`, which is how the gate PROVES that the operational tenant uuid arriving with the
>   request belongs to the EMIS school the officer actually picked. `ref_school`'s own tenant RLS
>   keys on `id = app.current_school`, so this grant can confirm a claimed school but can never
>   enumerate others.
>
> ```sql
> grant select on ref_user, ref_school to oversight_readback;
> ```
>
> **Still not granted, and not requested:** `staff_compensation`, `ref_district`, `ref_region`,
> `attendance_records`, anything student-side.

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
- Provision the first GES users national → regional → district.

## Deferred in this scaffold

- **The ETL job** (`OVERSIGHT_ANALYTICS_SPEC.md` §7) — explicitly skipped for now.
- **The 13 Oversight surfaces** and **GES-staff auth** — built on `withJurisdiction()` reads next.
