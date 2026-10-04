-- ---------------------------------------------------------------------------
-- HAND-AUTHORED, DATA-ONLY. There is no schema diff here, so `drizzle-kit generate` would emit
-- nothing; the file and its _journal.json entry are written by hand, and meta/0005_snapshot.json is
-- 0004's snapshot re-chained (same tables, new id) so the next generate still diffs from the truth.
--
-- WHAT THIS CLEANS UP. `fact_infrastructure` was re-grained from TERM to ANNUAL (Kofi's Q3 ruling):
-- the pipeline now writes exactly one row per school per academic YEAR, hung off the derived ANNUAL
-- `dim_period` row. Rows the OLD term-grain pipeline wrote are still hanging off TERM periods, and
-- the ETL's own delete-then-insert only ever touches the period_ids of the run it is performing — so
-- it cannot reach them. They are orphans: nothing writes them, nothing refreshes them, and they
-- describe a grain the table no longer has.
--
-- They are not merely untidy. Until the read path was pinned to `dp.period_type = 'ANNUAL'` (see
-- lib/oversight/infrastructure.ts) a leftover TERM row for the current year was a live candidate on
-- the school facilities panel, which is how stale stock reaches an officer. The query pin and this
-- delete are the two halves of one fix: the pin stops them being READ, this stops them EXISTING.
--
-- PURE DML, DELIBERATELY. No CREATE, ALTER, RENAME, no table, sequence or routine touched — this file
-- is safe to paste into prod under the paste rule that forbids DDL. And a bare DELETE is idempotent:
-- replayed, it matches nothing and reports 0. (On prod the fact table is currently empty, so the
-- expected effect there is exactly zero rows; the statement earns its place on every environment
-- that ran the old pipeline, and on the migration-replay from empty it is a documented no-op.)
--
-- NOT scoped to a jurisdiction or a year on purpose: "non-ANNUAL row in an ANNUAL-grain table" is
-- the whole defect, and any narrower predicate would leave some of it behind.
-- ---------------------------------------------------------------------------
DELETE FROM fact_infrastructure fi
      USING dim_period dp
      WHERE dp.period_id = fi.period_id
        AND dp.period_type <> 'ANNUAL';
