/**
 * GES staff-record consent — the SINGLE SOURCE for the canonical consent-statement version and its
 * exact wording, plus the two pure helpers the page/action/panel share. Imported by BOTH the client
 * panel (to render the copy the grantor agrees to) AND the server action (to stamp the version stored
 * on the row): one source means the stored `consent_statement_version` and the displayed text can
 * never drift — the DPA (Act 843) defence.
 *
 * ⚠ OC-1: the exact wording is PENDING DPO / owner ratification. When it changes, BUMP the version
 * string (a grant recorded under one version must always map back to that exact text). The version
 * string itself is stable and safe to persist now.
 *
 * Pure module — no DB, no server-only imports. Client- and server-safe.
 */
import { rankOf } from "@/lib/access";

/** Bump when the statement wording below changes (OC-1). */
export const CONSENT_STATEMENT_VERSION = "v1-2026-09";

/**
 * A run of statement text. `school` renders the school name (bold); `bold` renders emphasised copy;
 * a bare string is plain body text. The panel maps these to spans — one structure, so the bold spans
 * required by the surface map (§5.1) can't be lost in a hand-transcription.
 */
export type StatementSegment = string | { bold: string } | { school: true };

/**
 * The canonical consent statement (version v1-2026-09), three paragraphs — reproduced
 * character-for-character from the surface map §5.1. Every bold span is preserved.
 */
export const CONSENT_STATEMENT_PARAGRAPHS: readonly (readonly StatementSegment[])[] = [
  [
    "On behalf of ",
    { school: true },
    ", I authorise the Ghana Education Service (GES) and the Ministry of Education (MoE), as statutory education regulators, to view — through Omnischools Oversight's gated, audit-logged access path — the individual staff record of a named member of this school's ",
    { bold: "non-teaching staff, and of any staff member who is not on the GES establishment register" },
    ". Every such access is logged with the accessing officer, the stated reason, and the exact fields released.",
  ],
  [
    { bold: "This consent does NOT cover, and nothing here changes:" },
    " aggregate/statistical reporting (statutory, always in effect); any student record (students are never individually visible to GES); GES-licensed teachers on the establishment register (statutory oversight, independent of this consent).",
  ],
  [
    "I confirm I am authorised to grant this for ",
    { school: true },
    ". It can be ",
    { bold: "withdrawn at any time with immediate effect" },
    " from this page.",
  ],
];

/** Consent state the panel renders, derived server-side from the current-state row. */
export type ConsentState = "NONE" | "GRANTED" | "REVOKED";

/**
 * Derive the panel state from the current-state consent row. No row ⇒ NONE; a live grant
 * (GRANTED with no revoked_at) ⇒ GRANTED; anything else ⇒ REVOKED (belt-and-braces: revoked_at set
 * means REVOKED even if `state` somehow reads GRANTED, matching Oversight's fail-closed read).
 */
export function deriveConsentState(
  row: { state: string; revokedAt: Date | string | null } | null | undefined,
): ConsentState {
  if (!row) return "NONE";
  if (row.state === "GRANTED" && row.revokedAt == null) return "GRANTED";
  return "REVOKED";
}

/**
 * The role to STAMP on the grant/withdraw (granted_by_role / actor_role). Server-derived from the
 * session's held roles: the highest-ranked role the caller holds that is in the action's allow-list —
 * never the client, never blindly `roles[0]`. Ties (ADMIN & HEADMASTER are rank peers) resolve by
 * allow-list order (stable sort), so an ADMIN+HEADMASTER caller stamps the first allow-list entry.
 * Returns null only if the caller holds none of the allowed roles — which `assertAnyRole` already
 * precludes at the action's top.
 */
export function highestRankedRole(
  sessionRoles: readonly string[],
  allowed: readonly string[],
): string | null {
  const matched = allowed.filter((r) => sessionRoles.includes(r));
  if (matched.length === 0) return null;
  return [...matched].sort((a, b) => rankOf([b]) - rankOf([a]))[0] ?? null;
}
