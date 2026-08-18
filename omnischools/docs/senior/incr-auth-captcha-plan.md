# INCR-AUTH-CAPTCHA — plan: bot protection on the auth entry points

**Status:** built (Claude Code) · follow-up (e) of the auth audit (item #4 — brute-force / bot-spam of the login + OTP-send + reset endpoints). **Provider:** Cloudflare Turnstile (owner may switch to hCaptcha; both are Supabase-native).

## Why / what
Supabase Auth has native CAPTCHA support (Auth → Protection). When enabled, GoTrue **requires** a `captchaToken` on every friction endpoint — `signInWithOtp`, `signInWithPassword`, `signUp`, `resetPasswordForEmail` — or the call is rejected. So this is **all-or-nothing at the project level**: the client must send a token on *every* auth entry point, not just login. `verifyOtp` (submitting the code) is NOT captcha-gated — only the initiating calls are.

## Design
- **Inert until configured** (mirrors `AUTH_OTP_LIVE`): a new **`NEXT_PUBLIC_TURNSTILE_SITE_KEY`**. No key ⇒ `captchaEnabled()` false ⇒ no widget renders and no token is sent (`lib/captcha.ts`). The seam passes `options.captchaToken` only when a token is present, so with the key unset and Supabase captcha OFF, nothing changes.
- **Seam-only Supabase touch** (portability): `captchaToken?` threads through `lib/auth` (`signInWithPhone`, `signInWithPassword`, `createPasswordUser`, `sendPasswordResetEmail`) into `options: { captchaToken }`. Feature code never touches `supabase.auth.*`.
- **One shared widget** `components/auth/captcha-widget.tsx` (wraps `@marsidev/react-turnstile`): renders only when `captchaSiteKey()` is set; `onToken(token)` on solve; a `resetKey` prop remounts it to clear the **single-use** token after a failed attempt.
- **Entry points** (each gets the widget + threads the token): login OTP-send + password (`login-form`), onboarding signup (`wizard`), invite-accept (`accept-form`), password reset — phone OTP-send + email (`reset-form`).
- **CSP:** `next.config.mjs` report-only CSP gains Turnstile's origins (`https://challenges.cloudflare.com`) in `script-src` + `frame-src`.

## Owner rollout (coordinate, or auth breaks) — like the OTP P-steps
1. Create a Cloudflare **Turnstile** widget → get the **site key** (public) + **secret** (server).
2. Add the secret in Supabase **Auth → Protection → enable CAPTCHA → Turnstile → secret key**.
3. Set **`NEXT_PUBLIC_TURNSTILE_SITE_KEY`** (env) to the site key + add your domain (and `localhost` for testing) to the Turnstile widget's allowed hostnames.
Do 1→2→3 together: enabling Supabase captcha (step 2) makes GoTrue require a token, and the client only sends one once the site key is set (step 3). With both unset it's fully inert. To switch to hCaptcha instead: pick hCaptcha in step 2, and swap the widget lib + the CSP origin (the seam/token flow is identical).

## Gate note
No live demo possible here (dev-bypass makes auth inert + no site key + the running dev server is a different worktree). Verified by source + `tsc`/build/suite; the widget lifecycle is delegated to the maintained `@marsidev/react-turnstile`.
