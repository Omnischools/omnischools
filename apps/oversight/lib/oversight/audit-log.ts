import { sql } from "drizzle-orm";
import { withJurisdiction, type JurisdictionScope } from "@/lib/db/rls";

/**
 * READING the access & audit log (Lucy §A1.3 own-history, §A2 the log, C6 the new columns).
 *
 * Read-only, and analytics-only: the log lives in the analytics DB and this module never touches
 * the operational read-back. Rendering an audit ENTRY must never re-open the record it describes —
 * that would turn every page refresh into a fresh access, and a log that grows when you read it is
 * not a log. The entry view shows the entry.
 *
 * Visibility is the `audit_scope` RLS policy, not a WHERE clause here: an officer sees their own
 * rows plus their jurisdiction subtree. Writing the filter in SQL as well would be a second,
 * divergeable copy of the rule.
 */

export interface AuditLogEntry {
  accessId: string;
  officerId: string;
  officerRole: string;
  reasonCode: string;
  caseReference: string | null;
  recordType: string;
  targetRef: string;
  fieldsReleased: string[];
  legalBasis: "STATUTORY" | "CONSENT";
  consentRef: string | null;
  outcome: string;
  staffCategory: string | null;
  rosterBrowsed: boolean;
  exported: boolean;
  exportFormat: string | null;
  reviewStatus: string;
  occurredAt: string;
}

const SELECT = sql`
  select access_id::text     as access_id,
         officer_id::text    as officer_id,
         officer_role        as officer_role,
         reason_code         as reason_code,
         case_reference      as case_reference,
         record_type::text   as record_type,
         target_ref          as target_ref,
         coalesce(fields_released, '[]'::jsonb) as fields_released,
         legal_basis::text   as legal_basis,
         consent_ref::text   as consent_ref,
         outcome::text       as outcome,
         staff_category      as staff_category,
         roster_browsed      as roster_browsed,
         exported            as exported,
         export_format       as export_format,
         review_status::text as review_status,
         occurred_at::text   as occurred_at
  from audit_access_log
`;

function rowsOf(result: unknown): Record<string, unknown>[] {
  return (
    Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])
  ) as Record<string, unknown>[];
}

function mapRow(row: Record<string, unknown>): AuditLogEntry {
  return {
    accessId: row.access_id as string,
    officerId: row.officer_id as string,
    officerRole: row.officer_role as string,
    reasonCode: row.reason_code as string,
    caseReference: (row.case_reference as string | null) ?? null,
    recordType: row.record_type as string,
    targetRef: row.target_ref as string,
    fieldsReleased: (row.fields_released as string[] | null) ?? [],
    legalBasis: row.legal_basis as "STATUTORY" | "CONSENT",
    consentRef: (row.consent_ref as string | null) ?? null,
    outcome: row.outcome as string,
    staffCategory: (row.staff_category as string | null) ?? null,
    rosterBrowsed: Boolean(row.roster_browsed),
    exported: Boolean(row.exported),
    exportFormat: (row.export_format as string | null) ?? null,
    reviewStatus: row.review_status as string,
    occurredAt: row.occurred_at as string,
  };
}

/** Lucy §A1.3 — the officer's own accesses, most recent first. */
export async function listOwnAccesses(
  scope: JurisdictionScope,
  limit = 50,
): Promise<AuditLogEntry[]> {
  return withJurisdiction(scope, async (tx) => {
    const result = await tx.execute(
      sql`${SELECT} where officer_id = ${scope.officerId ?? ""}::uuid
          order by occurred_at desc limit ${limit}`,
    );
    return rowsOf(result).map(mapRow);
  });
}

/** Lucy §A2.2 — one entry. Null when it does not exist or is outside the reader's scope. */
export async function getAccessEntry(
  scope: JurisdictionScope,
  accessId: string,
): Promise<AuditLogEntry | null> {
  return withJurisdiction(scope, async (tx) => {
    const result = await tx.execute(
      sql`${SELECT} where access_id = ${accessId}::uuid limit 1`,
    );
    const row = rowsOf(result)[0];
    return row ? mapRow(row) : null;
  });
}
