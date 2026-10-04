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
operational read-back, and nothing else writes an `audit_access_log` row. In order — resolve the
school under the officer's own jurisdiction RLS and refuse it outright if it is outside their
subtree, classify the subject against the GES establishment register, preflight the school's
ownership (from the **register**, never from the caller) against `E3_NON_PUBLIC_STAFF_DRILLDOWN`,
bind any claimed establishment number to the row about to be fetched, read consent live inside the
read-back transaction, **write the audit row**, and only then project the fields the stated reason
unlocks. Denials are written rows too, with `fields_released = []`.

**The STATUTORY basis is a subject bound structurally, not a claimed id.** The basis is the
teacher's `ntc_licence_number` READ off the exact `staff_profile` row being fetched (never typed by
the officer), checked for membership against the authoritative GES establishment register inside the
same read-back transaction. Because the licence comes from the row, statute is structurally bound to
the person projected — there is nothing to forge. A teacher whose NTC is on the school's current,
non-stale register resolves to STATUTORY at every ownership type; anyone else resolves to CONSENT
(fail-closed). A GES-supplied establishment name that disagrees with the operational name demotes to
CONSENT.

The jurisdiction ceiling is enforced **twice, independently**: in the choke point (so it cannot be
skipped by a future caller) and in the database, where `audit_insert`'s `WITH CHECK` requires
`ov_in_subtree(jurisdiction_id)`. Because the gate logs before it fetches, a row the database
refuses is an access that cannot happen. On prod that predicate arrives via
`db/sql/prod-paste-0003-audit-insert-subtree.sql`.

`lib/db/readback.ts` is a second, isolated Postgres client for `OPERATIONAL_READBACK_URL`. It fails
closed when that is unset and never falls back to the analytics DB. Aggregate code may not import it
— enforced by an ESLint `no-restricted-imports` override and by `tests/readback-isolation.test.ts`,
which also checks transitive reachability from every App-Router entry point.

`lib/oversight/suppression.ts` is the small-cell helper for sexed school-grain staff facts
(`fact_teacher_attendance` + `fact_plc_participation`, treated as ONE disclosure surface). **No
sexed-staff-fact aggregate surface is built yet — the first one must route its rows through it.**

## The ETL (increment H, first slice: `fact_infrastructure`)

`lib/etl/` is the nightly operational→analytics aggregation. The slice built so far is
`facilities_snapshot → fact_infrastructure`, end-to-end: `etl_run` lifecycle + provenance stamper
(`run.ts`), the `dim_jurisdiction` / `dim_period` refresh with its unbroken-chain-to-NATIONAL assertion
(`dimensions.ts`), the EMIS register file loader (`register.ts`), the inclusion set and coverage
(`inclusion.ts`), the source reader (`source.ts`), the decomposition and its delete-then-insert write
(`infrastructure.ts`), and the run sequence (`pipeline.ts`).

```bash
# 1 · generate the grounded DEMO dataset (deterministic; 16 real regions, real MMDAs, ~970 schools)
#     → writes db/seed/demo/emis-register-extract.json and the demo_source stand-in tables
ANALYTICS_DATABASE_URL=<owner/writer> pnpm db:seed-demo

# 2 · run the pipeline
ANALYTICS_DATABASE_URL=<owner/writer> pnpm etl:run
#   flags: --extract <file.json>  --source-schema <name>   (default: the demo extract + demo_source)
```

`ANALYTICS_DATABASE_URL` must be the **privileged owner/writer** (the Direct connection, as for
`db:migrate`): the app runtime's role has no INSERT on any fact table.

**Two things are deliberately stood in, and only two.** There is no EMIS extract yet, so the demo
generates one in the real file format. There is no cross-tenant operational read role yet (scope task
H1 — `oversight_readback` is structurally incapable), so the demo reads an operational-SHAPED stand-in
in the `demo_source` schema; `db/seed/demo/demo-source-schema.sql` explains exactly what is stood in.
The transform itself is real — nothing hand-seeds a fact row. Pointing the pipeline at operational
`public.facilities_snapshot` over an `oversight_etl` connection is `--source-schema public` plus that
connection.

Open rulings this slice states an interim answer to, rather than silently deciding: the per-school →
global **period mapping** (Q3 — see `dimensions.ts`) and the **run-failure policy** (Q11 — see
`SchoolFailurePolicy` in `run.ts`, default: ≤1% of schools may fail and the run still closes
SUCCESS-with-gaps).

**The `product_line` gap is deliberate and reported.** Operational `academic_period` has no `term`
column — it has `period_number` plus `product_line` (SENIOR | BASIC | SENIOR_F3), and the line is what
gives the number its meaning (Basic runs 3 terms, Senior 2 semesters). The slice maps **BASIC only**;
SENIOR-line census rows are read and returned as `skippedProductLines`, which the run records in
`etl_run.error_text` and the CLI prints. So an SHS school shows up as a counted, named gap rather than
as a semester filed under a term, and the run exits `⚠ SUCCESS WITH GAPS`. Closing it needs the Q3
ruling.

Three outcomes, three signals, because a scheduler reads the exit code and not the prose:
`✓ SUCCESS` exit 0 · `⚠ SUCCESS WITH GAPS` exit 0 · `✗ FAILED` exit 1 and **nothing written** (the run
computes every period, takes the verdict, then writes once in one transaction).

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
implements the contract in `apps/web/Todo.md`. A **third** analytics database (`demoAnalyticsUrl`,
migrations only) carries the increment-H ETL tests: the demo seed is a whole country, and
`tests/rls-tier-matrix.test.ts` measures global row counts in the shared fixture DB.

## Status

Scaffold plus the §6 gated individual-staff drill-down. The schema (23 tables), RLS, config seed,
app shell, the gate's server-side core and its surfaces are in place. Still to build: the ETL job
(`apps/web`, 02:00 GMT — deferred), the remaining aggregate surfaces, and GES-staff auth (until it
exists, `AUTH_DEV_BYPASS=false` means the gate refuses — there is nobody to log an access against).
See `docs/PROVISIONING.md` and `md files/OVERSIGHT_ANALYTICS_SPEC.md` for the full plan.
