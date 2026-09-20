# F0 + Score Ledger Item 1 — Schema Design

**Author:** Wells (DB engineer) · **Status:** Design proposed, ready for the implementation engineer to wire and migrate.
**Scope:** Increment 1 only — **F0 (Senior foundations)** and **Score Ledger Item 1** (five-category data model + Path A auto-compile). Nothing else in the 11-item ledger sequence is designed here.

This is a design document. It does **not** run migrations or touch app code. It specifies Drizzle table definitions in the repo's exact style, every enum/index/constraint, the RLS classification per table, migration ordering, the Path-A compile rule and where it lives, and open questions for domain review.

---

## 0. Conventions this design inherits (do not deviate)

Verified against `db/schema/gradebook.ts`, `students.ts`, `periods.ts`, `_enums.ts`, `scripts/apply-policies.ts`, and migrations `0000` / `0033`:

- **`score()` helper** — `numeric(name, { precision: 5, scale: 2 })`. Re-declare the same private helper at the top of the new schema file (it is file-local in `gradebook.ts`, not exported). Same precision for marks and computed totals.
- **Composite tenant FKs** — every intra-tenant reference is `(school_id, <id>)` against the parent's `*_tenant_uk` unique, via Drizzle `foreignKey({ columns, foreignColumns })`. Single-column FKs are only for `school_id → ref_school.id` and for global-table refs (`users.id`, `roles.id`). This makes cross-tenant references structurally impossible. See memory `composite-tenant-fks`.
- **`*_tenant_uk`** — any table that is itself a composite-FK *target* must declare `unique("<name>_tenant_uk").on(t.schoolId, t.id)`. Here: `senior_assessment` needs one (its scores reference it); `senior_score_ledger` and `senior_assessment_score` are leaves and do **not** need one.
- **RLS** — tenant tables get `ENABLE` + `FORCE` + the `tenant_isolation` policy (added to the `apply-policies.ts` array). Global tables get bare `ENABLE` only (no FORCE, no policy) so the owner stays exempt and the Data API is denied. See memory `global-tables-rls-no-force` and `prod-rls-manual-paste` (prod needs the policy pasted by hand).
- **Enums** live in `_enums.ts`, `pgEnum`, SCREAMING_SNAKE values.
- **Audit** — every mutation writes an `audit_log` row from `lib/db/audit.ts`; that is an app-layer concern, no schema change here beyond confirming the pattern applies to all four new mutable tables.
- **Portability** — no Supabase-proprietary features; no DB triggers/functions for business logic (the compile rule is a lib function, §5). Standard-SQL CHECK constraints are portable and allowed.

---

## 1. New enums (`db/schema/_enums.ts`)

Add in the existing style. Placement: a new `// Senior (SHS) foundations` block and a `// Score ledger (SHS)` block.

```ts
// Senior (SHS) foundations — F0
export const programmeEnum = pgEnum("programme", [
  "GENERAL_ARTS",
  "GENERAL_SCIENCE",
  "BUSINESS",
  "AGRICULTURE",
  "VISUAL_ARTS",
  "HOME_ECONOMICS",
  "TECHNICAL",
]);

export const residencyEnum = pgEnum("residency", ["BOARDER", "DAY", "DEBOARDINIZED"]);

// Score ledger (SHS) — Item 1
export const assessmentCategoryEnum = pgEnum("assessment_category", [
  "ASSIGNMENT",
  "MID_SEM_EXAM",
  "END_SEM_EXAM",
  "PROJECT",
]);

export const ledgerStatusEnum = pgEnum("ledger_status", [
  "DRAFT",
  "COMPLETE",
  "STPSHS_READY",
]);
```

