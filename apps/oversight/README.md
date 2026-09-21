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
    sql/policies.sql   Jurisdiction RLS + append-only audit guard (§8, §6) — LOCAL DEV only
    sql/prod-paste-*   Hand-pasted RLS for tables added after prod went live (⚠ not automated)
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
internal/continuous performance, staffing (PTR/vacancies), fees (distributional), anomalies,
**teacher attendance**, **school infrastructure** (from the operational facilities snapshot), and
**PLC participation** (teacher CPD). These map directly to the oversight services GES/MoE want —
performance, student/teacher attendance, infrastructure, demographics, PLC.

Three caveats on the newest three. `fact_teacher_attendance` is shape-correct but stays **empty**
until an operational teacher daily-attendance source exists (apps/web records staff PD/PLC
attendance, not a teacher daily register). `fact_plc_participation` has a narrower gate of the same
kind: the operational CPD ledger records PLC points only and carries no category, so the NTC
category columns — Specialised, Recommended, and the National-CPD-Days half of Mandatory — stay
**NULL, never 0**, and with them `teachers_meeting_cpd_threshold`, until an NTC-portal feed exists.
So "% of teachers meeting the 20-point NTC target" is gated, not merely unpopulated; writing 0
would report every school in Ghana as 0% compliant. And **VLC participation is deliberately not
modelled**: VLC is the *student* pastoral programme, whose confidential graph is structurally
barred from analytics — whether GES wants even an aggregate VLC session-coverage fact is an open
question for the human owner.

On `fact_infrastructure`, every presence/categorical attribute is stored as a 0/1 **count**
(`has_library_count`, `water_borehole_count`, …) rather than a boolean or enum, because a boolean
does not roll up: the district answer must be a plain `SUM` reading "N of Y schools". Infrastructure
is a stock, so it sums spatially (across schools) only, never across periods.

## The §6 individual drill-down

The one surface that shows a named person. Its server-side core lives in `lib/oversight/`, and
`lib/oversight/named-record-access.ts` is the **single choke point**: nothing else opens the
operational read-back, and nothing else writes an `audit_access_log` row. In order — classify the
subject against the GES establishment register (analytics, jurisdiction RLS), preflight the school's
ownership against `E3_NON_PUBLIC_STAFF_DRILLDOWN`, read consent live inside the read-back
transaction, **write the audit row**, and only then project the fields the stated reason unlocks.
Denials are written rows too, with `fields_released = []`.

`lib/db/readback.ts` is a second, isolated Postgres client for `OPERATIONAL_READBACK_URL`. It fails
closed when that is unset and never falls back to the analytics DB. Aggregate code may not import it
— enforced by an ESLint `no-restricted-imports` override and by `tests/readback-isolation.test.ts`,
which also checks transitive reachability from every App-Router entry point.

`lib/oversight/suppression.ts` is the small-cell helper for sexed school-grain staff facts
(`fact_teacher_attendance` + `fact_plc_participation`, treated as ONE disclosure surface). **No
sexed-staff-fact aggregate surface is built yet — the first one must route its rows through it.**

## Tests

```bash
pnpm test        # vitest, against REAL Postgres
```

`tests/setup/global-setup.ts` boots a throwaway cluster (`scripts/test-pg.sh`, or point
`OVERSIGHT_TEST_DATABASE_URL` at your own server) and provisions two databases: **analytics** from
this app's own migrations + `db/sql/policies.sql`, connected as a non-owner role so RLS applies; and
**operational** from `tests/fixtures/operational-schema.sql`, connected as a narrow read-back role
with the `docs/PROVISIONING.md` §4a grant list — notably no SELECT on `staff_compensation`. The
consent table does not exist in this repo (it is being built in `apps/web`), so the fixture
implements the contract in `apps/web/Todo.md`.

## Status

Scaffold plus the §6 gated individual-staff drill-down. The schema (23 tables), RLS, config seed,
app shell, the gate's server-side core and its surfaces are in place. Still to build: the ETL job
(`apps/web`, 02:00 GMT — deferred), the remaining aggregate surfaces, and GES-staff auth (until it
exists, `AUTH_DEV_BYPASS=false` means the gate refuses — there is nobody to log an access against).
See `docs/PROVISIONING.md` and `md files/OVERSIGHT_ANALYTICS_SPEC.md` for the full plan.
