import { readFileSync } from "node:fs";
import postgres from "postgres";
import { TEST_DB_CONFIG_PATH, type TestDbConfig } from "./setup/paths";
import { JUR, OFFICER } from "./fixtures/ids";
import type { OfficerSession } from "@/lib/oversight/officer";

export const testDbConfig = JSON.parse(
  readFileSync(TEST_DB_CONFIG_PATH, "utf8"),
) as TestDbConfig;

/**
 * A SUPERUSER connection, used ONLY by assertions.
 *
 * Audit rows are read back as the owner (RLS-exempt) on purpose: a test that read them through the
 * app role would be asserting "the officer can see their own row", which is a different claim from
 * "the row exists". When the point is that a DENIAL was written, the assertion must be able to see
 * every row, including ones no officer is entitled to.
 */
export function adminAnalytics(): postgres.Sql {
  return postgres(testDbConfig.superuserAnalyticsUrl, { max: 1, prepare: false });
}

export function adminOperational(): postgres.Sql {
  return postgres(testDbConfig.superuserOperationalUrl, { max: 1, prepare: false });
}

export interface AuditRow {
  access_id: string;
  officer_id: string;
  officer_role: string;
  jurisdiction_id: string | null;
  reason_code: string;
  case_reference: string | null;
  record_type: string;
  target_ref: string;
  fields_released: string[] | null;
  legal_basis: string;
  consent_ref: string | null;
  outcome: string;
  staff_category: string | null;
  roster_browsed: boolean;
  exported: boolean;
  export_format: string | null;
}

/** Every audit row written under one case reference, oldest first. */
export async function auditRowsFor(caseReference: string): Promise<AuditRow[]> {
  const sql = adminAnalytics();
  try {
    return (await sql`
      select access_id::text, officer_id::text, officer_role, jurisdiction_id::text,
             reason_code, case_reference, record_type::text, target_ref, fields_released,
             legal_basis::text, consent_ref::text, outcome::text, staff_category,
             roster_browsed, exported, export_format
      from audit_access_log
      where case_reference = ${caseReference}
      order by occurred_at asc, access_id asc
    `) as unknown as AuditRow[];
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function auditRowCount(): Promise<number> {
  const sql = adminAnalytics();
  try {
    const rows =
      (await sql`select count(*)::int as n from audit_access_log`) as unknown as {
        n: number;
      }[];
    return rows[0]!.n;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** A district director scoped to Wassa Amenfi West — the ordinary officer in the fixtures. */
export const districtOfficer: OfficerSession = {
  officerId: OFFICER.districtId,
  officerRole: OFFICER.role,
  jurisdictionId: JUR.district,
  level: "DISTRICT",
};

export const nationalOfficer: OfficerSession = {
  officerId: OFFICER.nationalId,
  officerRole: OFFICER.nationalRole,
  jurisdictionId: null,
  level: "NATIONAL",
};

/** Unique per test, so `auditRowsFor` isolates one test's rows from an append-only shared table. */
export function caseRef(label: string): string {
  return `CASE-${label}-${Math.random().toString(36).slice(2, 10)}`;
}
