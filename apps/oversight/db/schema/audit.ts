import { pgTable, uuid, text, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";
import { dimJurisdiction } from "./dim";
import {
  accessLegalBasisEnum,
  accessOutcomeEnum,
  etlStatusEnum,
  recordTypeEnum,
  reviewStatusEnum,
} from "./_enums";

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
 *
 * INDIVIDUAL DRILL-DOWN (E3). A row now also records the LEGAL BASIS claimed and the OUTCOME of the
 * request, so the log evidences the gate rather than only its successes:
 *   legal_basis    STATUTORY (GES-establishment teacher) | CONSENT (non-GES/non-teaching staff)
 *   consent_ref    the operational consent artefact relied on (NULL when STATUTORY)
 *   outcome        GRANTED, or the specific reason the boundary refused
 *   staff_category the server-derived subject class (GES_TEACHER | OTHER_STAFF)
 * All four are ADDITIVE columns; the append-only posture is unchanged (a correction is a new row).
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
  fieldsReleased: jsonb("fields_released"), // string[] of the fields the reason unlocked; [] on a denial

  // ---- lawful basis & outcome of the individual drill-down (§6) ----------------------------
  //
  // NOT NULL and DEFAULT-LESS on purpose. There is no safe default lawful basis: silently
  // defaulting to STATUTORY would let a caller that forgot to state its basis log a non-GES staff
  // access as though the law authorised it. The writer must name the basis explicitly or the INSERT
  // fails. (Same reasoning for outcome: an unstated outcome must not read as GRANTED.)
  legalBasis: accessLegalBasisEnum("legal_basis").notNull(),

  // The operational consent artefact (school_staff_oversight_consent.id) relied on. NULL exactly
  // when legal_basis = STATUTORY.
  //
  // ⚠ DELIBERATELY NO FOREIGN KEY. The consent table lives in the OPERATIONAL Postgres
  // (apps/web — see apps/web/Todo.md); this table lives in the analytics Postgres. Postgres cannot
  // enforce referential integrity across databases, so this is a recorded uuid, not a reference.
  // Two consequences to hold on to:
  //   1. Validity is checked at WRITE time, inside the gated read-back transaction, by reading the
  //      consent row live (state = 'GRANTED' AND revoked_at IS NULL). No cache.
  //   2. The value is an immutable HISTORICAL claim: later revocation of that consent must NOT
  //      rewrite this row (it is append-only), because the audit records what was relied on at the
  //      time, not what is true now. An auditor resolves it by looking the uuid up operationally.
  consentRef: uuid("consent_ref"),

  outcome: accessOutcomeEnum("outcome").notNull(),

  // Server-DERIVED subject class (GES_TEACHER | OTHER_STAFF), stored so a reviewer can read the row
  // without re-running the derivation against an establishment extract that may since have changed.
  // Free text rather than an enum: it is descriptive audit context, and the classification
  // vocabulary is expected to grow (e.g. NSS posting, contract staff) — widening it must never
  // require an ALTER TYPE on the audit table's write path.
  staffCategory: text("staff_category"),
  rosterBrowsed: boolean("roster_browsed").notNull().default(false),
  exported: boolean("exported").notNull().default(false),
  exportFormat: text("export_format"),
  reviewStatus: reviewStatusEnum("review_status").notNull().default("PENDING"),
  reviewNote: text("review_note"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
});