Notes:
- **`programme`** — the four the seed/spec require first (`GENERAL_ARTS`, `GENERAL_SCIENCE`, `BUSINESS`, `AGRICULTURE`) plus the fuller SHS set (`VISUAL_ARTS`, `HOME_ECONOMICS`, `TECHNICAL`) so we never migrate the enum when Asankrangwa adds a programme. Enum order is not alphabetical on purpose — the four common Asankrangwa programmes lead. **Postgres enum values cannot be reordered or removed without a type rebuild**, only appended; ordering is cosmetic (we never `ORDER BY` the enum), so this is safe. See open question Q6 on the alternative (a `ref_programme` table).
- **`residency`** — matches `student_residency` shape used later in boarding (`BOARDER | DAY | DEBOARDINIZED`) and `ref_school.residency_model` copy. Deliberately reused as the F0 column type so Phase 4 boarding does not introduce a second vocabulary.
- **`assessment_category`** deliberately has **four** values — portfolio has no assessment *event* (spec §2, §4.1), so it is not a category an event can belong to. Portfolio lives only as a column on the ledger. Do not add `PORTFOLIO` here.
- **`ledger_status`** — `STPSHS_READY` is the terminal "all five categories present and signed off for export" state; `COMPLETE` is "computed but not yet released for STPSHS." Kept as three explicit states per spec §11 Item 1.

---

## 2. F0 — Senior foundations

### 2.1 `house` (new table — `db/schema/senior.ts`)

School-scoped, seedable with the 6 Asankrangwa houses (Aggrey, Guggisberg, Fraser, Slessor, Kingsley, Aryee — per `INSTRUCTIONS_FOR_CLAUDE_CODE.md` §1.7). It is a **composite-FK target** (student references it), so it needs a `tenant_uk`.

```ts
export const houses = pgTable(
  "house",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    name: text("name").notNull(), // "Aggrey", "Guggisberg", ...
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqName: unique("uniq_house_per_school").on(t.schoolId, t.name),
    // Composite-FK target for students.house_id (school_id, id).
    tenantUk: unique("house_tenant_uk").on(t.schoolId, t.id),
  }),
);
```

> **Scope note.** `house` is the *only* new physical table F0 needs. Housemaster staffing, dormitories, and bunks are Phase 4.2 boarding tables and are explicitly **out of scope** here. We add `house` now because `student.house_id` needs a target and the seed creates all 6 houses.

### 2.2 `student` — new SHS columns (extend `db/schema/students.ts`)

All three columns **nullable** — null for every Basic student (the students comment already reserves this: *"SHS-specific columns (programme/house/residency) are added in Phase 4"*). This design brings that forward into F0.

```ts
// add to the students table column list:
programme: programmeEnum("programme"),          // nullable — null for Basic
residency: residencyEnum("residency"),          // nullable — null for Basic
houseId: uuid("house_id"),                       // nullable — composite FK below
```

Add to the students table's second-arg config object (alongside the existing `classFk`):

```ts
// Composite school-scoped FK — house must belong to the same tenant.
houseFk: foreignKey({
  columns: [t.schoolId, t.houseId],
  foreignColumns: [houses.schoolId, houses.id],
}).onDelete("set null"),
```

- **`onDelete: "set null"`** — deleting/deactivating a house should not delete students; it detaches them. This matches the `set null` used for `household_id` and `class_teacher_user_id` elsewhere. Per memory `composite-tenant-fks`, `SET NULL` FKs must be nullable — `house_id` is.
- **Import cycle caution (migration-hygiene flag).** `students.ts` would now import `houses` from `senior.ts`, and `senior.ts` imports `students`/`classes` from `students.ts`. TS type-only circular imports resolve fine at runtime for Drizzle table objects, but to be safe the implementation engineer should **define `houses` in `students.ts`** (next to `classes`, since it is the same foundational tenant-object layer) rather than a separate `senior.ts`, OR keep the ledger tables in `senior.ts` and put only `houses` in `students.ts`. Recommendation: **`houses` → `students.ts`; ledger tables → new `score-ledger.ts`.** This avoids any `students ↔ senior` cycle. The rest of this doc assumes that split.

### 2.3 `classes` — new nullable `programmeId` (extend `db/schema/students.ts`)

