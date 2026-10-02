import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/**
 * THE TWO-PERSON APPROVAL CODE (Kofi R7 · Lucy G8.d).
 *
 * ── THE PROBLEM, STATED HONESTLY ─────────────────────────────────────────────────────────────────
 * Lucy's G8.d describes an ASYNCHRONOUS two-person flow: a proposer submits, the proposal sits in an
 * "Awaiting approval" queue, a second administrator opens it later and approves. That needs a
 * PERSISTED PROPOSAL — proposer id, target node, timestamp, state — and Wells's schema has no table
 * for one. The two tables that exist are the live directory (whose only "not yet effective" state is
 * `is_active = false`, which is also what WITHDRAWN means — overloading it would make a pending
 * grant and a revoked one the same row) and the append-only provisioning LOG (whose rows are
 * historical facts about completed actions, not pending intentions; `action = 'PROVISION'` is also
 * CHECK-constrained to `active_after = true`).
 *
 * Inventing either shape here would be re-deciding the schema, which is not this role's call. So the
 * SYNCHRONOUS half of the rule is what ships, and it is a real two-person control rather than a
 * weakened one:
 *
 *   · the APPROVER, signed in to the admin console under their own Supabase identity, chooses WHICH
 *     ACTION they are approving (PROVISION or DEACTIVATE) and mints a short-lived approval code for
 *     that action against a specific (officer uid, node) pair;
 *   · the PROPOSER pastes it into the provision (or withdrawal) form;
 *   · the server verifies the signature, the action, the pair, the expiry AND that the two uids
 *     differ, then writes the directory row and the audit row — naming both administrators — in ONE
 *     transaction.
 *
 * Two distinct, independently-authenticated administrators are therefore required for every
 * REGION/NATIONAL grant, and the provisioning log records both. What is NOT built is the queue: a
 * proposal cannot be left pending for someone to find later. That is a UX gap, deliberately
 * reported rather than papered over — it needs a `provisioning_proposal` table from Wells.
 *
 * ── WHY HMAC AND NOT A ROW ───────────────────────────────────────────────────────────────────────
 * Portability (no KV, no platform session store — the code is a signed string) and because a code
 * that cannot be stored cannot be stolen from storage. It is bound to the exact action it
 * authorises, so it is useless for any other action, node or officer, and it expires in minutes.
 */

/** Short: an approval is a decision taken now, not a standing permission. */
export const APPROVAL_CODE_TTL_MS = 15 * 60_000;

export class ApprovalCodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprovalCodeError";
  }
}

/**
 * WHICH ACTION a code approves (security finding S2a).
 *
 * Before this existed the signature covered (approver, officer, node, expiry) and nothing else, so
 * the two paths that verify a code — provisioning an officer and withdrawing one — verified against
 * the SAME payload. A code an approver minted to approve a grant therefore also satisfied a
 * withdrawal of the same officer at the same node, and the reverse: one administrator's signature on
 * one decision was silently reusable for the opposite decision. An approval has to say what it
 * approves, so the verb is a signed field and a mismatch is a refusal.
 *
 * There is NO default. A missing or unrecognised action refuses to mint and refuses to verify,
 * because the only safe reading of "an approval that does not say what it approves" is "not an
 * approval" — a default of either value would make the other action approvable by omission.
 */
export type ApprovalAction = "PROVISION" | "DEACTIVATE";

export function isApprovalAction(value: unknown): value is ApprovalAction {
  return value === "PROVISION" || value === "DEACTIVATE";
}

/** Parse an action from untrusted input (a form field, a caller without types). Fails closed. */
export function requireApprovalAction(
  value: unknown,
  label = "The approved action",
): ApprovalAction {
  if (!isApprovalAction(value)) {
    throw new ApprovalCodeError(
      `${label} must be either PROVISION or DEACTIVATE — it was ${JSON.stringify(value)}. An approval code names the one action it approves, and there is no default: approving "something" would approve both granting access and withdrawing it.`,
    );
  }
  return value;
}

export interface ApprovalPayload {
  /** WHICH action is approved. A PROVISION code never satisfies a DEACTIVATE, or the reverse. */
  action: ApprovalAction;
  /** The administrator who approves. Must differ from the proposer at verification time. */
  approverId: string;
  /** The officer uid being granted — the code is useless for any other. */
  targetOfficerId: string;
  /** The node being granted — likewise. */
  targetJurisdictionId: string;
  /** Expiry, ms since epoch. */
  expiresAtMs: number;
}

function secret(): string {
  const raw = env.PROVISIONING_APPROVAL_SECRET?.trim();
  if (!raw || raw.length < 32) {
    throw new ApprovalCodeError(
      "PROVISIONING_APPROVAL_SECRET is not configured (or is shorter than 32 characters). REGION/NATIONAL provisioning requires a second administrator's signed approval, so with no secret it refuses — fail closed.",
    );
  }
  return raw;
}

