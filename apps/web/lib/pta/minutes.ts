/**
 * PTA minutes decision core (SHS module 4.7 / INCR-53) — PURE, DB-free, unit-tested (minutes.test.ts).
 * The lib/pta/meeting-access.ts analogue for the minutes record: minutes-data.ts / actions/pta-minutes.ts
 * load the tenant-scoped rows and call these functions, so every load-bearing rule (the R451 immutability
 * fence, the R452 quorum→resolution gate, the R455 submit validation, the R453 resolution numbering, the
 * Chair adopt-access) is provable without a database — the officers.ts / points.ts discipline.
 *
 * Nothing here touches the DB or `now()`; the actions inject the loaded values + the clock predicates
 * (lib/pta/meeting-clock.ts) so the decisions stay deterministic.
 */
import { canActAsPtaOfficer, hasAnyRole, PTA_MEETING_BREAKGLASS_ROLES } from "@/lib/access";
import type { PtaTierType } from "./defaults";

export type MinutesStatus = "DRAFT" | "CHAIR_REVIEW" | "ADOPTED";
export type Classification = "DISCUSSION" | "ACTION" | "RESOLUTION";

/** The office that ADOPTS minutes (R450). A stored PTA officer, never ex-officio (the mirror of the
 *  Secretary being the drafter). The convene/emergency path already hard-codes "Chair" — same name. */
export const CHAIR_OFFICE = "Chair";

// ── R451 — the ADOPTED-is-TOTAL-immutable fence ──────────────────────────────────────────────────────

/** True once the minutes reach the terminal, immutable ADOPTED state (R451). */
export function isAdopted(status: MinutesStatus | string): boolean {
  return status === "ADOPTED";
}

/**
 * 🔴 R451 — the module's immutability fence. Returns the refusal message iff the parent minute is ADOPTED,
 * else null. EVERY mutating action on a minute or ANYWHERE in its agenda-item / action / resolution subtree
 * calls this after loading the parent status: an adopted minute admits ZERO mutation (no UPDATE/DELETE of
 * the minute, no UPDATE/DELETE/INSERT of a child). Corrections happen by a FUTURE amending minute — there is
 * deliberately no unlock. `markDistributed` is the ONE exception (it stamps distributed_at on an adopted
 * minute, R458) and therefore does NOT call this.
 */
export function adoptedFenceError(status: MinutesStatus | string): string | null {
  return isAdopted(status)
    ? "These minutes are adopted and locked — corrections happen by a future amending minute."
    : null;
}

// ── R452 — the quorum → resolution gate ──────────────────────────────────────────────────────────────

/**
 * A `pta_resolution` (and classifying an agenda item as RESOLUTION) is permitted ONLY when the meeting's
 * `quorum_met` is strictly TRUE (R452 — NULL/false refused). Drafting the rest of the minutes is quorum-
 * INDEPENDENT; only the binding-decision path is gated. Returns the refusal message or null.
 */
export function resolutionQuorumError(quorumMet: boolean | null): string | null {
  return quorumMet === true
    ? null
    : "A resolution needs a confirmed quorum — the Secretary must record quorum as met first.";
}

// ── R448 — derived resolution outcome + vote presence ────────────────────────────────────────────────

/** PASSED ⟺ votes_for > votes_against (R448, DERIVED — never stored). */
export function resolutionOutcome(
  votesFor: number,
  votesAgainst: number,
): "PASSED" | "NOT_PASSED" {
  return votesFor > votesAgainst ? "PASSED" : "NOT_PASSED";
}

/** A vote was actually recorded — for R455 (a RESOLUTION with an all-zero tally hasn't been voted on). */
export function resolutionHasVotes(
  votesFor: number,
  votesAgainst: number,
  votesAbstain: number,
): boolean {
  return votesFor + votesAgainst + votesAbstain > 0;
}

// ── R447 — the action-item owner XOR ────────────────────────────────────────────────────────────────

/** Exactly-one owner: a `person_user_id` XOR a non-empty `external_name` (R447). Null when valid. */
export function ownerXorError(
  personUserId: string | null | undefined,
  externalName: string | null | undefined,
): string | null {
  const hasUser = !!personUserId;
  const hasExternal = !!externalName && externalName.trim() !== "";
  if (hasUser === hasExternal) return "Pick exactly one owner — a person or an external name.";
  return null;
}

// ── R450 — the Chair adopt-access arm (identity, not a bare role) ────────────────────────────────────

/**
 * May the viewer ADOPT / return-to-draft these minutes (R450)? break-glass role ∥ the PTA's "Chair" held
 * BY IDENTITY (a stored `pta_officer` row — server-loaded, never request-supplied). NO bare KnownAppRole
 * satisfies the officer arm ([[builds-widen-ratified-authz-and-self-bless]] fence): `canActAsPtaOfficer`
 * takes no `roles`, so only ADMIN / HEADMASTER reach it via the SEPARATE break-glass arm. A Chair of PTA-A
 * cannot adopt PTA-B — the caller passes only the offices held in the TARGET pta.
 */
export function computeChairAccess(args: {
  heldOffices: readonly string[];
  viewer: { userId: string | null; roles: readonly string[] };
}): boolean {
  if (hasAnyRole(args.viewer.roles, PTA_MEETING_BREAKGLASS_ROLES)) return true;
  return canActAsPtaOfficer({
    userId: args.viewer.userId,
    heldOffices: args.heldOffices,
    exOfficioOffices: [],
    office: CHAIR_OFFICE,
  });
}