The instruction says a `programmeId` (nullable) on the existing `classes` table. Because `programme` is an **enum**, not a table, "programmeId" is best modelled as the enum column `programme` on `class` (there is no `programme` row to reference). Naming it `programme` (enum) is consistent with `student.programme`; naming it `programme_id` would falsely imply a FK to a table that does not exist.

```ts
// add to the classes table column list:
programme: programmeEnum("programme"),   // nullable — "Form 2 General Arts" → GENERAL_ARTS; null for Basic
```

> **Decision to confirm (Q6).** If domain wants programmes to be first-class rows (school-editable label, ordering, per-school subset) rather than a fixed enum, this becomes `programmeId uuid` → a new `ref_programme` tenant table with a `tenant_uk`, and `student.programme` / `class.programme` become composite FKs. That is a bigger F0 and changes three columns. The enum path is the lighter default and matches how the spec/seed talk about programmes as a fixed GES set. **Flagged, not silently chosen.**

---

## 3. Score Ledger Item 1

New file `db/schema/score-ledger.ts`. Re-declare the `score()` helper at the top:

```ts
const score = (name: string) => numeric(name, { precision: 5, scale: 2 });
```

### 3.1 `ref_assessment_weights` — per (school × subject) five-category weights

Per spec §2: configurable per (subject × school), Asankrangwa default **15/15/40/15/15**, the five must sum to 100, and a **system default when no per-subject row exists**.

**Design decision — how "system default" is represented.** Rather than a magic global row, we make the **per-subject row optional** and let the lib layer fall back to a hardcoded/`gradebook_config`-style default when absent. To also allow a **school-wide default** (a school that tunes 20/10/40/15/15 for *all* subjects), we make `subject_id` **nullable**: a row with `subject_id = NULL` is that school's default; a row with a `subject_id` overrides it for that subject. Resolution order in the lib: exact `(school, subject)` row → `(school, NULL)` row → system constant 15/15/40/15/15.

The `ref_` prefix matches the repo's convention for configuration/reference tables that are still tenant-scoped (`ref_academic_period_config`, `ref_school_product`).

```ts
export const assessmentWeights = pgTable(
  "ref_assessment_weights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    subjectId: uuid("subject_id"), // NULL = school-wide default; set = per-subject override
    asgnWeight: smallint("asgn_weight").notNull().default(15),
    midSemWeight: smallint("mid_sem_weight").notNull().default(15),
    endSemWeight: smallint("end_sem_weight").notNull().default(40),
    projectWeight: smallint("project_weight").notNull().default(15),
    portfolioWeight: smallint("portfolio_weight").notNull().default(15),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One default row per school (subject NULL) and one override per subject.
    // NULLs are distinct in a UNIQUE, so the school-default row is enforced separately.
    uniqPerSubject: unique("uniq_weights_per_school_subject").on(t.schoolId, t.subjectId),
    // CHECK: the five weights sum to exactly 100.
    sumTo100: check(
      "assessment_weights_sum_100",
      sql`${t.asgnWeight} + ${t.midSemWeight} + ${t.endSemWeight} + ${t.projectWeight} + ${t.portfolioWeight} = 100`,
    ),
    // Composite school-scoped FK — subject is same-tenant (only when subject_id set).
    subjectFk: foreignKey({
      columns: [t.schoolId, t.subjectId],
      foreignColumns: [subjects.schoolId, subjects.id],
    }).onDelete("cascade"),
  }),
);
```

**Imports needed:** `check` and `sql` from `drizzle-orm` (`check` from `drizzle-orm/pg-core`, `sql` from `drizzle-orm`). Confirmed available in `drizzle-orm@0.45.2`.

