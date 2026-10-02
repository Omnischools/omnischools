/**
 * Analytics-DB schema barrel for Omnischools Oversight (omnischools-analytics-prod).
 *
 * Three kinds of table (OVERSIGHT_ANALYTICS_SPEC §2):
 *   dim_*  — jurisdiction hierarchy, time, stage/subject vocabularies
 *   fact_* — pre-aggregated enrolment/attendance/performance/staffing/fees, one row per school/period
 *   ref_*  — data Omnischools does not generate (EMIS, GSS, WAEC, establishment, DSAs, anomaly rules)
 * plus etl_run and the append-only audit_access_log.
 *
 * `officer.ts` is the officer-auth pair (increment G): ref_oversight_officer (the live directory,
 * keyed by Supabase auth uid) and audit_officer_provisioning (append-only provisioning history).
 * Neither is jurisdiction-scoped, so neither takes the shared `jurisdiction_scope` policy — their
 * RLS is bespoke (db/sql/policies.sql, "officer auth").
 */
export * from "./_enums";
export * from "./dim";
export * from "./ref";
export * from "./audit";
export * from "./fact";
export * from "./officer";
