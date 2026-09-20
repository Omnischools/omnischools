import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * #304 — onboarding OTP-first auto-sign-in must not SILENTLY degrade when CAPTCHA is on.
 *
 * With CAPTCHA enabled the app-controlled OTP auto-send can't run (there is no user-solved token before
 * the mount-time send), so inline auto-sign-in is impossible. The done phase must instead render an
 * EXPLICIT hand-off (why + phone + a /login route), and must NOT render the auto-send OTP card — that
 * card would attempt a captcha-less send, and there is no bypass. With CAPTCHA off the inline auto-sign-in
 * is unchanged.
 *
 * `captchaEnabled()` is MOCKED per case (not env-stubbed with a module reset + dynamic re-import). The
 * earlier resetModules/stubEnv/`await import` dance raced the once-at-load `env` parse under parallel
 * suite contention (cold-transform timeout + non-hermetic env bleed — Dex/Quinn #304). A static
 * `DonePanel` import + a per-case mock is hermetic and fast. `renderToStaticMarkup` runs in node (no
 * jsdom): mount effects do NOT fire, so the render proves the STRUCTURE (which card shows, which route).
 */
vi.mock("@/lib/captcha", () => ({ captchaEnabled: vi.fn(() => false) }));
import { captchaEnabled } from "@/lib/captcha";
import { DonePanel } from "@/components/onboarding/wizard";

const mockedCaptcha = vi.mocked(captchaEnabled);
beforeEach(() => mockedCaptcha.mockReset());

const renderDone = (opts: { otpLive: boolean; captcha: boolean }): string => {
  mockedCaptcha.mockReturnValue(opts.captcha);
  return renderToStaticMarkup(
    createElement(DonePanel, {
      result: {
        ok: true as const,
        schoolId: "sch_123",
        academicYear: "2025/26",
        periodsCreated: 3,
        adminPhone: "+233241234567",
        otpLive: opts.otpLive,
      },
      schoolName: "St. Theresa's SHS",
    }),
  );
};

const visible = (html: string): string =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&apos;|&#x27;/g, "'")
    // Ampersand LAST: unescaping &amp; before the named entities can double-unescape (CodeQL js/double-escaping).
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

const LOGIN_HREF = 'href="/login?accepted=1"';
// The auto-send OTP card (OnboardingOtpFinish) — its title & CTA are distinct from the hand-off's copy.
const AUTO_SEND_CARD = "Finish signing in — verify your number";
const AUTO_SEND_CTA = "Verify & go to dashboard";

describe("#304 · onboarding done phase — CAPTCHA on renders an EXPLICIT hand-off (no silent drop)", () => {
  it("otpLive + captcha ON: explicit hand-off names the reason + phone, and does NOT auto-send an OTP", () => {
    const html = renderDone({ otpLive: true, captcha: true });
    const text = visible(html);
    // Explicit, not silent: the hand-off card, the security reason, and the phone to sign in with.
    expect(text).toContain("finish signing in");
    expect(text).toContain("quick verification");
    expect(text).toContain("+233241234567");
    // The auto-send card must NOT render — it can't supply a captcha token (no bypass introduced).
    expect(text).not.toContain(AUTO_SEND_CARD);
    expect(text).not.toContain(AUTO_SEND_CTA); // text unescapes &amp; → &, catches the card either way
    // Still routes to the captcha-gated /login OTP page — captcha stays in force.
    expect(html).toContain(LOGIN_HREF);
  });

  it("otpLive + captcha OFF: inline auto-sign-in is unchanged (card renders, no hand-off)", () => {
    const html = renderDone({ otpLive: true, captcha: false });
    const text = visible(html);
    expect(text).toContain(AUTO_SEND_CARD);
    expect(text).toContain(AUTO_SEND_CTA); // visible() unescapes &amp; → & ; raw html has &amp;
    // The captcha hand-off copy is absent when captcha is off.
    expect(text).not.toContain("quick verification");
  });

  it("otpLive=false: pre-OTP terminal button, regardless of captcha", () => {
    const html = renderDone({ otpLive: false, captcha: true });
    const text = visible(html);
    expect(text).toContain("Sign in →");
    expect(text).not.toContain(AUTO_SEND_CARD);
    expect(text).not.toContain("quick verification");
    expect(html).toContain(LOGIN_HREF);
  });
});
