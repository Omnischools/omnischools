import { createHash } from "node:crypto";

/**
 * The RSVP token seam (INCR #298 part B). The raw token is NEVER persisted — only this SHA-256 hex is
 * stored in `boarding_visit_rsvp_token.token_hash` and used as the public lookup key. Shared by the
 * server action (issue + public submit) and the public page so both hash identically.
 */
export const hashRsvpToken = (raw: string): string =>
  createHash("sha256").update(raw).digest("hex");

/** Per-token wrong-DOB attempts before the link locks — the brute-force fence on the low-entropy factor. */
export const DOB_ATTEMPT_CAP = 8;