**CHECK-constraint hygiene flag.** No existing table in this repo uses a CHECK constraint (verified: zero `CHECK` in `db/migrations/`, zero `check(` in `db/schema/`). This introduces the first one. CHECK is standard SQL and fully portable (no Supabase dependency), so it is safe — but it is a *new pattern* for this codebase, so call it out in the PR. Two subtleties:
1. The composite `subjectFk` on `(school_id, subject_id)` is a partial reference — when `subject_id IS NULL` the FK is simply not enforced (SQL FK semantics skip rows with any NULL column under the default `MATCH SIMPLE`). That is exactly what we want for the school-default row. Good, but non-obvious — comment it.
2. The `UNIQUE(school_id, subject_id)` allows **multiple** rows with `subject_id IS NULL` because NULLs are distinct in a UNIQUE index. If we want *exactly one* school-default row, add a **partial unique index** `UNIQUE (school_id) WHERE subject_id IS NULL`. Drizzle expresses this via `uniqueIndex(...).on(t.schoolId).where(sql\`subject_id IS NULL\`)`. **Recommended** — see Q7.

### 3.2 `senior_assessment` — a Path A gradebook event

One row per (class × subject × period × category × title). This is the SHS analogue of `gradebook_column`, but keyed to the five-category model. It is a **composite-FK target** (scores reference it) → needs `tenant_uk`.

```ts
export const seniorAssessments = pgTable(
  "senior_assessment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    classId: uuid("class_id").notNull(),
    subjectId: uuid("subject_id").notNull(),
    periodId: uuid("period_id").notNull(),
    category: assessmentCategoryEnum("category").notNull(), // ASSIGNMENT | MID_SEM_EXAM | END_SEM_EXAM | PROJECT
    title: text("title").notNull(), // "Assignment 1", "Mid-Sem Exam"
    maxMark: score("max_mark").notNull(), // marks ceiling for this event
    assessedOn: date("assessed_on"), // when the assessment happened (nullable until set)
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqTitle: unique("uniq_assessment_per_context").on(
      t.schoolId,
      t.classId,
      t.subjectId,
      t.periodId,
      t.category,
      t.title,
    ),
    byContext: index("senior_assessment_context_idx").on(t.periodId, t.subjectId, t.classId),
    // Composite-FK target for senior_assessment_score (school_id, id).
    tenantUk: unique("senior_assessment_tenant_uk").on(t.schoolId, t.id),
    // Composite school-scoped FKs — class, subject and period are same-tenant.
    classFk: foreignKey({
      columns: [t.schoolId, t.classId],
      foreignColumns: [classes.schoolId, classes.id],
    }).onDelete("cascade"),
    subjectFk: foreignKey({
      columns: [t.schoolId, t.subjectId],
      foreignColumns: [subjects.schoolId, subjects.id],
    }).onDelete("cascade"),
    periodFk: foreignKey({
      columns: [t.schoolId, t.periodId],
      foreignColumns: [academicPeriod.schoolId, academicPeriod.periodId],
    }).onDelete("cascade"),
  }),
);
```

- **`category` is on the event**, so an ASSIGNMENT event and a MID_SEM_EXAM event are different rows in the same table — mirrors how `gradebook_column.category` (CA/EXAM) works, just with the five-category enum. Mid/end/project will each normally be a *single* event per (class×subject×period); assignments are *many*. The unique on `(…, category, title)` prevents two identically-titled events in the same context but allows N distinct assignment titles.
- **`assessed_on` nullable** — a teacher may create the column before the assessment date is fixed. `gradebook_column` has no date; the ledger progress view (spec §6) wants "Mid-sem entered (date)", so we carry the date here.

### 3.3 `senior_assessment_score` — one row per (event × student)

The raw mark a student got on one event. SHS analogue of `gradebook_column_score`. It is a **leaf** (nothing references it) → no `tenant_uk`.

```ts
export const seniorAssessmentScores = pgTable(
  "senior_assessment_score",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    assessmentId: uuid("assessment_id").notNull(),
    studentId: uuid("student_id").notNull(),
    rawMark: score("raw_mark"), // nullable — blank until entered
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: unique("uniq_assessment_score_per_student").on(
      t.schoolId,
      t.assessmentId,
      t.studentId,
    ),
    byAssessment: index("senior_assessment_score_assessment_idx").on(t.assessmentId),
    // Composite school-scoped FKs — event and student are same-tenant.
    assessmentFk: foreignKey({
      columns: [t.schoolId, t.assessmentId],
      foreignColumns: [seniorAssessments.schoolId, seniorAssessments.id],
    }).onDelete("cascade"),
    studentFk: foreignKey({
      columns: [t.schoolId, t.studentId],
      foreignColumns: [students.schoolId, students.id],
    }).onDelete("cascade"),
  }),
);
```