function body(payload: ApprovalPayload): string {
  // A fixed field order and a separator that cannot appear in a uuid, a number or either action
  // literal, so two different payloads can never serialise to the same string (the canonicalisation
  // bug that makes signed tokens forgeable). The action goes FIRST and is drawn from a closed
  // two-value vocabulary: it cannot absorb or be absorbed by a neighbouring field, so adding it
  // cannot make a (PROVISION, x, y) payload collide with a (DEACTIVATE, x', y') one.
  return [
    payload.action,
    payload.approverId.toLowerCase(),
    payload.targetOfficerId.toLowerCase(),
    payload.targetJurisdictionId.toLowerCase(),
    String(payload.expiresAtMs),
  ].join("|");
}

function sign(payloadBody: string): string {
  return createHmac("sha256", secret()).update(payloadBody).digest("base64url");
}

/**
 * Mint a code. Called ONLY from the approver's own authenticated admin session.
 *
 * The action is re-parsed rather than trusted to the type: the one caller that mints reads it from a
 * form, and a `string` that slipped past the compiler must not become a signed assertion.
 */
export function mintApprovalCode(
  payload: Omit<ApprovalPayload, "expiresAtMs">,
  now: number = Date.now(),
): string {
  const action = requireApprovalAction(payload.action, "The action being approved");
  const full: ApprovalPayload = {
    ...payload,
    action,
    expiresAtMs: now + APPROVAL_CODE_TTL_MS,
  };
  const payloadBody = body(full);
  return `${Buffer.from(payloadBody, "utf8").toString("base64url")}.${sign(payloadBody)}`;
}

/**
 * Verify a code against the action it is being used for.
 *
 * EVERY check is a refusal, and the order matters only in that the signature is checked before
 * anything is believed: an unsigned payload's fields are attacker-chosen, so reading the approver id
 * out of one before verifying would be trusting the attacker's choice of approver.
 *
 * `expected.action` is the verb the CALLER is about to perform, not one read from the code — that is
 * the whole point: the code says what was approved, the call site says what is happening, and they
 * have to agree.
 */
export function verifyApprovalCode(
  code: string,
  expected: {
    action: ApprovalAction;
    targetOfficerId: string;
    targetJurisdictionId: string;
    proposerId: string;
  },
  now: number = Date.now(),
): ApprovalPayload {
  const expectedAction = requireApprovalAction(
    expected.action,
    "The action being performed",
  );
  const parts = (code ?? "").trim().split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new ApprovalCodeError("That approval code is not in the expected format.");
  }
  const payloadBody = Buffer.from(parts[0], "base64url").toString("utf8");

  const expectedSig = Buffer.from(sign(payloadBody), "utf8");
  const givenSig = Buffer.from(parts[1], "utf8");
  // Constant-time, and length-checked first because timingSafeEqual throws on a length mismatch.
  if (expectedSig.length !== givenSig.length || !timingSafeEqual(expectedSig, givenSig)) {
    throw new ApprovalCodeError(
      "That approval code failed verification — it was not issued by this system.",
    );
  }

  // Exactly five fields, or it is not a payload this version issued. A code minted before the
  // action became a signed field splits into four and is refused here rather than being read with a
  // field missing — which is the fail-closed direction: an old code approved an unstated action.
  const fields = payloadBody.split("|");
  const [actionRaw, approverId, targetOfficerId, targetJurisdictionId, expiresRaw] =
    fields;
  const expiresAtMs = Number(expiresRaw);
  if (
    fields.length !== 5 ||
    !isApprovalAction(actionRaw) ||
    !approverId ||
    !targetOfficerId ||
    !targetJurisdictionId ||
    !Number.isFinite(expiresAtMs)
  ) {
    throw new ApprovalCodeError("That approval code is malformed.");
  }
  const action: ApprovalAction = actionRaw;

  if (expiresAtMs < now) {
    throw new ApprovalCodeError(
      "That approval code has expired. Ask the approving administrator for a fresh one — an approval is a decision taken now, not a standing permission.",
    );
  }
  if (action !== expectedAction) {
    throw new ApprovalCodeError(
      `That approval code approves a ${action === "PROVISION" ? "PROVISION (granting access)" : "DEACTIVATE (withdrawing access)"}, not a ${expectedAction}. An approver signs ONE decision — approving that someone be given a region does not also approve taking it away, or the reverse.`,
    );
  }
  if (targetOfficerId !== expected.targetOfficerId.toLowerCase()) {
    throw new ApprovalCodeError(
      "That approval code was issued for a DIFFERENT officer. A code authorises one action against one officer at one node.",
    );
  }
  if (targetJurisdictionId !== expected.targetJurisdictionId.toLowerCase()) {
    throw new ApprovalCodeError(
      "That approval code was issued for a DIFFERENT jurisdiction. A code authorises one action against one officer at one node.",
    );
  }
  if (approverId === expected.proposerId.toLowerCase()) {
    throw new ApprovalCodeError(
      "You cannot approve your own proposal. A REGION or NATIONAL grant needs a second administrator — a one-person two-person rule is the failure this closes.",
    );
  }

  return { action, approverId, targetOfficerId, targetJurisdictionId, expiresAtMs };
}
