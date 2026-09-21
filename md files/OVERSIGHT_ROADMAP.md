# Omnischools Oversight — Roadmap to Go-Live

Status roadmap for the **Oversight tier** (the GES/MoE analytics + oversight product,
`apps/oversight` + the `omnischools-analytics-prod` database). Structured increment to
increment. Companion to `OVERSIGHT_ANALYTICS_SPEC.md` (the what) — this is the sequencing
(the when/order). Tracked in the GitHub **"Oversight — Go-Live"** project/milestone.

Legend: ✅ done · 🔄 in progress · ⏭️ next · 🔒 blocked/gated

---

## Where we are

The analytics DB is live with the full dimensional / fact / reference **schema** and
jurisdiction RLS, plus the §6 individual-drill-down subsystem. It does **not** yet have
real data (no ETL), officer sign-in (auth fails closed), or the analytics dashboards GES
would use daily. Foundation + one hardened vertical slice are done; the data pipeline,
officer auth, and the read surfaces are the bulk of the remaining work.

---

## ✅ Done (merged + prod-applied)

| Inc | Increment | PR | State |
|-----|-----------|-----|-------|
| A | Analytics DB foundation — dims, 8 original facts, refs, `etl_run`, `audit_access_log`, jurisdiction RLS (migration 0000) | pre-existing | Live |
| B | 3 new fact domains (teacher attendance, infrastructure, PLC) + E1/E2/E4 refinements (3-state attendance, CPD-by-category, sex breakdowns, grain UNIQUEs) | #356 | Merged, prod-applied |
| C | `ov_in_subtree` RLS fix — `SECURITY DEFINER` + `pg_temp`-pinned search_path (fixes the recursion that blocked sub-national reads, closes the pg_temp hijack) | #357 | Merged, prod-paste-0002 applied |
| D | §6 gated individual drill-down subsystem — classification, consent enforcement, field-scoping projection, audit-before-fetch, suppression helper, teacher/staff/infra paths | #358 | Merged, prod-paste-0003 applied |
| E | Next.js 15.5.21 → 15.5.25 (critical CVE fixes) | #359 | Merged |

---

## 🔄 In progress

| Inc | Increment | Owner | Notes |
|-----|-----------|-------|-------|
| F | **apps/web consent capture + `staff_profile.ges_staff_id` + read-back role provisioning** | apps/web session | Unblocks E3's consent branch (today fails closed) and the statutory teacher path. Private/mission stays flag-off pending DPO. |

---

## ⏭️ Next — to Go-Live (dependency-ordered)

### G — GES officer authentication & session→RLS wiring  *(critical path)*
Real GES/MoE officer sign-in; derive `app.current_jurisdiction` / `app.current_level` /
`app.current_officer` GUCs from the authenticated session (never request input); tier role
model (national/region/district/school). Retire `AUTH_DEV_BYPASS` for prod (hard-stop in place).
- **Depends on:** — (can start now)
- **Exit:** a real officer reads only their subtree; the drill-down gate issues real audit identities.

### H — ETL pipeline + reference-data loaders  *(critical path — turns an empty DB into a real one)*
Nightly operational→analytics aggregation for every fact table with provenance
(`source`/`as_of_date`/`etl_run_id`), idempotent (delete-by-period-then-insert),
register-based coverage. Reference loaders: EMIS register (coverage denominator), GSS
population, WAEC extract, GES establishment (also the statutory teacher-lookup key), NTC CPD.
Encode the ETL-layer invariants the schema deliberately does not enforce (3-state
reconciliation; CPD category totals; category NULL-not-0; `teacher_headcount` on both PLC
cuts; small-cell suppression via the shipped helper).
- **Depends on:** F (read-back role, `ges_staff_id`), ref-data sources
- **Exit:** `etl_run` SUCCESS; facts populate; district roll-up = Σ its schools; as-of banner reads real runs.

