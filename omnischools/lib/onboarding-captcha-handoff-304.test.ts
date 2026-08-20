import { describe, it, expect, afterEach, vi } from "vitest";
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
 * `env` (→ `captchaEnabled`) is parsed once at module load, so we stub the site key then re-import the
 * wizard fresh per case. `renderToStaticMarkup` runs in node (no jsdom); mount effects do NOT fire, so the
 * render proves the STRUCTURE (which card shows, which route exists).
 */
async function renderDone(opts: { otpLive: boolean; captcha: boolean }): Promise<string> {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", opts.captcha ? "0x_test_sitekey" : undefined);
  const { DonePanel } = await import("@/components/onboarding/wizard");
  const result = {
    ok: true as const,
    schoolId: "sch_123",
    academicYear: "2025/26",
    periodsCreated: 3,
    adminPhone: "+233241234567",
    otpLive: opts.otpLive,
  };
  return renderToStaticMarkup(
    createElement(DonePanel, { result, schoolName: "St. Theresa's SHS" }),
  );
}

const visible = (html: string): string =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&apos;|&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

const LOGIN_HREF = 'href="/login?accepted=1"';
// The auto-send OTP card (OnboardingOtpFinish) — its title & CTA are distinct from the hand-off's copy.
const AUTO_SEND_CARD = "Finish signing in — verify your number";
const AUTO_SEND_CTA = "Verify & go to dashboard";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("#304 · onboarding done phase — CAPTCHA on renders an EXPLICIT hand-off (no silent drop)", () => {
  it("otpLive + captcha ON: explicit hand-off names the reason + phone, and does NOT auto-send an OTP", async () => {
    const html = await renderDone({ otpLive: true, captcha: true });
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

  it("otpLive + captcha OFF: inline auto-sign-in is unchanged (card renders, no hand-off)", async () => {
    const html = await renderDone({ otpLive: true, captcha: false });
    const text = visible(html);
    expect(text).toContain(AUTO_SEND_CARD);
    expect(text).toContain(AUTO_SEND_CTA); // visible() unescapes &amp; → & ; raw html has &amp;
    // The captcha hand-off copy is absent when captcha is off.
    expect(text).not.toContain("quick verification");
  });

  it("otpLive=false: pre-OTP terminal button, regardless of captcha", async () => {
    const html = await renderDone({ otpLive: false, captcha: true });
    const text = visible(html);
    expect(text).toContain("Sign in →");
    expect(text).not.toContain(AUTO_SEND_CARD);
    expect(text).not.toContain("quick verification");
    expect(html).toContain(LOGIN_HREF);
  });
});
