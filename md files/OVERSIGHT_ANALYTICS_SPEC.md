# Omnischools Oversight — Analytics Database Schema & ETL Specification

**Decision 3, resolved.** This document was deliberately deferred until all 13 Oversight surfaces were built, so the schema is derived from the data each surface actually shows rather than guessed in advance. It specifies the analytics database — the second Postgres that the `apps/oversight` Next.js app reads from — and the nightly ETL that populates it.

It does **not** restate the operational database design, the two-database rationale, the 02:00 GMT ETL window, or jurisdiction-aware RLS — those are settled earlier in BUILD_STACK under "Two databases" and "What to do in week 0." This is the table-by-table schema and the ETL job.

---

## 1. Principles carried in from the surfaces

Thirteen surfaces imposed five constraints on the data layer. Every table below answers to these.

1. **Aggregate is the default; named records are the gated exception.** Twelve surfaces are aggregate. Only the compliance record view reads an individual. So the analytics DB holds *pre-computed aggregates* as ordinary tables, and reaches a named record only through a separate, audited read path (§6). The schema makes the common case cheap and the rare case controlled.

2. **Coverage is a first-class quantity, not a derived afterthought.** Every dashboard shows "X of Y schools." That means the analytics DB must always know Y (the EMIS register count) independently of X (the schools actually reporting). Coverage is stored, not computed on the fly from whatever happened to sync.

3. **Provenance travels with every figure.** Decision 7: a director presenting upward needs each figure's source and vintage. Every fact table and every reference table carries a `source` and an `as_of_date`. The provenance row and period banner in the UI read these columns.

4. **Stage-for-stage age-matching is structural.** The enrolment-vs-population analysis compares a stage's enrolment only against the population of that stage's official age band. The schema stores enrolment bucketed by stage and population bucketed by the *same* stage bands — so the comparison is a join on `stage`, never an ad-hoc age calculation.

5. **The hierarchy is one nested dimension.** School → district → region → national is the spine of every dashboard and every roll-up. It is a single dimension table (`dim_jurisdiction`) that every fact table references, so a regional figure is genuinely the sum of its districts and a national figure the sum of its regions — never a separately sourced number.

---

## 2. Architecture recap (one paragraph)

Operational Postgres (`omnischools-prod`) is the system of record. A nightly ETL at 02:00 GMT reads it, computes school-scoped aggregates, and writes them into the analytics Postgres (`omnischools-analytics-prod`). The `apps/oversight` app reads **only** the analytics DB. The analytics DB holds three kinds of table: **dimension** tables (the jurisdiction hierarchy, time, the stage/subject vocabularies), **fact** tables (pre-aggregated enrolment, attendance, performance, staffing, fees — one row per school per period), and **reference** tables (data Omnischools does not generate — the EMIS register, GSS population, WAEC extract, teacher establishment). Named-record reads do not touch the analytics DB at all; they are a gated, logged call back to the operational DB (§6).

```
  omnischools-prod (operational)                omnischools-analytics-prod (Oversight)
  ─────────────────────────────              ──────────────────────────────────
  students, attendance, grades,   ──ETL──▶   dim_*  (jurisdiction, time, stage…)
  staff, invoices, …  (per-school)  02:00     fact_* (one row / school / period)
                                              ref_*  (EMIS, GSS, WAEC, establishment)
        ▲                                     audit_access_log
        │                                          ▲
        └──── gated named-record read ─────────────┘
              (compliance view only, logged)
```

---

## 3. Dimension tables

Dimensions are small, slow-changing, and shared by every fact table.

### 3.1 `dim_jurisdiction`

The school→district→region→national spine. One row per node at every level, self-referencing via `parent_id`. A school row, a district row, a region row, and one national row all live here.

| Column | Type | Notes |
|---|---|---|
| `jurisdiction_id` | uuid PK | |
| `level` | enum | `SCHOOL`, `DISTRICT`, `REGION`, `NATIONAL` |
| `parent_id` | uuid FK → self | district for a school, region for a district, national for a region, null for national |
| `name` | text | "Asankrangwa SHS", "Wassa Amenfi West", "Western Region", "Ghana" |
| `ges_code` | text | GES identifier where one exists (e.g. `WR-WAW-014` for the school) |
| `school_type` | enum, nullable | `KG`, `PRIMARY`, `JHS`, `SHS`, `COMBINED` — only on `SCHOOL` rows |
| `ownership_type` | enum, nullable | `PUBLIC`, `PRIVATE`, `MISSION` — only on `SCHOOL` rows |
| `founded_year` | int, nullable | school rows only |
| `is_reporting` | bool | school rows: currently live on Omnischools and feeding the ETL |

