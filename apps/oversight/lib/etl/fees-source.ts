import type postgres from "postgres";

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THE OPERATIONAL SOURCE READER for BILLED FEES (`invoice_line_item` ⋈ `invoice` ⋈ `fee_category`,
 * LEFT JOIN `pta_dues_charge`, plus the invoiced pupil's class) — the source of `fact_fees` (task H11).
 *
 * Everything `lib/etl/attendance-source.ts`'s header says about the SEAM applies here unchanged: the
 * QUERY uses operational names and is real; the CONNECTION and the CREDENTIAL are stood in until the
 * cross-tenant `oversight_etl` role (task H1) exists. `schemaName` is interpolated as an IDENTIFIER and
 * comes from the pipeline's CONFIGURATION, never from a request; in real operation it is `"public"` on
 * an `oversight_etl` connection.
 *
 * ── ⚠ THE ALLOW-LIST IS THE TIGHTEST IN THE ETL, BECAUSE THE FEES ESTATE IS THE MOST SENSITIVE ──
 * This is the one domain where an operational row is simultaneously a CHILD, a HOUSEHOLD'S MEANS and a
 * CASH LEDGER. So the SELECT is a NAMED allow-list — seven tables, and nothing else is mentioned:
 *     invoice_line_item   school_id · id · invoice_id · fee_category_id · amount
 *     fee_category        school_id · id · name
 *     invoice             school_id · id · student_id · period_id · status · issued_at
 *     pta_dues_charge     school_id · line_item_id                     (EXISTENCE ONLY — see below)
 *     students            school_id · id · class_id · current_class_label
 *     class               school_id · id · level · name
 *
 * ⚠ AND THE HARD DENIALS, each for its own reason, none of them a style preference:
 *   `invoice_line_item.description`   FREE TEXT a bursar typed onto ONE CHILD'S BILL ("Ama's arrears —
 *                                     see her mother"). Nothing bounds what free text contains, and the
 *                                     category is available structurally (`fee_category_id`, or the dues
 *                                     bridge), so the one plausible excuse for reading it does not exist.
 *                                     The resolver (`lib/etl/fee-category.ts`) reads the CATEGORY NAME
 *                                     and never a line's own description.
 *   `invoice.invoice_number`          a per-child document reference — a direct handle on one bill.
 *   any pupil / parent identity       names, student_code, date_of_birth, household_id. The fact table
 *                                     is aggregate-only; there is no destination for any of them.
 *   any ACTOR user id                 `recorded_by_user_id`, `void_reason`, `allocated_by_user_id`,
 *                                     `captured_by`, `marked_by_user_id`. "Who took this money" must
 *                                     not become queryable outside the gated §6 named-record path.
 *   ⚠ THE ENTIRE PAYMENT ESTATE       `payment`, `payment_allocation`, `receipt`, `payment_audit_log`
 *                                     and `invoice.paid_amount` / `.balance_amount` / `.paid_at`. THIS
 *                                     SLICE PUBLISHES **BILLED** FIGURES ONLY (Kofi's ruling): what was
 *                                     CHARGED is a school's published fee policy, while what a family
 *                                     HAS PAID is that family's financial distress — a district-level
 *                                     "mean arrears" figure for a two-school village is a sentence about
 *                                     identifiable households. Collection/arrears analytics is a
 *                                     different slice with its own Kofi ruling, and this reader must not
 *                                     make it an accident. `tests/etl-fees.test.ts` asserts that none of
 *                                     those words appears in this module's code at all.
 * The demo stand-in (`db/seed/demo/demo-source-schema.sql`) does not even CARRY the denied columns, so
 * the allow-list is STRUCTURAL in the demo: a reader that reached for one would FAIL rather than quietly
 * succeed. That is the `students` posture, and it is the floor under every claim above.
 *
 * ⚠ `pta_dues_charge` IS JOINED FOR EXISTENCE ONLY, AND `rate_snapshot` IS NEVER READ. The bridge
 * answers exactly one question — "is this line item PTA dues?" — and `invoice_line_item.amount` is the
 * billed figure for it, exactly as for every other line. Summing `rate_snapshot` BESIDE the line amount
 * would double-count the same money (the dues line IS the snapshotted rate, billed), and reading it
 * INSTEAD would silently disagree with the invoice the parent was handed whenever the rate changed after
 * issuance (`pta_dues_config_history` is forward-only, and the invoicer never re-rates an issued
 * invoice). The bridge's other columns — `subject_student_id`, `household_id`, `pta_id` — are identity
 * and are not read.
 *
 * ⚠ THE LEFT JOIN MUST NOT FAN OUT, and the guarantee is the SOURCE's own: `uniq_pta_dues_charge_line_item
 * UNIQUE (school_id, line_item_id)` (apps/web migration 0078) makes the bridge strictly 1:1 with its line
 * item. This reader RELIES on that and does not defend against it with a DISTINCT — a DISTINCT would hide
 * a source that had lost the constraint, and the failure mode it hides is a DOUBLED fee. The reliance is
 * written down here because it is invisible in the SQL, and the demo stand-in carries the UNIQUE verbatim.
 *
 * ── IT GROUPS, IT DOES NOT ENUMERATE — BUT THE GROUP KEY INCLUDES THE PUPIL ─────────────────────
 * Every other reader in this ETL groups the pupil AWAY. This one cannot: `fact_fees`'s measures are a
 * PER-STUDENT DISTRIBUTION (Kofi's ruling — mean and median of what each CHILD was billed), and a
 * distribution cannot be reconstructed from a total. So `invoice.student_id` is in the GROUP BY and in
 * the returned row — as an OPAQUE JOIN/GROUP KEY and nothing else:
 *   · it is never SELECTed into an analytics row (`fact_fees` has no pupil column and never will);
 *   · the transform uses it ONLY to decide "same child or different child" when summing and counting;
 *   · it is a bare uuid with no attribute attached — no name, no code, no DOB, no household.
 * `tests/etl-fees.test.ts` asserts both halves: the key reaches the transform, and NOTHING derived from
 * it reaches a written row.
 *
 * ── THE STATUS FILTER (Kofi's ruling, stated in full because it is unrecoverable once loaded) ───
 *     INCLUDED  ISSUED · PARTIAL · PAID · OVERDUE · EXEMPT
 *     EXCLUDED  DRAFT · VOIDED
 * DRAFT is a bill that was never issued — counting it would publish a fee nobody was charged. VOIDED was
 * withdrawn, and a voided invoice left in the mean is a charge the school has already retracted.
 * ⚠ EXEMPT IS INCLUDED, AND IT IS A FLAGGED DEMO DEFAULT. An EXEMPT invoice's line `amount` is treated
 * as BILLED-AS-CHARGED, i.e. the published fee for that child is what the school wrote down even though
 * it has excused her from paying it. That is defensible (the figure is "what this school charges for
 * this category", and an exemption is a collection decision) and it is also the half of this ruling most
 * likely to be revisited: the alternative reading — an exempt child is billed ZERO, which would pull
 * every mean down — is equally arguable and would change published national figures. It is called out
 * here so the next ruling is an amendment rather than a discovery.
 *
 * ── THE PERIOD IS THE **TERM**, AND `period_number` IS NEVER READ ───────────────────────────────
 * An invoice carries `period_id` → operational `academic_period`, which is PER SCHOOL and whose
 * `period_number` means a TERM on a BASIC row and a SEMESTER on a SENIOR one (the Q3 problem,
 * `lib/etl/dimensions.ts`). So the number is NOT the mapping. What this reader uses is the operational
 * period's own `academic_year` plus its own `starts_on`, assigned to the DECLARED TERM whose
 * [starts_on, ends_on] window CONTAINS that start date — the same civil-date containment the attendance
 * arm applies to a mark, and the same "nothing is inferred except from dates" discipline `dimensions.ts`
 * states for the ANNUAL cut. A SENIOR semester therefore files against the term it OPENS in, once,
 * instead of being multiplied across the two terms it overlaps.
 *
 * ⚠ TWO CONSEQUENCES, BOTH DELIBERATE:
 *   · `invoice.period_id IS NULL` invoices are NOT read here (the join is INNER) and are NOT ignored
 *     either: `countInvoicesWithoutPeriod` tallies them per school so the run REPORTS them. A bill with
 *     no term cannot be filed against one, and an un-tallied one is a silently missing fee.
 *   · an invoice whose operational period's start falls in NO declared TERM window likewise reaches no
 *     row. It is NOT separately tallied today — the run declares the terms its own calendar is made of,
 *     so the case is an undeclared term rather than a data fault — and whether that deserves its own
 *     report line (the attendance arm's `attendanceOutOfWindowMarks` equivalent) is the one open question
 *     this slice leaves for Kofi rather than answering on its own initiative.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */

/** The invoice statuses whose line items are BILLED. See the header — EXEMPT is in, deliberately. */
export const BILLED_INVOICE_STATUSES = [
  "ISSUED",
  "PARTIAL",
  "PAID",
  "OVERDUE",
  "EXEMPT",
] as const;

/** The two excluded statuses, named rather than implied, so the exclusion is reviewable. */
export const UNBILLED_INVOICE_STATUSES = ["DRAFT", "VOIDED"] as const;

/**
 * One grouped slice of a school's BILLED fee lines for ONE term: a (pupil × category label × dues flag ×
 * class label) key and the GHS it sums to. NOT a line item and NOT an invoice.
 */
export interface FeeLineGroupRow {
  /** Operational tenant uuid (`invoice.school_id`). */
  schoolId: string;
  /**
   * `invoice.student_id` — AN OPAQUE JOIN/GROUP KEY. It exists so the transform can tell one child's
   * billed total from another's (the measures are a per-student DISTRIBUTION); it reaches no fact row,
   * and no attribute of the child is read beside it.
   */
  studentId: string;
  /** `fee_category.name` — the per-school label, or NULL when the line carries no `fee_category_id`. */
  categoryName: string | null;
  /** TRUE when a `pta_dues_charge` row exists for the line(s) in this group. The PTA_DUES discriminator. */
  isDues: boolean;
  /** `class.level` — nullable upstream, which is why the stage mapping is "level first, then name". */
  classLevel: string | null;
  /** `class.name` — the pupil's class, when she has one. */
  className: string | null;
  /** `students.current_class_label` — the ONLY year-group statement for a pupil with no class row. */
  currentClassLabel: string | null;
  /** FALSE when `students.class_id` is null: the label above is then the stage's only input. */
  hasClass: boolean;
  /**
   * The group's billed total in PESEWAS (GHS × 100), as an exact integer.
   *
   * ⚠ PESEWAS, NOT A FLOAT GHS FIGURE, and that is not a micro-optimisation: `amount` is
   * `numeric(12,2)`, so the sum is exact in the database, and the mean/median this slice publishes are
   * `numeric(10,2)`. Carrying the figure through JS as a float would make `0.1 + 0.2` arithmetic decide
   * a published national fee, and the rounding would differ from Postgres's on exact-half cases. Integer
   * pesewas round-trip exactly and are compared exactly.
   */
  billedPesewas: number;
  /** `max(invoice.issued_at)` in this group, ISO — the input to the deterministic `as_of_date`. */
  lastIssuedAt: string;
}

export interface FeesSourceQuery {
  /** `"demo_source"` for the demo; `"public"` on an `oversight_etl` operational connection. */
  schemaName: string;
  /** The inclusion set's operational tenant uuids. Never unbounded — one run, one known set. */
  operationalSchoolIds: string[];
  /** The DECLARED TERM's `academic_year` — matched against operational `academic_period.academic_year`. */
  academicYear: string;
  /** The DECLARED TERM's window, inclusive. The operational period's `starts_on` must fall inside it. */
  startsOn: string;
  endsOn: string;
}

export interface FeesSourceResult {
  groups: FeeLineGroupRow[];
}

/**
 * Read every included school's BILLED fee lines for ONE declared term, grouped by
 * (school, pupil, category label, dues flag, class label).
 *
 * ONE TERM PER CALL, and ONE QUERY: the dues lines and the categorised lines come back through the SAME
 * read, so there is exactly one transform and exactly one delete-then-insert batch downstream (Kofi's
 * "one arm, one fact_fees"). A second pass for dues would be a second source of truth for the same
 * money, and the two would eventually disagree about a school's PTA_DUES row with nothing to say which
 * was right.
 *
 * Deterministic order (school, pupil, label, dues, class) so the groups the transform sees — and
 * therefore the rows written — are identical on every run, which is what makes "a re-run is
 * byte-identical" a property rather than a coincidence.
 */
export async function readFeeLineGroups(
  sql: postgres.Sql,
  query: FeesSourceQuery,
): Promise<FeesSourceResult> {
  if (query.operationalSchoolIds.length === 0) return { groups: [] };
  // `i.status::text` is cast on the way out of the comparison because operationally it is an ENUM
  // (`invoice_status`) while the analytics side has no invoice vocabulary at all — casting to text at
  // the boundary is what keeps the two from being accidentally welded together, exactly as the roster
  // read does for sex and the register read does for the mark state.
  //
  // `(sum(li.amount) * 100)::bigint` is the exact-pesewas conversion: `amount` is numeric(12,2), so the
  // product is an integer by construction and the cast cannot round. The sum happens in Postgres, in
  // numeric, and only the integer crosses into JS.
  const rows = await sql<Record<string, unknown>[]>`
    select i.school_id::text                           as school_id,
           i.student_id::text                          as student_id,
           fc.name                                     as category_name,
           (pd.line_item_id is not null)               as is_dues,
           c.level                                     as class_level,
           c.name                                      as class_name,
           st.current_class_label                      as current_class_label,
           (c.id is not null)                          as has_class,
           (sum(li.amount) * 100)::bigint              as billed_pesewas,
           max(i.issued_at)                            as last_issued_at
      from ${sql(query.schemaName)}.invoice_line_item li
      join ${sql(query.schemaName)}.invoice i
             on i.school_id = li.school_id and i.id = li.invoice_id
      join ${sql(query.schemaName)}.academic_period ap
             on ap.school_id = i.school_id and ap.period_id = i.period_id
      join ${sql(query.schemaName)}.students st
             on st.school_id = i.school_id and st.id = i.student_id
      left join ${sql(query.schemaName)}.fee_category fc
             on fc.school_id = li.school_id and fc.id = li.fee_category_id
      left join ${sql(query.schemaName)}.pta_dues_charge pd
             on pd.school_id = li.school_id and pd.line_item_id = li.id
      left join ${sql(query.schemaName)}.class c
             on c.school_id = st.school_id and c.id = st.class_id
     where i.school_id = any(${query.operationalSchoolIds}::uuid[])
       and i.status::text = any(${[...BILLED_INVOICE_STATUSES]}::text[])
       and ap.academic_year = ${query.academicYear}
       and ap.starts_on >= ${query.startsOn}::date
       and ap.starts_on <= ${query.endsOn}::date
     group by i.school_id, i.student_id, fc.name, (pd.line_item_id is not null),
              c.level, c.name, st.current_class_label, (c.id is not null)
     order by i.school_id, i.student_id, fc.name, (pd.line_item_id is not null),
              c.level, c.name, st.current_class_label`;

  return {
    groups: rows.map((r) => ({
      schoolId: r.school_id as string,
      studentId: r.student_id as string,
      categoryName: (r.category_name as string | null) ?? null,
      isDues: r.is_dues as boolean,
      classLevel: (r.class_level as string | null) ?? null,
      className: (r.class_name as string | null) ?? null,
      currentClassLabel: (r.current_class_label as string | null) ?? null,
      hasClass: r.has_class as boolean,
      billedPesewas: Number(r.billed_pesewas),
      lastIssuedAt:
        r.last_issued_at instanceof Date
          ? r.last_issued_at.toISOString()
          : String(r.last_issued_at),
    })),
  };
}

/**
 * THE TALLY OF BILLED INVOICES NO TERM CLAIMS — `invoice.period_id IS NULL`.
 *
 * `invoice.period_id` is NULLABLE operationally (apps/web/db/schema/fees.ts:59), so a real bill can
 * exist with no term attached. It contributes to no fact row, and that is correct: `fact_fees` is
 * TERM-grained and there is no period to file it against. What would NOT be correct is for it to
 * VANISH — a school that stopped filling in the term on its invoices would publish a shrinking fee book
 * and look like a school that stopped charging, with nothing on screen to say otherwise. So the run
 * COUNTS them, PER SCHOOL, and reports both the per-school figures and the run-wide total
 * (`EtlRunReport.feesNullPeriodInvoices`).
 *
 * It counts INVOICES, not line items, and it applies the SAME status filter as the main read: a DRAFT
 * with no period is not a gap in the published figures, it is a bill nobody has issued yet. It is
 * period-INDEPENDENT (a null period belongs to no term), so the run issues it ONCE rather than per term.
 */
export async function countInvoicesWithoutPeriod(
  sql: postgres.Sql,
  query: { schemaName: string; operationalSchoolIds: string[] },
): Promise<{ schoolId: string; invoices: number }[]> {
  if (query.operationalSchoolIds.length === 0) return [];
  const rows = await sql<{ school_id: string; invoices: number }[]>`
    select i.school_id::text as school_id, count(*)::int as invoices
      from ${sql(query.schemaName)}.invoice i
     where i.school_id = any(${query.operationalSchoolIds}::uuid[])
       and i.status::text = any(${[...BILLED_INVOICE_STATUSES]}::text[])
       and i.period_id is null
     group by i.school_id
     order by i.school_id`;
  return rows.map((r) => ({
    schoolId: r.school_id,
    invoices: Number(r.invoices),
  }));
}
