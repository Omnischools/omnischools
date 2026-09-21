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

## 5 · Before launch

- Stand up the ETL cron in `apps/web` (02:00 GMT) writing into this DB (deferred — separate work).
- Run it nightly against a **staging** analytics DB; verify roll-ups equal hand-computed sums and
  coverage equals register-minus-onboarded (`OVERSIGHT_ANALYTICS_SPEC.md` §10.3).
- Provision the first GES users national → regional → district.

## Deferred in this scaffold

- **The ETL job** (`OVERSIGHT_ANALYTICS_SPEC.md` §7) — explicitly skipped for now.
- **The 13 Oversight surfaces** and **GES-staff auth** — built on `withJurisdiction()` reads next.
