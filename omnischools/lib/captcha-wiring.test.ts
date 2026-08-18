import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readCode } from "@/lib/test-utils/source-shape";

/**
 * INCR-AUTH-CAPTCHA (audit #4) — the token threads through the `lib/auth` seam into `options.captchaToken`
 * on every friction endpoint, and each entry-point action + form forwards it. This is an UN-DEMOABLE
 * feature (widget inert without a site key, auth inert under dev-bypass, Turnstile is an external
 * Cloudflare service, the dev server runs a different worktree), so it is proven by source-shape (the
 * house instrument, same as auth-l3) PLUS one runtime proof that the token actually reaches Supabase.
 * `readCode` strips comments so the INCR-AUTH-CAPTCHA docblocks don't self-trip the greps.
 */
const SEAM = readCode("lib/auth/index.ts");
const AUTH_ACTION = readCode("lib/actions/auth.ts");
const INVITE_ACTION = readCode("lib/actions/invites.ts");
const ONBOARD_ACTION = readCode("lib/actions/onboarding.ts");
const ONBOARD_SCHEMA = readCode("lib/onboarding.ts");

/** The body of an `export async function NAME`, up to the next top-level `export` (matches auth-l3). */
function body(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}`);
  if (start === -1) return "";
  const after = src.indexOf("\nexport ", start + 1);
  return src.slice(start, after === -1 ? undefined : after);
}

/* -------------------------------------------------- item 2 · the lib/auth seam */

describe("seam · the 4 friction fns forward options.captchaToken (source)", () => {
  const OPTS = "options: captchaToken ? { captchaToken } : undefined";

  it("signInWithPhone(phone, captchaToken?) → signInWithOtp with options", () => {
    const b = body(SEAM, "signInWithPhone");
    expect(b).toContain("captchaToken?: string");
    expect(b).toContain(".signInWithOtp({");
    expect(b).toContain(OPTS);
  });

  it("createPasswordUser(phone, password, captchaToken?) → signUp with options", () => {
    const b = body(SEAM, "createPasswordUser");
    expect(b).toContain("captchaToken?: string");
    expect(b).toContain(".signUp({");
    expect(b).toContain(OPTS);
  });

  it("signInWithPassword(phone, password, captchaToken?) → signInWithPassword with options", () => {
    const b = body(SEAM, "signInWithPassword");
    expect(b).toContain("captchaToken?: string");
    expect(b).toContain(".signInWithPassword({");
    expect(b).toContain(OPTS);
  });

  it("sendPasswordResetEmail(email, redirectTo, captchaToken?) → resetPasswordForEmail spreads the token", () => {
    const b = body(SEAM, "sendPasswordResetEmail");
    expect(b).toContain("captchaToken?: string");
    expect(b).toContain(".resetPasswordForEmail(email, {");
    // different shape — a second positional-options arg, so the token is spread in, not nested under options
    expect(b).toContain("...(captchaToken ? { captchaToken } : {})");
  });

  it("verifyPhoneOtp is NOT captcha-gated — the verify step takes no token", () => {
    const b = body(SEAM, "verifyPhoneOtp");
    expect(b).toContain(".verifyOtp({");
    expect(b).not.toContain("captchaToken"); // no param, no options, no forwarding
  });
});

/* ---------------------------------------------- item 3a · the entry-point actions */

describe("actions · each entry-point accepts + forwards the token (source)", () => {
  it("requestOtp forwards the token to signInWithPhone", () => {
    const b = body(AUTH_ACTION, "requestOtp");
    expect(b).toContain("captchaToken?: string");
    expect(b).toContain("signInWithPhone(phone, captchaToken)");
  });

  it("passwordLogin forwards the token to signInWithPassword", () => {
    const b = body(AUTH_ACTION, "passwordLogin");
    expect(b).toContain("captchaToken?: string");
    expect(b).toContain("signInWithPassword(phone, password, captchaToken)");
  });

  it("requestPasswordReset forwards the token to sendPasswordResetEmail", () => {
    const b = body(AUTH_ACTION, "requestPasswordReset");
    expect(b).toContain("captchaToken?: string");
    expect(b).toContain("sendPasswordResetEmail(email, redirectTo, input?.captchaToken)");
  });

  it("acceptInvite validates captchaToken on AcceptSchema and forwards it to createPasswordUser", () => {
    expect(INVITE_ACTION).toContain("captchaToken: z.string().optional()");
    const b = body(INVITE_ACTION, "acceptInvite");
    expect(b).toContain("captchaToken");
    expect(b).toContain("createPasswordUser(inv.phone, password, captchaToken)");
  });

  it("onboardSchool validates captchaToken on OnboardSchema and forwards d.captchaToken to createPasswordUser", () => {
    expect(ONBOARD_SCHEMA).toContain("captchaToken: z.string().optional()");
    expect(ONBOARD_ACTION).toContain("createPasswordUser(adminPhone, d.password, d.captchaToken)");
  });
});

/* -------------------------------------------------------- item 3b · the 4 forms */

const FORMS: { name: string; src: string; action: string }[] = [
  {
    name: "login-form",
    src: readCode("components/auth/login-form.tsx"),
    action: "requestOtp(phone, captcha.token || undefined)",
  },
  {
    name: "accept-form",
    src: readCode("components/auth/accept-form.tsx"),
    action: "acceptInvite({ token, password, captchaToken: captcha.token || undefined })",
  },
  {
    name: "reset-form",
    src: readCode("components/auth/reset-form.tsx"),
    action: "requestOtp(phone, captcha.token || undefined)",
  },
  {
    name: "wizard",
    src: readCode("components/onboarding/wizard.tsx"),
    action: "onboardSchool({ ...form, captchaToken: captcha.token || undefined })",
  },
];

describe("forms · every entry point renders the widget, guards, forwards + resets (source)", () => {
  for (const { name, src, action } of FORMS) {
    it(`${name} wires the shared captcha widget + hook`, () => {
      expect(src).toContain("const captcha = useCaptcha()");
      expect(src).toContain(
        "<CaptchaWidget onToken={captcha.setToken} resetKey={captcha.resetKey} />",
      );
      expect(src).toContain("captcha.missing()");
      expect(src).toContain("captcha.token || undefined"); // passes the token, undefined when unsolved
      expect(src).toContain("captcha.reset()"); // single-use token cleared after a failed attempt
    });

    it(`${name} blocks submit on captcha.missing() BEFORE calling the action`, () => {
      expect(src).toContain(action);
      expect(src.indexOf("captcha.missing()")).toBeLessThan(src.indexOf(action));
    });
  }
});

/* -------------------- item 2 (runtime) · the token actually reaches Supabase */

// Mock the Supabase server client so the seam's `authApi()` resolves to a capturing spy. `vi.hoisted`
// so the object exists when `vi.mock` is hoisted above the imports.
const supa = vi.hoisted(() => {
  const auth = {
    signUp: vi.fn(async () => ({ error: null })),
    signInWithPassword: vi.fn(async () => ({ error: null })),
    resetPasswordForEmail: vi.fn(async () => ({ error: null })),
  };
  return { auth, createClient: vi.fn(async () => ({ auth })) };
});
vi.mock("@/lib/supabase/server", () => ({ createClient: supa.createClient }));

describe("seam (runtime) · the token lands in the Supabase call, absent when unsolved", () => {
  beforeEach(() => {
    vi.resetModules();
    // Make authIsLive() true so the seam reaches authApi() (dev-bypass would no-op it).
    vi.stubEnv("AUTH_DEV_BYPASS", "false");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co");
    supa.auth.signUp.mockClear();
    supa.auth.signInWithPassword.mockClear();
    supa.auth.resetPasswordForEmail.mockClear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("createPasswordUser: token → options.captchaToken; no token → options undefined", async () => {
    const auth = await import("@/lib/auth");
    await auth.createPasswordUser("+233200000000", "password1", "TOK123");
    expect(supa.auth.signUp).toHaveBeenLastCalledWith(
      expect.objectContaining({ options: { captchaToken: "TOK123" } }),
    );
    // MUTATION GUARD: hardcode `options: undefined` in the seam and the token line above goes RED.
    await auth.createPasswordUser("+233200000000", "password1");
    expect(supa.auth.signUp).toHaveBeenLastCalledWith(
      expect.objectContaining({ options: undefined }),
    );
  });

  it("signInWithPassword: token → options.captchaToken; no token → options undefined", async () => {
    const auth = await import("@/lib/auth");
    await auth.signInWithPassword("+233200000000", "password1", "TOK123");
    expect(supa.auth.signInWithPassword).toHaveBeenLastCalledWith(
      expect.objectContaining({ options: { captchaToken: "TOK123" } }),
    );
    await auth.signInWithPassword("+233200000000", "password1");
    expect(supa.auth.signInWithPassword).toHaveBeenLastCalledWith(
      expect.objectContaining({ options: undefined }),
    );
  });

  it("sendPasswordResetEmail: token spread into the options arg; no token → redirectTo only", async () => {
    const auth = await import("@/lib/auth");
    await auth.sendPasswordResetEmail("head@school.gh", "https://site/auth/reset-callback", "TOK123");
    expect(supa.auth.resetPasswordForEmail).toHaveBeenLastCalledWith(
      "head@school.gh",
      { redirectTo: "https://site/auth/reset-callback", captchaToken: "TOK123" },
    );
    await auth.sendPasswordResetEmail("head@school.gh", "https://site/auth/reset-callback");
    expect(supa.auth.resetPasswordForEmail).toHaveBeenLastCalledWith(
      "head@school.gh",
      { redirectTo: "https://site/auth/reset-callback" }, // no captchaToken key
    );
  });
});
