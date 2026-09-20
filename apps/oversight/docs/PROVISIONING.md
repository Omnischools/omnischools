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
