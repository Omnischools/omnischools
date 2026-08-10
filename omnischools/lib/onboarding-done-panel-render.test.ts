import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readCode } from "@/lib/test-utils/source-shape";
import { DonePanel } from "@/components/onboarding/wizard";
import type { OnboardResult } from "@/lib/onboarding";

/**
 * INCR-AUTH-OTP · AUTH-OTP-06/07/08 — the onboarding done phase. `DonePanel` renders the inline OTP
 * auto-sign-in card (`OnboardingOtpFinish`) IFF `result.otpLive`; a `/login` "Go to sign in" link is
 * ALWAYS present (both states), so a failed/skipped OTP can never orphan or block the just-created
 * school. `renderToStaticMarkup` runs the component in node with no jsdom — effects (the mount-time
 * `requestOtp`) do NOT fire, so the render proves the STRUCTURE (which card shows, which links exist);
 * the auto-send-once + verify→/dashboard wiring is proven at the SOURCE below.
 */
const okResult = (otpLive: boolean): Extract<OnboardResult, { ok: true }> => ({
  ok: true,
  schoolId: "sch_123",
  academicYear: "2025/26",
  periodsCreated: 3,
  adminPhone: "+233241234567",
  otpLive,
});

const render = (otpLive: boolean) =>
  renderToStaticMarkup(
    createElement(DonePanel, { result: okResult(otpLive), schoolName: "St. Theresa's SHS" }),
  );

const visible = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&apos;|&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

const LOGIN_HREF = 'href="/login?accepted=1"';

describe("AUTH-OTP-06 · otpLive=true renders the inline OTP auto-sign-in card", () => {
  const html = render(true);

  it("shows the OTP finish card wired to the creator's admin phone", () => {
    const text = visible(html);
    expect(text).toContain("Finish signing in — verify your number");
    expect(text).toContain("Verify & go to dashboard");
    expect(text).toContain("+233241234567"); // the effective admin phone from result.adminPhone
  });

  it("hides the plain 'Sign in →' button (the OTP card IS the sign-in action)", () => {
    // The top button is gated `!result.otpLive`; only the bottom 'Go to sign in' link remains.
    expect(visible(html)).not.toContain("Sign in →");
  });

  it("STILL exposes a /login link (no orphan/block) — AUTH-OTP-07", () => {
    expect(html).toContain(LOGIN_HREF);
    expect(visible(html)).toContain("Go to sign in");
  });
});

describe("AUTH-OTP-08 · otpLive=false renders NO OTP step, links to /login", () => {
  const html = render(false);

  it("does NOT render the OTP finish card", () => {
    expect(visible(html)).not.toContain("Finish signing in");
    expect(html).not.toContain("Verify & go to dashboard");
  });

  it("renders the plain 'Sign in →' terminal button to /login", () => {
    expect(visible(html)).toContain("Sign in →");
    expect(html).toContain(LOGIN_HREF);
  });

  it("also keeps the always-present 'Go to sign in' /login link", () => {
    expect(visible(html)).toContain("Go to sign in");
  });
});

describe("AUTH-OTP-07 · a /login link is present in BOTH otpLive states", () => {
  it("both renders contain at least one href=/login?accepted=1", () => {
    expect(render(true)).toContain(LOGIN_HREF);
    expect(render(false)).toContain(LOGIN_HREF);
  });
});

/**
 * AUTH-OTP-06 wiring that a static render cannot exercise: the mount-time single `requestOtp`, and
 * `verifyLogin` (which redirects to /dashboard on success). Proven at the source (comment-stripped).
 */
describe("AUTH-OTP-06 · OTP card auto-sends once on mount and verifies via verifyLogin (source)", () => {
  const WIZARD = readCode("components/onboarding/wizard.tsx");

  it("the done phase renders OnboardingOtpFinish exactly when result.otpLive", () => {
    expect(WIZARD).toContain("result.otpLive && <OnboardingOtpFinish");
    // and the plain Sign-in button is the else case (gated on NOT otpLive)
    expect(WIZARD).toContain("!result.otpLive");
  });

  it("mounts one app-controlled requestOtp to the admin phone", () => {
    const effStart = WIZARD.indexOf("useEffect(");
    const effEnd = WIZARD.indexOf("}, [phone]);", effStart);
    const effect = WIZARD.slice(effStart, effEnd);
    expect(effect).toContain("requestOtp(phone)");
    // exactly one requestOtp inside the mount effect (the second call lives in `resend`, outside it)
    expect((effect.match(/requestOtp\(/g) ?? []).length).toBe(1);
  });

  it("verify calls verifyLogin(phone, code) — which redirects to /dashboard", () => {
    expect(WIZARD).toContain("verifyLogin(phone, code.trim())");
    // verifyLogin's /dashboard redirect lives in the action, not the component.
    expect(readCode("lib/actions/auth.ts")).toMatch(/verifyLogin[\s\S]*redirect\("\/dashboard"\)/);
  });
});
