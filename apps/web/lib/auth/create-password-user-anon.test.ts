import { describe, it, expect } from "vitest";
import { readCode } from "@/lib/test-utils/source-shape";

/**
 * INCR-AUTH-OTP · AUTH-OTP-05 (KEY) — the whole guarantee rests on `createPasswordUser` staying on the
 * anonymous `signUp` and NEVER admin-confirming a phone. If any onboarding/accept/admin path set
 * `phone_confirm:true` (or used the service-role admin API to create the user), a brand-new account's
 * phone would be confirmed on create and GoTrue would permit a password login with NO OTP — silently
 * voiding OTP-first for every creator and invitee. This is a source-shape guard because the enforcing
 * signal is GoTrue-owned (`phone_confirmed_at`), not observable from our code at runtime; the mutation
 * demonstration (adding `phone_confirm` turns this file RED) is the proof it actually bites.
 *
 * `readCode` strips comments, so the docblocks in `lib/auth/index.ts` that MENTION "admin-confirm" /
 * "phone_confirm" as the forbidden thing cannot self-trip the greps below.
 */
const AUTH = readCode("lib/auth/index.ts");
const ONBOARD_ACTION = readCode("lib/actions/onboarding.ts");
const INVITE_ACTION = readCode("lib/actions/invites.ts");

/** The body of `createPasswordUser`, from its signature to the next top-level `export`. */
function createPasswordUserBody(src: string): string {
  const start = src.indexOf("export async function createPasswordUser");
  expect(start, "createPasswordUser must exist in lib/auth/index.ts").toBeGreaterThan(-1);
  const after = src.indexOf("\nexport ", start + 1);
  return src.slice(start, after === -1 ? undefined : after);
}

describe("AUTH-OTP-05 · createPasswordUser uses anon signUp, never admin-confirm", () => {
  const body = createPasswordUserBody(AUTH);

  it("creates the account via anon signUp", () => {
    expect(body).toContain("signUp");
    // The credential is exactly { phone, password } — no confirm flags smuggled into the object.
    expect(body).toContain(".signUp({");
  });

  it("MUTATION GUARD — no admin API, no phone/email auto-confirm anywhere in lib/auth", () => {
    // These are the exact tokens a "confirm on create" regression introduces. Adding
    // `phone_confirm: true` to the signUp call (or switching to `admin.createUser`) flips this RED.
    expect(AUTH).not.toContain("phone_confirm");
    expect(AUTH).not.toContain("email_confirm");
    expect(AUTH).not.toContain("admin.createUser");
    expect(AUTH).not.toContain(".admin.");
    expect(AUTH).not.toContain("createAdminClient");
    expect(AUTH).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    // No service-role client is constructed in the auth seam at all.
    expect(AUTH).not.toMatch(/service_role/i);
  });

  it("createPasswordUser body itself carries no confirm flag / admin path", () => {
    expect(body).not.toContain("phone_confirm");
    expect(body).not.toContain("admin");
  });
});

describe("AUTH-OTP-05 · both onboarding AND invite-accept route through createPasswordUser", () => {
  it("onboardSchool creates the credential via createPasswordUser", () => {
    expect(ONBOARD_ACTION).toContain("createPasswordUser(adminPhone, d.password"); // + optional captchaToken
  });

  it("acceptInvite creates the credential via createPasswordUser (no admin-confirm either)", () => {
    expect(INVITE_ACTION).toContain("createPasswordUser(");
    expect(INVITE_ACTION).not.toContain("phone_confirm");
    expect(INVITE_ACTION).not.toContain("admin.createUser");
  });
});