- **`raw_mark` nullable** — matches `gradebook_column_score.raw_score`. A blank cell is a missing entry, distinct from a zero.
- No CHECK that `raw_mark <= max_mark` at the DB level: `max_mark` lives on the parent event, and a cross-row CHECK would need a trigger/subquery (non-portable, and we forbid business-logic triggers). **Validate `raw_mark ≤ max_mark` in the lib/UI layer.** (Flagged — Q3.)

### 3.4 `senior_score_ledger` — the compiled record

Keyed `(school_id, student_id, subject_id, period_id)` — the exact grain the spec prescribes (§2, §3.3, §9). Holds the five compiled category values, the computed weighted total, the `portfolio_manual` flag, the status, and who/when compiled. **Leaf** → no `tenant_uk`.

```ts
export const seniorScoreLedger = pgTable(
  "senior_score_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    studentId: uuid("student_id").notNull(),
    subjectId: uuid("subject_id").notNull(),
    periodId: uuid("period_id").notNull(),
    // The five category values (0–100 scale, already reduced from raw events).
    asgnScore: score("asgn_score"),
    midSemScore: score("mid_sem_score"),
    endSemScore: score("end_sem_score"),
    projectScore: score("project_score"),
    portfolioScore: score("portfolio_score"), // manual entry (spec §4.1)
    // The computed weighted total, using the resolved ref_assessment_weights.
    weightedTotal: score("weighted_total"),
    portfolioManual: boolean("portfolio_manual").notNull().default(false),
    status: ledgerStatusEnum("status").notNull().default("DRAFT"),
    compiledByUserId: uuid("compiled_by_user_id").references(() => users.id),
    compiledAt: timestamp("compiled_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: unique("uniq_ledger_student_subject_period").on(
      t.schoolId,
      t.studentId,
      t.subjectId,
      t.periodId,
    ),
    byPeriodSubject: index("senior_ledger_period_subject_idx").on(t.periodId, t.subjectId),
    // Composite school-scoped FKs — student, subject and period are same-tenant.
    studentFk: foreignKey({
      columns: [t.schoolId, t.studentId],
      foreignColumns: [students.schoolId, students.id],
    }).onDelete("cascade"),
    subjectFk: foreignKey({
      columns: [t.schoolId, t.subjectId],
      foreignColumns: [subjects.schoolId, subjects.id],
    }).onDelete("cascade"),
    periodFk: foreignKey({
      columns: [t.schoolId, t.periodId],
      foreignColumns: [academicPeriod.schoolId, academicPeriod.periodId],
    }).onDelete("cascade"),
  }),
);
```

- Mirrors `gradebook_score` (the Basic two-category analogue) exactly in shape and FK style — same unique grain `(school, student, subject, period)`, same three composite FKs, same `byPeriodSubject` index. This is deliberate: the Senior ledger is the five-category sibling of the Basic `gradebook_score`.
- All five category scores nullable — a DRAFT ledger may have only assignments + mid-sem so far. The lib decides when it is `COMPLETE`/`STPSHS_READY` (all five non-null).
- `weighted_total` is **stored, not derived at read** — persisted so the progress view, STPSHS sheet, and report card read one number, and so the exact weights-at-compile-time are frozen into it (weights can change later; a compiled total should not silently move). The `weights_used` snapshot is deferred — see Q4.

---

## 4. RLS classification (feeds `scripts/apply-policies.ts` and `db/sql/policies.sql`)

Every new table is **tenant-scoped** (all carry `school_id`) → each gets **`ENABLE` + `FORCE` + `tenant_isolation`**. Add these six names to the `FOREACH tbl IN ARRAY [...]` tenant-table loop in `db/sql/policies.sql`:

