/**
 * INCR-30 — audit-feed redaction predicate (the ONE source of truth).
 *
 * `/settings/audit` renders to ALL staff behind the all-staff `requireSchool` gate, but some
 * audited entities are read-gated NARROWER than that (clinical = [HEADMASTER,MATRON], ADMIN barred
 * per D2/R166) and are a confidentiality-protected class (health / pay / discipline). For those the
 * feed BYPASSES the read boundary, so their before→after diff AND `reason` must be suppressed at the
 * render layer. Imported by BOTH render sites (§01 component + §02 page) so they cannot drift (AC9).
 *
 * The `sickbay_` prefix is deliberate (R239 fail-safe): a FUTURE `sickbay_*` entity redacts with no
 * code change — the clinical family is where the danger both concentrates and grows.
 */
export const REDACTED_AUDIT_ENTITIES = new Set([
  "student_nhis_card", // NHIS card = health identifier
  "waec_special_consideration", // SC-12 medical grounds
  "staff_compensation", // pay
  "boarding_infractions", // disciplinary narrative
  "bond_artefacts", // disciplinary
  "deboardinization_records", // disciplinary
]);

export function isRedactedAuditEntity(entityType: string | null | undefined): boolean {
  return !!entityType && (entityType.startsWith("sickbay_") || REDACTED_AUDIT_ENTITIES.has(entityType));
}

/** The neutral marker shown in place of a redacted entry's suppressed content (R241). */
export const REDACTED_MARKER = "Details restricted — sensitive record.";
/** Shorter marker for the §02 reason cell (a plain table cell, no diff to replace). */
export const REDACTED_REASON = "Details restricted";
