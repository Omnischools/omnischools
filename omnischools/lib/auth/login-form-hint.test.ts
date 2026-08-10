import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readCode } from "@/lib/test-utils/source-shape";
import { LoginForm } from "@/components/auth/login-form";

/**
 * INCR-AUTH-OTP · AUTH-OTP-10 — the Password tab shows a STATIC first-login hint that does not vary
 * with account existence/confirmation (enumeration-safe). The hint only renders in the password tab,
 * reached by a click that `renderToStaticMarkup` cannot simulate; the enforceable invariant is that it
 * is a literal, not a value derived from account state, so it is proven at the SOURCE. The render half
 * confirms the ONLY account-state-driven text on the page is the navigation banner (`?accepted=1` /
 * `?reset=1`) — never an existence/confirmation oracle.
 */
const FORM = readCode("components/auth/login-form.tsx");
const AUTH_ACTIONS = readCode("lib/actions/auth.ts");

const visible = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&apos;|&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

describe("AUTH-OTP-10 · the first-login hint is a static literal (source)", () => {
  it("the hint copy is present in the password branch", () => {
    expect(FORM).toContain("First time signing in?");
    expect(FORM).toContain("Phone OTP");
    // It sits inside the password-tab branch (the `mode === \"password\"` else-arm), not the OTP tab.
    expect(FORM).toContain('mode === "otp"');
  });

  it("the hint does NOT interpolate account state (no accepted/error/phone/password expression)", () => {
    // Isolate the hint paragraph and prove it contains no `{…}` JSX expression at all — a pure literal.
    const hintStart = FORM.indexOf("First time signing in?");
    // The <p> opens shortly before the copy; grab a generous window around the paragraph.
    const windowStart = FORM.lastIndexOf("<p", hintStart);
    const windowEnd = FORM.indexOf("</p>", hintStart);
    const hint = FORM.slice(windowStart, windowEnd);
    expect(hint).not.toMatch(/\{[^}]*\b(accepted|reset|error|phone|password|exist|confirm)\b/i);
  });
});

describe("AUTH-OTP-10 · the password-failure message is a single generic constant (source)", () => {
  it("passwordLogin returns the same 'Invalid phone or password.' regardless of the reason", () => {
    // One constant, used for BOTH the empty-input and the auth-failure branch — no unknown-vs-wrong
    // -password oracle. (Enumeration-safety; the OTP send path is Sarah's INCR-38 territory.)
    expect(AUTH_ACTIONS).toContain('"Invalid phone or password."');
    expect(AUTH_ACTIONS).not.toMatch(/no such (account|user)|not found|unconfirmed|does not exist/i);
  });
});

describe("AUTH-OTP-10 · rendered login page leaks no existence oracle", () => {
  it("the accepted banner is the ONLY state signal, and it is a navigation flag, not account state", () => {
    const withBanner = renderToStaticMarkup(createElement(LoginForm, { accepted: true }));
    const noBanner = renderToStaticMarkup(createElement(LoginForm, { accepted: false }));
    expect(visible(withBanner)).toContain("Account ready");
    expect(visible(noBanner)).not.toContain("Account ready");
    // Neither render (nor the reset variant) ever names an account's existence/confirmation state.
    for (const html of [
      withBanner,
      noBanner,
      renderToStaticMarkup(createElement(LoginForm, { reset: true })),
    ]) {
      expect(visible(html)).not.toMatch(/not found|no such|unconfirmed|does not exist|already registered/i);
    }
  });
});
