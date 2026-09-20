# INCR-3 · Score Ledger Item 8 (STPSHS printable sheet) — Assessment Reference ID column

**Author:** Wells (DB engineer) · **Status:** Designed, generated, applied to dev, RLS-verified.
**Migration:** `0042_easy_blazing_skull.sql` (applied to dev DB `omnischools_dev`).
**Owner ruling:** Q1 LOCKED (2026-07-15) — store the real STPSHS ID; add the nullable column now.

---

## 0. What this migration is (and is not)

Net DDL: **1 nullable text column** — `stpshs_ref` — on the *existing* tenant table `students`.
- **No new table** → no new `tenant_uk`, no new FK, **no new RLS**, no prod-paste RLS policy.
- **No UNIQUE constraint** (see §2).
- **No ingest path** — the column stays NULL until a future STPSHS bio-data-registration
  increment populates real IDs. This increment only reserves the column.

## 1. Why a plain `text` column on `students`

The STPSHS Assessment Reference ID (format like `REF-2024-XXXX`) is an **external opaque id**
STPSHS assigns each student at Year-1 bio-data registration. It is not a closed vocabulary, so
it is `text`, not a `pgEnum`. It lives on `students` because it is a **per-student attribute for
the 3-year SHS cycle** (spec §2) — not per subject×period, not per ledger row. The regulator
score sheet (INCR-3 PDF) reads it once per student row.

Nullable because no ingest path exists yet: STPSHS assigns these at bio-data registration, which
is unbuilt. A manufactured ID that doesn't match STPSHS's real one mis-keys the teacher — worse
than none — so the sheet renders **"pending"** in the REF column while the value is NULL. Every
Basic (KG · Primary · JHS) student also stays NULL, consistent with the other SHS-only columns
(`programme` / `residency` / `house_id`).

## 2. No UNIQUE constraint now

Uniqueness is **per student for the 3-year cycle** (spec §2). But the column is nullable and
unpopulated: a UNIQUE over many NULLs buys nothing today (NULLs are distinct in a UNIQUE) and a
`NOT NULL` would break every existing student. The correct enforcement is a **partial unique
index** (`WHERE stpshs_ref IS NOT NULL`), and it belongs with the ingest increment that actually
writes real IDs — added there, not here. Reserving the column now is the whole job of 0042.

## 3. RLS & prod

`students` already has `ENABLE + FORCE ROW LEVEL SECURITY + tenant_isolation` (school_id is the
primary boundary; the session `app.current_school` is defence in depth). Adding one column
changes none of it. **No RLS delta, no leak risk, nothing to hand-paste.**
`db/sql/prod-paste-0042-stpshs-ref.sql` documents this explicitly and carries the idempotent
`ALTER TABLE students ADD COLUMN IF NOT EXISTS stpshs_ref text` for hand-verification; prod gets
that DDL via the normal drizzle migrate flow. **Deploy note: prod needs the column ALTER only —
NOT new RLS.**

## 4. Dev DB apply note

The shared dev DB (`omnischools_dev`) was built via `db:push`, so it has no
`drizzle.__drizzle_migrations` journal — `drizzle-kit migrate` would replay from 0000 and fail.
The column was therefore applied to dev by piping the idempotent ALTER through docker psql (the
established pattern for updating this shared DB), then verified: `information_schema.columns`
reports `stpshs_ref | text | is_nullable = YES`. No `db:policies` run was needed (no RLS change).

## 5. Hand-off to the implementer (Claude Code)

The data builder reads `students.stpshsRef` per roster row. **Null → render "pending"** in the
REF column of the STPSHS sheet; otherwise render the string verbatim (opaque id, no formatting).
No new query join is needed — it is a column on the `students` row the sheet already fetches.
