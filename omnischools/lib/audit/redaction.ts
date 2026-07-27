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
  // Academic per-student marks (owner-confirmed 2026-07-26 — Sarah's audience correction): read-gated to
  // SENIOR_LEDGER_ROLES / WASSCE_SETUP_ROLES, which EXCLUDE Matron/Dean/Housemaster/Accountant/Bursar —
  // non-teaching staff who reach the feed. The score-correction reason is an unbounded teacher note
  // (e.g. a mark-down rationale). NOT the assessment/column CONFIG (senior_assessment/gradebook_column —
  // a test/column definition, no student mark), which stays shown.
  "senior_score_ledger", // per-student score + correction note
  "mock_result", // per-student mock grade + raw score
  "mock_result_moderation", // per-student moderated grade
  // Projected WASSCE aggregate + band in the audit `after` (wassce-readiness.ts:236) — mark-adjacent
  // (same class as the mock/score marks), read-gated WASSCE_SETUP_ROLES (excludes the 5 non-teaching
  // roles that reach the feed); the parent PDF even strips the band. NOT config despite the name (Sarah).
  "readiness_statement", // per-student projected aggregate/band
]);

/**
 * INCR-30 follow-up — the classify-at-creation ALLOW-LIST (Sarah's standing mitigation for the
 * hybrid deny-list's future-non-namespaced-entity residual, R239/R244).
 *
 * Every audited `entityType` deliberately SHOWN in the all-staff `/settings/audit` feed: operational
 * records ADMIN legitimately reads, config that carries no student mark, lower-tier boarding
 * logistics, and dev-only seed markers. Paired with `audit-classification.test.ts`, which sweeps the
 * repo for every audited entityType and FAILS the build if one is neither redacted nor listed here —
 * so a FUTURE sensitive audited entity cannot silently reach the feed.
 *
 * 🔴 INVARIANT: no member here may be redacted. A `sickbay_*` name or a `REDACTED_AUDIT_ENTITIES`
 * member must NEVER appear below (the guard asserts the two sets are disjoint). Redact iff read-gated
 * NARROWER than all-staff AND a confidentiality class (health/pay/discipline/marks); everything else
 * is SHOWN. This changes NO production behaviour — it is a registry the guard reads, nothing else.
 */
