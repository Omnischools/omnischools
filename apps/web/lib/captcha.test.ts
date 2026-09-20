import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// INCR-AUTH-CAPTCHA — the captcha config helper is the on-switch: inert when NEXT_PUBLIC_TURNSTILE_SITE_KEY
// is unset/empty, active when set. `env` is parsed once at module load, so each case stubs then re-imports.
vi.setConfig({ testTimeout: 20_000 });

async function load(siteKey?: string) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", siteKey);
  return import("@/lib/captcha");
}

// Same stub-then-reimport dance for the widget/hook module (it reads the site key transitively via
// lib/captcha → lib/env, both parsed at load). renderToStaticMarkup runs in node (no jsdom needed).
async function loadWidget(siteKey?: string) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", siteKey);
  return import("@/components/auth/captcha-widget");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("captcha config (INCR-AUTH-CAPTCHA)", () => {
  it("inert when the site key is unset — no widget, no token", async () => {
    const { captchaEnabled, captchaSiteKey } = await load(undefined);
    expect(captchaEnabled()).toBe(false);
    expect(captchaSiteKey()).toBeUndefined();
  });

  it("inert when the site key is an empty string", async () => {
    const { captchaEnabled, captchaSiteKey } = await load("");
    expect(captchaEnabled()).toBe(false);
    expect(captchaSiteKey()).toBeUndefined();
  });

  it("active when a site key is set", async () => {
    const { captchaEnabled, captchaSiteKey } = await load("0x_test_sitekey");
    expect(captchaEnabled()).toBe(true);
    expect(captchaSiteKey()).toBe("0x_test_sitekey");
  });
});

/**
 * The shared widget + `useCaptcha` hook — the un-demoable half (inert in dev, external Cloudflare
 * script, wrong worktree runs the dev server). Proven here via renderToStaticMarkup instead. The
 * freshly-imported hook is parked on `hookRef` and exercised through a real React render by `MissingProbe`
 * (a named, capitalised component so eslint's react/display-name + rules-of-hooks stay satisfied; the ref
 * name is off `use*` so the call site isn't misread — the hook's own useState lives in the widget module).
 */
let hookRef: (() => { missing: () => boolean }) | null = null;
function MissingProbe() {
  return createElement("output", null, String(hookRef!().missing()));
}

describe("CaptchaWidget + useCaptcha (INCR-AUTH-CAPTCHA)", () => {
  it("INERT (KEY) — <CaptchaWidget> renders NOTHING with no site key (no widget, no token)", async () => {
    const { CaptchaWidget } = await loadWidget(undefined);
    const html = renderToStaticMarkup(createElement(CaptchaWidget, { onToken: () => {} }));
    // MUTATION GUARD: delete `if (!siteKey) return null` and this renders the Turnstile mount → RED.
    expect(html).toBe("");
  });

  it("renders the Turnstile mount when the site key IS set (proves the null-guard is non-vacuous)", async () => {
    const { CaptchaWidget } = await loadWidget("0x_test_sitekey");
    const html = renderToStaticMarkup(
      createElement(CaptchaWidget, { onToken: () => {}, resetKey: 0 }),
    );
    expect(html).not.toBe("");
    expect(html).toContain("cf-turnstile"); // @marsidev/react-turnstile's mount node
  });

  it("INERT (KEY) — useCaptcha().missing() is FALSE when disabled, so submit is NOT blocked", async () => {
    hookRef = (await loadWidget(undefined)).useCaptcha;
    // missing() === captchaEnabled() && !token; disabled ⇒ false regardless of token ⇒ every form submits.
    expect(renderToStaticMarkup(createElement(MissingProbe))).toBe("<output>false</output>");
  });

  it("useCaptcha().missing() is TRUE when enabled with no token yet — submit blocked until solved", async () => {
    hookRef = (await loadWidget("0x_test_sitekey")).useCaptcha;
    // token starts "" (useState); enabled + empty ⇒ blocked. This is the property the 4 forms gate on.
    expect(renderToStaticMarkup(createElement(MissingProbe))).toBe("<output>true</output>");
  });
});