| Table | Scope | RLS | tenant_uk? | Notes |
|---|---|---|---|---|
| `house` | tenant | ENABLE + FORCE + `tenant_isolation` | **yes** (`house_tenant_uk`) | FK target for `student.house_id` |
| `ref_assessment_weights` | tenant | ENABLE + FORCE + `tenant_isolation` | no | `ref_` prefix but still tenant-scoped |
| `senior_assessment` | tenant | ENABLE + FORCE + `tenant_isolation` | **yes** (`senior_assessment_tenant_uk`) | FK target for scores |
| `senior_assessment_score` | tenant | ENABLE + FORCE + `tenant_isolation` | no | leaf |
| `senior_score_ledger` | tenant | ENABLE + FORCE + `tenant_isolation` | no | leaf |
| (`student`, `class` — **already** in the RLS list; no change) | tenant | unchanged | unchanged | only columns added |

- **No new global tables** in this increment. No table gets bare-ENABLE-only treatment — all six are tenant tables. (`programme`/`residency`/`assessment_category`/`ledger_status` are enums, not tables.)
- **Prod reminder (memory `prod-rls-manual-paste`).** `db:policies` only applies to local dev. When this ships, the five new `tenant_isolation` policy statements **must be pasted onto prod by hand**, or these tables leak across schools. Put the exact SQL in the PR description. See §6.
- The `apply-policies.ts` runner needs no change — it reads `policies.sql`. Only the SQL file's table array changes.

---

## 5. The Path A compile rule — a lib function, not a DB trigger

Per the portability discipline (no business-logic triggers) and spec §4.1, compilation lives in a **lib function** (e.g. `lib/score-ledger/compile.ts`, `compileLedger({ schoolId, studentId, subjectId, periodId })`). The DB stores inputs (`senior_assessment` + `senior_assessment_score`) and the compiled outputs (`senior_score_ledger`); it does **not** compute them.

**The rule per category:**

| Category | Source | Reduction |
|---|---|---|
| `asgn_score` | all `senior_assessment` rows with `category = ASSIGNMENT` in (class, subject, period), joined to that student's `senior_assessment_score` | **average of the per-event percentages** `(raw_mark / max_mark) × 100`. Default = simple (equal-weight) mean; **configurable to weight by `max_mark`** (spec §4.1). A blank/absent score for an event is excluded from the mean (not treated as 0) unless the teacher marks it 0 — see Q1/Q2. |
| `mid_sem_score` | the single `MID_SEM_EXAM` event | that event's percentage `(raw / max) × 100`. If more than one exists → error surfaced to teacher (Q1). |
| `end_sem_score` | the single `END_SEM_EXAM` event | that event's percentage. |
| `project_score` | `PROJECT` event(s) | single event → its percentage; multiple → aggregate (mean of percentages), per spec §4.1 "or aggregate of multiple." |
| `portfolio_score` | **none** — manual entry | teacher-typed at semester end; sets `portfolio_manual = true`. Never auto-computed. |

**Weighted total:**
```
weighted_total =
  asgn_score      × asgnWeight/100
+ mid_sem_score   × midSemWeight/100
+ end_sem_score   × endSemWeight/100
+ project_score   × projectWeight/100
+ portfolio_score × portfolioWeight/100
```
using the weights resolved from `ref_assessment_weights` (exact subject row → school-default row → system constant 15/15/40/15/15). All five category values are on a 0–100 scale before weighting, so `weighted_total` is also 0–100.

**Status transitions (lib-owned):**
- `DRAFT` — any category still null, or portfolio not yet entered.
- `COMPLETE` — all five non-null and `weighted_total` computed.
- `STPSHS_READY` — `COMPLETE` **and** the teacher has signed off for export (an explicit action, not automatic).

