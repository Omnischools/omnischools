# INCR-2 · Score Ledger Item 4 (Path B) — Denominator + Reason-code Schema

**Author:** Wells (DB engineer) · **Status:** Designed, generated, applied to dev, RLS-verified.
**Migration:** `0041_little_human_torch.sql` (applied to dev DB `omnischools_dev`).
**Scope:** INCR-2 only — the *data-layer* change Path B needs (per-category scan denominators
+ the correction-reason domain). No image storage, no upload/provenance/version table (Kofi Q1
LOCKED: diff-against-committed; the version chain is Item 7).

> **Migration number note.** The build plan step table says "migration 0040", but `0040`
> (`senior_subject_teacher`, Item 3 VHM view) has already merged to `main`. INCR-2 is therefore
> **`0041`**, not 0040. The number in the plan predates Item 3 consuming 0040.

---

## 0. What this migration is (and is not)

Net DDL: **1 enum + 5 columns + 1 CHECK** on the *existing* tenant table `ref_assessment_weights`.
- **No new table** → no new `tenant_uk`, no new FK, **no new RLS**, no prod-paste RLS policy.
- **No image column / bucket / upload table** — owner ruling: the photo is transient, never persisted.
- **No new ledger column for the reason** — the reason value rides `audit_log.reason` (existing).

---

## 1. Per-category denominators on `ref_assessment_weights` (Kofi Q1b)

Five columns, `smallint NOT NULL DEFAULT 100`, guarded by one combined `CHECK (… > 0)`:

| Column | Meaning |
|---|---|
| `asgn_denominator` | scale for a scanned assignment raw number |
| `mid_sem_denominator` | scale for a scanned mid-sem raw number |
| `end_sem_denominator` | scale for a scanned end-sem raw number |
| `project_denominator` | scale for a scanned project raw number |
| `portfolio_denominator` | scale for a scanned portfolio raw number (Asankrangwa = 10) |

**Why extend `ref_assessment_weights` (not a new table):** the denominator has the *exact same
grain and resolution as the weights* — subject-override row → school-default row (`subject_id NULL`)
→ system constant `100`. Co-locating means the resolver fetches one row, not two, and reuses the
existing FK, the `uniq_school_default_weights` partial index, and the table's RLS unchanged. A
dedicated table would duplicate all of that for zero benefit.

**System default = 100 = identity.** An unconfigured category never inflates a mark (`raw 8` under
`/100` → `8.00`). Only a *smaller* configured denominator scales up (`raw 8` under `/10` → `80.00`).
Never inflated by accident — the fallback is the largest sane denominator.

**CHECK `assessment_denominators_positive`.** One combined constraint (mirrors the single
`assessment_weights_sum_100` style). A `0` denominator is a divide-by-zero silent-corruption path,
so it is blocked at the DB; the lib scaler *also* returns `null` on a non-positive denominator
(defence in depth). Acceptance A5/A7 land on `compute.ts:percent`, which already caps at `MAX_PERCENT`
and guards `maxMark > 0`.

## 2. Reason codes → `pgEnum`, not a `ref_` table (owner: Wells's call)

`ledger_correction_reason` = `RE_GRADED | TRANSCRIPTION_ERROR | OTHER` (LOCKED membership).

**Chosen: a `pgEnum` in `_enums.ts`.** Rationale:
- Matches the codebase's enum-heavy convention (every other closed vocabulary is a `pgEnum`).
- It is the *domain of allowed codes* only — **not a column**. The chosen code persists as the
  free-text `audit_log.reason` (`recordAudit`/`AuditEntry.reason`), per Kofi Q1/Q4. So there is no
  FK integrity to gain from a lookup table — a `ref_` table would add a global table + RLS
  classification + seed and buy nothing (`audit_log.reason` would still be free text).
- One typed source of truth the app validates against, and ready if Item 7's version chain later
  adopts it as a real column.
- drizzle-kit still materializes the Postgres type (a bare `CREATE TYPE`) even though no column
  references it yet — cheap, portable, and keeps dev == prod.

Free text is mandatory on `OTHER`; that is app-layer validation (Sarah/Claude Code), not a DB check.

## 3. RLS & prod

`ref_assessment_weights` already has `ENABLE + FORCE ROW LEVEL SECURITY + tenant_isolation` (0038).
Adding columns changes none of it. **No RLS delta, no leak risk, nothing to hand-paste.**
`db/sql/prod-paste-0041-ledger-denominators.sql` documents this explicitly and carries the idempotent
column/enum/CHECK DDL for hand-verification; prod gets that DDL via the normal drizzle migrate flow.
Deploy note: prod needs **the column ALTER + the enum, NOT new RLS.**

## 4. Seed (Asankrangwa, WR-WAW-014)

`db/seed/asankrangwa.ts` — the school-default `assessmentWeights` insert (scoped to `school.id`)
now sets `portfolioDenominator: 10`; the other four inherit the `100` column default. This is the
seeded *real* config, distinct from the system fallback. Seed is **not idempotent and was not run**
(school data has no `onConflict`); the change is a single field on the existing Asankrangwa row.

## 5. Hand-off to the implementer (`compute.ts:resolveWeights`)

The denominator resolution must **mirror the weights resolution exactly** — same two candidate rows,
same precedence. Recommended extension (pure lib, no DB, no trigger):

- Add a `CategoryDenominators` interface (five numbers) and `SYSTEM_DEFAULT_DENOMINATORS` = all `100`.
- Add `resolveDenominators(subjectRow, schoolDefaultRow)` = `subjectRow ?? schoolDefaultRow ?? SYSTEM_DEFAULT_DENOMINATORS`
  — identical shape to `resolveWeights`. Feed it the *same* two fetched `ref_assessment_weights`
  rows the weight resolver already gets (the denominators are columns on those very rows), so no
  extra query.
- Scale each scanned raw number with the existing `percent(raw, denominator)` — it already returns
  `null` on blank/`≤0` and caps at `MAX_PERCENT`, satisfying A3/A5/A6/A7. `raw 8` under `/10` →
  `percent(8, 10)` → `80.00`.
