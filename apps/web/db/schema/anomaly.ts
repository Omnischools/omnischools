import { pgTable, uuid, text, jsonb, boolean } from "drizzle-orm/pg-core";
import { anomalySeverityEnum } from "./_enums";

/**
 * Shared anomaly-rule catalogue. Global reference (no tenant scope) — consumed by the
 * Vice-Headmaster Academic progress view and (later) the Oversight compliance queue.
 */
export const anomalyRules = pgTable("ref_anomaly_rule", {
  ruleId: uuid("rule_id").primaryKey().defaultRandom(),
  ruleCode: text("rule_code").notNull().unique(),
  severity: anomalySeverityEnum("severity").notNull(),
  description: text("description").notNull(),
  appliesTo: text("applies_to").notNull(), // e.g. SCORE_LEDGER, ATTENDANCE, STAFFING
  thresholdJson: jsonb("threshold_jsonb"),
  enabled: boolean("enabled").notNull().default(true),
});