Why one table and not four: every fact table can then carry a single `jurisdiction_id` and every roll-up is a recursive query up `parent_id`. The regional dashboard's district table is `WHERE parent_id = :region`; the national spread is one level up again. The RLS predicate (`WHERE jurisdiction_id IN (subtree of the user's node)`) is expressed once against this table.

### 3.2 `dim_period`

Every fact is stamped to a period. Academic time in Ghana is year + term, not calendar months.

| Column | Type | Notes |
|---|---|---|
| `period_id` | uuid PK | |
| `academic_year` | text | "2025/26" |
| `term` | int, nullable | 1, 2, 3 — null for annual or exam-cohort facts |
| `period_type` | enum | `TERM`, `ANNUAL`, `EXAM_COHORT` |
| `starts_on`, `ends_on` | date | |
| `is_current` | bool | drives the "Term 2, 2025/26" period banner |

`EXAM_COHORT` exists because a WASSCE result belongs to a *cohort year*, not a term — it lets the academic-performance surface's exam trend sit on the same period dimension as termly internal results without conflating them.

### 3.3 `dim_stage` — the age-matching key

This is the table that makes Principle 4 structural. It is configuration, exactly as Decision 2 required ("the official age-for-stage mapping held as configuration so it can track curriculum changes").

| Column | Type | Notes |
|---|---|---|
| `stage` | text PK | `KG`, `PRIMARY`, `JHS`, `SHS` |
| `official_age_low` | int | KG 4, Primary 6, JHS 12, SHS 15 |
| `official_age_high` | int | KG 5, Primary 11, JHS 14, SHS 17 |
| `display_order` | int | |

Both `fact_enrolment` and `ref_gss_population` bucket by `stage`. The enrolment-vs-population rate is then `fact_enrolment.headcount / ref_gss_population.population` joined on `stage` — and because the population row was itself built using `official_age_low/high`, the numerator and denominator describe the same children by construction. A curriculum reform that moved JHS to ages 13–15 is a one-row config edit, not a code change.

### 3.4 `dim_subject`

The WASSCE/BECE and internal-performance subject vocabulary — `CORE_MATHS`, `CORE_ENGLISH`, `INT_SCIENCE`, `SOCIAL_STUDIES`, electives by programme. Referenced by `fact_performance_subject`. Small, static, lets the academic-performance subject grid be a clean join.

---

## 4. Fact tables

Facts are the heart of the analytics DB. **Grain rule: one row per `jurisdiction_id` (school level) per `period_id` per breakdown.** District, regional and national figures are *not stored* — they are roll-ups computed at query time by summing school rows up the `dim_jurisdiction` tree. This guarantees a regional number is always exactly its districts' sum (Principle 5).

Each fact table additionally carries, on every row: `source` (enum — see §7), `as_of_date`, and `etl_run_id` (which nightly run wrote it).

### 4.1 `fact_enrolment`

Feeds the enrolment-vs-population surface, the dashboards' enrolment panels, the comparison workspace.

| Column | Type | Notes |
|---|---|---|
| `jurisdiction_id` | uuid FK | school level |
| `period_id` | uuid FK | |
| `stage` | text FK → dim_stage | |
| `class_form` | text, nullable | "Form 2", "P4" — null when the row is a stage total |
| `sex` | enum | `MALE`, `FEMALE`, `ALL` — `ALL` row stored alongside the split for cheap reads |
| `headcount` | int | |
| `source`, `as_of_date`, `etl_run_id` | | provenance |

The unmeasured-gap split on the enrolment surface is **not** a stored column — it is computed in the view layer as `ref_gss_population.population − SUM(fact_enrolment.headcount)`, then apportioned using `ref_emis_school_register` coverage. Storing it would risk it drifting out of sync with the two inputs; deriving it keeps the arithmetic honest every night.

### 4.2 `fact_attendance`

| Column | Type | Notes |
|---|---|---|
| `jurisdiction_id`, `period_id` | uuid FK | |
| `stage`, `class_form` | | |
| `enrolled_days`, `present_days` | int | rate = present/enrolled, computed in view |
| `attendance_rate` | numeric(5,2) | denormalised for fast dashboard reads |
| `source`, `as_of_date`, `etl_run_id` | | |

Rate is stored *and* its inputs are stored — inputs so a roll-up can re-derive a correct weighted rate (you cannot average rates), the stored rate so a single-school card is a no-math read.

### 4.3 `fact_performance_exam` — external, WAEC

BECE and WASSCE. Terminal, authoritative, annual. Grain: one row per school per `EXAM_COHORT` period per exam.

| Column | Type | Notes |
|---|---|---|
| `jurisdiction_id`, `period_id` | uuid FK | period is `EXAM_COHORT` type |
| `exam` | enum | `BECE`, `WASSCE` |
| `sex` | enum | `MALE`/`FEMALE`/`ALL` |
| `candidates` | int | |
| `qualified` | int | graded credit-or-above (A1–C6 / grades 1–6) |
| `qualification_rate` | numeric(5,2) | the headline metric — stored, never "raw pass rate" |
| `source` | enum | `WAEC_EXTRACT` or `SCHOOL_ENTERED` (Decision 7's two paths) |
| `as_of_date`, `etl_run_id` | | |

### 4.4 `fact_performance_subject`

The subject-level cut behind §4.3 — Core Maths at 54%, etc. Same grain plus `subject` (FK → `dim_subject`). Splits out from the exam table because not every consumer needs subject detail and the subject grid is its own panel.

### 4.5 `fact_performance_internal` — internal/continuous

The section-4 addition to the academic-performance surface: termly, annual, and mock results from schools' own gradebooks. **Revised to reflect the five-category SHS score ledger** (`SHS_SCORE_LEDGER_SPEC.md`): SHS rows now carry per-category scores, weights used, and `path_used` discriminator. Basic-school rows continue to use a single subject score as before.

| Column | Type | Notes |
|---|---|---|
| `jurisdiction_id`, `period_id` | uuid FK | period is `TERM` or `ANNUAL` |
| `assessment_type` | enum | `TERMLY`, `ANNUAL`, `MOCK` |
| `school_level` | enum | `BASIC`, `JHS`, `SHS` · controls which score columns are meaningful |
| `stage`, `class_form`, `subject`, `sex` | | the switchable cuts |
| `subject_score_mean` | numeric(5,2) | mean weighted total · school-level average for the cut · works across BASIC, JHS, SHS |
| `assignments_score_mean` | numeric(5,2) | SHS only · NULL for Basic · the per-category breakouts the WASSCE-predictor view consumes |
| `mid_sem_score_mean` | numeric(5,2) | SHS only |
| `end_sem_score_mean` | numeric(5,2) | SHS only |
| `project_score_mean` | numeric(5,2) | SHS only |
| `portfolio_score_mean` | numeric(5,2) | SHS only |
| `weights_config_id` | bigint FK | which `ref_assessment_weights` row produced the weighted total · null for Basic |
| `paths_used` | jsonb | SHS only · `{"A": 12, "B": 4, "C": 3}` showing path distribution for this cut · useful for understanding entry-method coverage |
| `credit_rate` | numeric(5,2) | % at credit-or-above · still computed and stored for backward compatibility with the academic-performance surface's qualification-rate analogue |
| `source` | enum | always `SCHOOL_GRADEBOOK` |
| `gradebook_coverage_flag` | bool | true if this school uses the gradebook at all |
| `score_ledger_coverage_flag` | bool | SHS only · true if this school's teachers complete the five-category ledger · distinguishes schools where the ledger is genuinely lived from schools where teachers enter only a final mark |
| `as_of_date`, `etl_run_id` | | |

`gradebook_coverage_flag` and `score_ledger_coverage_flag` are both what powers the surface's caveats — internal performance has its *own* coverage figures, narrower than platform coverage, and the schema carries them explicitly so the caveats are never lost. Mock rows (`assessment_type = MOCK`) are queried beside the cohort's later `fact_performance_exam` row to produce the predictor view. **The five-category breakouts give the predictor more structure** — a school where mid-sem scores predict end-of-sem scores predict WAEC outcomes well is structurally different from a school where they don't, and the analytics can surface that difference.

### 4.6 `fact_staffing`

| Column | Type | Notes |
|---|---|---|
| `jurisdiction_id`, `period_id` | uuid FK | |
| `teachers_on_roll` | int | from the school's operational staff roster |
| `teaching_posts_established` | int | from `ref_ges_teacher_establishment` |
| `enrolment_total` | int | denormalised copy for the PTR calc |
| `ptr` | numeric(5,2) | enrolment ÷ teachers, stored for fast reads |
| `vacancies` | int | established − on-roll |
| `source`, `as_of_date`, `etl_run_id` | | |

PTR breaches (`PTR-ESC-30`) and vacancy counts in the anomaly queue read straight from this table.

### 4.7 `fact_fees`

| Column | Type | Notes |
|---|---|---|
| `jurisdiction_id`, `period_id` | uuid FK | |
| `fee_category` | enum | `TUITION`, `BOARDING`, `FEEDING`, `EXAM`, `PTA_DUES`, `OTHER` — matches the operational `fee_categories` reference |
| `stage` | | fees vary by level |
| `mean_amount`, `median_amount` | numeric(10,2) | GHS · aggregates only, never a named pupil's balance |
| `source`, `as_of_date`, `etl_run_id` | | |

Only distributional figures (mean, median by category and level) cross into analytics — an individual fee balance is operational data and never enters the Oversight DB.

### 4.8 `fact_anomaly`

The rule-based anomaly engine's output (anomaly queue surface). Written by the ETL after the fact tables are populated, because rules run *on* the night's aggregates.

| Column | Type | Notes |
|---|---|---|
| `anomaly_id` | uuid PK | |
| `jurisdiction_id` | uuid FK | the school (or district, for cross-school rules) |
| `rule_code` | text | `PTR-ESC-30`, `PERF-DROP-15`, `COV-GAP`, `ATT-DROP-3`, `FEE-OUT-1.5x` … |
| `severity` | enum | `HIGH`, `MEDIUM`, `LOW` |
| `status` | enum | `NEW`, `IN_REVIEW`, `ASSIGNED`, `RESOLVED`, `DISMISSED` |
| `cluster_id` | uuid, nullable | groups correlated anomalies (the Samreboi cluster) |
| `detail_json` | jsonb | the figures that tripped the rule, for the readable-logic display |
| `raised_etl_run_id` | uuid | which run first raised it |
| `first_seen`, `last_updated` | timestamptz | |

`status` and `cluster_id` are the one place the analytics DB accepts writes from the app outside the ETL — triage updates a status, the engine sets the cluster. Everything else is ETL-write, app-read.

### 4.9 Anomaly rules — config, not code

Rules live in a small `ref_anomaly_rule` table (`rule_code`, `predicate_json`, `severity`, `enabled`) so a rule is inspectable and tunable without a deploy — which is what lets the anomaly queue show each rule as readable logic (`IF ptr > 30 AND enrolment up AND staffing flat`). The ETL evaluates enabled rules against the night's facts.

---

## 5. Reference tables

These hold data Omnischools does **not** generate. Decision 7 named all four. They are loaded by GES (or via GES data agreements), kept distinct from the school-generated facts, and every one carries `source` and `as_of_date` so the UI can state vintage.

### 5.1 `ref_emis_school_register`

The authoritative list of every recognised school — the **Y** in every "X of Y schools" coverage figure.

| Column | Type | Notes |
|---|---|---|
| `emis_school_id` | text PK | EMIS identifier |
| `name`, `district_id`, `region_id` | | maps onto `dim_jurisdiction` |
| `school_type`, `ownership_type` | enum | |
| `on_schoolup` | bool | does this registered school have a live Omnischools tenant |
| `source` | enum | `EMIS_EXTRACT` |
| `as_of_date` | date | extract vintage |

Coverage = `COUNT(on_schoolup) / COUNT(*)` within a jurisdiction. Because the register is independent of who synced, coverage is honest even when a school's data is missing. The data-sharing-agreement surface's three-stage funnel (registered → signed → live) is this table joined to `ref_ges_data_sharing_agreements`.

### 5.2 `ref_gss_population`

Ghana Statistical Service census population, bucketed by the **same stage bands** as `dim_stage`.

| Column | Type | Notes |
|---|---|---|
| `district_id` | uuid FK → dim_jurisdiction | |
| `stage` | text FK → dim_stage | KG / Primary / JHS / SHS |
| `population` | int | children of that stage's official age band in that district |
| `source` | enum | `GSS_CENSUS` |
| `as_of_date` | date | "2021 Census" — the vintage the surface displays |

Loaded from GSS 2021 Census district age tables. The ETL does not touch it; it is refreshed only when a new census is published. This is the denominator of the signature analysis.

### 5.3 `ref_waec_results_extract`

Official WAEC school-level results, where supplied under a GES–WAEC arrangement (Decision 7: there is no public school-level WAEC dataset). Feeds `fact_performance_exam` rows with `source = WAEC_EXTRACT`. Schools that instead enter their own results produce `SCHOOL_ENTERED` rows through the normal ETL — both paths, one fact table, distinguished by `source`.

### 5.4 `ref_ges_teacher_establishment`

GES payroll/HR establishment data from the EMIS personnel module — authorised teaching posts per school, and the staff IDs that make teacher named-record lookup possible (§6). Supplies `teaching_posts_established` to `fact_staffing`.

### 5.5 `ref_ges_data_sharing_agreements`

Mirrors the operational `ges_data_sharing_agreements` table into analytics so the DSA-management surface can run at the national tier.

| Column | Type | Notes |
|---|---|---|
| `school_id` | uuid FK | |
| `agreement_version` | text | `v2.1`, `v1.4` … |
| `status` | enum | `NONE`, `SIGNED`, `LIVE` — the funnel's three stages |
| `agreed_at` | date | |
| `scope_json` | jsonb | which categories aggregate, which gated — the scope table |
| `signed_by` | text | e.g. the Headmaster |

The ETL's school-inclusion rule reads this: a school's facts are written to analytics only if `status = LIVE`.

---

## 6. The named-record path — deliberately *not* in the analytics DB

The compliance record view is the one surface that shows an individual. It must not be served from the analytics DB, because that DB is, by Principle 1 and the privacy boundary, aggregates only. Putting a named student row into the analytics DB would defeat the architecture.

Instead, a named-record request is a **gated, audited, read-only call back to the operational database**:

1. The officer completes the justification gate (reason, school, record type, case explanation). Nothing is fetched yet.
2. On submit, the Oversight app writes an `audit_access_log` row **first** — accessing officer, reason, jurisdiction, target, timestamp, `roster_browsed` flag.
3. Only then does it issue a scoped, read-only query to operational Postgres for that one record, returning **only the fields the stated reason unlocks** (field-scoping enforced server-side, not in the UI).
4. **Teacher lookup** keys on the staff ID from `ref_ges_teacher_establishment`. **Student lookup** has no GES-side identifier, so it returns a filtered roster (school + form + programme + gender) from operational, and the officer picks — the roster read is itself logged.

```
  audit_access_log
  ────────────────
  access_id, officer_id, officer_role, jurisdiction_id,
  reason_code, case_reference (free text, stored verbatim),
  record_type (STUDENT|TEACHER), target_ref,
  fields_released[], roster_browsed (bool),
  exported (bool), export_format,
  review_status (CLEARED|QUERIED|PENDING),
  review_note, occurred_at
