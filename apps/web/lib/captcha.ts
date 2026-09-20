import { env } from "@/lib/env";

/**
 * INCR-AUTH-CAPTCHA (audit #4) — client-safe captcha config. The site key is PUBLIC (NEXT_PUBLIC), so this
 * is importable from client components. Its PRESENCE is the on-switch: unset ⇒ no widget renders and no
 * token is sent, so the auth flow is byte-identical to today (and Supabase captcha must be OFF to match).
 * See docs/senior/incr-auth-captcha-plan.md. Provider = Cloudflare Turnstile.
 */
export function captchaSiteKey(): string | undefined {
  return env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || undefined;
}

export function captchaEnabled(): boolean {
  return !!captchaSiteKey();
}
