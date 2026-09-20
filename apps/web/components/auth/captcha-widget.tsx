"use client";
import { useState } from "react";
import { Turnstile } from "@marsidev/react-turnstile";
import { captchaSiteKey, captchaEnabled } from "@/lib/captcha";

/**
 * Per-form captcha state (INCR-AUTH-CAPTCHA). Pair with <CaptchaWidget>: feed `setToken`/`resetKey` to the
 * widget, call `missing()` at the top of submit to block until solved, pass `token` to the action, and call
 * `reset()` on a failed attempt (the token is single-use). All no-ops when the site key is unset.
 */
export function useCaptcha() {
  const [token, setToken] = useState("");
  const [resetKey, setResetKey] = useState(0);
  return {
    token,
    setToken,
    resetKey,
    /** True when a token is required (captcha enabled) but not yet solved — block submit. */
    missing: () => captchaEnabled() && !token,
    /** After a failed attempt: clear the spent token and remount the widget for a fresh one. */
    reset: () => {
      setToken("");
      setResetKey((k) => k + 1);
    },
  };
}

/**
 * INCR-AUTH-CAPTCHA — the shared Cloudflare Turnstile widget. Renders ONLY when
 * `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set; otherwise returns null (no widget, no token, fully inert).
 * `onToken(token)` fires on solve; on error/expiry it fires `onToken("")` so the caller can require a
 * FRESH token before submit. The token is single-use — after a failed attempt, bump `resetKey` (used as
 * the React `key`) to remount the widget and clear the spent token.
 */
export function CaptchaWidget({
  onToken,
  resetKey,
}: {
  onToken: (token: string) => void;
  resetKey?: number;
}) {
  const siteKey = captchaSiteKey();
  if (!siteKey) return null;
  return (
    <div className="mt-1">
      <Turnstile
        key={resetKey}
        siteKey={siteKey}
        onSuccess={onToken}
        onError={() => onToken("")}
        onExpire={() => onToken("")}
        options={{ theme: "auto" }}
      />
    </div>
  );
}