### I — Core analytics surfaces (the dashboards GES uses)
Enrolment-vs-population, attendance, WASSCE/BECE performance (+ subject cut), internal SHS
score ledger, staffing/PTR, fees distribution, plus the 3 new domains. District/region/
ownership comparison views. Every sexed-staff-fact surface routes through the n=5 suppression helper.
- **Depends on:** G (auth), H (data)
- **Exit:** each surface renders live, roll-up-correct, RLS-scoped figures.

### J — Anomaly engine + triage
Evaluate `ref_anomaly_rule` (config, not code) against each night's facts → `fact_anomaly`;
triage surface (status/cluster_id — the one place analytics accepts app writes).
- **Depends on:** H (facts)
- **Exit:** rules fire, cluster, and triage within the caller's subtree.

### K — §6 completion — audit & review workflow
National access & audit-log surface, the query/review workflow, and the **`audit_access_review`**
linked table (the access row is append-only, so a review inserts a linked row).
- **Depends on:** G (auth), D (drill-down, done)
- **Exit:** every disclosure is reviewable; no access row is mutated.

### L — Data-protection sign-offs & hardening  *(gates real named-record use)*
DPO lawful-basis position for private/mission staff (then lift the flag); confirm
sensitive-field release (emergency_contact / DOB / address / phone) and small-cell
thresholds; retention policy.
- **Depends on:** F, D
- **Exit:** written DPO positions on file; flags set accordingly. 🔒 blocks live named-record use.

### M — Scale, perf & observability
Replace the recursive-CTE jurisdiction walk with a `dim_jurisdiction.path` / closure table
(~0.55s at ~18k nodes today); index pass on the original 8 fact tables; adopt `.enableRLS()`
in the schema; observability/alerting on ETL + read latency.
- **Depends on:** H, I
- **Exit:** dashboards responsive at national scale; ETL monitored.

### N — Pre-launch security & hygiene
Full security review + pen test (this tier holds an operational-DB read-back credential);
port `brace-expansion`/`sharp` `pnpm.overrides` to `apps/web`; retrofit the grain UNIQUE to
the original 8 fact tables; verify all prod-paste/RLS as the non-owner role; primary-source
NTC CPD verification.
- **Depends on:** G–M substantially in place
- **Exit:** clean audit, no criticals.

### O — UAT & staged rollout → 🚀 Go-Live
GES pilot (one region/district), verify coverage honesty + isolation with real officers,
then phased national rollout.
- **Depends on:** all above
- **Exit:** GES + DPO sign-off; go-live.

---

## Dependency graph (remaining)

```
F ──┬─► G ──┐
    └─► H ──┴─► I ──► M ──┐
        H ──► J ──────────┤
        G ──► K ──────────┼─► N ──► O (Go-Live)
   F,D ──► L ─────────────┘
```

- **Longest pole:** F → (G ∥ H) → I → M. No data without H; nothing safely user-facing without G.
- **Compliance gate:** L must land before individual named-record use goes live.
- **Parallelism:** G and H run in parallel once F's read-back role exists; J/K parallel to I.

---

## Standing follow-ups (folded into the increments above)
- `audit_access_review` table → K
- suppression-helper consumer (first sexed-staff-fact surface) → I
- jurisdiction closure/path table (perf) → M
- retrofit grain UNIQUE to the original 8 fact tables → N
- `.enableRLS()` adoption / drizzle-managed RLS → M
- `brace-expansion` / `sharp` overrides for `apps/web` → N
- NTC CPD primary-source verification (6/6 PLC-NCPD split, cadence, renewal cycle) → H/N

---

## Build process
Every increment runs the gated loop in `OMNISCHOOLS_BUILD_TEAM.md`: Pence decomposes →
Kofi (ACs) / Wells (schema+RLS) / Lucy (design) → implementer → **Quinn → Dex → Sarah**
(strict order; Sarah merges only on Quinn GREEN + Dex APPROVE). Prod RLS is applied by hand
via numbered `prod-paste-*.sql`. Merges are verified against `git`, not agent prose.
