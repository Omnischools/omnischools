import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { runOversightEtl } from "@/lib/etl/pipeline";
import { attendanceRateOf } from "@/lib/etl/attendance";
import { ptrOf } from "@/lib/etl/staffing";
import {
  DEMO_EMIS_EXTRACT_PATH,
  DEMO_EXAM_COHORTS,
  DEMO_TERMS,
} from "@/scripts/seed-demo-data";

/**
 * THE ETL ENTRY POINT for the fact slices — `fact_infrastructure`, `fact_enrolment`,
 * `fact_performance_exam`, `fact_attendance`, `fact_fees`, `fact_staffing` AND
 * `fact_plc_participation`, which are ONE run, one verdict and one transaction (see
 * `lib/etl/pipeline.ts`). The SEVENTH arm is the only one that writes at TWO period cuts — a TERM
 * participation row set and an ANNUAL CPD row set — so it prints TWO kinds of line, and its ANNUAL
 * line distinguishes the GENUINELY OBSERVED PLC points from the ILLUSTRATIVE DEMO NTC figures beside
 * them. Its `teacher_headcount` is PINNED to the sixth arm's `teachers_on_roll`, so it runs for the
 * current academic year only and prints under the same year. The sixth arm files at the SAME ANNUAL period
 * as the first two and has no source of its own: its `enrolment_total` IS the enrolment arm's published
 * roll, so its line below is printed under the same academic year and prints Σ÷Σ rather than any average
 * of the stored per-school `ptr`. The third arm files at its own EXAM_COHORT periods, one per
 * sitting year; the fourth at the TERM periods, one per declared term (it is the first FLOW — pupil-days
 * over a window — so it is the only arm whose figures may be summed across periods); the fifth files at
 * the SAME TERM periods and is the first NON-ADDITIVE table — distributional mean/median figures that may
 * be summed in NO direction, which is why its operator line prints counts and tallies and no national mean.
 *
 * ── PRIVILEGE ───────────────────────────────────────────────────────────────────────────────────
 * `ANALYTICS_DATABASE_URL` must point at the PRIVILEGED owner/writer (the Direct connection, the same
 * one `db:migrate` / `db:policies` / `db:load-establishment` use) — never the app runtime's
 * read-scoped pooler, which has no INSERT on the fact tables at all, and never the §6
 * `oversight_readback` operational role.
 *
 * ── WHERE THE ETL LIVES (scope §7 Q12, open for Dex) ────────────────────────────────────────────
 * Here, in `apps/oversight/scripts/`, alongside every other loader. Spec §7 suggests a cron in
 * `apps/web`; this slice does not settle that, and nothing about the decision is baked in: the
 * pipeline is a plain function over a `postgres.Sql`, so a cron in either app, or a generic HTTP
 * POST + shared-secret job runner, calls the same `runOversightEtl()`. Scheduling is task H21.
 *
 * ── THE SOURCE SCHEMA ARGUMENT ──────────────────────────────────────────────────────────────────
 * `--source-schema` defaults to `demo_source`, the operational stand-in the demo generator writes
 * (`db/seed/demo/demo-source-schema.sql` explains why it is a stand-in and exactly what is stood in).
 * In real operation it becomes `public` on an `oversight_etl` connection — scope task H1, which does
 * not exist yet and is the reason the demo path exists at all.
 *
 *   usage: tsx scripts/run-etl.ts [--extract <file.json>] [--source-schema <name>]
 *                                [--ntc-schema <name>]
 */

