# Omnischools Oversight (`apps/oversight`)

The GES **Oversight** product line — observational analytics dashboards for district directors,
regional directors, and the Ministry of Education. It is the third Omnischools product ("three
products, one codebase, two databases" — `md files/BUILD_STACK.md`) and the second Next.js app in
this repo, deployed to `oversight.omnischools.gh`.

## What makes it different from `apps/web`

| | `apps/web` (Basic / Senior) | `apps/oversight` |
|---|---|---|
| Users | School admins, teachers, parents | GES district/regional directors, MoE |
| Database | Operational Postgres (`omnischools-prod`) | **Analytics** Postgres (`omnischools-analytics-prod`) |
| Data | Live, named, per-tenant | Pre-aggregated, one row per school per period |
| Isolation | RLS on `app.current_school` | RLS on `app.current_jurisdiction` / `app.current_level` |
| Auth | School accounts (phone OTP) | GES staff accounts |

Oversight **never** reads operational Postgres directly, except through the gated, audited
named-record path (`OVERSIGHT_ANALYTICS_SPEC.md` §6) — a separate, logged, field-scoped connection
used only by the compliance surface.

## Layout

```
apps/oversight/
  app/                 Next.js App Router (force-dynamic; the build opens no DB)
  db/
    schema/            Drizzle schema for the analytics DB — dim_* / fact_* / ref_* / audit
    sql/policies.sql   Jurisdiction RLS + append-only audit guard (§8, §6)
    seed/config.ts     Seeds dim_stage, dim_subject, ref_anomaly_rule (config tables)
    migrations/        drizzle-kit output (generate before first migrate)
  lib/
    db/index.ts        Analytics DB client (read-only, RLS-scoped role)
    db/rls.ts          withJurisdiction() — sets the request GUCs
    env.ts             Validated env (ANALYTICS_DATABASE_URL, …)
  scripts/apply-policies.ts
  docs/PROVISIONING.md The omnischools-analytics-prod provisioning runbook
```

## Local development

```bash
pnpm install
cp .env.example .env.local          # point ANALYTICS_DATABASE_URL at a local analytics Postgres
pnpm db:generate                    # generate migrations from db/schema (first run)
pnpm db:setup                       # migrate + apply RLS policies + seed config
pnpm dev                            # http://localhost:3100
```

The schema is warehouse-agnostic (`OVERSIGHT_ANALYTICS_SPEC.md` §7) — Supabase Postgres to start,
a managed warehouse later only if scale demands.

## Regulatory model — no consent gate

GES and the MoE are **statutory regulators** with mandatory oversight of curriculum, academic
performance, and school administration. So there is **no per-school data-sharing/consent table**:
every EMIS-registered school is in scope by law. The ETL inclusion set is simply the registered
schools live on Omnischools (`on_schoolup` / `is_reporting`), and coverage stays register-based. The
privacy boundary is architectural (analytics holds aggregates only; named records go through the
gated §6 audit path), not consent-based.

## Fact domains

Modelled now: enrolment/demographics, student attendance, exam performance (WASSCE/BECE),
internal/continuous performance, staffing (PTR/vacancies), fees (distributional), anomalies.

Planned next (each needs its own grain decision before modelling): **teacher attendance**, **school
infrastructure** (from the operational facilities snapshot), and **PLC/VLC** participation. These
map directly to the oversight services GES/MoE want — performance, student/teacher attendance,
infrastructure, demographics, PLC/VLC.

## Status

Scaffold. The schema (20 tables), RLS, config seed, and app shell are in place. Still to build: the
ETL job (`apps/web`, 02:00 GMT — deferred), the surfaces, and GES-staff auth. See
`docs/PROVISIONING.md` and `md files/OVERSIGHT_ANALYTICS_SPEC.md` for the full plan.
