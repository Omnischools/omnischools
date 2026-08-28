import { describe, it, expect } from "vitest";
import { readCode } from "@/lib/test-utils/source-shape";

/**
 * #307 — guardian email was captured on 3 surfaces but consumed by nothing. Now the parent-portal invite
 * ALSO delivers to the guardian's STORED email (student_guardian.email). The security invariant is
 * preserved: the email is resolved server-side from the guardian row (never caller free-text), and it is
 * DELIVERY ONLY — the OTP/claim destination + the phone-keyed claim stamping (AC C2/C4) stay the stored
 * phone, so email never becomes an alternate claim key (the #307 decision, default omit).
 */
const invites = () => readCode("lib/actions/invites.ts");
const parentData = () => readCode("lib/parent/parent-data.ts");

describe("#307 · guardian email is consumed by the parent invite", () => {
  it("resolveParentInviteTargetTx now selects + returns the stored guardian email", () => {
    const s = parentData();
    expect(s).toMatch(/email: studentGuardians\.email/); // selected from the stored row
    expect(s).toMatch(/email: g\.email/); // returned
    expect(s).toMatch(/email: string \| null/); // on the ParentInviteTarget type
  });

  it("the parent invite delivers to the STORED email, never a caller-supplied one", () => {
    const s = invites();
    // the parent branch sets the delivery email from the resolved target (stored), not from request input.
    expect(s).toMatch(/inviteEmail = target\.email/);
    expect(s).toMatch(/email: inviteEmail/); // the invite row stores that resolved email
    expect(s).toMatch(/to: inviteEmail/); // sendEmail delivers to it
    expect(s).toMatch(/if \(inviteEmail\)/); // guarded — no email, no send (console-degrades like SMS)
  });

  it("email is DELIVERY ONLY — the OTP/claim destination stays the stored phone (no claim-key change)", () => {
    const s = invites();
    // the SMS OTP/claim link still goes to the stored `phone`; the claim keying is untouched by this change.
    expect(s).toMatch(/phone = target\.phone/);
    expect(s).toMatch(/sendSms\(\s*\n?\s*phone,/);
    // no email-keyed claim: the accept/stamp path keys on phone (AC C4) — this file never stamps on email.
    expect(s).not.toMatch(/stamp.*email|email.*claim key/i);
  });
});