**Why lib, not trigger:** (1) portability — a Postgres trigger would not survive a move off Supabase cleanly and duplicates logic the app already needs client-side for the live "weighted total" preview in the ledger UI (spec §5.2 card view); (2) the weight-by-max-mark toggle and the "exclude blank vs treat-as-zero" policy are product decisions that belong in versioned app code, not DDL; (3) audit — the compile writes an `audit_log` row via `lib/db/audit.ts`, which a trigger cannot do idiomatically. **Compilation is idempotent**: re-running upserts the same `senior_score_ledger` row (unique grain guarantees one row).

---

## 6. Migration ordering & hygiene

Drizzle generates one migration from the schema diff; ordering *within* it matters because of FK dependencies. The implementation engineer runs `pnpm db:generate` after adding the schema; the generated SQL must create objects in this order (drizzle-kit usually gets this right, but verify):

1. **Enums first** — `CREATE TYPE programme`, `residency`, `assessment_category`, `ledger_status`. (drizzle emits all `CREATE TYPE` before tables — see migration `0000`.)
2. **`house`** — before `student` alter, because `student.house_id` FK targets `house(school_id, id)` and needs `house_tenant_uk` to exist.
3. **`student` / `class` ALTERs** — add columns + `houseFk`. Depends on `house` and its `tenant_uk`.
4. **`ref_assessment_weights`** — depends on `subject` (existing `subject_tenant_uk`).
5. **`senior_assessment`** — depends on `class`, `subject`, `academic_period` (all existing tenant_uks).
6. **`senior_assessment_score`** — depends on `senior_assessment_tenant_uk` (step 5) and `students_tenant_uk`.
7. **`senior_score_ledger`** — depends on `students`, `subject`, `academic_period` tenant_uks.
8. **RLS** — **not** in the Drizzle migration. Applied separately via `scripts/apply-policies.ts` (dev) after editing `db/sql/policies.sql` to add the five tenant tables. **Prod: paste the five policy blocks by hand** (memory `prod-rls-manual-paste`).

**Hygiene flags:**
- **Single migration, but two concerns.** F0 (house + student/class columns) and Ledger Item 1 (four ledger tables + weights) will land in one generated migration if done together. That is fine — they ship as one increment — but if the team wants them independently revertible, generate F0 first, commit, then the ledger. Recommendation: **one migration**, since the ledger's progress view needs `student.programme`/`house` anyway.
- **First CHECK constraint in the repo.** `ref_assessment_weights` introduces `assessment_weights_sum_100`. Portable, standard SQL — but call it out in review since it is a new pattern (§3.1).
- **First partial-unique-index candidate** (`WHERE subject_id IS NULL`, if Q7 is accepted). Also portable, also new to this repo.
- **Seed will need extending** (not part of this schema doc, but flag for the implementation engineer): `db/seed/asankrangwa.ts` currently creates **no** houses, programmes, subjects, or students. To honour `INSTRUCTIONS_FOR_CLAUDE_CODE.md` §1.7 it must add the 6 houses, the `subject` rows, students J. Manu (Form 2 GA, Aggrey House, BOARDER) and Y. Aidoo (Form 3), a `ref_assessment_weights` default (15/15/40/15/15), and — for a Path A demo — a few `senior_assessment` + `senior_assessment_score` rows. Seed edits must be **scoped to marker codes** (memory `seed-cleanup-must-be-scoped`) and the dev DB migrated before previewing.
- **No down-migrations** — this repo has none; consistent with existing practice. Reverting means a new forward migration.

---

## 7. Portability & risk register

| Risk | Severity | Mitigation |
|---|---|---|
| CHECK constraint is a new pattern for the repo | low | Standard SQL, fully portable; flag in PR. |
| `raw_mark ≤ max_mark` not DB-enforced | medium | Enforce in lib/UI; a DB-level check needs a non-portable trigger, which we forbid. |
| Enum `programme` can't be reordered/removed later | medium | Chose enum for lightness; Q6 offers the `ref_programme` table alternative if domain wants editable programmes. Appending values is safe. |
| Weights change after a ledger is compiled → historical totals | medium | `weighted_total` is **stored** at compile time so it doesn't drift; the exact weights used should ideally be snapshotted (Q4). |
| Multiple `subject_id IS NULL` weight rows possible | low | Add partial unique index `WHERE subject_id IS NULL` (Q7). |
| Prod RLS not auto-applied | **high** | Manual paste of 5 policies on prod (memory), documented in PR — else cross-school leak. |
| `students ↔ senior` import cycle | low | Put `houses` in `students.ts`, ledger tables in `score-ledger.ts` (§2.2). |

