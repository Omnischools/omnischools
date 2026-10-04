import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { runInfrastructureEtl } from "@/lib/etl/pipeline";
import { DEMO_EMIS_EXTRACT_PATH, DEMO_TERMS } from "@/scripts/seed-demo-data";

/**
 * THE ETL ENTRY POINT for the `fact_infrastructure` slice.
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
 * POST + shared-secret job runner, calls the same `runInfrastructureEtl()`. Scheduling is task H21.
 *
 * ── THE SOURCE SCHEMA ARGUMENT ──────────────────────────────────────────────────────────────────
 * `--source-schema` defaults to `demo_source`, the operational stand-in the demo generator writes
 * (`db/seed/demo/demo-source-schema.sql` explains why it is a stand-in and exactly what is stood in).
 * In real operation it becomes `public` on an `oversight_etl` connection — scope task H1, which does
 * not exist yet and is the reason the demo path exists at all.
 *
 *   usage: tsx scripts/run-etl.ts [--extract <file.json>] [--source-schema <name>]
 */

interface Args {
  extract: string;
  sourceSchema: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { extract: DEMO_EMIS_EXTRACT_PATH, sourceSchema: "demo_source" };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!value) throw new Error(`Missing value for ${flag}`);
    if (flag === "--extract") args.extract = value;
    else if (flag === "--source-schema") args.sourceSchema = value;
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
    const report = await runInfrastructureEtl(sql, {
      emisExtractText: readFileSync(args.extract, "utf8"),
      periods: DEMO_TERMS.map((t) => ({
        academicYear: t.academicYear,
        term: t.term,
        startsOn: t.startsOn,
        endsOn: t.endsOn,
        isCurrent: t.isCurrent,
      })),
      sourceSchema: args.sourceSchema,
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
    }
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
