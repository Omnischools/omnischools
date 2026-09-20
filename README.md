# Omnischools

Multi-tenant school-management platform for Ghanaian schools. Three product lines, one repo, two
databases (`md files/BUILD_STACK.md`).

## Repository layout

This repo is a multi-app monorepo. Each app is a **self-contained project with its own
`pnpm-lock.yaml`** — installs are per-app (`pnpm -C apps/<app> …`), not a hoisted workspace — so
each deploys independently and CI's `--frozen-lockfile` stays valid.

```
apps/
  web/         Omnischools Basic + Senior — the operational SaaS (schools, teachers, parents).
               Reads operational Postgres (omnischools-prod). Deploys to omnischools.gh.
  oversight/   Omnischools Oversight — GES district/regional/MoE monitoring dashboards.
               Reads the analytics DB (omnischools-analytics-prod). Deploys to oversight.omnischools.gh.
Surfaces/          Design surfaces (HTML) for the product.
md files/          Specs & build docs (BUILD_STACK.md, OVERSIGHT_ANALYTICS_SPEC.md, …).
additional info/   Scaling notes.
images/
```

## The two databases

- **Operational** (`omnischools-prod`) — the system of record, per-tenant, RLS on
  `app.current_school`. Read by `apps/web`.
- **Analytics** (`omnischools-analytics-prod`) — pre-aggregated, one row per school per period,
  jurisdiction RLS. Read by `apps/oversight`, populated nightly by an ETL from operational.
  Provisioned when Oversight is ~3 months from launch (see `apps/oversight/docs/PROVISIONING.md`).

## Working in an app

```bash
cd apps/web        # or apps/oversight
pnpm install
pnpm dev
```

CI (`.github/workflows/ci.yml`) runs typecheck + tests + build per app, plus a migration-replay
for `apps/web`. On Vercel, each app is a separate project whose **Root Directory** is its
`apps/<app>` folder.