```

`audit_access_log` is **append-only** — enforced by a Postgres rule that rejects `UPDATE`/`DELETE` on existing rows; a review only ever *inserts* a linked review row. It lives in the analytics DB (it is GES-internal audit data, not school operational data) and is the single table behind both the compliance view's own-history panel and the access & audit log surface. An exported named record writes the **same** row with `exported = true` — leaving the platform is the same logged event as viewing on screen.

---

## 7. The ETL job

A cron job in the operational app, 02:00 GMT, same window as the nightly DR snapshot. One run = one `etl_run_id` stamped onto every row it writes.

**Per-run sequence:**

1. **Open run.** Insert an `etl_run` row (`run_id`, `started_at`, `status = RUNNING`).
2. **Refresh dimensions.** Upsert `dim_jurisdiction` from the operational school/district/region tables (new schools, changed `is_reporting`). `dim_period` rolls the term/year. `dim_stage`, `dim_subject`, `ref_anomaly_rule` change only by manual config edit — skipped unless a version bump is flagged.
3. **Determine the inclusion set.** Schools where `ref_ges_data_sharing_agreements.status = LIVE`. Public schools are `LIVE` by default once onboarded (GES is the regulator); private schools require a signed agreement. Schools not `LIVE` are excluded from fact computation but **still counted in `ref_emis_school_register`** — that asymmetry is what makes the coverage figure real.
4. **Compute facts.** For each included school and the current period(s), aggregate operational data into `fact_enrolment`, `fact_attendance`, `fact_performance_*`, `fact_staffing`, `fact_fees`. School grain only — no pre-rolled district/region rows. Stamp `source`, `as_of_date`, `etl_run_id`.
5. **Load reference deltas.** If a new EMIS register, GSS population set, WAEC extract, or establishment file has been supplied, load it into the matching `ref_*` table with its own `as_of_date`. These are event-driven, not nightly.
6. **Run the anomaly engine.** Evaluate enabled `ref_anomaly_rule` predicates against the night's facts. Insert new `fact_anomaly` rows; update `last_updated` on ones that persist; leave `status`/`cluster_id` alone (those are app-owned). Correlate same-school, same-window anomalies into a `cluster_id`.
7. **Close run.** Set `etl_run.status = SUCCESS` (or `FAILED` with error). The Oversight UI's "next sync" / "as of" banner reads the latest `SUCCESS` run.

**Idempotency.** A run for a given period overwrites that period's fact rows (delete-by-`period_id`-then-insert, in a transaction). Re-running a failed night is safe and produces an identical result. Reference tables are upsert-by-natural-key.

**Failure handling.** A failed run leaves the previous night's data in place — Oversight shows slightly stale data with an honest "as of" date rather than nothing or partial garbage. Fact computation per school is independent, so one school's bad data fails that school, not the run.

**Start simple.** First implementation: `pg_dump` the selected aggregates and `\COPY` across, exactly as BUILD_STACK's week-0 note says. Migrate to a managed warehouse (ClickHouse / BigQuery) only if scale demands — the schema above is warehouse-agnostic.

---

## 8. Jurisdiction RLS on the analytics DB

One predicate, expressed against `dim_jurisdiction`. A GES user's session sets `app.current_jurisdiction` and `app.current_level`. Every fact/dimension read is filtered to the subtree rooted at the user's node:

- **District director** → rows whose `jurisdiction_id` is the district or any school under it.
- **Regional director** → the region, its districts, their schools.
- **National (MoE)** → no filter.

Because the hierarchy is one self-referencing table, "the subtree" is a single recursive CTE, and the same predicate covers every fact table by joining through `jurisdiction_id`. The comparison workspace's tier ceiling (a district director cannot select Regions) is the same rule applied to the picker. `audit_access_log` has its own policy — an officer sees their own rows; regional/national/audit roles see their subtree.

---

## 9. What this schema deliberately does not do

- **No stored roll-ups.** District/region/national figures are always `SUM`/weighted-mean over school rows up the tree. A stored roll-up could drift from its parts; computing it cannot. The cost is query-time aggregation, which is exactly what a separate analytics DB exists to absorb.
- **No raw student records.** The analytics DB never holds an individual. The one surface that needs one reaches operational data through the §6 gated path. This is the privacy promise made truthful at the schema level — a private-school subscriber can be told GES's analytics DB *structurally cannot* hold their pupils' records.
- **No merged coverage gap.** The unmeasured gap is computed in the view layer from `ref_gss_population` minus `fact_enrolment`, split by `ref_emis_school_register` coverage — never stored as one number, because the enrolment surface's whole honesty rule is that the gap stays decomposed.
- **No silent provenance.** There is no fact or reference row without `source` and `as_of_date`. A figure that cannot state where it came from cannot appear in Oversight.

---

## 10. Build order

Consistent with BUILD_STACK's "provision the analytics DB ~3 months before Oversight launch":

1. **Now, in the operational migration:** the Oversight-readiness columns already noted — `district_id`, `region_id`, `ownership_type` on schools, and the `ges_data_sharing_agreements` table. Designing the operational data shape so aggregation is later a script, not a redesign.
2. **~3 months pre-launch:** provision `omnischools-analytics-prod`; create `dim_*`, `fact_*`, `ref_*`, `audit_access_log`, `etl_run`; seed `dim_stage`, `dim_subject`, `ref_anomaly_rule` from config; load the first `ref_emis_school_register`, `ref_gss_population`.
3. **Pre-launch:** stand up the ETL cron; run it nightly against a staging analytics DB; verify roll-ups equal hand-computed sums and coverage equals register-minus-onboarded.
4. **Launch:** point `apps/oversight` at the analytics DB; enable jurisdiction RLS; first GES users provisioned national→regional→district per Decision 5.

This closes Decision 3. With it, all six Oversight scoping decisions are resolved and all 13 surfaces have a specified data layer beneath them.