No Supabase-proprietary features are used anywhere in this design. The GUC-based RLS (`app.current_school` / `app.bypass_rls`) is the repo's existing portable pattern and is reused unchanged.

---

## 8. Open questions for Kofi / domain

1. **Assignment count & the single-event assumption.** How many ASSIGNMENT events per subject per semester is typical (3? 8? 15?) — this sizes the UI and confirms the average-of-percentages reduction is right. And is it *guaranteed* there is exactly one MID_SEM_EXAM and one END_SEM_EXAM per (class×subject×period)? The compile rule assumes single events for mid/end; if a subject can legitimately have two mid-sem sittings, the rule needs an aggregation policy.
2. **Blank vs zero in the assignment average.** If a student misses an assignment, is the intended semester behaviour "excluded from the average" or "counts as 0"? These give very different `asgn_score`s. Default chosen: **excluded unless the teacher explicitly enters 0.** Confirm.
3. **`raw_mark > max_mark` — hard block or warn?** Should the UI hard-reject a mark above the event's max, or allow it (bonus marks) with a warning? Affects whether we ever want a DB CHECK.
4. **Freeze the weights into each compiled ledger row?** Should `senior_score_ledger` store a snapshot of the five weights used at compile time (e.g. a `weights_used_jsonb` or five `*_weight_used` columns), so a later weight change never alters a historical `weighted_total`? Recommended yes; deferred out of Increment 1 unless domain wants it now.
5. **Weight-by-max-mark default.** Spec says the assignment average is "equal weight by default; configurable to weight by maximum mark." Confirm equal-weight is the Asankrangwa default, and where the toggle lives — per (school), per (subject), or per (teacher × class × subject × semester)?
6. **Programmes: fixed enum or editable table?** Is the 7-value programme set fixed nationally (enum is fine), or do private/international-track schools need to add their own programmes (then `ref_programme` tenant table + composite FKs on `student`/`class`)? This changes three columns.
7. **Exactly one school-default weight row?** Accept the partial unique index `UNIQUE (school_id) WHERE subject_id IS NULL` to guarantee a single school-wide default row? (Recommended.)
8. **Additional categories extension.** Spec §2 says private schools may track *additional* categories (scripture, IGCSE) on top of the five. Not in Increment 1. When it comes: a `ref_extra_category` tenant table + an extra-scores table, weighted separately and *outside* the NaCCA-five weighted total — confirm it never dilutes the five-category 100. Flagged so the enum/weights design here doesn't have to change to accommodate it later (it won't — extras are additive tables, not new enum values).
9. **Project multiplicity.** Spec allows "one or more project submissions." Confirm the aggregate rule for multiple PROJECT events (mean of percentages assumed).

---

## 9. Summary of physical objects created (Increment 1)

- **Enums (4):** `programme`, `residency`, `assessment_category`, `ledger_status`.
- **New tables (5):** `house`, `ref_assessment_weights`, `senior_assessment`, `senior_assessment_score`, `senior_score_ledger`.
- **Altered tables (2):** `students` (+`programme`, `residency`, `house_id` + `houseFk`), `class` (+`programme`).
- **New tenant_uks (2):** `house_tenant_uk`, `senior_assessment_tenant_uk`.
- **New CHECK (1):** `assessment_weights_sum_100`.
- **RLS additions (5):** all five new tables → `ENABLE + FORCE + tenant_isolation` (dev via `policies.sql`; prod by hand).
- **Files touched:** `db/schema/_enums.ts`, `db/schema/students.ts` (+`house`, student/class columns), new `db/schema/score-ledger.ts`, `db/schema/index.ts` (barrel export), `db/sql/policies.sql`.