// ── R455 — submit-for-review validation ──────────────────────────────────────────────────────────────

export interface AgendaItemForValidation {
  classification: Classification | null;
  /** the single ACTION child (present only when classified ACTION). */
  action: { hasOwner: boolean; hasDeadline: boolean } | null;
  /** the single RESOLUTION child (present only when classified RESOLUTION). */
  resolution: { hasVotes: boolean } | null;
}

export interface MinutesValidation {
  totalItems: number;
  classifiedCount: number;
  allClassified: boolean;
  totalActions: number;
  actionsOwned: number;
  everyActionOwned: boolean;
  /** ADVISORY (R455 — Ongoing is legal, never blocks). */
  actionsWithDeadline: number;
  totalResolutions: number;
  resolutionsVoted: number;
  everyResolutionVoted: boolean;
  quorumMet: boolean | null;
  quorumOkForResolutions: boolean;
  canSubmit: boolean;
  /** The first blocking reason (the submit-action error), or null when submit is allowed. */
  blocker: string | null;
}

/**
 * R455 — DRAFT→CHAIR_REVIEW validation: (a) every item classified; (b) every ACTION has an owner; (c) every
 * RESOLUTION has its vote tally recorded AND `quorum_met=true`. The deadline is ADVISORY (Ongoing is legal),
 * so it is counted but never gates. Shared by the validator side-panel (read) and `submitForReview` (write).
 */
export function validateMinutesForReview(
  items: AgendaItemForValidation[],
  quorumMet: boolean | null,
): MinutesValidation {
  const totalItems = items.length;
  const classifiedCount = items.filter((i) => i.classification != null).length;
  const allClassified = items.every((i) => i.classification != null);

  const actionItems = items.filter((i) => i.classification === "ACTION");
  const totalActions = actionItems.length;
  const actionsOwned = actionItems.filter((i) => i.action?.hasOwner === true).length;
  const everyActionOwned = actionItems.every((i) => i.action?.hasOwner === true);
  const actionsWithDeadline = actionItems.filter((i) => i.action?.hasDeadline === true).length;

  const resItems = items.filter((i) => i.classification === "RESOLUTION");
  const totalResolutions = resItems.length;
  const resolutionsVoted = resItems.filter((i) => i.resolution?.hasVotes === true).length;
  const everyResolutionVoted = resItems.every((i) => i.resolution?.hasVotes === true);
  const quorumOkForResolutions = totalResolutions === 0 || quorumMet === true;

  const canSubmit =
    allClassified && everyActionOwned && everyResolutionVoted && quorumOkForResolutions;

  const blocker = !allClassified
    ? "Every agenda item must be classified before you submit."
    : !everyActionOwned
      ? "Every action item needs an owner before you submit."
      : !everyResolutionVoted
        ? "Every resolution needs its vote counts recorded before you submit."
        : !quorumOkForResolutions
          ? "Resolutions were recorded, but quorum isn't confirmed as met."
          : null;

  return {
    totalItems,
    classifiedCount,
    allClassified,
    totalActions,
    actionsOwned,
    everyActionOwned,
    actionsWithDeadline,
    totalResolutions,
    resolutionsVoted,
    everyResolutionVoted,
    quorumMet,
    quorumOkForResolutions,
    canSubmit,
    blocker,
  };
}

// ── R453 — resolution numbering (assigned AT ADOPTION, per pta × academic period) ────────────────────

const RES_SEQ_RE = /-(\d+)$/;

/** Parse the trailing NNN off a `{scope}-{period}-{NNN}` resolution_no. Null when it doesn't match. */
export function parseResolutionSeq(no: string | null | undefined): number | null {
  const m = RES_SEQ_RE.exec(no ?? "");
  return m ? parseInt(m[1], 10) : null;
}

/** The next NNN = MAX over the existing adopted numbers (of this pta × period) + 1; starts at 1. */
export function nextResolutionSeqStart(existingNos: (string | null)[]): number {
  let max = 0;
  for (const n of existingNos) {
    const s = parseResolutionSeq(n);
    if (s != null && s > max) max = s;
  }
  return max + 1;
}

/** UPPER-slug a label into a resolution-number token: "Form 2 General Arts A" → "FORM-2-GENERAL-ARTS-A". */
export function slugToken(s: string | null | undefined): string {
  return (
    (s ?? "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "NA"
  );
}

/**
 * The `{scope}` token of a resolution number (R453). FORM = the class name, HOUSE = the House name,
 * GENERAL = "GENERAL" (a per-school singleton). EMERGENCY (or a missing scope name) falls back to a
 * pta-id-suffixed token so the school-level `UNIQUE(school_id, resolution_no)` stays collision-free even
 * when two on-demand Emergency PTAs number resolutions in the same period.
 * ponytail: pta-id suffix for the Emergency edge — the surface never numbers Emergency resolutions.
 */
export function resolutionScopeToken(
  tierType: PtaTierType,
  className: string | null,
  houseName: string | null,
  ptaId: string,
): string {
  if (tierType === "FORM" && className) return slugToken(className);
  if (tierType === "HOUSE" && houseName) return slugToken(houseName);
  if (tierType === "GENERAL") return "GENERAL";
  return `${tierType}-${(ptaId ?? "").slice(0, 8).toUpperCase()}`;
}

/** `{scope}-{period}-{NNN}` with NNN zero-padded to 3 (R453). */
export function formatResolutionNo(scopeToken: string, periodToken: string, seq: number): string {
  return `${scopeToken}-${periodToken}-${String(seq).padStart(3, "0")}`;
}