interface Args {
  extract: string;
  sourceSchema: string;
  /**
   * THE NTC CPD SEAM (increment L). `demo_ntc_source` is the stand-in; `public` would be a live
   * NTC-portal/extract connection; ANY name whose schema has no `ntc_cpd_summary` table leaves the
   * SOURCING GATE CLOSED — the category/threshold columns stay NULL (never 0) and the run is still a
   * normal, successful run. That last case is how an operator previews the LIVE-no-feed state.
   */
  ntcSchema: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    extract: DEMO_EMIS_EXTRACT_PATH,
    sourceSchema: "demo_source",
    ntcSchema: "demo_ntc_source",
  };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!value) throw new Error(`Missing value for ${flag}`);
    if (flag === "--extract") args.extract = value;
    else if (flag === "--source-schema") args.sourceSchema = value;
    else if (flag === "--ntc-schema") args.ntcSchema = value;
    else throw new Error(`Unknown flag ${flag}`);
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const url =
    process.env.ANALYTICS_DATABASE_URL ??
    "postgresql://omnischools:omnischools@localhost:55432/omnischools_analytics_dev";
  const sql = postgres(url, { max: 1, prepare: false });
  try {
    const report = await runOversightEtl(sql, {
      emisExtractText: readFileSync(args.extract, "utf8"),
      periods: DEMO_TERMS.map((t) => ({
        academicYear: t.academicYear,
        term: t.term,
        startsOn: t.startsOn,
        endsOn: t.endsOn,
        isCurrent: t.isCurrent,
      })),
      // THE SITTING COHORTS (task H14). DECLARED, exactly as the academic years are: the run states
      // which sittings it files, `dim_period`'s EXAM_COHORT rows are upserted from that declaration, and
      // each cohort's `endsOn` becomes its rows' frozen `as_of_date`. A source sitting year that is NOT
      // declared FAILS the run with the naming rule in the message — it is never silently skipped.
      examCohorts: DEMO_EXAM_COHORTS.map((c) => ({
        sittingYear: c.sittingYear,
        startsOn: c.startsOn,
        endsOn: c.endsOn,
      })),
      sourceSchema: args.sourceSchema,
      ntcSourceSchema: args.ntcSchema,
    });

    const { coverage } = report;

    // ── THE EXIT CODE IS THE SCHEDULER'S ONLY SIGNAL ──────────────────────────────────────────────
    // A cron (or the generic HTTP-POST job runner H21 lands) does not read this prose; it reads the
    // status. A FAILED run that exits 0 is indistinguishable from a clean one, so the night the
    // pipeline breaks is the night nobody is paged — and the dashboard quietly serves yesterday under
    // today's heading. Three outcomes, three distinct signals:
    //   ✓ clean SUCCESS        exit 0
    //   ⚠ SUCCESS WITH GAPS    exit 0, but visibly not clean (some schools' censuses would not compute)
    //   ✗ FAILED               exit 1, nothing was written
    const gapped = report.status === "SUCCESS" && report.errorText !== null;
    if (report.status === "FAILED") {
      process.exitCode = 1;
      console.error(
        `✗ etl_run ${report.runId} → FAILED — NOTHING WAS WRITTEN (prior data intact)`,
      );
    } else if (gapped) {
      console.log(`⚠ etl_run ${report.runId} → SUCCESS WITH GAPS`);
    } else {
      console.log(`✓ etl_run ${report.runId} → SUCCESS`);
    }

    // Guarded: an empty register is a real state (a first run against a fresh DB, or an extract that
    // parsed to zero usable rows), and `0/0` must print as "n/a" rather than "NaN%" — a NaN in a
    // coverage figure is the kind of thing that gets screenshotted.
    const coveragePct =
      coverage.registered > 0
        ? `${((coverage.onSchoolup / coverage.registered) * 100).toFixed(1)}%`
        : "n/a — register is empty";
    console.log(
      `  register ${report.registerRows} rows · coverage ${coverage.onSchoolup}/${coverage.registered} ` +
        `(${coveragePct}) on Schoolup · ${coverage.included} in the inclusion set`,
    );
    if (coverage.unmapped.length > 0)
      console.log(
        `  ⚠ ${coverage.unmapped.length} on-Schoolup school(s) have no operational_school_id`,
      );
    if (coverage.unresolved.length > 0)
      console.log(
        `  ⚠ ${coverage.unresolved.length} on-Schoolup school(s) have no dim_jurisdiction node`,
      );
    for (const p of report.periods) {
      // ONE LINE PER ACADEMIC YEAR, not per term: the grain is ANNUAL (Kofi's Q3 ruling), so
      // `sourceRows` is the number of schools whose latest census in the year was selected.
      console.log(
        `  ${p.academicYear} ANNUAL · source ${p.sourceRows} → fact_infrastructure ` +
          `${p.inserted} inserted (${p.deleted} replaced)` +
          (p.failures.length > 0
            ? ` · ${p.failures.length} school(s) failed compute`
            : "") +
          (p.noSourceRow.length > 0
            ? ` · ${p.noSourceRow.length} filed no census all year`
            : ""),
      );
      // THE SECOND FACT TABLE, at the SAME ANNUAL period. `headcount` is the roll-up-safe figure —
      // `sex = 'ALL' AND class_form IS NULL` — printed with that filter stated, because the number a
      // reader gets without it is ~6× too big and still internally consistent.
      const e = p.enrolment;
      console.log(
        `  ${p.academicYear} ANNUAL · roster ${e.sourceGroups} groups → fact_enrolment ` +
          `${e.inserted} inserted (${e.deleted} replaced) · ${e.headcount} on roll ` +
          `(sex=ALL, class_form IS NULL) across ${e.schoolsComputed} school(s)` +
          (e.failures.length > 0
            ? ` · ${e.failures.length} school(s) failed compute`
            : "") +
          (e.noRoster.length > 0 ? ` · ${e.noRoster.length} returned no roster` : ""),
      );
      if (e.outOfScopeHeadcount > 0 || e.unmappedHeadcount > 0)
        console.log(
          `    ⓘ ${e.outOfScopeHeadcount} child(ren) below KG (out of scope) and ` +
            `${e.unmappedHeadcount} in an unmapped class — counted here, in NO stage row`,
        );
      if (e.stageDrift.length > 0)
        console.log(
          `    ⚠ ${e.stageDrift.length} school(s) teach a stage their register school_type does not ` +
            `account for (e.g. ${e.stageDrift[0]!.emisSchoolId} is ${String(e.stageDrift[0]!.schoolType)} ` +
            `and teaches ${e.stageDrift[0]!.stages.join("/")})`,
        );
      // ── THE SIXTH FACT TABLE, at the SAME ANNUAL period and PINNED to the line above ─────────────
      // The national PTR printed here is Σ enrolment_total ÷ Σ teachers_on_roll over this period's
      // SCHOOL rows — re-derived from the two summable counts, NEVER the mean of the stored school
      // `ptr` values, which would weight a 40-pupil school equally with a 1,200-pupil one (Kofi §6).
      // The two counts are printed BESIDE it so the figure is checkable and so nobody has to trust the
      // ratio alone. `enrolment_total` is the SAME number as "on roll" above, by construction.
      const st = p.staffing;
      const nationalPtr =
        st.teachersOnRoll > 0
          ? ptrOf(st.enrolmentTotal, st.teachersOnRoll, `${p.academicYear} national`)
          : "n/a — no teachers on roll";
      console.log(
        `  ${p.academicYear} ANNUAL · pinned to the roll above → fact_staffing ${st.inserted} inserted ` +
          `(${st.deleted} replaced) across ${st.schoolsComputed} school(s) · ${st.teachersOnRoll} ` +
          `teachers for ${st.enrolmentTotal} pupils — PTR ${nationalPtr} (Σenrolment ÷ Σteachers, ` +
          `NEVER avg(ptr))` +
          (st.failures.length > 0
            ? ` · ${st.failures.length} school(s) failed compute`
            : "") +
          (st.noEnrolment.length > 0
            ? ` · ${st.noEnrolment.length} had a reconciled roll of 0 and get NO row`
            : ""),
      );
      // The establishment figures carry their OWN denominator, stated rather than implied: PRIVATE and
      // MISSION schools have no GES establishment at all (NULL, not 0 — Kofi §4), so summing vacancies
      // across every school would describe a base that does not exist. `vacancies` is SIGNED, so a
      // national total near zero can mean "balanced" OR "a northern shortage cancelling a southern
      // surplus" — which is why the sign and the school count are both printed.
      if (st.postsEstablishedSchools > 0)
        console.log(
          `    ⓘ ${st.postsEstablished} GES-authorised post(s) and ${st.vacancies} vacanc(ies) (SIGNED: ` +
            `negative = over establishment) across the ${st.postsEstablishedSchools} PUBLIC school(s) ` +
            `that have an establishment — the other ${st.schoolsComputed - st.postsEstablishedSchools} ` +
            `(PRIVATE/MISSION) are NULL, not 0, and are excluded from both sums`,
        );
      // ── THE SEVENTH FACT TABLE, at the SAME ANNUAL period AND at this year's TERM periods ───────
      // ⚠ TWO LINES, BECAUSE THE ARM HAS TWO CUTS AND TWO PROVENANCES, and collapsing them would be
      // the exact misread Kofi's per-figure DEMO marking exists to prevent. The PLC figures are
      // real-shape operational aggregates; the NTC category/threshold figures are ILLUSTRATIVE DEMO
      // data from a stand-in, and this operator line says so in as many words — an operator reading
      // the log at 3am must not have to know which columns came from where.
      // Every rate printed here is re-derived from that cut's own summed counts (Σnum ÷ Σden over the
      // sex='ALL' rows), NEVER averaged from the stored per-school rates.
      const plc = p.plc;
      for (const t of plc.terms) {
        const sessionCoverage =
          t.sessionsExpected > 0
            ? `${attendanceRateOf(t.sessionsHeld, t.sessionsExpected)}%`
            : "n/a — no configured cadence";
        const participation =
          t.attendanceExpected > 0
            ? `${attendanceRateOf(t.attendanceEvents, t.attendanceExpected)}%`
            : "n/a — no session held";
        const coverage =
          t.teacherHeadcount > 0
            ? `${attendanceRateOf(t.teachersInPlc, t.teacherHeadcount)}%`
            : "n/a — no teachers on roll";
        console.log(
          `  ${t.academicYear} TERM ${t.term} (${t.startsOn}…${t.endsOn}) · PLC participation → ` +
            `fact_plc_participation ${t.inserted} inserted (${t.deleted} replaced) · ` +
            `${t.schoolsRunningPlc}/${plc.schoolsComputed} school(s) run a PLC (sex=ALL only — ` +
            `summing that count under the MALE/FEMALE split returns exactly 2×) · sessions ` +
            `${t.sessionsHeld}/${t.sessionsExpected} (${sessionCoverage}) · attendance ` +
            `${t.attendanceEvents}/${t.attendanceExpected} (${participation}) · ${t.teachersInPlc} ` +
            `of ${t.teacherHeadcount} teacher(s) in a PLC (${coverage}, headcount PINNED to ` +
            `fact_staffing.teachers_on_roll)` +
            (t.schoolsWithoutCadence > 0
              ? ` · ${t.schoolsWithoutCadence} school(s) have NO configured cadence, so their ` +
                `sessions_expected is NULL (never 0) and they are out of that denominator`
              : "") +
            (t.orphanSessions > 0
              ? ` · ${t.orphanSessions} session(s) belong to an ARCHIVED PLC and reach no fact column`
              : ""),
        );
      }
      const an = plc.annual;
      if (plc.schoolsComputed > 0) {
        const thresholdRate =
          an.teachersMeetingCpdThreshold !== null && an.teacherHeadcount > 0
            ? `${attendanceRateOf(an.teachersMeetingCpdThreshold, an.teacherHeadcount)}%`
            : null;
        console.log(
          `  ${p.academicYear} ANNUAL · CPD points → fact_plc_participation ${an.inserted} inserted ` +
            `(${an.deleted} replaced) across ${plc.schoolsComputed} school(s) · ` +
            `${an.plcPoints} pt(s) GENUINELY OBSERVED from the PLC ledger · cpd_points_total ` +
            `${an.cpdPointsTotal} · NTC source: ${plc.ntcProvenance}`,
        );
        // ⚠ THE SOURCING GATE, PRINTED. A NULL threshold is NOT 0% compliance, and the difference is
        // the single most consequential distinction on this surface: writing 0 would report every
        // school in Ghana as non-compliant, which is false and actionable.
        if (plc.ntcProvenance === "ABSENT")
          console.log(
            `    ⚠ NO NTC CPD SOURCE: cpd_points_specialised_total, cpd_points_recommended_total, ` +
              `their teacher counts, teachers_meeting_cpd_threshold and ntc_cpd_target are NULL — ` +
              `NEVER 0 — and cpd_points_total is the PLC-ONLY subtotal. cpd_points_mandatory_total ` +
              `is populated as a STATED PLC-only partial. Zero is a measurement; NULL is the truth.`,
          );
        else
          console.log(
            `    ⚠ DEMO NTC DATA (${an.ntcSourcedSchools}/${plc.schoolsComputed} school(s) covered): ` +
              `${thresholdRate === null ? "no" : String(an.teachersMeetingCpdThreshold)} teacher(s) ` +
              `of ${an.teacherHeadcount} met the national CPD requirement` +
              `${thresholdRate === null ? "" : ` (${thresholdRate})`} — ILLUSTRATIVE, NOT MEASURED. ` +
              `The live NTC CPD feed is not connected; these figures come from the demo stand-in ` +
              `through the swappable seam, and Mandatory is the OBSERVED PLC floor + an NCPD topup. ` +
              `The ${an.ntcSourcedSchools === plc.schoolsComputed ? "" : "un"}covered schools' NTC ` +
              `columns are NULL, never 0`,
          );
        if (plc.noPlc.length > 0)
          console.log(
            `    ⓘ ${plc.noPlc.length} school(s) run NO PLC and DO get rows, with ` +
              `schools_running_plc_count = 0 (e.g. ${plc.noPlc[0]!}) — the count is the numerator of ` +
              `"N of Y schools", and the Y is the row count, so suppressing them would report 100%`,
          );
        if (plc.ntcCountsClamped > 0)
          console.log(
            `    ⚠ ${plc.ntcCountsClamped} NTC-sourced teacher count(s) exceeded this warehouse's own ` +
              `roll and were CLAMPED to it — NTC counts against its own roll of licensed teachers, ` +
              `and every coverage rate here divides by teacher_headcount, so an unclamped figure ` +
              `would publish compliance above 100%`,
          );
      }
    }
    // ── THE THIRD ARM, at its OWN EXAM_COHORT periods (one line per SITTING, never per year) ───────
    // The counts are printed PER EXAM on purpose: a BECE candidate and a WASSCE candidate are different
    // children, so a pooled pair would invite a pooled rate for a cohort that does not exist. And the
    // rate printed per exam is re-derived here from that exam's own summed counts — never averaged from
    // the stored school rates, which is the one arithmetic mistake this table punishes silently.
    for (const c of report.examCohorts) {
      console.log(
        `  ${c.sittingYear} sitting (EXAM_COHORT ${c.academicYear}) · source ${c.sourceRows} filings → ` +
          `fact_performance_exam ${c.inserted} inserted (${c.deleted} replaced) across ` +
          `${c.schoolsComputed} school(s), as of ${c.asOfDate}` +
          (c.failures.length > 0
            ? ` · ${c.failures.length} school(s) failed compute`
            : "") +
          (c.noResults.length > 0 ? ` · ${c.noResults.length} filed no sitting` : ""),
      );
      for (const e of c.byExam) {
        if (e.candidates === 0) continue;
        // KNOWINGLY left as a float print: the exam arm's stored qualification rate has its own helper
        // (`qualificationRate`, which returns "0.00" on zero candidates rather than throwing), so it is NOT
        // the attendance helper, and converting this print is a separate exam-arm tidy, out of H10's scope.
        const rate = ((e.qualified / e.candidates) * 100).toFixed(2);
        console.log(
          `    ${e.exam}: ${e.qualified}/${e.candidates} qualified (${rate}%, sex=ALL, one sitting) ` +
            `— “candidates − qualified” is NOT “failed” (absent/withheld are in it too)`,
        );
      }
      if (c.waecRows > 0)
        console.log(
          `    ⓘ ${c.waecRows} row(s) from the WAEC extract supersede school-entered figures`,
        );
      if (c.superseded > 0)
        console.log(
          `    ⓘ ${c.superseded} school-entered row(s) superseded by WAEC_EXTRACT — a WAEC-covered ` +
            `cohort loses its whole school-entered row-set and is sex='ALL' ONLY`,
        );
    }
    // ── THE FOURTH ARM, at the TERM periods (one line per DECLARED TERM) ───────────────────────────
    // The rate printed per term is re-derived HERE from that term's own summed counts — Σpresent ÷
    // Σenrolled over the roll-up-safe rows — and never averaged from the stored school rates. The counts
    // are printed BESIDE it because this is the one fact table whose figures are additive across periods:
    // the ANNUAL rate is Σ of these terms' present over Σ of their enrolled, NOT the mean of these lines.
    for (const t of report.terms) {
      // Re-derived through the SAME helper the fact rows store, so this printed national rate rounds
      // IDENTICALLY to every stored rate it summarises (integer half-away-from-zero = Postgres round()).
      // A float `(present / enrolled) * 100` here would read 0.01 off a stored rate on exact-half totals.
      const rate =
        t.enrolledDays > 0
          ? `${attendanceRateOf(t.presentDays, t.enrolledDays)}%`
          : "n/a — no marked pupil-days";
      console.log(
        `  ${t.academicYear} TERM ${t.term} (${t.startsOn}…${t.endsOn}) · ${t.sourceGroups} mark groups → ` +
          `fact_attendance ${t.inserted} inserted (${t.deleted} replaced) across ${t.schoolsComputed} ` +
          `school(s) · ${t.presentDays}/${t.enrolledDays} pupil-days present (${rate}, class_form IS NULL)` +
          (t.failures.length > 0
            ? ` · ${t.failures.length} school(s) failed compute`
            : "") +
          (t.noMarks.length > 0 ? ` · ${t.noMarks.length} marked no register` : ""),
      );
      if (t.outOfScopeMarks > 0 || t.unmappedMarks > 0)
        console.log(
          `    ⓘ ${t.outOfScopeMarks} mark(s) below KG (out of scope) and ${t.unmappedMarks} in an ` +
            `unmapped class — counted here, in NO stage row`,
        );
    }
    // ── THE FIFTH ARM, at the SAME TERM periods (one line per DECLARED TERM) ───────────────────────
    // ⚠ NO NATIONAL MEAN IS PRINTED, AND THAT IS THE RULING RATHER THAN AN OMISSION. `fact_fees` is
    // NON-ADDITIVE in both time and space: a national mean fee cannot be computed from school means
    // (they weight a 40-pupil school equally with a 900-pupil one), and a national MEDIAN cannot be
    // computed from school medians at any weighting at all. The only honest national figure would come
    // from re-reading the source as one pooled distribution, which is a different slice. So this line
    // prints COUNTS and the degradation TALLIES, and the money figures a reader may act on are the ones
    // IN the rows — per school, with `stage IS NULL` for the whole-school cut.
    for (const f of report.feeTerms) {
      console.log(
        `  ${f.academicYear} TERM ${f.term} (${f.startsOn}…${f.endsOn}) · ${f.sourceGroups} billed-line ` +
          `groups → fact_fees ${f.inserted} inserted (${f.deleted} replaced) across ` +
          `${f.schoolsComputed} school(s) · ${f.billedStudents} billed pupil(s) in ` +
          `${f.categories.length} categor(ies) — NON-ADDITIVE: never sum or average these rows` +
          (f.failures.length > 0
            ? ` · ${f.failures.length} school(s) failed compute`
            : "") +
          (f.noInvoices.length > 0 ? ` · ${f.noInvoices.length} issued no bill` : ""),
      );
      if (Number(f.otherBilled) > 0 || Number(f.otherCategoryNames) > 0)
        console.log(
          `    ⓘ GHS ${f.otherBilled} published under OTHER across ${f.otherCategoryNames} distinct ` +
            `unmapped category name(s) — the pure resolver's coverage signal, read it before adding a keyword`,
        );
      if (Number(f.outOfScopeBilled) > 0 || Number(f.unmappedStageBilled) > 0)
        console.log(
          `    ⓘ GHS ${f.outOfScopeBilled} billed to pupils below KG (out of scope) and GHS ` +
            `${f.unmappedStageBilled} to pupils in an unmapped class — counted here, in NO row`,
        );
      // The per-school tallies exist so a degradation is attributable; printing the worst one keeps the
      // operator line readable while naming a school to go and look at.
      const worst = [...f.perSchool].sort(
        (a, b) => Number(b.otherBilled) - Number(a.otherBilled),
      )[0];
      if (worst && (Number(worst.otherBilled) > 0 || Number(worst.otherCategoryNames) > 0))
        console.log(
          `    ⓘ most OTHER-bucketed: ${worst.emisSchoolId} (GHS ${worst.otherBilled}, ` +
            `${worst.otherCategoryNames} unmapped name(s)) — ${f.perSchool.length} school(s) have tallies`,
        );
    }
    if (report.feesNullPeriodInvoices.total > 0)
      console.log(
        `  ⚠ ${report.feesNullPeriodInvoices.total} billed invoice(s) across ` +
          `${report.feesNullPeriodInvoices.bySchool.length} school(s) carry NO period_id, so no TERM can ` +
          `claim them and they reach no fact row (e.g. ` +
          `${report.feesNullPeriodInvoices.bySchool[0]!.emisSchoolId}) — a school that stops filling in ` +
          `the term would otherwise look like a school that stopped charging`,
      );
    if (report.attendanceOutOfWindowMarks > 0)
      console.log(
        `  ⚠ ${report.attendanceOutOfWindowMarks} attendance mark(s) fall in NO declared term window ` +
          `(holiday marking, a mis-keyed date — or a term this run failed to declare, which would leave ` +
          `that term stale under a SUCCESS banner)`,
      );
    if (report.errorText) {
      const line = `  note: ${report.errorText}`;
      if (report.status === "FAILED") console.error(line);
      else console.log(line);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
