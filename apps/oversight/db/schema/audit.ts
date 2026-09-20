import { pgTable, uuid, text, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";
import { dimJurisdiction } from "./dim";
import { etlStatusEnum, recordTypeEnum, reviewStatusEnum } from "./_enums";

/**
 * etl_run — one row per nightly ETL run (§7). One run = one run_id stamped onto every row it
 * writes. The Oversight "as of" / "next sync" banner reads the latest SUCCESS run.
 */
export const etlRun = pgTable("etl_run", {
  runId: uuid("run_id").primaryKey().defaultRandom(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: etlStatusEnum("status").notNull().default("RUNNING"),
  errorText: text("error_text"),
});

/**
 * audit_access_log — the named-record audit trail (§6). APPEND-ONLY: a Postgres rule rejects
 * UPDATE/DELETE on existing rows (see db/sql/policies.sql); a review only ever INSERTs a linked
 * row. It lives in the analytics DB (GES-internal audit data, not school operational data) and is
 * the single table behind both the compliance view's own-history panel and the access & audit log
 * surface. An exported named record writes the SAME row with exported = true — leaving the platform
 * is the same logged event as viewing on screen.
 */
export const auditAccessLog = pgTable("audit_access_log", {
  accessId: uuid("access_id").primaryKey().defaultRandom(),
  officerId: uuid("officer_id").notNull(),
  officerRole: text("officer_role").notNull(),
  jurisdictionId: uuid("jurisdiction_id").references(() => dimJurisdiction.jurisdictionId),
  reasonCode: text("reason_code").notNull(),
  caseReference: text("case_reference"), // free text, stored verbatim
  recordType: recordTypeEnum("record_type").notNull(),
  targetRef: text("target_ref").notNull(),
  fieldsReleased: jsonb("fields_released"), // string[] of the fields the reason unlocked
  rosterBrowsed: boolean("roster_browsed").notNull().default(false),
  exported: boolean("exported").notNull().default(false),
  exportFormat: text("export_format"),
  reviewStatus: reviewStatusEnum("review_status").notNull().default("PENDING"),
  reviewNote: text("review_note"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
});
