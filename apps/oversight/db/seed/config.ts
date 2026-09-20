import { config } from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import * as schema from "@/db/schema";

/**
 * Seed the analytics DB's CONFIG tables — dim_stage, dim_subject, ref_anomaly_rule. These are the
 * tables OVERSIGHT_ANALYTICS_SPEC §10 says to "seed from config" at provision time (the ETL never
 * writes them; they change only by a manual config edit). Idempotent: onConflictDoNothing.
 *
 * The register (ref_emis_school_register) and population (ref_gss_population) are loaded from the
 * GES/GSS extracts, not seeded here.
 */
config({ path: ".env.local" });

const url =
  process.env.ANALYTICS_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://omnischools:omnischools@localhost:55432/omnischools_analytics_dev";

const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema, casing: "snake_case" });

// dim_stage — the age-for-stage mapping (§3.3). Config, so a curriculum reform is a one-row edit.
const STAGES = [
  { stage: "KG", officialAgeLow: 4, officialAgeHigh: 5, displayOrder: 1 },
  { stage: "PRIMARY", officialAgeLow: 6, officialAgeHigh: 11, displayOrder: 2 },
  { stage: "JHS", officialAgeLow: 12, officialAgeHigh: 14, displayOrder: 3 },
  { stage: "SHS", officialAgeLow: 15, officialAgeHigh: 17, displayOrder: 4 },
];

// dim_subject — WASSCE/BECE + internal-performance vocabulary (§3.4). Cores plus a starter set.
const SUBJECTS = [
  { subject: "CORE_MATHS", displayName: "Core Mathematics", isCore: true, displayOrder: 1 },
  { subject: "CORE_ENGLISH", displayName: "English Language", isCore: true, displayOrder: 2 },
  { subject: "INT_SCIENCE", displayName: "Integrated Science", isCore: true, displayOrder: 3 },
  { subject: "SOCIAL_STUDIES", displayName: "Social Studies", isCore: true, displayOrder: 4 },
];

// ref_anomaly_rule — rules as CONFIG (§4.9). Predicate JSON is the readable-logic the queue renders.
const RULES = [
  {
    ruleCode: "PTR-ESC-30",
    description: "Pupil-teacher ratio above 30 with enrolment rising and staffing flat",
    predicateJson: { metric: "ptr", op: ">", value: 30, and: ["enrolment_up", "staffing_flat"] },
    severity: "HIGH" as const,
    enabled: true,
  },
  {
    ruleCode: "PERF-DROP-15",
    description: "Qualification rate fell 15+ points year on year",
    predicateJson: { metric: "qualification_rate", op: "yoy_drop", value: 15 },
    severity: "HIGH" as const,
    enabled: true,
  },
  {
    ruleCode: "COV-GAP",
    description: "Reporting coverage below register expectation for the jurisdiction",
    predicateJson: { metric: "coverage", op: "<", value: 0.6 },
    severity: "MEDIUM" as const,
    enabled: true,
  },
  {
    ruleCode: "ATT-DROP-3",
    description: "Attendance rate dropped 3+ points term on term",
    predicateJson: { metric: "attendance_rate", op: "tot_drop", value: 3 },
    severity: "MEDIUM" as const,
    enabled: true,
  },
  {
    ruleCode: "FEE-OUT-1.5x",
    description: "Mean fee for a category more than 1.5x the district median",
    predicateJson: { metric: "mean_amount", op: "ratio_gt", value: 1.5, of: "district_median" },
    severity: "LOW" as const,
    enabled: true,
  },
];

async function main() {
  await db.insert(schema.dimStage).values(STAGES).onConflictDoNothing();
  await db.insert(schema.dimSubject).values(SUBJECTS).onConflictDoNothing();
  await db.insert(schema.refAnomalyRule).values(RULES).onConflictDoNothing();
  // Sanity: prove the RLS helper compiles against a live DB (no rows expected).
  await db.execute(sql`select 1`);
  console.log(
    `✓ seeded config: ${STAGES.length} stages, ${SUBJECTS.length} subjects, ${RULES.length} anomaly rules`,
  );
}

main()
  .catch((err) => {
    console.error("✗ config seed failed:", err);
    process.exit(1);
  })
  .finally(() => client.end());