export const SHOWN_AUDIT_ENTITIES = new Set([
  // — core people & workspace records (operational; ADMIN reads) —
  "student", // roster record (name/class) — not a health/discipline record
  "student_batch", // bulk student import summary
  "staff", // staff record (employment/role) — not the pay row (staff_compensation is redacted)
  "staff_batch", // bulk staff import summary
  "staff_profile", // staff bio/contact, no compensation
  "class", // class definition
  "class_batch", // bulk class import summary
  "attendance", // attendance action (P/L/E/M/A code — no clinical detail; the M-not-A seam)
  "attendance_record", // a day's attendance mark; the M code carries no medical narrative
  "attendance_settings", // attendance config
  "admission_application", // applicant pipeline record (operational)
  "invite", // staff invite
  "user_account", // INCR-34 L2a — self password-change / admin reset-initiated event (actionType only, NEVER a value)
  "user_block", // INCR-35 L2b — block/activate event; fixed neutral reason (the admin's free-text stays on user_school_block, R240)
  "household_autogroup", // household grouping (operational)
  "school", // school profile / settings
  "school_year", // academic-year config
  "school_holiday", // calendar config
  "academic_period", // term/period config
  "conversation", // inbox thread (operational; content-less audit)
  "inbox_routing_rule", // inbox routing config
  "announcement", // broadcast announcement (operational comms)
  "sms_broadcast", // SMS broadcast (operational comms)
  "whatsapp_template", // WhatsApp template config
  // — finance & bookkeeping (operational; ADMIN / Accountant read) —
  "fee_structure", // fee config
  "discount", // discount config
  "invoice", // invoice (operational finance)
  "invoice_batch", // invoice-run summary
  "book_category", // bookkeeping category config
  "book_entry", // bookkeeping ledger entry (operational finance, not a student mark)
  "fixed_asset", // asset-register entry
  // — boarding config & logistics (lower-tier operational; owner left SHOWN at INCR-30) —
  "boarding_settings", // boarding config
  "daily_schedule_template", // boarding schedule config
  "house", // boarding house config
  "boarding_dormitory", // dormitory config
  "boarding_calendar_event", // boarding calendar (operational)
  "boarding_exeat", // exeat pass (logistics; owner-confirmed SHOWN — not the discipline triad)
  "boarding_visit", // visitor log (logistics; owner-confirmed SHOWN)
  "boarding_approved_visitor", // approved-visitor list (logistics)
  "boarding_arrival", // resumption arrival (logistics)
  "inspections", // dorm inspection (operational — not a disciplinary narrative)
  "prep_attendance", // prep-session attendance (operational)
  // — academic CONFIG & generation events (NO per-student mark in the diff; INCR-30 kept SHOWN) —
  "subject", // subject config
  "gradebook", // gradebook config
  "gradebook_column", // column/assessment DEFINITION — no student mark (the marks are redacted, not the column)
  "gradebook_config", // gradebook settings
  "grade_scale", // grade-scale config
  "senior_assessment", // SHS assessment DEFINITION (test/column config) — no student mark
  "senior_ledger_path", // capture-path config (class×subject×period → path); no mark
  "report_cards", // "generated N report cards" event — diff is {periodId, count}, no per-student mark
  "ledger_book", // blank paper-ledger PDF export — payload has counts only, no names/scores (route I2)
  "mock_exam", // mock-exam DEFINITION (the exam, not a result); mock results are redacted
  // NB: readiness_statement is REDACTED (its `after` carries a projected aggregate+band — mark-adjacent).
  "university_target", // student's university target (programme + rank; no band/aggregate — guidance, not a mark)
  // — VLC config spine (SHS module 4.5 / INCR-40) — operational config, NO pastoral PII (all three are
  // the programme cadence, the value list, and the session prompts). The pastoral graph (journal /
  // flags) lands at INCR-42/43 as a `vlc_pastoral_*` REDACTED family; these three are SHOWN. —
  "vlc_programme", // cadence + phase durations config
  "vlc_value", // taught-value name (EN/Twi) + term group
  "vlc_session_template", // per-value session title/prompt (curriculum copy, no student data)
  // — VLC Peer Guides (SHS module 4.5 / INCR-41) — OPERATIONAL student-leadership roster + training,
  // NO pastoral PII (R308). Peer Guides are a visible, prefect-like role the whole staff sees, not
  // confidential counselling; `ended_reason` is an operational note (welfare detail belongs to the
  // INCR-43 `vlc_pastoral_*` REDACTED family). NONE uses the reserved `vlc_pastoral_` prefix, so they
  // MUST be listed here explicitly or the classify-at-creation guard fails the build. —
  "vlc_peer_guide", // appointment roster row (student × class × period, ended_at open-row)
  "vlc_training", // Dean-authored training event (title/date/duration)
  "vlc_training_absence", // present-by-default training-attendance row (excused/note)
  // — VLC Session register (SHS module 4.5 / INCR-42a) — the OPERATIONAL Wednesday live-session register,
  // the same audit class as attendance / prep_attendance. NO pastoral PII (the confidential
  // vlc_pastoral_flag is INCR-42b). Neither uses the reserved `vlc_pastoral_` prefix, so both MUST be
  // listed here or the classify-at-creation guard fails the build (R316). —
  "vlc_session", // held-session instance (one per class × date; "held" = the row exists)
  "vlc_session_attendance", // present-by-default student P/L/A row (minutes_late/note)
  // — dev-only seed markers (idempotency / summary audit rows; never a real student record) —
  "wassce_cohort", // seed marker
  "boarding_spine", // seed marker
  "boarding_daily_seed", // seed marker
  "boarding_exeat_seed", // seed marker
  "boarding_discipline_seed", // seed marker (seed summary; real discipline uses the redacted triad)
  "boarding_visiting_seed", // seed marker
  "boarding_resumption_seed", // seed marker
]);

export function isRedactedAuditEntity(entityType: string | null | undefined): boolean {
  return !!entityType && (entityType.startsWith("sickbay_") || REDACTED_AUDIT_ENTITIES.has(entityType));
}

/** The neutral marker shown in place of a redacted entry's suppressed content (R241). */
export const REDACTED_MARKER = "Details restricted — sensitive record.";
/** Shorter marker for the §02 reason cell (a plain table cell, no diff to replace). */
export const REDACTED_REASON = "Details restricted";
